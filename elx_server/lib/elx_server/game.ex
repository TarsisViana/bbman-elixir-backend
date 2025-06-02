defmodule ElxServer.Game do
  @doc """
  PUBLIC API
  """

  alias ElxServer.GameServer

  @respawn_ms 2000

  def start_link(opts), do: GenServer.start_link(GameServer, opts, name: GameServer)

  def add_player(color), do: GenServer.call(GameServer, {:add_player, color})
  def remove_player(id), do: GenServer.cast(GameServer, {:remove_player, id})
  def init_player_msg(), do: GenServer.call(GameServer, :init_player_msg)
  def player_move(data), do: GenServer.cast(GameServer, {:move, data})
  def player_bomb(id), do: GenServer.cast(GameServer, {:bomb, id})

  def schedule_respawn(id),
    do: Process.send_after(GameServer, {:schedule_respawn, id}, @respawn_ms)
end
