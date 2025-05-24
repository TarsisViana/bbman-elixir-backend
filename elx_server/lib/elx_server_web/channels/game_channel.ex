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
    {:ok, {grid, players, scores}} = GameServer.init_player_msg()

    push(socket, "init", %{
      "type" => "init",
      "playerId" => socket.assigns.player_id,
      "grid" => grid |> format_grid_for_client(),
      "gridSize" => GameUtils.get_grid_size(),
      "players" => players,
      "scores" => scores
    })

    {:noreply, socket}
  end

  def handle_in("move", payload, socket) do
    %{"dx" => dx, "dy" => dy} = payload

    GameServer.player_move({socket.assigns.player_id, dx, dy})

    {:reply, :ok, socket}
  end

  def handle_in("bomb", _payload, socket) do
    GameServer.player_bomb(socket.assigns.player_id)

    {:reply, :ok, socket}
  end

  # Disconnects
  def terminate(_reason, socket) do
    player_id = socket.assigns.player_id
    IO.puts("Player #{player_id} disconnected.")
    GameServer.remove_player(player_id)
    :ok
  end

  # ____HELPERS_____
  defp format_grid_for_client(grid) do
    grid
    |> Enum.map(fn {{x, y}, cell} ->
      %{"x" => x, "y" => y, "value" => GameUtils.Cell.to_int(cell)}
    end)
  end
end
