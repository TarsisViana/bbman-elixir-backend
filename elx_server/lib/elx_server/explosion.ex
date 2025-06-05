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
    cell = Map.get(state.grid, pos)
    restore = maybe_powerup(cell)

    state
    # explode other bombs in range
    |> update_in([:bombs], &chain_explosion(pos, cell, &1))
    |> Grid.set_cell({x, y}, :explosion)
    # schedule cell restoration
    |> update_in([:explosions], &[new(x, y, restore) | &1])
    |> Player.kill_player_at({x, y}, owner)
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

  def end_explosions(%State{} = state, explosions) do
    Enum.reduce(explosions, state, fn explosion, acc ->
      acc
      |> Grid.set_cell({explosion.x, explosion.y}, explosion.restore_to)
    end)
  end

  def chain_explosion({x, y}, :bomb, bombs) do
    Enum.map(bombs, fn
      %Bomb{x: ^x, y: ^y} = bomb -> %{bomb | explode_at: now_ms()}
      bomb -> bomb
    end)
  end

  def chain_explosion(_pos, _cell, bombs), do: bombs
end
