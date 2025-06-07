import { Socket, Channel } from "phoenix"

/* =========================================================================
   Shared enums / structures – keep identical on client and server
   ========================================================================= */
enum Cell {
  empty,
  wall,
  crate,
  bomb,
  explosion,
  powerupFirePower,
  powerupBomb,
}
type Grid = { x: number, y: number, value: Cell }[]

/* ---------------- messages sent → server ---------------- */
interface MessageJoin {
  type: "join";
  color: string;
}
interface MessageMove {
  type: "move";
  dx: number;
  dy: number;
}
interface MessageBomb {
  type: "bomb";
}
type ClientMessage = MessageJoin | MessageMove | MessageBomb;

/* ---------------- messages received ← server ------------ */
interface PlayerState {
  id: string;
  x: number;
  y: number;
  color: string;
  alive: boolean;
}

interface ScoreState {
  kills: number;
  deaths: number;
  assists: number;
}

interface MessageInit {
  type: "init";
  playerId: string;
  grid: Grid;
  gridSize: number[];
  players: PlayerState[];
  scores: Record<string, ScoreState>;
}
interface MessageDiff {
  type: "diff";
  updatedCells: { x: number; y: number; value: Cell }[];
  updatedPlayers: PlayerState[];
  scores?: Record<string, ScoreState>;
}
type ServerMessage = MessageInit | MessageDiff;

/* =========================================================================
     DOM references
     ========================================================================= */
const canvas = document.getElementById("game") as HTMLCanvasElement;
const context = canvas.getContext("2d")!;
const buttonPlay = document.getElementById("playOnline") as HTMLButtonElement;
const inputColor = document.getElementById("playerColor") as HTMLInputElement;
const scoreboardDiv = document.getElementById("scoreboard") as HTMLDivElement;

/* =========================================================================
     Constants
     ========================================================================= */
const TILE_SIZE = 25;

/* =========================================================================
     In-memory state
     ========================================================================= */
let websocket: Socket | null = null;
let channel: Channel | null = null;
let myPlayerId = "";
let grid: Grid = [];
let collumns = 0
let rows = 0
const players = new Map<string, PlayerState>();
const flatGrid = new Map<string, number>()

/* =========================================================================
     Networking
     ========================================================================= */
function send(message: ClientMessage) {
  // websocket?.readyState === WebSocket.OPEN &&
  //   websocket.send(JSON.stringify(message));
  channel?.push(message.type, message)
}

function connect(color: string) {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const host = import.meta.env.VITE_SOCKET_HOST || "bbman-elx.fly.dev";
  const websocket = new Socket(`${protocol}://${host}/socket`);
  websocket.connect()

  channel = websocket.channel("game:lobby", { color: color });

  channel.join()
    .receive("ok", res => {
      console.log("JOINED successfully");
    }).receive("error", res => {
      console.error("Unable to join", res);
    });

  channel.on("init", handleInitMessage)
  channel.on("diff", handleDiffMessage)

  // websocket.onopen = () => send({ type: "join", color });
  // websocket.onmessage = (ev) => handleServerMessage(JSON.parse(ev.data));
  // websocket.onclose = () => alert("Disconnected");

  document.getElementById("menu")!.style.display = "none";
  scoreboardDiv.style.display = "block";
  canvas.style.display = "block";
}

/* =========================================================================
     Input → intent
     ========================================================================= */
window.addEventListener("keydown", (e) => {
  const dir: Record<string, [number, number]> = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  };
  if (e.key in dir) {
    const [dx, dy] = dir[e.key];
    send({ type: "move", dx, dy });
  }
  if (e.key === " ") send({ type: "bomb" });
});

/* =========================================================================
     Server handling
     ========================================================================= */

function handleInitMessage(payload: MessageInit) {
  myPlayerId = payload.playerId;

  grid = payload.grid;
  grid.forEach(({ x, y, value }) => flatGrid.set(`${x},${y}`, value));
  [rows, collumns] = payload.gridSize

  players.clear();
  payload.players.forEach((p) => players.set(p.id, p));

  // canvas size now comes from server grid
  canvas.width = payload.gridSize[1] * TILE_SIZE;
  canvas.height = payload.gridSize[0] * TILE_SIZE;

  updateScoreboard(payload.scores);
}

function handleDiffMessage(payload: MessageDiff) {
  payload.updatedCells.forEach((c) => {
    flatGrid.set(`${c.x},${c.y}`, c.value)
  });
  payload.updatedPlayers.forEach((p) => players.set(p.id, p));
  if (payload.scores) updateScoreboard(payload.scores);
}

/* =========================================================================
     Scoreboard (table of all players)
     ========================================================================= */
function updateScoreboard(all: Record<string, ScoreState>) {

  const rows = Object.entries(all)
    .sort(([, a], [, b]) => b.kills - a.kills) // simple sort by kills
    .map(
      ([id, s]) => {
        return (`<tr>
           <td style="color:${players.get(id)?.color ?? "#fff"}">${id === myPlayerId ? "(you)" : id.slice(0, 5)
          }</td>
           <td>kills: ${s.kills}</td><td>deaths: ${s.deaths}</td><td>assists: ${s.assists
          }</td>
         </tr>`)
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
  if (!grid.length) return requestAnimationFrame(render);


  // Draw grid tiles
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < collumns; x++) {
      const cellType = flatGrid.get(`${x},${y}`) || 0;
      context.fillStyle = tileColor(cellType);
      context.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  players.forEach((p) => {
    if (!p.alive) return;
    context.fillStyle = p.color;
    context.fillRect(
      p.x * TILE_SIZE + 5,
      p.y * TILE_SIZE + 5,
      TILE_SIZE - 10,
      TILE_SIZE - 10
    );
  });

  requestAnimationFrame(render);
}

function tileColor(t: Cell): string {
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
