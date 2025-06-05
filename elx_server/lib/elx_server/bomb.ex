defmodule ElxServer.Bomb do
  alias ElxServer.{Player, Grid, Explosion}
  alias ElxServer.GameServer.State

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

  def explode_multiple(%State{} = state, exploding) do
    Enum.reduce(exploding, state, fn bomb, acc ->
      explode_bomb(bomb, acc)
    end)
  end

  def explode_bomb(%__MODULE__{owner: %Player{} = owner} = bomb, %State{} = state) do
    state
    |> update_in([:players, owner.id], &%{&1 | active_bombs: &1.active_bombs - 1})
    |> Explosion.blast({bomb.x, bomb.y}, owner)
    |> explode_in_all_directions(bomb, owner)
  end

  defp explode_in_all_directions(state, bomb, %Player{fire_power: fire_power} = owner) do
    dir = [{1, 0}, {-1, 0}, {0, 1}, {0, -1}]

    Enum.reduce(dir, state, fn {dx, dy}, acc_state ->
      explode_in_direction(acc_state, bomb, {dx, dy}, fire_power, owner)
    end)
  end

  defp explode_in_direction(%State{} = state, bomb, {dx, dy}, fire_power, owner) do
    Enum.reduce_while(1..fire_power, state, fn i, acc ->
      nx = bomb.x + dx * i
      ny = bomb.y + dy * i

      case {Grid.in_bounds?(nx, ny), Map.get(acc.grid, {nx, ny})} do
        {false, _} ->
          {:halt, acc}

        {true, :wall} ->
          {:halt, acc}

        {true, cell} when cell in [:crate, :bomb] ->
          acc = Explosion.blast(acc, {nx, ny}, owner)
          {:halt, acc}

        {true, _} ->
          acc = Explosion.blast(acc, {nx, ny}, owner)
          {:cont, acc}
      end
    end)
  end
end
