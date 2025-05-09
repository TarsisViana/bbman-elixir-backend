"use strict";
/* =========================================================================
   Shared enums / structures – keep identical on client and server
   ========================================================================= */
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
/* =========================================================================
     DOM references
     ========================================================================= */
const canvas = document.getElementById("game");
const context = canvas.getContext("2d");
const buttonPlay = document.getElementById("playOnline");
const inputColor = document.getElementById("playerColor");
const scoreboardDiv = document.getElementById("scoreboard");
/* =========================================================================
     Constants
     ========================================================================= */
const TILE_SIZE = 35;
/* =========================================================================
     In-memory state
     ========================================================================= */
let websocket = null;
let myPlayerId = "";
let grid = [];
const players = new Map();
/* =========================================================================
     Networking
     ========================================================================= */
function send(message) {
    (websocket === null || websocket === void 0 ? void 0 : websocket.readyState) === WebSocket.OPEN &&
        websocket.send(JSON.stringify(message));
}
function connect(color) {
    websocket = new WebSocket("http//:localhost:4000");
    websocket.onopen = () => send({ type: "join", color });
    websocket.onmessage = (ev) => handleServerMessage(JSON.parse(ev.data));
    websocket.onclose = () => alert("Disconnected");
    document.getElementById("menu").style.display = "none";
    scoreboardDiv.style.display = "block";
    canvas.style.display = "block";
}
/* =========================================================================
     Input → intent
     ========================================================================= */
window.addEventListener("keydown", (e) => {
    const dir = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
    };
    if (e.key in dir) {
        const [dx, dy] = dir[e.key];
        send({ type: "move", dx, dy });
    }
    if (e.key === " ")
        send({ type: "bomb" });
});
/* =========================================================================
     Server handling
     ========================================================================= */
function handleServerMessage(msg) {
    if (msg.type === "init") {
        myPlayerId = msg.playerId;
        grid = msg.grid;
        players.clear();
        msg.players.forEach((p) => players.set(p.id, p));
        // canvas size now comes from server grid
        canvas.width = grid[0].length * TILE_SIZE;
        canvas.height = grid.length * TILE_SIZE;
        updateScoreboard(msg.scores);
    }
    else {
        // diff
        msg.updatedCells.forEach((c) => (grid[c.y][c.x] = c.value));
        msg.updatedPlayers.forEach((p) => players.set(p.id, p));
        if (msg.scores)
            updateScoreboard(msg.scores);
    }
}
/* =========================================================================
     Scoreboard (table of all players)
     ========================================================================= */
function updateScoreboard(all) {
    const rows = Object.entries(all)
        .sort(([, a], [, b]) => b.kills - a.kills) // simple sort by kills
        .map(([id, s]) => {
        var _a, _b;
        return `<tr>
           <td style="color:${(_b = (_a = players.get(id)) === null || _a === void 0 ? void 0 : _a.color) !== null && _b !== void 0 ? _b : "#fff"}">${id === myPlayerId ? "(you)" : id}</td>
           <td>kills: ${s.kills}</td><td>deaths: ${s.deaths}</td><td>assists: ${s.assists}</td>
         </tr>`;
    })
        .join("");
    scoreboardDiv.innerHTML = `<table>
         <thead><tr><th>Player</th><th>K</th><th>D</th><th>A</th></tr></thead>
         <tbody>${rows}</tbody>
       </table>`;
}
/* =========================================================================
     Rendering
     ========================================================================= */
function render() {
    if (!grid.length)
        return requestAnimationFrame(render);
    for (let y = 0; y < grid.length; y++)
        for (let x = 0; x < grid[0].length; x++) {
            context.fillStyle = tileColor(grid[y][x]);
            context.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
    players.forEach((p) => {
        if (!p.alive)
            return;
        context.fillStyle = p.color;
        context.fillRect(p.x * TILE_SIZE + 5, p.y * TILE_SIZE + 5, TILE_SIZE - 10, TILE_SIZE - 10);
    });
    requestAnimationFrame(render);
}
function tileColor(t) {
    switch (t) {
        case Cell.wall:
            return "gray";
        case Cell.crate:
            return "#a0522d";
        case Cell.bomb:
            return "rgba(50,50,50,0.7)";
        case Cell.explosion:
            return "red";
        case Cell.powerupFirePower:
            return "yellow";
        case Cell.powerupBomb:
            return "blue";
        default:
            return "#ffffff";
    }
}
/* =========================================================================
     Bootstrap
     ========================================================================= */
buttonPlay.onclick = () => connect(inputColor.value);
requestAnimationFrame(render);
