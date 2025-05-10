defmodule ElxServerWeb.GameChannel do
  use ElxServerWeb, :channel

  alias ElxServer.GameServer

  def join("game:lobby", %{"color" => color}, socket) do
    player_id = UUID.uuid4()
    # make function to create player passing player_id and color
    send(self(), :after_join)
    {:ok, assign(socket, :player_id, player_id)}
  end

  def handle_info(:after_join, socket) do
    player_id = socket.assigns.player_id
    grid = GameServer.get_grid() |> format_grid_for_client()

    push(socket, "init", %{
      "playerId" => player_id,
      "grid" => grid,
      "players" => "get players",
      "score" => "get score"
    })

    {:noreply, socket}
  end

  def format_grid_for_client(grid) do
    grid
    |> Enum.map(fn {{x, y}, cell} ->
      %{"x" => x, "y" => y, "value" => cell}
    end)
  end
end
