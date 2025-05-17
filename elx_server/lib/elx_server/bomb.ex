defmodule ElxServer.Bomb do
  alias ElxServer.Player

  @fuse_ms 2000

  defstruct [
    :x,
    :y,
    :owner,
    :explode_at
  ]

  def new(x, y, %Player{} = owner) do
    %__MODULE__{
      x: x,
      y: y,
      owner: owner,
      explode_at: now_ms() + @fuse_ms
    }
  end

  defp now_ms do
    System.monotonic_time(:millisecond)
  end
end
