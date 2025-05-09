defmodule ElxServerWeb.UserSocket do
  use Phoenix.Socket

  ## Channels
  channel("game:lobby", ElxServerWeb.GameChannel)

  def connect(_params, socket, _connect_info) do
    {:ok, socket}
  end

  def id(_socket), do: nil
end
