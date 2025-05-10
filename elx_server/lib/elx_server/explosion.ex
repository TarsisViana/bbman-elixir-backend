defmodule ElxServer.Explosion do
  defstruct [
    :x,
    :y,
    :restore_to,
    :clear_at
  ]

  @exposion_duration_ms 500

  def new(x, y, restore_to) do
    %ElxServer.Explosion{
      x: x,
      y: y,
      restore_to: restore_to,
      clear_at: now_ms() + @explosion_duration_ms
    }
  end

  defp now_ms do
    System.monotonic_time(:millisecond)
  end
end
