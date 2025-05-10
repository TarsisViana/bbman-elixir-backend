defmodule ElxServer.GameServer do
  use GenServer
  alias ElxServer.GameUtils

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  end

  defmodule State do
    defstruct grid: %{}
  end

  def init(_) do
    grid = GameUtils.build_grid()
    {:ok, %State{grid: grid}}
  end

  def handle_call(:get_grid, _from, state) do
    {:reply, state.grid, state}
  end

  def get_grid do
    GenServer.call(__MODULE__, :get_grid)
  end
end
