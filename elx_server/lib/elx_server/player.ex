defmodule ElxServer.Player do
  alias ElxServer.GameUtils

  @derive Jason.Encoder
  defstruct [
    :id,
    :x,
    :y,
    :color,
    alive: true,
    fire_power: 2,
    max_bombs: 1,
    active_bombs: 0,
    kills: 0,
    deaths: 0,
    assists: 0
  ]

  def create(color, grid, players) do
    %{x: x, y: y} = GameUtils.find_free_spawn(grid, players)

    %__MODULE__{
      id: UUID.uuid4(),
      x: x,
      y: y,
      color: color
    }
  end
end
