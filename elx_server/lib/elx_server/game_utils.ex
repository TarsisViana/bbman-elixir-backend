defmodule ElxServer.GameUtils do
  @columns 31
  @rows 25

  @type cell_type ::
          :empty
          | :wall
          | :crate
          | :bomb
          | :explosion
          | :powerup_fire
          | :powerup_bomb

  @type grid :: %{{integer(), integer()} => cell_type()}

  def now_ms do
    System.system_time(:milliseconds)
  end

  def in_bounds?(x, y) when is_integer(x) and is_integer(y) do
    x >= 0 and x < @columns and y >= 0 and y < @rows
  end

  @spec build_grid() :: grid()
  def build_grid() do
    for y <- 0..(@rows - 1), x <- 0..(@columns - 1), into: %{} do
      {{x, y}, choose_cell_type(x, y)}
    end
  end

  defp choose_cell_type(x, y) do
    cond do
      border?(x, y) or pillar?(x, y) -> :wall
      :rand.uniform() < 0.5 -> :crate
      true -> :empty
    end
  end

  defp border?(x, y), do: x in [0, @columns - 1] or y in [0, @rows - 1]
  defp pillar?(x, y), do: rem(x, 2) == 0 and rem(y, 2) == 0
end
