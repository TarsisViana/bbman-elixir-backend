defmodule ElxServer.GameServer do
  use GenServer

  alias ElxServer.Grid.Cell
  alias ElxServer.{Player, Bomb, Grid, Explosion}
  alias ElxServerWeb.Endpoint

  @tick_ms 50
  @topic "game:lobby"
  @event_diff "diff"

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  defmodule State do
    alias ElxServer.Explosion
    use Accessible

    defstruct [
      :last_refill,
      grid: %{},
      players: %{},
      bombs: [],
      explosions: [],
      updated_players: MapSet.new(),
      updated_cells: MapSet.new()
    ]

    @type t :: %__MODULE__{
            grid: Grid.grid(),
            players: map(),
            updated_players: MapSet.t(),
            updated_cells: MapSet.t(),
            bombs: list(Bomb),
            explosions: list(Explosion),
            last_refill: integer()
          }
  end

  # ────────────────────────────────────────────────────────────────────────────
  # GAME LOOP
  # ────────────────────────────────────────────────────────────────────────────
  def handle_info(:tick, %State{} = state) do
    started_at = now_ms()

    state
    |> check_timeout(:bombs, started_at)
    |> check_timeout(:explosions, started_at)
    |> Grid.maybe_refill_crates(started_at)
    |> diff_or_idle(started_at)
  end

  def handle_info({:respawn_player, id}, %State{players: players} = state)
      when is_map_key(players, id) do
    {x, y} = Grid.find_free_cell(state.grid, players)

    new_state =
      state
      |> update_in([:players, id], &%{&1 | x: x, y: y, alive: true})
      |> update_in([:updated_players], &MapSet.put(&1, id))

    {:noreply, new_state}
  end

  def handle_info({:respawn_player, _}, state), do: {:no_reply, state}

  defp diff_or_idle(
         %State{updated_players: up_players, updated_cells: up_cells} = state,
         started_at
       )
       when map_size(up_players) > 0 or map_size(up_cells) > 0 do
    updated_players_snapshots =
      up_players
      |> Enum.map(fn id -> state.players |> Map.fetch!(id) |> Player.snapshot() end)

    msg = %{
      "type" => @event_diff,
      "updatedPlayers" => updated_players_snapshots,
      "updatedCells" => Enum.map(up_cells, &%{&1 | value: Cell.to_int(&1.value)}),
      "scores" => get_scores(state.players)
    }

    Endpoint.broadcast(@topic, @event_diff, msg)
    schedule_tick(started_at)
    {:noreply, %State{state | updated_players: MapSet.new(), updated_cells: MapSet.new()}}
  end

  defp diff_or_idle(%State{} = state, started_at) do
    schedule_tick(started_at)
    {:noreply, state}
  end

  # ────────────────────────────────────────────────────────────────────────────
  # SERVER CALLBACKS
  # ────────────────────────────────────────────────────────────────────────────
  def init(_) do
    schedule_tick(now_ms())
    grid = Grid.build_grid()
    {:ok, %State{grid: grid, last_refill: now_ms()}}
  end

  def handle_call({:add_player, color}, _from, %State{} = state) do
    new_player = Player.create(color, state.grid, state.players)

    new_state =
      state
      |> update_in([:players, new_player.id], fn _ -> new_player end)
      |> update_in([:updated_players], &MapSet.put(&1, new_player.id))

    {:reply, new_player.id, new_state}
  end

  def handle_call(:init_player_msg, _from, %State{grid: grid, players: players} = state) do
    players_snapshots = players |> Map.values() |> Enum.map(&Player.snapshot/1)
    scores = get_scores(players)

    {:reply, {grid, players_snapshots, scores}, state}
  end

  def handle_cast({:remove_player, id}, state)
      when is_map_key(state.players, id) do
    {:noreply, state |> update_in([:players], &Map.delete(&1, id))}
  end

  def handle_cast({:remove_player, _}, state), do: {:noreply, state}

  # ────────────────────────────────────────────────────────────────────────────
  # ACTION HANDLERS
  # ────────────────────────────────────────────────────────────────────────────
  @blocked [:wall, :crate, :bomb]

  def handle_cast({:move, {id, dx, dy}}, %State{players: players} = state)
      when is_map_key(players, id) do
    %Player{alive: alive, x: x, y: y} = players[id]
    nx = x + dx
    ny = y + dy

    with true <- Grid.in_bounds?(nx, ny),
         true <- alive,
         false <- Map.get(state.grid, {nx, ny}) in @blocked do
      new_state =
        state
        |> update_in([:players, id], &%{&1 | x: nx, y: ny})
        |> Player.check_powerup({nx, ny}, id)
        |> update_in([:updated_players], &MapSet.put(&1, id))

      {:noreply, new_state}
    else
      _ -> {:noreply, state}
    end
  end

  def handle_cast({:move, _}, state), do: {:noreply, state}

  def handle_cast({:bomb, id}, %State{players: players} = state)
      when is_map_key(players, id) do
    pl = players[id]

    if pl.alive == false or pl.active_bombs >= pl.max_bombs do
      {:noreply, state}
    else
      bomb = Bomb.new(pl.x, pl.y, pl)

      new_state =
        state
        |> put_in([:grid, {pl.x, pl.y}], :bomb)
        |> update_in([:bombs], &[bomb | &1])
        |> update_in([:players, id], &%{&1 | active_bombs: &1.active_bombs + 1})
        |> update_in([:updated_players], &MapSet.put(&1, id))
        |> update_in([:updated_cells], &MapSet.put(&1, %{x: pl.x, y: pl.y, value: :bomb}))

      {:noreply, new_state}
    end
  end

  def handle_cast({:bomb, _}, state), do: {:noreply, state}

  def handle_cast(msg, state) do
    IO.puts("Unhandled cast: #{inspect(msg)}")
    {:noreply, state}
  end

  # ────────────────────────────────────────────────────────────────────────────
  # HELPERS
  # ────────────────────────────────────────────────────────────────────────────
  def now_ms do
    System.monotonic_time(:millisecond)
  end

  defp schedule_tick(started_at) when is_integer(started_at) do
    elapsed = now_ms() - started_at
    # if the elapsed is bigger then the tick_ms run now
    wait = max(@tick_ms - elapsed, 0)
    Process.send_after(self(), :tick, wait)
  end

  defp get_scores(players) do
    players
    |> Enum.into(%{}, fn {id, player} ->
      {
        id,
        %{
          kills: player.kills,
          deaths: player.deaths,
          assists: player.assists
        }
      }
    end)
  end

  def check_timeout(%State{bombs: bombs} = state, :bombs, time) do
    {live_bombs, exploding} = Enum.split_with(bombs, fn bomb -> bomb.explode_at > time end)

    case exploding do
      [] ->
        state

      _ ->
        state
        |> put_in([:bombs], live_bombs)
        |> Bomb.explode_multiple(exploding)
    end
  end

  def check_timeout(%State{explosions: explosions} = state, :explosions, time) do
    {exploding, expired} = Enum.split_with(explosions, &(&1.clear_at > time))

    case expired do
      [] ->
        state

      _ ->
        state
        |> Explosion.end_explosions(expired)
        |> put_in([:explosions], exploding)
    end
  end
end
