defmodule ElxServerWeb.GameChannel do
  use ElxServerWeb, :channel

  def join("game:lobby", %{"color" => color}, socket) do
    player_id = UUID.uuid4()
    # make function to create player passing player_id and color
    send(self(), :after_join)
    {:ok, assign(socket, :player_id, player_id)}
  end

  def handle_info(:after_join, socket) do
    player_id = socket.assigns.player_id

    push(socket, "init", %{
      "playerId" => player_id,
      "grid" => "get grid",
      "players" => "get players",
      "score" => "get score"
    })

    {:noreply, socket}
  end
end
