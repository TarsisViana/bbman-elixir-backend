# Bomberman Elixir Backend 
A real-time multiplayer backend for a Bomberman-style game, built with **Elixir**, **Phoenix**, and **WebSockets**. This server manages the core gameplay logic, player coordination, and fast communication with a minimal TypeScript frontend. The server is published on Fly.io with an Docker image.
## Setup

### Prerequisites
 - Elixir (and Erlang) installed on your machine.
 - Node.js and npm for frontend development.

1. Set up the Elixir backend:
```bash
cd elx-server
mix deps.get
mix phx.server
```
The backend should now be running at http://localhost:4000.

2. Set up the frontend with Vite
In the root folder:
```bash
npm install
npm run dev
```
The frontend will typically run at http://localhost:5173
