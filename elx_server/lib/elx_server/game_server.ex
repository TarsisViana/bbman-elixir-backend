defmodule ElxServer.GameServer do
  use GenServer

  alias ElxServer.{GameUtils, Player}
  alias ElxServerWeb.Endpoint

  @tick_ms 50

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  defmodule State do
    defstruct grid: %{},
              players: %{},
              updated_players: []
  end

  # PUBLIC FUNCTIONS
  def get_grid do
    GenServer.call(__MODULE__, :get_grid)
  end

  def add_player(color) do
    player_id = GenServer.call(__MODULE__, {:add_player, color})

    {:ok, player_id}
  end

  def snapshot_scores() do
    GenServer.call(__MODULE__, :snapshot_scores)
  end

  def snapshot_players() do
    GenServer.call(__MODULE__, :snapshot_players)
  end

  def remove_player(id) do
    GenServer.cast(__MODULE__, {:remove_player, id})
  end

  # gameloop
  def handle_info(:tick, state) do
    # update state

    if length(state.updated_players) > 0 do
      diff = %{
        "type" => "diff",
        "updatedPlayers" => state.updated_players,
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

  # SERVER CALLBACKS
  def init(_) do
    schedule_tick()
    grid = GameUtils.build_grid()
    {:ok, %State{grid: grid}}
  end

  def handle_call(:get_grid, _from, state) do
    {:reply, state.grid, state}
  end

  def handle_call({:add_player, color}, _from, %State{} = state) do
    new_player = Player.create(color, state.grid, state.players)
    players = Map.put(state.players, new_player.id, new_player)
    updated_players = state.updated_players ++ [Player.snapshot(new_player)]

    new_state = %State{state | players: players, updated_players: updated_players}
    IO.inspect(new_state.updated_players, label: "Updated players array:")

    {:reply, new_player.id, new_state}
  end

  def handle_call(:snapshot_scores, _from, state) do
    scores = get_scores(state.players)

    {:reply, scores, state}
  end

  def handle_call(:snapshot_players, _from, state) do
    players = Enum.map(state.players, fn {_id, player} -> Player.snapshot(player) end)

    {:reply, players, state}
  end

  def handle_cast({:remove_player, id}, state) do
    case Map.has_key?(state.players, id) do
      false ->
        {:noreply, state}

      true ->
        updated_players = Map.delete(state.players, id)
        {:noreply, %{state | players: updated_players}}
    end
  end

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
