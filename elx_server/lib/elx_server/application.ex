defmodule ElxServer.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      ElxServerWeb.Telemetry,
      {DNSCluster, query: Application.get_env(:elx_server, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: ElxServer.PubSub},
      # Start the Finch HTTP client for sending emails
      {Finch, name: ElxServer.Finch},
      # Start a worker by calling: ElxServer.Worker.start_link(arg)
      # {ElxServer.Worker, arg},
      # Start to serve requests, typically the last entry
      ElxServerWeb.Endpoint,
      # start the server
      {ElxServer.GameServer, []}
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: ElxServer.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    ElxServerWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
