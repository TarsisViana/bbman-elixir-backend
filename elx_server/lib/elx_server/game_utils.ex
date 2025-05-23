defmodule ElxServer.GameUtils do
  alias ElxServer.GameServer.State
  alias ElxServer.Bomb
  @columns 31
  @rows 25

  @type grid :: %{{integer(), integer()} => 0..6}

  defmodule Cell do
    @type t ::
            :empty
            | :wall
            | :crate
            | :bomb
            | :explosion
            | :powerup_fire
            | :powerup_bomb

    def empty, do: 0
    def wall, do: 1
    def crate, do: 2
    def bomb, do: 3
    def explosion, do: 4
    def powerup_fire, do: 5
    def powerup_bomb, do: 6
  end

  def now_ms do
    System.monotonic_time(:millisecond)
  end

  def get_grid_size() do
    [@rows, @columns]
  end

  def in_bounds?(x, y) when is_integer(x) and is_integer(y) do
    x >= 0 and x < @columns and y >= 0 and y < @rows
  end

  def cell_empty?(x, y) when is_integer(x) and is_integer(y) do
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
      border?(x, y) or pillar?(x, y) -> Cell.wall()
      :rand.uniform() < 0.5 -> Cell.crate()
      true -> Cell.empty()
    end
  end

  defp border?(x, y), do: x in [0, @columns - 1] or y in [0, @rows - 1]
  defp pillar?(x, y), do: rem(x, 2) == 0 and rem(y, 2) == 0

  def find_free_spawn(grid, players) do
    taken =
      Map.values(players)
      |> Enum.filter(fn player -> player.alive end)
      |> Enum.map(fn player -> %{x: player.x, y: player.y} end)

    loop_recursive(grid, taken, 100)
  end

  defp loop_recursive(_grid, _taken, 0), do: {:error, :no_spawn_available}

  defp loop_recursive(grid, taken, attempts) do
    x = Enum.random(1..(@columns - 2))
    y = Enum.random(1..(@rows - 2))
    cell = grid |> Map.get({x, y})

    if cell == Cell.empty() and {x, y} not in taken do
      %{x: x, y: y}
    else
      loop_recursive(grid, taken, attempts - 1)
    end
  end

  # Bomb explosion
  @spec explode_bombs(list(%Bomb{}), %State{}) :: {%State{}}
  def explode_bombs(bombs, state) do
    new_state =
      Enum.map(bombs, fn %Bomb{} = bomb ->
        blast({bomb.x, bomb.y}, bomb.owner, state)
      end)
  end

  def blast({x, y}, owner, state) do
    # explode other bombs in range
    # decide what should re-appear after the flame
    # kill players in range
  end

  def set_cell({x, y}, value, {grid, updated_cells}) do
    same_value = Map.get(grid, {x, y}) == value

    if in_bounds?(x, y) and not same_value do
      grid = Map.put(grid, {x, y}, value)
      updated_cells = [%{x: x, y: y, value: value} | updated_cells]

      {grid, updated_cells}
    else
      {grid, updated_cells}
    end
  end
end
