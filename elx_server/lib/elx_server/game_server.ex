defmodule ElxServer.GameServer do
  use GenServer
  alias ElxServer.GameUtils
  alias ElxServer.Player

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  end

  defmodule State do
    defstruct grid: %{}, players: %{}
  end

  def init(_) do
    grid = GameUtils.build_grid()
    {:ok, %State{grid: grid}}
  end

  def handle_call(:get_grid, _from, state) do
    {:reply, state.grid, state}
  end

  def handle_call(:get_players, _from, state) do
    IO.inspect(state.players)
    {:reply, state.players, state}
  end

  def handle_call({:new_player, color}, _from, state) do
    player = Player.create(color, state.grid, state.players)
    updated_players = Map.put(state.players, player.id, player)
    {:reply, %{player_id: player.id}, %State{state | players: updated_players}}
  end

  def get_grid do
    GenServer.call(__MODULE__, :get_grid)
  end

  def get_players do
    GenServer.call(__MODULE__, :get_players)
  end

  def new_player(color) do
    player_id = GenServer.call(__MODULE__, {:new_player, color})
    {:ok, player_id}
  end
end
