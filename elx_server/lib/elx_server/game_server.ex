defmodule ElxServer.GameServer do
  use GenServer

  alias ElxServer.GameUtils
  alias ElxServer.Player

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  end

  defmodule State do
    defstruct grid: %{},
              players: %{}
  end

  # Handler functions

  def init(_) do
    grid = GameUtils.build_grid()
    {:ok, %State{grid: grid}}
  end

  def handle_call(:get_grid, _from, state) do
    {:reply, state.grid, state}
  end

  def handle_call(:get_players, _from, state) do
    {:reply, state.players, state}
  end

  def handle_call({:add_player, color}, _from, state) do
    player = Player.create(color, state.grid, state.players)
    updated_players = Map.put(state.players, player.id, player)
    {:reply, player.id, %State{state | players: updated_players}}
  end

  def handle_call(:snapshot_scores, _from, state) do
    scores =
      state.players
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

    {:reply, scores, state}
  end

  def handle_call(:snapshot_players, _from, state) do
    players =
      state.players
      |> Enum.into(%{}, fn {id, player} ->
        {id, Player.snapshot(player)}
      end)

    {:reply, players, state}
  end

  # Wrappers

  def get_grid do
    GenServer.call(__MODULE__, :get_grid)
  end

  def get_players do
    GenServer.call(__MODULE__, :get_players)
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
end
