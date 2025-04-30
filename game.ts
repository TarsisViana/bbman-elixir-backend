enum Cell {
  empty,
  wall,
  crate,
  bomb,
  explosion,
  powerupFirePower,
  powerupBomb,
}

interface Bomb {
  x: number;
  y: number;
  owner: Actor;
  fuse: number; // ms until explode
}

interface Explosion {
  x: number;
  y: number;
  timer: number; // ms until clear
  spawn: Cell; // what to restore after explosion
}

type Actor = Player | Bot;

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const TILE_SIZE = 35;
const COLS = 20;
const ROWS = 18;

type MiliSecond = number;

const MOVE_COOLDOWN: MiliSecond = 150;
const BOMB_FUSE: MiliSecond = 2000;
const EXPLOSION_DURATION: MiliSecond = 500;

canvas.width = COLS * TILE_SIZE;
canvas.height = ROWS * TILE_SIZE;

let grid: Cell[][] = [];
let player!: Player;
let bots: Bot[] = [];
let bombs: Bomb[] = [];
let explosions: Explosion[] = [];

// input queue
let pendingMove: [number, number] | null = null;
let pendingBomb = false;

document.getElementById("withBots")!.onclick = () => {
  const color = (document.getElementById("color") as HTMLSelectElement).value;
  player = new Player(color);
  init();
};

window.addEventListener("keydown", (e) => {
  const dirs: Record<string, [number, number]> = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  };
  if (e.key in dirs) pendingMove = dirs[e.key];
  if (e.key === " ") pendingBomb = true;
});

class Player {
  x = 1;
  y = 1;
  firePower = 2;
  maxBombs = 1;
  activeBombs = 0;
  lastMoveAt = 0;
  constructor(public color: string) {}
}

class Bot extends Player {
  constructor(x: number, y: number) {
    super("#8000fa");
    this.x = x;
    this.y = y;
  }

  tryStep() {
    const now = Date.now();
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
    const cell = grid[this.y][this.x];
    if (cell === Cell.powerupFirePower) {
      this.firePower++;
      grid[this.y][this.x] = Cell.empty;
    }
    if (cell === Cell.powerupBomb) {
      this.maxBombs++;
      grid[this.y][this.x] = Cell.empty;
    }
  }
}

function init() {
  document.getElementById("menu")!.style.display = "none";
  canvas.style.display = "block";

  buildGrid();

  bots = [
    new Bot(COLS - 2, ROWS - 2),
    new Bot(1, ROWS - 2),
    new Bot(COLS - 2, 1),
  ];

  lastFrame = performance.now();
  requestAnimationFrame(gameLoop);
}

function buildGrid() {
  for (let y = 0; y < ROWS; y++) {
    grid[y] = [];
    for (let x = 0; x < COLS; x++) {
      const isWall = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
      const isEveryTwoCells = x % 2 === 0 && y % 2 === 0;
      if (isWall || isEveryTwoCells) {
        grid[y][x] = Cell.wall;
      } else if (Math.random() < 0.5) {
        grid[y][x] = Cell.crate;
      } else {
        grid[y][x] = Cell.empty;
      }
    }
  }
}

function placeBomb(actor: Actor) {
  if (actor.activeBombs >= actor.maxBombs) return;
  if (grid[actor.y][actor.x] !== Cell.empty) return;

  grid[actor.y][actor.x] = Cell.bomb;
  actor.activeBombs++;
  bombs.push({
    x: actor.x,
    y: actor.y,
    owner: actor,
    fuse: BOMB_FUSE,
  });
}

let lastFrame = 0;
function gameLoop(now: number) {
  const delta = now - lastFrame;
  lastFrame = now;

  // 1) player input
  if (pendingMove) {
    const [dx, dy] = pendingMove;
    if (
      now - player.lastMoveAt >= MOVE_COOLDOWN &&
      isEmpty(player.x + dx, player.y + dy)
    ) {
      player.x += dx;
      player.y += dy;
      player.lastMoveAt = now;
      checkPlayerPickup();
    }
    pendingMove = null;
  }
  if (pendingBomb) {
    placeBomb(player);
    pendingBomb = false;
  }

  // 2) bots moving
  bots.forEach((b) => b.tryStep());

  // 3) bombs
  for (let i = bombs.length - 1; i >= 0; i--) {
    bombs[i].fuse -= delta;
    if (bombs[i].fuse <= 0) {
      const b = bombs[i];
      explode(b);
      bombs.splice(i, 1);
      b.owner.activeBombs--;
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

  // 5) render
  draw();
  requestAnimationFrame(gameLoop);
}

function explode(bomb: Bomb) {
  const { x, y, owner } = bomb;
  const toSpawn = (explodedStuff: Cell): Cell => {
    if (explodedStuff !== Cell.crate) return Cell.empty;
    const r = Math.random();
    if (r < 0.1) return Cell.powerupFirePower;
    if (r < 0.2) return Cell.powerupBomb;
    return Cell.empty;
  };

  // collect explosion cells
  const cells: Explosion[] = [];

  // center
  cells.push({
    x,
    y,
    timer: EXPLOSION_DURATION,
    spawn: toSpawn(grid[y][x]),
  });

  // four directions
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    for (let i = 1; i <= owner.firePower; i++) {
      const nx = x + dx * i,
        ny = y + dy * i;
      if (!inBounds(nx, ny) || grid[ny][nx] === Cell.wall) break;

      if (grid[ny][nx] === Cell.crate) {
        cells.push({
          x: nx,
          y: ny,
          timer: EXPLOSION_DURATION,
          spawn: toSpawn(Cell.crate),
        });
        break;
      }

      if (grid[ny][nx] === Cell.bomb) {
        // chain reaction
        for (const b2 of bombs) {
          if (b2.x === nx && b2.y === ny) {
            b2.fuse = 0;
            break;
          }
        }
      }

      cells.push({
        x: nx,
        y: ny,
        timer: EXPLOSION_DURATION,
        spawn: Cell.empty,
      });
    }
  }

  // apply explosion
  for (const e of cells) {
    grid[e.y][e.x] = Cell.explosion;
    explosions.push(e);
  }

  // reset any actor on explosion
  [player, ...bots].forEach((actor) => {
    if (grid[actor.y][actor.x] === Cell.explosion && actor === player) {
      actor.x = 1;
      actor.y = 1;
      actor.firePower = 2;
      actor.maxBombs = 1;
    }
  });
}

function checkPlayerPickup() {
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
  [player, ...bots].forEach((ent) => {
    ctx.fillStyle = ent.color;
    ctx.fillRect(
      ent.x * TILE_SIZE + 5,
      ent.y * TILE_SIZE + 5,
      TILE_SIZE - 10,
      TILE_SIZE - 10
    );
  });
}
