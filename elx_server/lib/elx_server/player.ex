defmodule ElxServer.Player do
  alias ElxServer.{Grid, GameServer.State, Game}

  defstruct [
    :id,
    :x,
    :y,
    :color,
    alive: true,
    fire_power: 2,
    max_bombs: 1,
    active_bombs: 0,
    kills: 0,
    deaths: 0,
    assists: 0
  ]

  def create(color, grid, players) do
    {x, y} = Grid.find_free_cell(grid, players)

    %__MODULE__{
      id: UUID.uuid4(),
      x: x,
      y: y,
      color: color
    }
  end

  def snapshot(%__MODULE__{} = player) do
    %{
      id: player.id,
      x: player.x,
      y: player.y,
      color: player.color,
      alive: player.alive
    }
  end

  def kill_player_at(%State{} = state, {x, y}, bomb_owner) do
    acc =
      Enum.reduce(state.players, %{pl: state.players, up_pl: state.updated_players}, fn
        {id, %__MODULE__{alive: true, x: ^x, y: ^y}}, acc ->
          acc
          |> kill_player(id)
          |> maybe_credit_kill(bomb_owner, id)
          |> update_in([:up_pl], &MapSet.put(&1, bomb_owner.id))
          |> tap(fn _ -> Game.schedule_respawn(id) end)

        _, acc ->
          acc
      end)

    %State{state | players: acc.pl, updated_players: acc.up_pl}
  end

  defp kill_player(acc, id) do
    acc
    |> update_in([:pl, id], &%{&1 | alive: false, deaths: &1.deaths + 1})
    |> update_in([:up_pl], &MapSet.put(&1, id))
  end

  defp maybe_credit_kill(acc, %__MODULE__{id: killer_id}, victim_id)
       when killer_id != victim_id do
    update_in(acc, [:pl, killer_id], &%{&1 | kills: &1.kills + 1})
  end

  defp maybe_credit_kill(acc, _killer, _victim), do: acc

  def check_powerup(%State{} = state, pos, id) do
    case Map.get(state.grid, pos) do
      cell when cell not in [:powerup_bomb, :powerup_fire] ->
        state

      :powerup_bomb ->
        state
        |> update_in([:players, id], &%{&1 | max_bombs: &1.max_bombs + 1})
        |> Grid.set_cell(pos, :empty)

      :powerup_fire ->
        state
        |> update_in([:players, id], &%{&1 | fire_power: &1.fire_power + 1})
        |> Grid.set_cell(pos, :empty)
    end
  end
end
