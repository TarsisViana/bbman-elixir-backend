defmodule ElxServer.Explosion do
  alias ElxServer.GameServer.State
  alias ElxServer.{Bomb, Player, Grid}

  defstruct [
    :x,
    :y,
    :restore_to,
    :clear_at
  ]

  @explosion_duration_ms 500

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

  def blast({x, y} = pos, owner, %State{} = state) do
    # explode other bombs in range
    cell = Map.get(state.grid, pos)
    updated_bombs = chain_explosion(pos, cell, state.bombs)
    # decide what should re-appear after the flame
    restore = maybe_powerup(cell)
    # explode
    {new_grid, updated_cells} =
      Grid.set_cell({x, y}, :explosion, {state.grid, state.updated_cells})

    # schedule cell restoration
    new_explosions = [new(x, y, restore) | state.explosions]

    # kill players in range
    {new_players, updated_players} = Player.kill_player_at({x, y}, owner, state)

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

  defp maybe_powerup(:crate) do
    case :rand.uniform() do
      r when r < 0.1 ->
        :powerup_fire

      r when r < 0.2 ->
        :powerup_bomb

      _ ->
        :empty
    end
  end

  defp maybe_powerup(_cell), do: :empty

  def end_explosions(explosions, state) do
    new_state =
      Enum.reduce(explosions, state, fn explosion, acc ->
        {new_grid, updated_cells} =
          Grid.set_cell(
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
end
