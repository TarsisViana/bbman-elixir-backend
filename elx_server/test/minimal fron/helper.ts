import WebSocket, { WebSocketServer } from 'ws';
import crypto from 'crypto';

const COLUMNS = 31;
const ROWS = 25;
const TICK_MS = 50;
const BOMB_FUSE_MS = 2000;
const EXPLOSION_MS = 500;
const RESPAWN_MS = 5000;
const CRATE_REFILL_MS = 20000;

enum Cell {
  empty,
  wall,
  crate,
  bomb,
  explosion,
  powerup_fire,
  powerup_bomb,
}

type PlayerMessage = { type: 'join'; color: string } | { type: 'move'; dx: number; dy: number } | { type: 'bomb' };

interface PlayerSnapshot {
  id: string;
  x: number;
  y: number;
  color: string;
  alive: boolean;
}

interface ScoreSnapshot {
  kills: number;
  deaths: number;
  assists: number;
}

class Player {
  id: string;
  x: number;
  y: number;
  alive = true;
  firePower = 2;
  maxBombs = 1;
  activeBombs = 0;
  kills = 0;
  deaths = 0;
  assists = 0;

  constructor(public ws: WebSocket, public color: string) {
    this.id = crypto.randomBytes(8).toString('hex');
    [this.x, this.y] = findFreeSpawn();
  }
}

class Bomb {
  explodeAt: number;
  constructor(public x: number, public y: number, public owner: Player) {
    this.explodeAt = Date.now() + BOMB_FUSE_MS;
  }
}

class Explosion {
  clearAt: number;
  constructor(public x: number, public y: number, public restoreTo: Cell) {
    this.clearAt = Date.now() + EXPLOSION_MS;
  }
}

let grid: Cell[][] = buildGrid();
const players = new Map<string, Player>();
let bombs: Bomb[] = [];
let explosions: Explosion[] = [];
const updatedCells = new Set<string>();
const updatedPlayers = new Set<string>();
let lastRefill = Date.now();

function buildGrid(): Cell[][] {
  return Array.from({ length: ROWS }, (_, y) =>
    Array.from({ length: COLUMNS }, (_, x) => {
      const border = x === 0 || x === COLUMNS - 1 || y === 0 || y === ROWS - 1;
      const pillar = x % 2 === 0 && y % 2 === 0;
      return border || pillar ? Cell.wall : Math.random() < 0.5 ? Cell.crate : Cell.empty;
    })
  );
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < COLUMNS && y >= 0 && y < ROWS;
}

function findFreeSpawn(): [number, number] {
  while (true) {
    const x = Math.floor(Math.random() * (COLUMNS - 2)) + 1;
    const y = Math.floor(Math.random() * (ROWS - 2)) + 1;
    const cellFree = grid[y][x] === Cell.empty;
    const noPlayer = ![...players.values()].some(p => p.alive && p.x === x && p.y === y);
    if (cellFree && noPlayer) return [x, y];
  }
}

function setCell(x: number, y: number, value: Cell): void {
  if (inBounds(x, y) && grid[y][x] !== value) {
    grid[y][x] = value;
    updatedCells.add(`${x},${y}`);
  }
}

function maybeRefillCrates() {
  if (Date.now() - lastRefill < CRATE_REFILL_MS) return;
  const count = grid.flat().filter(cell => cell === Cell.crate).length;
  if (count >= COLUMNS * ROWS * 0.10) {
    lastRefill = Date.now();
    return;
  }

  const target = Math.floor(COLUMNS * ROWS * 0.20);
  while (grid.flat().filter(c => c === Cell.crate).length < target) {
    const x = Math.floor(Math.random() * (COLUMNS - 2)) + 1;
    const y = Math.floor(Math.random() * (ROWS - 2)) + 1;
    if (grid[y][x] === Cell.empty && ![...players.values()].some(p => p.x === x && p.y === y)) {
      setCell(x, y, Cell.crate);
    }
  }

  lastRefill = Date.now();
}

function scheduleRespawn(player: Player) {
  setTimeout(() => {
    [player.x, player.y] = findFreeSpawn();
    player.alive = true;
    updatedPlayers.add(player.id);
  }, RESPAWN_MS);
}

function explodeBomb(bomb: Bomb) {
  bomb.owner.activeBombs--;
  blast([[bomb.x, bomb.y]], bomb.owner);

  const directions: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dy] of directions) {
    for (let i = 1; i <= bomb.owner.firePower; i++) {
      const nx = bomb.x + dx * i;
      const ny = bomb.y + dy * i;
      if (!inBounds(nx, ny) || grid[ny][nx] === Cell.wall) break;

      const before = grid[ny][nx];
      blast([[nx, ny]], bomb.owner);
      if ([Cell.crate, Cell.bomb].includes(before)) break;
    }
  }
}

function blast(cells: [number, number][], owner: Player) {
  for (const [x, y] of cells) {
    if (grid[y][x] === Cell.bomb) {
      bombs.forEach(b => {
        if (b.x === x && b.y === y) b.explodeAt = Date.now();
      });
    }

    const restore =
      grid[y][x] === Cell.crate
        ? Math.random() < 0.1
          ? Cell.powerup_fire
          : Math.random() < 0.2
            ? Cell.powerup_bomb
            : Cell.empty
        : Cell.empty;

    setCell(x, y, Cell.explosion);
    explosions.push(new Explosion(x, y, restore));

    for (const p of players.values()) {
      if (p.alive && p.x === x && p.y === y) {
        p.alive = false;
        p.deaths++;
        if (p !== owner) owner.kills++;
        updatedPlayers.add(p.id);
        updatedPlayers.add(owner.id);
        scheduleRespawn(p);
      }
    }
  }
}

function handleMove(p: Player, dx: number, dy: number) {
  if (!p.alive) return;
  const nx = p.x + dx;
  const ny = p.y + dy;

  if (!inBounds(nx, ny) || [Cell.wall, Cell.crate, Cell.bomb].includes(grid[ny][nx])) return;

  const cell = grid[ny][nx];
  p.x = nx;
  p.y = ny;

  if (cell === Cell.powerup_fire) {
    p.firePower++;
    setCell(nx, ny, Cell.empty);
  } else if (cell === Cell.powerup_bomb) {
    p.maxBombs++;
    setCell(nx, ny, Cell.empty);
  }

  updatedPlayers.add(p.id);
}

function handleBomb(p: Player) {
  if (!p.alive || p.activeBombs >= p.maxBombs || grid[p.y][p.x] !== Cell.empty) return;

  setCell(p.x, p.y, Cell.bomb);
  bombs.push(new Bomb(p.x, p.y, p));
  p.activeBombs++;
}

function snapshotPlayer(p: Player): PlayerSnapshot {
  return { id: p.id, x: p.x, y: p.y, color: p.color, alive: p.alive };
}

function snapshotScores(): Record<string, ScoreSnapshot> {
  const scores: Record<string, ScoreSnapshot> = {};
  players.forEach((p, id) => {
    scores[id] = { kills: p.kills, deaths: p.deaths, assists: p.assists };
  });
  return scores;
}

function broadcast(msg: object) {
  const data = JSON.stringify(msg);
  players.forEach(p => p.ws.send(data));
}

function gameLoop() {
  const now = Date.now();
  bombs = bombs.filter(b => {
    if (b.explodeAt <= now) {
      explodeBomb(b);
      return false;
    }
    return true;
  });

  explosions = explosions.filter(e => {
    if (e.clearAt <= now) {
      setCell(e.x, e.y, e.restoreTo);
      return false;
    }
    return true;
  });

  maybeRefillCrates();

  if (updatedCells.size > 0 || updatedPlayers.size > 0) {
    broadcast({
      type: 'diff',
      updatedCells: [...updatedCells].map(str => {
        const [x, y] = str.split(',').map(Number);
        return { x, y, value: grid[y][x] };
      }),
      updatedPlayers: [...updatedPlayers].map(id => snapshotPlayer(players.get(id)!)),
      scores: snapshotScores(),
    });
    updatedCells.clear();
    updatedPlayers.clear();
  }
}

// ─────────────────────────────────────────────────────
// Server Setup
// ─────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: 4000 }, () => {
  console.log('Bomberman server running on ws://localhost:4000');
});

wss.on('connection', ws => {
  ws.once('message', data => {
    const msg = JSON.parse(data.toString()) as PlayerMessage;
    if (msg.type !== 'join') return;

    const player = new Player(ws, msg.color);
    players.set(player.id, player);
    updatedPlayers.add(player.id);

    ws.send(
      JSON.stringify({
        type: 'init',
        playerId: player.id,
        grid,
        players: [...players.values()].map(snapshotPlayer),
        scores: snapshotScores(),
      })
    );

    broadcast({
      type: 'diff',
      updatedCells: [],
      updatedPlayers: [snapshotPlayer(player)],
      scores: snapshotScores(),
    });

    ws.on('message', data => {
      const msg = JSON.parse(data.toString()) as PlayerMessage;
      if (msg.type === 'move') handleMove(player, msg.dx, msg.dy);
      if (msg.type === 'bomb') handleBomb(player);
    });

    ws.on('close', () => {
      players.delete(player.id);
      updatedPlayers.add(player.id);
      broadcast({
        type: 'diff',
        updatedCells: [],
        updatedPlayers: [snapshotPlayer(player)],
        scores: snapshotScores(),
      });
    });
  });
});

setInterval(gameLoop, TICK_MS);
