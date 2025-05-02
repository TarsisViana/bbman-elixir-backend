import asyncio, json, secrets, time, concurrent.futures, random
from typing import Collection, Dict, Sequence, Tuple
import websockets
import websockets.asyncio.client

# ────────────────────────────────────────────────────────────────────────────
# Constants
# ────────────────────────────────────────────────────────────────────────────
COLUMNS, ROWS = 31, 25
TICK_MS = 50
BOMB_FUSE_MS = 2000
EXPLOSION_MS = 500
RESPAWN_MS = 5000
CRATE_REFILL_MS = 20_000


class Cell:
    empty, wall, crate, bomb, explosion, powerup_fire, powerup_bomb = range(7)


# ────────────────────────────────────────────────────────────────────────────
# Basic helpers
# ────────────────────────────────────────────────────────────────────────────
def now_ms() -> int:
    return int(time.time() * 1000)


def in_bounds(x: int, y: int) -> bool:
    return 0 <= x < COLUMNS and 0 <= y < ROWS


def build_grid() -> Sequence[Sequence[int]]:
    g: Sequence[Sequence[int]] = []

    for y in range(ROWS):
        row = []
        for x in range(COLUMNS):
            border = x in (0, COLUMNS - 1) or y in (0, ROWS - 1)
            pillar = x % 2 == 0 and y % 2 == 0
            row.append(
                Cell.wall
                if (border or pillar)
                else (Cell.crate if secrets.randbelow(2) else Cell.empty)
            )
        g.append(row)
    return g


def find_free_spawn() -> Tuple[int, int]:
    while True:
        x, y = random.randrange(1, COLUMNS - 1), random.randrange(1, ROWS - 1)
        if grid[y][x] == Cell.empty and all(
            (pl.x, pl.y) != (x, y) or not pl.alive for pl in players.values()
        ):
            return x, y


# ────────────────────────────────────────────────────────────────────────────
# Entities
# ────────────────────────────────────────────────────────────────────────────
class Player:
    def __init__(self, ws: websockets.asyncio.client, color: str):
        self.ws = ws
        self.id = secrets.token_hex(8)
        self.color = color
        self.x, self.y = find_free_spawn()
        self.alive = True
        self.fire_power = 2
        self.max_bombs = 1
        self.active_bombs = 0
        self.kills = self.deaths = self.assists = 0


class Bomb:
    def __init__(self, x: int, y: int, owner: Player):
        self.x, self.y = x, y
        self.owner = owner
        self.explode_at = now_ms() + BOMB_FUSE_MS


class Explosion:
    def __init__(self, x: int, y: int, restore_to: Cell):
        self.x, self.y = x, y
        self.restore_to = restore_to
        self.clear_at = now_ms() + EXPLOSION_MS


# ────────────────────────────────────────────────────────────────────────────
# Global state and infra
# ────────────────────────────────────────────────────────────────────────────
grid = build_grid()
players: Dict[str, Player] = {}
bombs: Sequence[Bomb] = []
explosions: Sequence[Explosion] = []

updated_cells: Collection[Tuple[int, int]] = set()
updated_players: Collection[str] = set()

thread_pool = concurrent.futures.ThreadPoolExecutor(max_workers=4)
last_refill = now_ms()


# ────────────────────────────────────────────────────────────────────────────
# Mechanics
# ────────────────────────────────────────────────────────────────────────────
def maybe_refill_crates():
    # refill if less than %
    global last_refill
    if now_ms() - last_refill < CRATE_REFILL_MS:
        return
    amount_of_crates = sum(row.count(Cell.crate) for row in grid)
    if amount_of_crates >= (COLUMNS * ROWS * 0.10):
        last_refill = now_ms()
        return

    desired_amount_of_crates = int(COLUMNS * ROWS * 0.20)
    for _ in range(desired_amount_of_crates - amount_of_crates):
        x, y = random.randrange(1, COLUMNS - 1), random.randrange(1, ROWS - 1)
        if grid[y][x] == Cell.empty and all(
            (p.x, p.y) != (x, y) for p in players.values()
        ):
            set_cell(x, y, Cell.crate)
            amount_of_crates += 1
    last_refill = now_ms()


def set_cell(x: int, y: int, c: int):
    if in_bounds(x, y) and grid[y][x] != c:
        grid[y][x] = c
        updated_cells.add((x, y))


def schedule_respawn(player: Player):
    thread_pool.submit(lambda: (time.sleep(RESPAWN_MS / 1000), respawn_handler(player)))


def explode_bomb(bomb: Bomb):
    # iterate over all cells the bomb is blasting through, and act upon it
    owner = bomb.owner
    owner.active_bombs -= 1

    blast([(bomb.x, bomb.y)], owner)

    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        for i in range(1, owner.fire_power + 1):
            nx, ny = bomb.x + dx * i, bomb.y + dy * i
            if not in_bounds(nx, ny) or grid[ny][nx] == Cell.wall:
                break

            cell_before = grid[ny][nx]
            blast([(nx, ny)], owner)

            if cell_before in (Cell.crate, Cell.bomb):
                break


def blast(cells: Sequence[Tuple[int, int]], owner: Player):
    for x, y in cells:
        if grid[y][x] == Cell.bomb:
            for bb in bombs:
                if bb.x == x and bb.y == y:
                    # will explode other bombs on the range
                    bb.explode_at = now_ms()

        old = grid[y][x]
        # decide what should re-appear after the flame
        if old == Cell.crate:
            r = random.random()
            restore = (
                Cell.powerup_fire
                if r < 0.10
                else Cell.powerup_bomb if r < 0.20 else Cell.empty
            )
        else:
            restore = Cell.empty

        set_cell(x, y, Cell.explosion)
        explosions.append(Explosion(x, y, restore))

        for pl in players.values():
            if pl.alive and pl.x == x and pl.y == y:
                # will unalive os desavisados no range
                pl.alive = False
                pl.deaths += 1
                if pl is not owner:
                    owner.kills += 1
                updated_players.update([pl.id, owner.id])

                # agenda a ressureição
                schedule_respawn(pl)


def snapshot_player(p: Player) -> dict:
    return {"id": p.id, "x": p.x, "y": p.y, "color": p.color, "alive": p.alive}


def snapshot_scores() -> dict:
    return {
        p.id: {"kills": p.kills, "deaths": p.deaths, "assists": p.assists}
        for p in players.values()
    }


async def broadcast(msg: dict):
    if not players:
        return
    data = json.dumps(msg)
    await asyncio.gather(*(pl.ws.send(data) for pl in players.values()))


# ────────────────────────────────────────────────────────────────────────────
# Action handlers
# ────────────────────────────────────────────────────────────────────────────
def handle_move(pl: Player, dx: int, dy: int):
    if not pl.alive:
        return

    nx, ny = pl.x + dx, pl.y + dy
    if (
        not in_bounds(nx, ny)
        or grid[ny][nx] == Cell.wall
        or grid[ny][nx] == Cell.bomb
        or grid[ny][nx] == Cell.crate
    ):
        return

    cell = grid[ny][nx]
    pl.x, pl.y = nx, ny

    if cell == Cell.powerup_fire:
        pl.fire_power += 1
        set_cell(nx, ny, Cell.empty)
    elif cell == Cell.powerup_bomb:
        pl.max_bombs += 1
        set_cell(nx, ny, Cell.empty)

    updated_players.add(pl.id)


def handle_bomb(pl: Player):
    if not pl.alive or pl.active_bombs >= pl.max_bombs:
        return

    if grid[pl.y][pl.x] != Cell.empty:
        return

    set_cell(pl.x, pl.y, Cell.bomb)
    b = Bomb(pl.x, pl.y, pl)
    bombs.append(b)
    pl.active_bombs += 1


def respawn_handler(pl: Player):
    pl.x, pl.y = find_free_spawn()
    pl.alive = True
    updated_players.add(pl.id)


# ────────────────────────────────────────────────────────────────────────────
# Main game loop
# ────────────────────────────────────────────────────────────────────────────
async def game_loop():
    while True:
        started_process_at = now_ms()

        # time-outs
        for b in bombs:
            if b.explode_at <= started_process_at:
                explode_bomb(b)
                bombs.remove(b)

        for e in explosions:
            if e.clear_at <= started_process_at:
                set_cell(e.x, e.y, e.restore_to)
                explosions.remove(e)

        maybe_refill_crates()

        # broadcast diff
        if updated_cells or updated_players:
            await broadcast(
                {
                    "type": "diff",
                    "updatedCells": [
                        {"x": x, "y": y, "value": grid[y][x]}
                        for (x, y) in updated_cells
                    ],
                    "updatedPlayers": [
                        snapshot_player(players[pid]) for pid in updated_players
                    ],
                    "scores": snapshot_scores(),
                }
            )
            updated_cells.clear()
            updated_players.clear()

        await asyncio.sleep(max(0, (TICK_MS - (now_ms() - started_process_at))) / 1000)


# ────────────────────────────────────────────────────────────────────────────
# Player handler
# ────────────────────────────────────────────────────────────────────────────
async def player_handler(ws: websockets):
    first = json.loads(await ws.recv())
    if first.get("type") != "join":
        return

    joined_player = Player(ws, first.get("color"))
    players[joined_player.id] = joined_player
    updated_players.add(joined_player.id)

    await ws.send(
        json.dumps(
            {
                "type": "init",
                "playerId": joined_player.id,
                "grid": grid,
                "players": [snapshot_player(p) for p in players.values()],
                "scores": snapshot_scores(),
            },
        )
    )

    await broadcast(
        {
            "type": "diff",
            "updatedCells": [],
            "updatedPlayers": [snapshot_player(joined_player)],
            "scores": snapshot_scores(),
        }
    )

    try:
        async for raw in ws:
            msg = json.loads(raw)
            if msg["type"] == "move":
                handle_move(joined_player, msg["dx"], msg["dy"])
            elif msg["type"] == "bomb":
                handle_bomb(joined_player)
    finally:
        players.pop(joined_player.id, None)
        updated_players.add(joined_player.id)  # mark departed (alive False)
        await broadcast(
            {
                "type": "diff",
                "updatedCells": [],
                "updatedPlayers": [snapshot_player(joined_player)],
                "scores": snapshot_scores(),
            }
        )


# ────────────────────────────────────────────────────────────────────────────
# Entrypoint
# ────────────────────────────────────────────────────────────────────────────
async def main():
    asyncio.create_task(game_loop())

    async with websockets.serve(player_handler, "0.0.0.0", 4000, max_queue=None):
        print("Bomberman server on ws://localhost:4000")
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Server stopped")
