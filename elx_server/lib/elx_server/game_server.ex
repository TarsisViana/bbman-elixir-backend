defmodule ElxServer.GameServer do
  use GenServer

  alias ElxServer.{GameUtils, Player}
  alias ElxServerWeb.Endpoint

  @tick_ms 50

  @moduledoc "Cell type enums"
  @cell_empty 0
  @cell_wall 1
  @cell_crate 2
  @cell_bomb 3
  @cell_explosion 4
  @cell_powerup_fire 5
  @cell_powerup_bomb 6

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  defmodule State do
    defstruct grid: %{},
              players: %{},
              updated_players: []
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

  # ────────────────────────────────────────────────────────────────────────────
  # GAME LOOP
  # ────────────────────────────────────────────────────────────────────────────
  def handle_info(:tick, state) do
    # update state

    if length(state.updated_players) > 0 do
      diff = %{
        "type" => "diff",
        "updatedPlayers" =>
          state.updated_players
          |> Enum.map(fn id -> Map.get(state.players, id) |> Player.snapshot() end),
        "updatedCells" => [],
        "scores" => get_scores(state.players)
      }

      Endpoint.broadcast("game:lobby", "diff", diff)
      schedule_tick()
      {:noreply, %State{state | updated_players: []}}
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
  def handle_cast({:move, {id, dx, dy} = data}, state) do
    case Map.get(state.players, id) do
      nil ->
        {:noreply, state}

      %Player{alive: false} ->
        {:noreply, state}

      %Player{x: curr_x, y: curr_y} = player ->
        {nx, ny} = {curr_x + dx, curr_y + dy}

        cell = Map.get(state.grid, {nx, ny})

        if GameUtils.in_bounds?(nx, ny) and cell not in [@cell_bomb, @cell_wall, @cell_crate] do
          players = Map.put(state.players, id, %{player | x: nx, y: ny})
          updated_players = [id | state.updated_players]

          {:noreply, %State{state | players: players, updated_players: updated_players}}
        else
          IO.puts("cell blocked: player didnt move")
          {:noreply, state}
        end
    end
  end

  def handle_cast(:bomb, state) do
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
end
