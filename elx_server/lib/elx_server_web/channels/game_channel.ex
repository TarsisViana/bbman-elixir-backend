defmodule ElxServerWeb.GameChannel do
  use ElxServerWeb, :channel

  alias ElxServer.GameUtils
  alias ElxServer.GameServer

  def join("game:lobby", %{"color" => color}, socket) do
    {:ok, player_id} = GameServer.add_player(color)
    send(self(), :after_join)
    {:ok, assign(socket, :player_id, player_id)}
  end

  def handle_info(:after_join, socket) do
    grid = GameServer.get_grid()
    players = GameServer.snapshot_players()
    score = GameServer.snapshot_scores()

    IO.inspect(GameServer.snapshot_players())

    push(socket, "init", %{
      "type" => "init",
      "playerId" => socket.assigns.player_id,
      "grid" => grid |> format_grid_for_client(),
      "gridSize" => GameUtils.get_grid_size(),
      "players" => players,
      "scores" => score
    })

    {:noreply, socket}
  end

  defp format_grid_for_client(grid) do
    grid
    |> Enum.map(fn {{x, y}, cell} ->
      %{"x" => x, "y" => y, "value" => cell}
    end)
  end
end
