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

  def explode(%__MODULE__{owner: %Player{} = owner} = bomb, %State{} = state) do
    new_state = %{
      state
      | players:
          Map.update!(state.players, owner.id, fn %Player{} = curr_player ->
            %{curr_player | active_bombs: curr_player.active_bombs - 1}
          end)
    }

    new_state = Explosion.blast({bomb.x, bomb.y}, owner, new_state)

    dir = [{1, 0}, {-1, 0}, {0, 1}, {0, -1}]

    new_state =
      Enum.reduce(dir, new_state, fn {dx, dy}, acc_state ->
        Enum.reduce_while(1..owner.fire_power, acc_state, fn i, acc ->
          nx = bomb.x + dx * i
          ny = bomb.y + dy * i

          case {Grid.in_bounds?(nx, ny), Map.get(acc.grid, {nx, ny})} do
            {false, _} ->
              {:halt, acc}

            {true, :wall} ->
              {:halt, acc}

            {true, cell} when cell in [:crate, :bomb] ->
              acc = Explosion.blast({nx, ny}, owner, acc)
              {:halt, acc}

            {true, _} ->
              acc = Explosion.blast({nx, ny}, owner, acc)
              {:cont, acc}
          end
        end)
      end)

    new_state
  end
end
