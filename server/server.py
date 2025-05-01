import asyncio, json, secrets, time, concurrent.futures
import websockets

# ────────────────────────────────────────────────────────────────────────────
# Constants
# ────────────────────────────────────────────────────────────────────────────
COLUMNS, ROWS = 20, 18
TICK_MILLISECONDS = 50
BOMB_FUSE_MS = 2000
EXPLOSION_DURATION_MS = 500


class Cell:
    empty, wall, crate, bomb, explosion, powerup_fire, powerup_bomb = range(7)


# ────────────────────────────────────────────────────────────────────────────
# Data classes
# ────────────────────────────────────────────────────────────────────────────
class Player:
    def __init__(self, websocket, color: str):
        self.websocket = websocket
        self.player_id = secrets.token_hex(4)
        self.color = color
        self.x = 1
        self.y = 1
        self.alive = True

        self.fire_power = 2
        self.max_bombs = 1
        self.active_bombs = 0

        self.kills = 0
        self.deaths = 0
        self.assists = 0


class Bomb:
    def __init__(self, x: int, y: int, owner: Player):
        self.x = x
        self.y = y
        self.owner = owner
        self.explode_at_ms = now_ms() + BOMB_FUSE_MS


class Explosion:
    def __init__(self, x: int, y: int):
        self.x, self.y = x, y
        self.clear_at_ms = now_ms() + EXPLOSION_DURATION_MS


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────
def now_ms() -> int:
    return int(time.time() * 1000)


def in_bounds(x: int, y: int) -> bool:
    return 0 <= x < COLUMNS and 0 <= y < ROWS


def build_initial_grid() -> list[list[int]]:
    grid: list[list[int]] = []
    for y in range(ROWS):
        row = []
        for x in range(COLUMNS):
            border = x in (0, COLUMNS - 1) or y in (0, ROWS - 1)
            pillar = x % 2 == 0 and y % 2 == 0
            if border or pillar:
                row.append(Cell.wall)
            else:
                row.append(Cell.crate if secrets.randbelow(2) else Cell.empty)
        grid.append(row)
    return grid


# ────────────────────────────────────────────────────────────────────────────
# Global state + infra
# ────────────────────────────────────────────────────────────────────────────
grid = build_initial_grid()
players: dict[str, Player] = {}
bombs: list[Bomb] = []
explosions: list[Explosion] = []

updated_cells: set[tuple[int, int]] = set()
updated_players: set[str] = set()

action_queue: asyncio.Queue = asyncio.Queue()
thread_pool = concurrent.futures.ThreadPoolExecutor(max_workers=12)


# ────────────────────────────────────────────────────────────────────────────
# Action helpers
# ────────────────────────────────────────────────────────────────────────────
async def enqueue(action: str, *args):
    await action_queue.put((action, args))


def bomb_timer(bomb: Bomb, loop: asyncio.AbstractEventLoop):
    time.sleep(BOMB_FUSE_MS / 1000)
    loop.call_soon_threadsafe(action_queue.put_nowait, ("explode", (bomb,)))


# ────────────────────────────────────────────────────────────────────────────
# Core mechanics
# ────────────────────────────────────────────────────────────────────────────
def set_cell(x: int, y: int, cell_type: Cell):
    if in_bounds(x, y) and grid[y][x] != cell_type:
        grid[y][x] = cell_type
        updated_cells.add((x, y))


def trigger_explosion(bomb: Bomb):
    owner = bomb.owner
    owner.active_bombs -= 1
    blast_cells([(bomb.x, bomb.y)], owner)

    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        for step in range(1, owner.fire_power + 1):
            nx, ny = bomb.x + dx * step, bomb.y + dy * step
            if not in_bounds(nx, ny) or grid[ny][nx] == Cell.wall:
                break
            blast_cells([(nx, ny)], owner)
            if grid[ny][nx] in (Cell.crate, Cell.bomb):
                break


def blast_cells(cells: list[tuple[int, int]], owner: Player):
    global explosions
    for x, y in cells:
        # chain reaction: explode other bombas
        if grid[y][x] == Cell.bomb:
            for other_bomb in bombs:
                if other_bomb.x == x and other_bomb.y == y:
                    other_bomb.explode_at_ms = now_ms()

        set_cell(x, y, Cell.explosion)
        explosions.append(Explosion(x, y))

        # kill os desavisados perto
        for player in players.values():
            if player.x == x and player.y == y and player.alive:
                player.deaths += 1
                owner.kills += 1 if player is not owner else 0
                player.alive = False
                updated_players.add(player.player_id)
                updated_players.add(owner.player_id)


def player_state_snapshot(player: Player) -> dict:
    return {
        "id": player.player_id,
        "x": player.x,
        "y": player.y,
        "color": player.color,
        "alive": player.alive,
    }


def scores_snapshot() -> dict:
    return {
        p.player_id: {
            "kills": p.kills,
            "deaths": p.deaths,
            "assists": p.assists,
        }
        for p in players.values()
    }


async def broadcast(message: dict):
    if not players:
        return
    data = json.dumps(message, separators=(",", ":"))
    await asyncio.gather(*(p.websocket.send(data) for p in players.values()))


# ────────────────────────────────────────────────────────────────────────────
# game loop – runs every 10 ms, drains the queue, then broadcasts diff
# ────────────────────────────────────────────────────────────────────────────
async def game_loop():
    tick_ms = 10
    while True:
        start = now_ms()

        # ── drain queue (non-blocking)
        try:
            while True:
                action, args = action_queue.get_nowait()
                if action == "move":
                    (player, dx, dy) = args
                    handle_move(player, dx, dy)
                elif action == "bomb":
                    (player,) = args
                    handle_bomb(player)
                elif action == "explode":
                    (bomb,) = args
                    if bomb in bombs:
                        trigger_explosion(bomb)
                        bombs.remove(bomb)
        except asyncio.QueueEmpty:
            pass

        # ── clear expired explosions
        current_time = now_ms()
        for explosion in explosions:
            if explosion.clear_at_ms <= current_time:
                set_cell(explosion.x, explosion.y, Cell.empty)
                explosions.remove(explosion)

        # ── broadcast diff if something changed
        if updated_cells or updated_players:
            await broadcast(
                {
                    "type": "diff",
                    "updatedCells": [
                        {"x": x, "y": y, "value": grid[y][x]}
                        for (x, y) in updated_cells
                    ],
                    "updatedPlayers": [
                        player_state_snapshot(players[pid]) for pid in updated_players
                    ],
                }
            )
            updated_cells.clear()
            updated_players.clear()

        # ── keep 10 ms cadence
        elapsed = now_ms() - start
        await asyncio.sleep(max(0, tick_ms - elapsed) / 1000)


# ────────────────────────────────────────────────────────────────────────────
# WebSocket handler – enqueue actions instead of acting directly
# ────────────────────────────────────────────────────────────────────────────
async def websocket_handler(websocket):
    data = await websocket.recv()
    join_request = json.loads(data)
    if join_request.get("type") != "join":
        return

    new_player = Player(websocket, join_request.get("color"))
    players[new_player.player_id] = new_player
    updated_players.add(new_player.player_id)

    # initial snapshot
    data_to_send = {
        "type": "init",
        "playerId": new_player.player_id,
        "grid": grid,
        "players": [player_state_snapshot(p) for p in players.values()],
        "scores": scores_snapshot(),
    }
    print(data_to_send)
    await websocket.send(
        json.dumps(
            data_to_send,
        )
    )

    await broadcast(
        {
            "type": "diff",
            "updatedCells": [],
            "updatedPlayers": [player_state_snapshot(new_player)],
        }
    )

    try:
        async for raw in websocket:
            msg = json.loads(raw)
            if msg["type"] == "move":
                await enqueue("move", new_player, msg["dx"], msg["dy"])
            elif msg["type"] == "bomb":
                await enqueue("bomb", new_player)
    finally:
        players.pop(new_player.player_id, None)
        await broadcast(
            {
                "type": "diff",
                "updatedCells": [],
                "updatedPlayers": [
                    {**player_state_snapshot(new_player), "alive": False}
                ],
            }
        )


def handle_move(player: Player, dx: int, dy: int):
    if not player.alive:
        return
    new_x, new_y = player.x + dx, player.y + dy
    if not in_bounds(new_x, new_y):
        return
    if grid[new_y][new_x] != Cell.empty:
        return
    player.x, player.y = new_x, new_y
    updated_players.add(player.player_id)


# ────────────────────────────────────────────────────────────────────────────
# Bomb placement – schedule timer in the thread pool
# ────────────────────────────────────────────────────────────────────────────
def handle_bomb(player: Player):
    if not player.alive or player.active_bombs >= player.max_bombs:
        return
    if grid[player.y][player.x] != Cell.empty:
        return

    set_cell(player.x, player.y, Cell.bomb)
    bomb = Bomb(player.x, player.y, player)
    bombs.append(bomb)
    player.active_bombs += 1

    # fire-and-forget timer
    loop = asyncio.get_running_loop()
    thread_pool.submit(bomb_timer, bomb, loop)


# ────────────────────────────────────────────────────────────────────────────
# Main entry
# ────────────────────────────────────────────────────────────────────────────
async def main():
    asyncio.create_task(game_loop())

    async with websockets.serve(websocket_handler, "0.0.0.0", 4000, max_queue=None):
        print("Bomberman server running at ws://localhost:4000")
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Server stopped")
