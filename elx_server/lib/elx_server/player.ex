defmodule ElxServer.Player do
  alias ElxServer.GameUtils

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
    {x, y} = GameUtils.find_free_spawn(grid, players)

    %__MODULE__{
      id: UUID.uuid4(),
      x: x,
      y: y,
      color: color
    }
  end

  def snapshot(%__MODULE__{} = player) do
    %{
      id: player.id,
      x: player.x,
      y: player.y,
      color: player.color,
      alive: player.alive
    }
  end
end
