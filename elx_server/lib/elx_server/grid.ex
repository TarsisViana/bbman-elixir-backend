defmodule ElxServer.Grid do
  alias ElxServer.GameServer.State

  @columns 31
  @rows 25
  @crate_refill_ms 20_000

  @type grid :: %{{integer(), integer()} => cell_type()}
  @type cell_type ::
          :empty
          | :wall
          | :crate
          | :bomb
          | :explosion
          | :powerup_fire
          | :powerup_bomb

  defmodule Cell do
    @type atom_t ::
            :empty
            | :wall
            | :crate
            | :bomb
            | :explosion
            | :powerup_fire
            | :powerup_bombs

    @mapping %{
      empty: 0,
      wall: 1,
      crate: 2,
      bomb: 3,
      explosion: 4,
      powerup_fire: 5,
      powerup_bomb: 6
    }

    def to_int(atom) when is_atom(atom), do: Map.fetch!(@mapping, atom)
    def to_atom(int), do: @mapping |> Enum.find(fn {_key, value} -> value == int end) |> elem(0)
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

  def find_free_cell(grid, players) do
    taken =
      players
      |> Map.values()
      |> Enum.filter(fn player -> player.alive end)
      |> Enum.map(fn player -> {player.x, player.y} end)
      |> MapSet.new()

    loop_recursive(grid, taken, 100)
  end

  defp loop_recursive(_grid, _taken, 0), do: {:error, :no_spawn_available}

  defp loop_recursive(grid, taken, attempts) do
    x = Enum.random(1..(@columns - 2))
    y = Enum.random(1..(@rows - 2))
    cell = grid |> Map.get({x, y})

    if cell == :empty and not MapSet.member?(taken, {x, y}) do
      {x, y}
    else
      loop_recursive(grid, taken, attempts - 1)
    end
  end

  def in_bounds?(x, y) when is_integer(x) and is_integer(y) do
    x >= 0 and x < @columns and y >= 0 and y < @rows
  end

  def get_grid_size() do
    [@rows, @columns]
  end

  def set_cell({x, y}, value, {grid, updated_cells}) do
    if in_bounds?(x, y) and Map.get(grid, {x, y}) != value do
      grid = Map.put(grid, {x, y}, value)
      updated_cells = MapSet.put(updated_cells, %{x: x, y: y, value: value})

      {grid, updated_cells}
    else
      {grid, updated_cells}
    end
  end

  # skip if it's too soon
  def maybe_refill_crates(%State{last_refill: last} = state, now)
      when is_integer(now) and now - last < @crate_refill_ms,
      do: state

  # skip if enough crates already exist
  def maybe_refill_crates(%State{grid: grid} = state, now) do
    if crate_count(grid) >= trunc(@columns * @rows * 0.10) do
      %{state | last_refill: now}
    else
      refill_crates(state, now)
    end
  end

  defp refill_crates(
         %State{grid: grid, players: players, updated_cells: updated_cells} = state,
         now
       ) do
    total = @columns * @rows
    desired = trunc(total * 0.20)
    current = crate_count(grid)
    needed = desired - current

    {updated_grid, up_cells} =
      Enum.reduce(1..needed, {grid, updated_cells}, fn _, {g, uc} ->
        case find_free_cell(g, players) do
          {:error, _} -> {g, uc}
          pos -> set_cell(pos, :crate, {g, uc})
        end
      end)

    %{state | grid: updated_grid, last_refill: now, updated_cells: up_cells}
  end

  defp crate_count(grid) do
    Enum.count(grid, fn {_pos, cell} -> cell == :crate end)
  end
end
