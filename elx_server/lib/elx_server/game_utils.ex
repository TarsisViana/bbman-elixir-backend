defmodule ElxServer.GameUtils do
  alias ElxServer.GameServer.State
  alias ElxServer.Bomb
  alias ElxServer.Explosion
  alias ElxServer.Player
  @columns 31
  @rows 25

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
    def to_atom(int), do: @mapping |> Enum.find(fn {_k, v} -> v == int end) |> elem(0)
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
      border?(x, y) or pillar?(x, y) -> :wall
      :rand.uniform() < 0.5 -> :crate
      true -> :empty
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

    if cell == :empty and {x, y} not in taken do
      {x, y}
    else
      loop_recursive(grid, taken, attempts - 1)
    end
  end

  # Bomb explosion
  def explode_bomb(%Bomb{owner: %Player{} = owner} = bomb, %State{} = state) do
    new_state = %{
      state
      | players:
          Map.update!(state.players, owner.id, fn %Player{} = curr_player ->
            %{curr_player | active_bombs: curr_player.active_bombs - 1}
          end)
    }

    new_state = blast({bomb.x, bomb.y}, owner, new_state)

    dir = [{1, 0}, {-1, 0}, {0, 1}, {0, -1}]

    new_state =
      Enum.reduce(dir, new_state, fn {dx, dy}, acc_state ->
        Enum.reduce_while(1..owner.fire_power, acc_state, fn i, acc ->
          nx = bomb.x + dx * i
          ny = bomb.y + dy * i

          case {in_bounds?(nx, ny), Map.get(acc.grid, {nx, ny})} do
            {false, _} ->
              {:halt, acc}

            {true, :wall} ->
              {:halt, acc}

            {true, cell} when cell in [:crate, :bomb] ->
              acc = blast({nx, ny}, owner, acc)
              {:halt, acc}

            {true, _} ->
              acc = blast({nx, ny}, owner, acc)
              {:cont, acc}
          end
        end)
      end)

    new_state
  end

  defp blast({x, y} = pos, owner, %State{} = state) do
    # explode other bombs in range
    cell = Map.get(state.grid, pos)
    updated_bombs = chain_explosion(pos, cell, state.bombs)
    # decide what should re-appear after the flame
    restore = :empty
    # explode
    {new_grid, updated_cells} =
      set_cell({x, y}, :explosion, {state.grid, state.updated_cells})

    # schedule cell restoration
    new_explosions = [Explosion.new(x, y, restore) | state.explosions]

    # kill players in range
    {new_players, updated_players} = kill_player_at({x, y}, owner, state)

    %State{
      state
      | grid: new_grid,
        updated_cells: updated_cells,
        bombs: updated_bombs,
        explosions: new_explosions,
        players: new_players,
        updated_players: updated_players
    }
  end

  def set_cell({x, y}, value, {grid, updated_cells}) do
    same_value = Map.get(grid, {x, y}) == value

    if in_bounds?(x, y) and not same_value do
      grid = Map.put(grid, {x, y}, value)
      updated_cells = MapSet.put(updated_cells, %{x: x, y: y, value: value})

      {grid, updated_cells}
    else
      {grid, updated_cells}
    end
  end

  def end_explosions(explosions, state) do
    new_state =
      Enum.reduce(explosions, state, fn explosion, acc ->
        {new_grid, updated_cells} =
          set_cell(
            {explosion.x, explosion.y},
            explosion.restore_to,
            {acc.grid, acc.updated_cells}
          )

        %{acc | grid: new_grid, updated_cells: updated_cells}
      end)

    {new_state}
  end

  def chain_explosion({x, y}, :bomb, bombs) do
    Enum.map(bombs, fn
      %Bomb{x: ^x, y: ^y} = bomb -> %{bomb | explode_at: now_ms()}
      bomb -> bomb
    end)
  end

  def chain_explosion(_pos, _cell, bombs), do: bombs

  def kill_player_at({x, y}, bomb_owner, %State{} = state) do
    Enum.reduce(state.players, {state.players, state.updated_players}, fn
      {id, %Player{alive: true, x: ^x, y: ^y} = pl}, {acc_pl, acc_ids} ->
        # Kill the fool
        acc_pl = Map.put(acc_pl, id, %{pl | alive: false, deaths: pl.deaths + 1})
        acc_ids = MapSet.put(acc_ids, id)

        # kill credit
        acc_pl =
          if id != bomb_owner.id do
            Map.update!(acc_pl, bomb_owner.id, fn player ->
              %{player | kills: player.kills + 1}
            end)
          else
            acc_pl
          end

        acc_ids = MapSet.put(acc_ids, bomb_owner.id)

        # Schedule respawn
        ElxServer.GameServer.schedule_respawn(id)

        {acc_pl, acc_ids}

      _, acc ->
        acc
    end)
  end
end
