defmodule ElxServer.Player do
  alias ElxServer.{Grid, GameServer.State}

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

  def kill_player_at({x, y}, bomb_owner, %State{} = state) do
    Enum.reduce(state.players, {state.players, state.updated_players}, fn
      {id, %__MODULE__{alive: true, x: ^x, y: ^y} = pl}, {acc_pl, acc_ids} ->
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
        ElxServer.Game.schedule_respawn(id)

        {acc_pl, acc_ids}

      _, acc ->
        acc
    end)
  end

  def check_powerup(players, pos, id, %State{} = state) do
    case Map.get(state.grid, pos) do
      :powerup_bomb ->
        updated_players =
          Map.update!(players, id, fn %__MODULE__{} = player ->
            %{player | max_bombs: player.max_bombs + 1}
          end)

        {grid, updated_cells} = Grid.set_cell(pos, :empty, {state.grid, state.updated_cells})

        %{state | grid: grid, players: updated_players, updated_cells: updated_cells}

      :powerup_fire ->
        updated_players =
          Map.update!(players, id, fn %__MODULE__{} = player ->
            %{player | fire_power: player.fire_power + 1}
          end)

        {grid, updated_cells} = Grid.set_cell(pos, :empty, {state.grid, state.updated_cells})

        %{state | grid: grid, players: updated_players, updated_cells: updated_cells}

      _ ->
        %{state | players: players}
    end
  end
end
