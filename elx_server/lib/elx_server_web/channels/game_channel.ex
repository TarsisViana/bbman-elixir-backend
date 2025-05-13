defmodule ElxServerWeb.GameChannel do
  use ElxServerWeb, :channel

  alias ElxServer.GameServer
  alias ElxServer.GameUtils

  def join("game:lobby", %{"color" => color}, socket) do
    {:ok, player_id} = GameServer.add_player(color)
    send(self(), :after_join)
    {:ok, assign(socket, :player_id, player_id)}
  end

  def handle_info(:after_join, socket) do
    grid = GameServer.get_grid()
    players = GameServer.get_players()
    score = GameServer.snapshot_scores()

    push(socket, "init", %{
      "playerId" => socket.assigns.player_id,
      "grid" => grid |> format_grid_for_client(),
      "players" => players |> format_players_for_client(),
      "score" => score
    })

    {:noreply, socket}
  end

  defp format_grid_for_client(grid) do
    grid
    |> Enum.map(fn {{x, y}, cell} ->
      %{"x" => x, "y" => y, "value" => cell}
    end)
  end

  defp format_players_for_client(players) do
    players
    |> Enum.map(fn {id, player} ->
      %{"id" => id, "player" => player}
    end)
  end
end
