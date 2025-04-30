var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
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
var canvas = document.getElementById("game");
var ctx = canvas.getContext("2d");
var TILE_SIZE = 35;
var COLS = 20;
var ROWS = 18;
var MOVE_COOLDOWN = 150;
var BOMB_FUSE = 2000;
var EXPLOSION_DURATION = 500;
canvas.width = COLS * TILE_SIZE;
canvas.height = ROWS * TILE_SIZE;
var grid = [];
var player;
var bots = [];
var bombs = [];
var explosions = [];
// input queue
var pendingMove = null;
var pendingBomb = false;
document.getElementById("withBots").onclick = function () {
    var color = document.getElementById("color").value;
    player = new Player(color);
    init();
};
window.addEventListener("keydown", function (e) {
    var dirs = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
    };
    if (e.key in dirs)
        pendingMove = dirs[e.key];
    if (e.key === " ")
        pendingBomb = true;
});
var Player = /** @class */ (function () {
    function Player(color) {
        this.color = color;
        this.x = 1;
        this.y = 1;
        this.firePower = 2;
        this.maxBombs = 1;
        this.activeBombs = 0;
        this.lastMoveAt = 0;
    }
    return Player;
}());
var Bot = /** @class */ (function (_super) {
    __extends(Bot, _super);
    function Bot(x, y) {
        var _this = _super.call(this, "#8000fa") || this;
        _this.x = x;
        _this.y = y;
        return _this;
    }
    Bot.prototype.tryStep = function () {
        var now = Date.now();
        if (now - this.lastMoveAt < MOVE_COOLDOWN)
            return;
        this.lastMoveAt = now;
        var dirs = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
        ];
        var _a = dirs[Math.floor(Math.random() * 4)], dx = _a[0], dy = _a[1];
        if (isEmpty(this.x + dx, this.y + dy)) {
            this.x += dx;
            this.y += dy;
            this.checkPickup();
        }
        if (Math.random() < 0.03)
            placeBomb(this);
    };
    Bot.prototype.checkPickup = function () {
        var cell = grid[this.y][this.x];
        if (cell === Cell.powerupFirePower) {
            this.firePower++;
            grid[this.y][this.x] = Cell.empty;
        }
        if (cell === Cell.powerupBomb) {
            this.maxBombs++;
            grid[this.y][this.x] = Cell.empty;
        }
    };
    return Bot;
}(Player));
function init() {
    document.getElementById("menu").style.display = "none";
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
    for (var y = 0; y < ROWS; y++) {
        grid[y] = [];
        for (var x = 0; x < COLS; x++) {
            var isWall = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
            var isEveryTwoCells = x % 2 === 0 && y % 2 === 0;
            if (isWall || isEveryTwoCells) {
                grid[y][x] = Cell.wall;
            }
            else if (Math.random() < 0.5) {
                grid[y][x] = Cell.crate;
            }
            else {
                grid[y][x] = Cell.empty;
            }
        }
    }
}
function placeBomb(actor) {
    if (actor.activeBombs >= actor.maxBombs)
        return;
    if (grid[actor.y][actor.x] !== Cell.empty)
        return;
    grid[actor.y][actor.x] = Cell.bomb;
    actor.activeBombs++;
    bombs.push({
        x: actor.x,
        y: actor.y,
        owner: actor,
        fuse: BOMB_FUSE,
    });
}
var lastFrame = 0;
function gameLoop(now) {
    var delta = now - lastFrame;
    lastFrame = now;
    // 1) player input
    if (pendingMove) {
        var dx = pendingMove[0], dy = pendingMove[1];
        if (now - player.lastMoveAt >= MOVE_COOLDOWN &&
            isEmpty(player.x + dx, player.y + dy)) {
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
    bots.forEach(function (b) { return b.tryStep(); });
    // 3) bombs
    for (var i = bombs.length - 1; i >= 0; i--) {
        bombs[i].fuse -= delta;
        if (bombs[i].fuse <= 0) {
            var b = bombs[i];
            explode(b);
            bombs.splice(i, 1);
            b.owner.activeBombs--;
        }
    }
    // 4) explosions
    for (var i = explosions.length - 1; i >= 0; i--) {
        explosions[i].timer -= delta;
        if (explosions[i].timer <= 0) {
            var e = explosions[i];
            if (grid[e.y][e.x] === Cell.explosion)
                grid[e.y][e.x] = e.spawn;
            explosions.splice(i, 1);
        }
    }
    // 5) render
    draw();
    requestAnimationFrame(gameLoop);
}
function explode(bomb) {
    var x = bomb.x, y = bomb.y, owner = bomb.owner;
    var toSpawn = function (explodedStuff) {
        if (explodedStuff !== Cell.crate)
            return Cell.empty;
        var r = Math.random();
        if (r < 0.1)
            return Cell.powerupFirePower;
        if (r < 0.2)
            return Cell.powerupBomb;
        return Cell.empty;
    };
    // collect explosion cells
    var cells = [];
    // center
    cells.push({
        x: x,
        y: y,
        timer: EXPLOSION_DURATION,
        spawn: toSpawn(grid[y][x]),
    });
    // four directions
    for (var _i = 0, _a = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ]; _i < _a.length; _i++) {
        var _b = _a[_i], dx = _b[0], dy = _b[1];
        for (var i = 1; i <= owner.firePower; i++) {
            var nx = x + dx * i, ny = y + dy * i;
            if (!inBounds(nx, ny) || grid[ny][nx] === Cell.wall)
                break;
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
                for (var _c = 0, bombs_1 = bombs; _c < bombs_1.length; _c++) {
                    var b2 = bombs_1[_c];
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
    for (var _d = 0, cells_1 = cells; _d < cells_1.length; _d++) {
        var e = cells_1[_d];
        grid[e.y][e.x] = Cell.explosion;
        explosions.push(e);
    }
    // reset any actor on explosion
    __spreadArray([player], bots, true).forEach(function (actor) {
        if (grid[actor.y][actor.x] === Cell.explosion && actor === player) {
            actor.x = 1;
            actor.y = 1;
            actor.firePower = 2;
            actor.maxBombs = 1;
        }
    });
}
function checkPlayerPickup() {
    var c = grid[player.y][player.x];
    if (c === Cell.powerupFirePower) {
        player.firePower++;
        grid[player.y][player.x] = Cell.empty;
    }
    if (c === Cell.powerupBomb) {
        player.maxBombs++;
        grid[player.y][player.x] = Cell.empty;
    }
}
function isEmpty(x, y) {
    if (!inBounds(x, y))
        return false;
    var c = grid[y][x];
    return (c === Cell.empty || c === Cell.powerupFirePower || c === Cell.powerupBomb);
}
function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < COLS && y < ROWS;
}
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (var y = 0; y < ROWS; y++) {
        for (var x = 0; x < COLS; x++) {
            var c = grid[y][x];
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
    __spreadArray([player], bots, true).forEach(function (ent) {
        ctx.fillStyle = ent.color;
        ctx.fillRect(ent.x * TILE_SIZE + 5, ent.y * TILE_SIZE + 5, TILE_SIZE - 10, TILE_SIZE - 10);
    });
}
