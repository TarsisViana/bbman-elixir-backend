"use strict";
var Cell;
(function (Cell) {
    Cell[Cell["empty"] = 0] = "empty";
    Cell[Cell["wall"] = 1] = "wall";
    Cell[Cell["crate"] = 2] = "crate";
    Cell[Cell["bomb"] = 3] = "bomb";
    Cell[Cell["explosion"] = 4] = "explosion";
    Cell[Cell["powerupFirePower"] = 5] = "powerupFirePower";
    Cell[Cell["powerupBomb"] = 6] = "powerupBomb";
})(Cell || (Cell = {}));
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const TILE_SIZE = 35;
const COLS = 20;
const ROWS = 18;
const MOVE_COOLDOWN = 150;
const BOMB_FUSE = 2000;
const EXPLOSION_DURATION = 500;
const CRATE_REFILL_INTERVAL = 20000; // 20s
canvas.width = COLS * TILE_SIZE;
canvas.height = ROWS * TILE_SIZE;
let grid = [];
let player;
let bots = [];
let bombs = [];
let explosions = [];
const chainMap = new Map();
// input
let pendingMove = null;
let pendingBomb = false;
// scoreboard elems
const scoreBoard = document.getElementById("scoreboard");
const killEl = document.getElementById("kills");
const deathEl = document.getElementById("deaths");
const assistEl = document.getElementById("assists");
document.getElementById("withBots").onclick = () => {
    const color = document.getElementById("color").value;
    player = new Player(color);
    init();
};
window.addEventListener("keydown", (e) => {
    const dirs = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
    };
    if (dirs[e.key])
        pendingMove = dirs[e.key];
    if (e.key === " ")
        pendingBomb = true;
});
class Player {
    constructor(color) {
        this.color = color;
        this.x = 1;
        this.y = 1;
        this.firePower = 2;
        this.maxBombs = 1;
        this.activeBombs = 0;
        this.lastMoveAt = 0;
        this.kills = 0;
        this.deaths = 0;
        this.assists = 0;
    }
}
class Bot extends Player {
    constructor(x, y) {
        super("#8000fa");
        this.x = x;
        this.y = y;
    }
    tryStep() {
        const now = performance.now();
        if (now - this.lastMoveAt < MOVE_COOLDOWN)
            return;
        this.lastMoveAt = now;
        const dirs = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
        ];
        const [dx, dy] = dirs[Math.floor(Math.random() * 4)];
        if (isEmpty(this.x + dx, this.y + dy)) {
            this.x += dx;
            this.y += dy;
            this.checkPickup();
        }
        if (Math.random() < 0.03)
            placeBomb(this);
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
    document.getElementById("menu").style.display = "none";
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
            if (border || block)
                grid[y][x] = Cell.wall;
            else
                grid[y][x] = Math.random() < 0.5 ? Cell.crate : Cell.empty;
        }
    }
}
function placeBomb(actor) {
    if (actor.activeBombs >= actor.maxBombs)
        return;
    if (grid[actor.y][actor.x] !== Cell.empty)
        return;
    actor.activeBombs++;
    grid[actor.y][actor.x] = Cell.bomb;
    const b = { x: actor.x, y: actor.y, owner: actor, fuse: BOMB_FUSE };
    bombs.push(b);
}
let lastFrame = 0;
let crateTimer = 0;
function gameLoop(now) {
    const delta = now - lastFrame;
    lastFrame = now;
    // 1) player
    if (pendingMove) {
        const [dx, dy] = pendingMove;
        if (now - player.lastMoveAt >= MOVE_COOLDOWN &&
            isEmpty(player.x + dx, player.y + dy)) {
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
            if (grid[e.y][e.x] === Cell.explosion)
                grid[e.y][e.x] = e.spawn;
            explosions.splice(i, 1);
        }
    }
    // 5) crate refill
    crateTimer += delta;
    if (crateTimer >= CRATE_REFILL_INTERVAL) {
        crateTimer = 0;
        refillCrates();
    }
    draw();
    requestAnimationFrame(gameLoop);
}
function explode(bomb) {
    const trigger = chainMap.get(bomb) || bomb.owner;
    const toSpawn = (old) => {
        if (old !== Cell.crate)
            return Cell.empty;
        const r = Math.random();
        if (r < 0.1)
            return Cell.powerupFirePower;
        if (r < 0.2)
            return Cell.powerupBomb;
        return Cell.empty;
    };
    const cells = [];
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
    ]) {
        for (let i = 1; i <= bomb.owner.firePower; i++) {
            const nx = bomb.x + dx * i, ny = bomb.y + dy * i;
            if (!inBounds(nx, ny) || grid[ny][nx] === Cell.wall)
                break;
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
            }
            else {
                // bot died
                if (trigger === player) {
                    // assist if chain, else kill
                    if (chainMap.has(bomb))
                        player.assists++;
                    else
                        player.kills++;
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
function isEmpty(x, y) {
    if (!inBounds(x, y))
        return false;
    const c = grid[y][x];
    return (c === Cell.empty || c === Cell.powerupFirePower || c === Cell.powerupBomb);
}
function inBounds(x, y) {
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
        ctx.fillRect(ent.x * TILE_SIZE + 5, ent.y * TILE_SIZE + 5, TILE_SIZE - 10, TILE_SIZE - 10);
    });
}
