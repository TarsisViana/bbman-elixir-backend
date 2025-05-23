defmodule ElxServer.GameServer do
  use GenServer

  alias ElxServer.GameUtils.Cell
  alias ElxServer.{GameUtils, Player, Bomb}
  alias ElxServerWeb.Endpoint

  @tick_ms 50

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  defmodule State do
    alias ElxServer.Explosion

    defstruct grid: %{},
              players: %{},
              bombs: [],
              explosions: [],
              updated_players: [],
              updated_cells: []

    @type t :: %__MODULE__{
            grid: GameUtils.grid(),
            players: map(),
            updated_players: list(),
            updated_cells: list(),
            bombs: list(Bomb),
            explosions: list(Explosion)
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

  # ────────────────────────────────────────────────────────────────────────────
  # GAME LOOP
  # ────────────────────────────────────────────────────────────────────────────
  def handle_info(:tick, %State{} = state) do
    # update state
    tick_start = GameUtils.now_ms()

    {%State{} = new_state} = timeout_check(:bombs, tick_start, state)

    diff? = Enum.any?(new_state.updated_players) or Enum.any?(new_state.updated_cells)

    if diff? do
      updated_players =
        Enum.map(new_state.updated_players, fn id ->
          Map.get(state.players, id)
          |> Player.snapshot()
        end)

      msg = %{
        "type" => "diff",
        "updatedPlayers" => updated_players,
        "updatedCells" => new_state.updated_cells,
        "scores" => get_scores(new_state.players)
      }

      Endpoint.broadcast("game:lobby", "diff", msg)
      schedule_tick()

      new_state =
        %State{new_state | updated_cells: [], updated_players: []}

      {:noreply, new_state}
    else
      schedule_tick()
      {:noreply, state}
    end
  end

  # ────────────────────────────────────────────────────────────────────────────
  # SERVER CALLBACKS
  # ────────────────────────────────────────────────────────────────────────────
  def init(_) do
    schedule_tick()
    grid = GameUtils.build_grid()
    {:ok, %State{grid: grid}}
  end

  def handle_call({:add_player, color}, _from, %State{} = state) do
    new_player = Player.create(color, state.grid, state.players)

    new_state = %State{
      state
      | players: Map.put(state.players, new_player.id, new_player),
        updated_players: [new_player.id | state.updated_players]
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

  def handle_cast({:move, {id, dx, dy} = _data}, %State{} = state) do
    case Map.get(state.players, id) do
      nil ->
        {:noreply, state}

      %Player{alive: false} ->
        {:noreply, state}

      %Player{x: curr_x, y: curr_y} = player ->
        {nx, ny} = {curr_x + dx, curr_y + dy}

        cell = Map.get(state.grid, {nx, ny})

        if GameUtils.in_bounds?(nx, ny) and cell not in [Cell.wall(), Cell.crate(), Cell.bomb()] do
          players = Map.put(state.players, id, %{player | x: nx, y: ny})
          updated_players = [id | state.updated_players]

          {:noreply, %State{state | players: players, updated_players: updated_players}}
        else
          IO.puts("cell blocked: player didnt move")
          {:noreply, state}
        end
    end
  end

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
              | grid: Map.put(state.grid, {pl.x, pl.y}, Cell.bomb()),
                bombs: [bomb | state.bombs],
                players:
                  Map.update!(state.players, id, fn p ->
                    %{p | active_bombs: p.active_bombs + 1}
                  end),
                updated_players: [id | state.updated_players],
                updated_cells: [%{x: pl.x, y: pl.y, value: Cell.bomb()} | state.updated_cells]
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
  defp schedule_tick do
    Process.send_after(self(), :tick, @tick_ms)
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

  def timeout_check(:bombs, time, %State{bombs: bombs} = state) do
    {live_bombs, exploding} = Enum.split_with(bombs, fn bomb -> bomb.explode_at > time end)

    # extract this logic
    if Enum.any?(exploding) do
      {new_grid, updated_cells} =
        Enum.reduce(exploding, {state.grid, state.updated_cells}, fn bomb, acc ->
          GameUtils.set_cell({bomb.x, bomb.y}, Cell.empty(), acc)
        end)

      IO.inspect(updated_cells)

      new_players =
        Enum.reduce(exploding, state.players, fn bomb, acc ->
          Map.update!(acc, bomb.owner.id, fn %Player{} = curr_player ->
            %{curr_player | active_bombs: curr_player.active_bombs - 1}
          end)
        end)

      new_state =
        %State{
          state
          | grid: new_grid,
            players: new_players,
            bombs: live_bombs,
            updated_cells: updated_cells
        }

      {new_state}
    else
      {state}
    end
  end
end
