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
  grid: Cell[][];
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
const killsSpan = document.getElementById("kills") as HTMLSpanElement;
const deathsSpan = document.getElementById("deaths") as HTMLSpanElement;
const assistsSpan = document.getElementById("assists") as HTMLSpanElement;

/* =========================================================================
     Constants
     ========================================================================= */
const TILE_SIZE = 35;
const COLUMNS = 20;
const ROWS = 18;

/* =========================================================================
     In-memory state
     ========================================================================= */
let websocket: WebSocket | null = null;
let myPlayerId = "";
let grid: Cell[][] = []; // authoritative grid copy
const players = new Map<string, PlayerState>(); // all remote players

/* =========================================================================
     Networking helpers
     ========================================================================= */
function send(message: ClientMessage) {
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify(message));
  }
}

function connect(color: string) {
  websocket = new WebSocket("ws://localhost:4000");
  websocket.onopen = () => send({ type: "join", color });
  websocket.onmessage = (event) => handleServerMessage(JSON.parse(event.data));
  websocket.onclose = () => alert("Disconnected from server");

  // hide menu / show game UI
  document.getElementById("menu")!.style.display = "none";
  scoreboardDiv.style.display = "block";
  canvas.style.display = "block";
}

/* =========================================================================
     Input → intent messages
     ========================================================================= */
window.addEventListener("keydown", (e) => {
  const moves: Record<string, [number, number]> = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  };
  if (e.key in moves) {
    const [dx, dy] = moves[e.key];
    send({ type: "move", dx, dy });
  }
  if (e.key === " ") send({ type: "bomb" });
});

/* =========================================================================
     Server message handling
     ========================================================================= */
function handleServerMessage(msg: ServerMessage) {
  if (msg.type === "init") {
    myPlayerId = msg.playerId;
    grid = msg.grid;
    players.clear();
    msg.players.forEach((p) => players.set(p.id, p));
    updateScoreboard(msg.scores[myPlayerId]);
  } else {
    // diff
    msg.updatedCells.forEach((c) => (grid[c.y][c.x] = c.value));
    msg.updatedPlayers.forEach((p) => players.set(p.id, p));
    if (msg.scores && msg.scores[myPlayerId])
      updateScoreboard(msg.scores[myPlayerId]);
  }
}

function updateScoreboard(my: ScoreState) {
  killsSpan.textContent = String(my.kills);
  deathsSpan.textContent = String(my.deaths);
  assistsSpan.textContent = String(my.assists);
}

/* =========================================================================
     Rendering
     ========================================================================= */
canvas.width = COLUMNS * TILE_SIZE;
canvas.height = ROWS * TILE_SIZE;

function render() {
  // tiles
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLUMNS; x++) {
      context.fillStyle = tileColor(grid[y]?.[x] ?? Cell.empty);
      context.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
  // players
  players.forEach((p) => {
    if (!p.alive) return;
    context.fillStyle = p.id === myPlayerId ? "#ffffff" : p.color;
    context.fillRect(
      p.x * TILE_SIZE + 5,
      p.y * TILE_SIZE + 5,
      TILE_SIZE - 10,
      TILE_SIZE - 10
    );
  });

  requestAnimationFrame(render);
}

function tileColor(cell: Cell): string {
  switch (cell) {
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
