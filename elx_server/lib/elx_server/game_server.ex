defmodule ElxServer.GameServer do
  use GenServer

  alias ElxServer.GameUtils.Cell
  alias ElxServer.{GameUtils, Player, Bomb}
  alias ElxServerWeb.Endpoint

  @tick_ms 50
  @respawn_ms 1000
  @topic "game:lobby"
  @event_diff "diff"

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  defmodule State do
    alias ElxServer.Explosion

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
            grid: GameUtils.grid(),
            players: map(),
            updated_players: MapSet.t(),
            updated_cells: MapSet.t(),
            bombs: list(Bomb),
            explosions: list(Explosion),
            last_refill: integer()
          }
  end

  # ────────────────────────────────────────────────────────────────────────────
  # PUBLIC FUNCTIONS
  # ────────────────────────────────────────────────────────────────────────────

  # Player management
  def add_player(color) do
    player_id = GenServer.call(__MODULE__, {:add_player, color})

    {:ok, player_id}
  end

  def init_player_msg() do
    init_data = GenServer.call(__MODULE__, :init_player_msg)

    {:ok, init_data}
  end

  def remove_player(id) do
    GenServer.cast(__MODULE__, {:remove_player, id})
  end

  # Action handlers
  def player_move(data) do
    GenServer.cast(__MODULE__, {:move, data})
  end

  def player_bomb(id) do
    GenServer.cast(__MODULE__, {:bomb, id})
  end

  def schedule_respawn(id) do
    Process.send_after(__MODULE__, {:schedule_respawn, id}, @respawn_ms)
  end

  # ────────────────────────────────────────────────────────────────────────────
  # GAME LOOP
  # ────────────────────────────────────────────────────────────────────────────
  def handle_info(:tick, %State{} = state) do
    started_at = GameUtils.now_ms()

    state
    |> timeout_check(:bombs, started_at)
    |> timeout_check(:explosions, started_at)
    |> GameUtils.maybe_refill_crates()
    |> diff_or_idle(started_at)
  end

  def handle_info({:schedule_respawn, id}, %State{} = state) do
    case Map.get(state.players, id) do
      nil ->
        {:noreply, state}

      player ->
        {x, y} = GameUtils.find_free_cell(state.grid, state.players)

        updated_player = %{player | x: x, y: y, alive: true}

        new_state = %{
          state
          | players: Map.put(state.players, updated_player.id, updated_player),
            updated_players: MapSet.put(state.updated_players, updated_player.id)
        }

        {:noreply, new_state}
    end
  end

  defp diff_or_idle(
         %State{updated_players: up_players, updated_cells: up_cells} = state,
         started_at
       )
       when map_size(up_players) > 0 or map_size(up_cells) > 0 do
    updated_players =
      Enum.map(up_players, fn id -> state.players |> Map.fetch!(id) |> Player.snapshot() end)

    msg = %{
      "type" => @event_diff,
      "updatedPlayers" => updated_players,
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
    schedule_tick(GameUtils.now_ms())
    grid = GameUtils.build_grid()
    {:ok, %State{grid: grid, last_refill: GameUtils.now_ms()}}
  end

  def handle_call({:add_player, color}, _from, %State{} = state) do
    new_player = Player.create(color, state.grid, state.players)

    new_state = %State{
      state
      | players: Map.put(state.players, new_player.id, new_player),
        updated_players: MapSet.put(state.updated_players, new_player.id)
    }

    {:reply, new_player.id, new_state}
  end

  def handle_call(:init_player_msg, _from, state) do
    grid = state.grid
    players = Enum.map(state.players, fn {_id, player} -> Player.snapshot(player) end)
    scores = get_scores(state.players)

    {:reply, {grid, players, scores}, state}
  end

  def handle_cast({:remove_player, id}, state) do
    case Map.has_key?(state.players, id) do
      false ->
        {:noreply, state}

      true ->
        new_players = Map.delete(state.players, id)

        {:noreply, %{state | players: new_players}}
    end
  end

  # ────────────────────────────────────────────────────────────────────────────
  # ACTION HANDLERS
  # ────────────────────────────────────────────────────────────────────────────
  @blocked [:wall, :crate, :bomb]

  def handle_cast({:move, {id, dx, dy}}, %State{players: players} = state)
      when is_map_key(players, id) do
    %Player{alive: alive, x: x, y: y} = players[id]
    nx = x + dx
    ny = y + dy

    with true <- GameUtils.in_bounds?(nx, ny),
         true <- alive,
         false <- Map.get(state.grid, {nx, ny}) in @blocked do
      state =
        Map.update!(players, id, &%{&1 | x: nx, y: ny})
        |> GameUtils.check_powerup({nx, ny}, id, state)

      {:noreply, %{state | updated_players: MapSet.put(state.updated_players, id)}}
    else
      _ -> {:noreply, state}
    end
  end

  def handle_cast({:move, _}, state), do: {:noreply, state}

  def handle_cast({:bomb, id}, %State{} = state) do
    case Map.get(state.players, id) do
      nil ->
        {:noreply, state}

      %Player{alive: false} ->
        {:noreply, state}

      %Player{} = pl ->
        if pl.active_bombs >= pl.max_bombs do
          {:noreply, state}
        else
          bomb = Bomb.new(pl.x, pl.y, pl)

          new_state =
            %State{
              state
              | grid: Map.put(state.grid, {pl.x, pl.y}, :bomb),
                bombs: [bomb | state.bombs],
                players:
                  Map.update!(state.players, id, fn p ->
                    %{p | active_bombs: p.active_bombs + 1}
                  end),
                updated_players: MapSet.put(state.updated_players, id),
                updated_cells:
                  MapSet.put(
                    state.updated_cells,
                    %{x: pl.x, y: pl.y, value: :bomb}
                  )
            }

          {:noreply, new_state}
        end

      _ ->
        {:noreply, state}
    end
  end

  def handle_cast(msg, state) do
    IO.warn("Unhandled cast: #{inspect(msg)}")
    {:noreply, state}
  end

  # ────────────────────────────────────────────────────────────────────────────
  # HELPERS
  # ────────────────────────────────────────────────────────────────────────────
  defp schedule_tick(started_at) when is_integer(started_at) do
    elapsed = GameUtils.now_ms() - started_at
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

  def timeout_check(%State{bombs: bombs} = state, :bombs, time) do
    {live_bombs, exploding} = Enum.split_with(bombs, fn bomb -> bomb.explode_at > time end)

    if Enum.any?(exploding) do
      Enum.reduce(exploding, %{state | bombs: live_bombs}, fn bomb, acc ->
        GameUtils.explode_bomb(bomb, acc)
      end)
    else
      state
    end
  end

  def timeout_check(%State{explosions: explosions} = state, :explosions, time) do
    {exploding, explosion_end} =
      Enum.split_with(explosions, fn explosion ->
        explosion.clear_at > time
      end)

    if Enum.any?(explosion_end) do
      {new_state} = GameUtils.end_explosions(explosion_end, state)

      new_state =
        %State{
          new_state
          | explosions: exploding
        }

      new_state
    else
      state
    end
  end
end
