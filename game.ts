enum Cell {
  empty,
  wall,
  crate,
  bomb,
  explosion,
  powerupFirePower,
  powerupBomb,
}

/* ---------- types shared with server ---------- */
interface ServerInit {
  t: "init";
  id: string; // my authoritative id
  grid: Cell[][];
  actors: RemoteActor[];
  scores: Record<string, Score>;
}
interface ServerDiff {
  t: "diff";
  cells: PatchCell[];
  actors: PatchActor[];
  scores?: Record<string, Score>;
}

type ServerMsg = ServerInit | ServerDiff;

interface PatchCell {
  x: number;
  y: number;
  v: Cell;
}
interface PatchActor {
  id: string;
  x: number;
  y: number;
  alive: boolean;
}
interface RemoteActor {
  id: string;
  x: number;
  y: number;
  color: string;
}
interface Score {
  k: number;
  d: number;
  a: number;
}
/* ---------- local-only structures ---------- */

interface Bomb {
  x: number;
  y: number;
  owner: Actor;
  fuse: number;
}
interface Explosion {
  x: number;
  y: number;
  timer: number; // ms until clear
  spawn: Cell; // restore after
}

type Actor = Player | Bot;

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
/* ---------- play mode ---------- */
enum Mode {
  Local,
  Online,
}
let mode: Mode = Mode.Local;

/* ---------- networking ---------- */
let ws: WebSocket | null = null;
let myId = "";

/* ---------- UI hooks ---------- */
document.getElementById("withBots")!.onclick = startLocal;
document.getElementById("online")!.onclick = startOnline;

const TILE_SIZE = 35;
const COLS = 20;
const ROWS = 18;

type MS = number;
const MOVE_COOLDOWN: MS = 150;
const BOMB_FUSE: MS = 2000;
const EXPLOSION_DURATION: MS = 500;
const CRATE_REFILL_INTERVAL: MS = 20000; // 20s

canvas.width = COLS * TILE_SIZE;
canvas.height = ROWS * TILE_SIZE;

let grid: Cell[][] = [];
let player!: Player;
let bots: Bot[] = [];
let bombs: Bomb[] = [];
let explosions: Explosion[] = [];
const chainMap = new Map<Bomb, Actor>();
let crateTimer = 0;

// input
let pendingMove: [number, number] | null = null;
let pendingBomb = false;

// scoreboard elems
const scoreBoard = document.getElementById("scoreboard") as HTMLDivElement;
const killEl = document.getElementById("kills") as HTMLSpanElement;
const deathEl = document.getElementById("deaths") as HTMLSpanElement;
const assistEl = document.getElementById("assists") as HTMLSpanElement;

/* ===================================================================== */
/*                           LOCAL  MODE                                 */
/* ===================================================================== */

function startLocal() {
  mode = Mode.Local;
  const color = (document.getElementById("color") as HTMLInputElement).value;
  player = new Player(color);
  init();
}

/* ===================================================================== */
/*                           ONLINE  MODE                                */
/* ===================================================================== */

function startOnline() {
  mode = Mode.Online;
  const color = (document.getElementById("color") as HTMLInputElement).value;
  openSocket(color);
}

function openSocket(color: string) {
  ws = new WebSocket("ws://localhost:4000");
  ws.onopen = () => ws!.send(JSON.stringify({ t: "join", color }));
  ws.onmessage = (ev) => handleServer(JSON.parse(ev.data));
  ws.onclose = () => alert("Disconnected");
  prepareCanvasForOnline();
}

function prepareCanvasForOnline() {
  document.getElementById("menu")!.style.display = "none";
  scoreBoard.style.display = "block";
  canvas.style.display = "block";
  bombs.length = explosions.length = 0;
}

function syncScores(all: Record<string, Score>) {
  const me = all[myId];
  if (!me) return; // not received yet
  killEl.textContent = me.k.toString();
  deathEl.textContent = me.d.toString();
  assistEl.textContent = me.a.toString();
}

function handleServer(msg: ServerMsg) {
  if (msg.t === "init") {
    myId = msg.id;
    grid = msg.grid;
    remoteActors = new Map(msg.actors.map((a) => [a.id, a]));
    syncScores(msg.scores);
    draw();
  } else if (msg.t === "diff") {
    // patch cells
    msg.cells.forEach((c) => (grid[c.y][c.x] = c.v));
    // patch actors
    if (msg.scores) syncScores(msg.scores);

    msg.actors.forEach((a) => {
      if (!remoteActors.has(a.id)) return;
      remoteActors.get(a.id)!.x = a.x;
      remoteActors.get(a.id)!.y = a.y;
    });
  }
}

/* ---------- client input ---------- */

window.addEventListener("keydown", (e) => {
  const dir: Record<string, [number, number]> = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  };
  if (mode === Mode.Local) {
    if (dir[e.key]) pendingMove = dir[e.key];
    if (e.key === " ") pendingBomb = true;
  } else {
    if (!ws || ws.readyState !== 1) return;
    if (dir[e.key]) ws.send(JSON.stringify({ t: "move", dir: dir[e.key] }));
    if (e.key === " ") ws.send(JSON.stringify({ t: "bomb" }));
  }
});

class Player {
  x = 1;
  y = 1;
  firePower = 2;
  maxBombs = 1;
  activeBombs = 0;
  lastMoveAt = 0;
  kills = 0;
  deaths = 0;
  assists = 0;
  constructor(public color: string) {}
}

class Bot extends Player {
  constructor(x: number, y: number) {
    super("#8000fa");
    this.x = x;
    this.y = y;
  }
  tryStep() {
    const now = performance.now();
    if (now - this.lastMoveAt < MOVE_COOLDOWN) return;
    this.lastMoveAt = now;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const;
    const [dx, dy] = dirs[Math.floor(Math.random() * 4)];
    if (isEmpty(this.x + dx, this.y + dy)) {
      this.x += dx;
      this.y += dy;
      this.checkPickup();
    }
    if (Math.random() < 0.03) placeBomb(this);
  }
  checkPickup() {
    const c = grid[this.y][this.x];
    if (c === Cell.powerupFirePower) {
      this.firePower++;
      grid[this.y][this.x] = Cell.empty;
    }
    if (c === Cell.powerupBomb) {
      this.maxBombs++;
      grid[this.y][this.x] = Cell.empty;
    }
  }
}

function init() {
  document.getElementById("menu")!.style.display = "none";
  scoreBoard.style.display = "block";
  canvas.style.display = "block";

  buildGrid();
  bots = [
    // new Bot(COLS - 2, ROWS - 2),
    // new Bot(1, ROWS - 2),
    // new Bot(COLS - 2, 1),
  ];

  lastFrame = performance.now();
  crateTimer = 0;
  requestAnimationFrame(gameLoop);
}

function buildGrid() {
  for (let y = 0; y < ROWS; y++) {
    grid[y] = [];
    for (let x = 0; x < COLS; x++) {
      const border = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
      const block = x % 2 === 0 && y % 2 === 0;
      if (border || block) grid[y][x] = Cell.wall;
      else grid[y][x] = Math.random() < 0.5 ? Cell.crate : Cell.empty;
    }
  }
}

function placeBomb(actor: Actor) {
  if (actor.activeBombs >= actor.maxBombs) return;
  if (grid[actor.y][actor.x] !== Cell.empty) return;
  actor.activeBombs++;
  grid[actor.y][actor.x] = Cell.bomb;
  const b: Bomb = { x: actor.x, y: actor.y, owner: actor, fuse: BOMB_FUSE };
  bombs.push(b);
}

/* ===================================================================== */
/*                     RENDER LOOP (both modes)                          */
/* ===================================================================== */

let remoteActors = new Map<string, RemoteActor>(); // online only
let lastFrame = performance.now();

function gameLoop(now: number) {
  const delta = now - lastFrame;
  lastFrame = now;

  if (mode === Mode.Local) localGameLoop(delta, now);

  draw();
  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop); // bootstrap loop once

function localGameLoop(delta: number, now: number) {
  // 1) player
  if (pendingMove) {
    const [dx, dy] = pendingMove;
    if (
      now - player.lastMoveAt >= MOVE_COOLDOWN &&
      isEmpty(player.x + dx, player.y + dy)
    ) {
      player.x += dx;
      player.y += dy;
      player.lastMoveAt = now;
      checkPickup();
    }
    pendingMove = null;
  }
  if (pendingBomb) {
    placeBomb(player);
    pendingBomb = false;
  }

  // 2) bots
  bots.forEach((b) => b.tryStep());

  // 3) bombs
  for (let i = bombs.length - 1; i >= 0; i--) {
    const b = bombs[i];
    b.fuse -= delta;
    if (b.fuse <= 0) {
      b.owner.activeBombs--;
      explode(b);
      bombs.splice(i, 1);
      chainMap.delete(b);
    }
  }

  // 4) explosions
  for (let i = explosions.length - 1; i >= 0; i--) {
    explosions[i].timer -= delta;
    if (explosions[i].timer <= 0) {
      const e = explosions[i];
      if (grid[e.y][e.x] === Cell.explosion) grid[e.y][e.x] = e.spawn;
      explosions.splice(i, 1);
    }
  }

  // 5) crate refill
  crateTimer += delta;
  if (crateTimer >= CRATE_REFILL_INTERVAL) {
    crateTimer = 0;
    refillCrates();
  }
}

function explode(bomb: Bomb) {
  const trigger = chainMap.get(bomb) || bomb.owner;
  const toSpawn = (old: Cell) => {
    if (old !== Cell.crate) return Cell.empty;
    const r = Math.random();
    if (r < 0.1) return Cell.powerupFirePower;
    if (r < 0.2) return Cell.powerupBomb;
    return Cell.empty;
  };

  const cells: Explosion[] = [];
  cells.push({
    x: bomb.x,
    y: bomb.y,
    timer: EXPLOSION_DURATION,
    spawn: toSpawn(grid[bomb.y][bomb.x]),
  });

  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    for (let i = 1; i <= bomb.owner.firePower; i++) {
      const nx = bomb.x + dx * i,
        ny = bomb.y + dy * i;
      if (!inBounds(nx, ny) || grid[ny][nx] === Cell.wall) break;

      if (grid[ny][nx] === Cell.bomb) {
        // chain
        const child = bombs.find((b2) => b2.x === nx && b2.y === ny);
        if (child) {
          child.fuse = 0;
          chainMap.set(child, trigger);
        }
      }

      if (grid[ny][nx] === Cell.crate || grid[ny][nx] === Cell.bomb) {
        cells.push({
          x: nx,
          y: ny,
          timer: EXPLOSION_DURATION,
          spawn: toSpawn(grid[ny][nx]),
        });
        break;
      }

      cells.push({
        x: nx,
        y: ny,
        timer: EXPLOSION_DURATION,
        spawn: Cell.empty,
      });
    }
  }

  // apply
  cells.forEach((e) => {
    grid[e.y][e.x] = Cell.explosion;
    explosions.push(e);
  });

  // handle deaths & scoring
  [player, ...bots].forEach((act) => {
    if (grid[act.y][act.x] === Cell.explosion) {
      if (act === player) {
        player.deaths++;
        resetPlayer();
      } else {
        // bot died
        if (trigger === player) {
          // assist if chain, else kill
          if (chainMap.has(bomb)) player.assists++;
          else player.kills++;
        }
      }
      updateScoreboard();
    }
  });
}

function checkPickup() {
  const c = grid[player.y][player.x];
  if (c === Cell.powerupFirePower) {
    player.firePower++;
    grid[player.y][player.x] = Cell.empty;
  }
  if (c === Cell.powerupBomb) {
    player.maxBombs++;
    grid[player.y][player.x] = Cell.empty;
  }
}

function refillCrates() {
  const total = COLS * ROWS;
  const crates = grid.flat().filter((c) => c === Cell.crate).length;
  if (crates < total * 0.1) {
    const target = Math.ceil(total * 0.15) - crates;
    let added = 0;
    while (added < target) {
      const x = Math.floor(Math.random() * COLS);
      const y = Math.floor(Math.random() * ROWS);
      if (grid[y][x] === Cell.empty && !(x === player.x && y === player.y)) {
        grid[y][x] = Cell.crate;
        added++;
      }
    }
  }
}

function resetPlayer() {
  player.x = 1;
  player.y = 1;
  player.firePower = 2;
  player.maxBombs = 1;
  player.activeBombs = 0;
}

function updateScoreboard() {
  killEl.textContent = player.kills.toString();
  deathEl.textContent = player.deaths.toString();
  assistEl.textContent = player.assists.toString();
}

function isEmpty(x: number, y: number) {
  if (!inBounds(x, y)) return false;
  const c = grid[y][x];
  return (
    c === Cell.empty || c === Cell.powerupFirePower || c === Cell.powerupBomb
  );
}

function inBounds(x: number, y: number) {
  return x >= 0 && y >= 0 && x < COLS && y < ROWS;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = grid[y][x];
      ctx.fillStyle =
        c === Cell.wall
          ? "gray"
          : c === Cell.crate
          ? "#a0522d"
          : c === Cell.bomb
          ? "rgba(50,50,50,0.7)"
          : c === Cell.explosion
          ? "red"
          : c === Cell.powerupFirePower
          ? "yellow"
          : c === Cell.powerupBomb
          ? "blue"
          : "#fff";
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
  if (mode === Mode.Local) {
    [player, ...bots].forEach(drawActor);
  } else {
    remoteActors.forEach((a) => {
      ctx.fillStyle = a.id === myId ? "#fff" : a.color;
      drawRect(a.x, a.y);
    });
  }
}

function drawActor(a: { x: number; y: number; color: string }) {
  ctx.fillStyle = a.color;
  drawRect(a.x, a.y);
}

function drawRect(x: number, y: number) {
  ctx.fillRect(
    x * TILE_SIZE + 5,
    y * TILE_SIZE + 5,
    TILE_SIZE - 10,
    TILE_SIZE - 10
  );
}
