defmodule ElxServer.Player do
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
end
