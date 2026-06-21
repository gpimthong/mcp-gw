# mcp-gw

An aggregating MCP (Model Context Protocol) gateway that runs as a Docker container. Claude Code connects to one endpoint and gets tools from all registered backend MCP servers combined.

## Architecture

```
Claude Code
    │  HTTP MCP (localhost:3000/mcp)
    ▼
┌─────────────────────────────┐
│       mcp-gateway           │  ← Alpine Docker container
│  ┌─────────┐ ┌──────────┐  │
│  │ MCP srv │ │Dashboard │  │
│  └────┬────┘ └──────────┘  │
│       │  mcp-gw-net         │
└───────┼─────────────────────┘
        │
        ├── backend-a:8080
        ├── backend-b:8080
        └── ...
```

Tools from all backends are aggregated and namespaced as `backend__tool_name` so Claude Code sees them in a single tool list.

## Quick Start

```bash
git clone https://github.com/gpimthong/mcp-gw
cd mcp-gw
docker compose up -d
```

The gateway starts on port **3000**.

- Dashboard: http://localhost:3000
- MCP endpoint: http://localhost:3000/mcp
- Health: http://localhost:3000/api/health

### Connect Claude Code

Add to `~/.mcp.json`:

```json
{
  "mcpServers": {
    "gateway": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Restart Claude Code to pick up the change.

## Adding Backend MCP Servers

Backend servers must be containers on the `mcp-gw-net` Docker network.

```bash
# Attach an existing container to the network
docker network connect mcp-gw-net <container-name>

# Or start a new backend directly on the network
docker run -d --name my-mcp --network mcp-gw-net my-mcp-image
```

Then register the backend via the dashboard form or the REST API:

```bash
curl -X POST http://localhost:3000/api/backends \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-mcp","url":"http://my-mcp:8080/mcp","transport":"http","enabled":true}'
```

The registration is saved to `config/backends.json` and reconnects automatically on gateway restart.

## Dashboard

The dashboard at http://localhost:3000 shows:

- **Backend cards** — connection status, tool count, latency, last ping
- **Live request log** — real-time stream of every tool call with duration and status
- **Tool catalog** — all tools from all backends, expandable by backend

Use the **+ Add Backend** button to register new backends, or click **Remove** / **Reconnect** on each card.

## REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Status, version, uptime, tool count |
| `GET` | `/api/backends` | List all backends with state |
| `POST` | `/api/backends` | Add / reconnect a backend |
| `DELETE` | `/api/backends/:name` | Remove a backend |
| `POST` | `/api/backends/:name/reconnect` | Force reconnect |
| `GET` | `/api/logs` | Last 200 log entries |
| `GET` | `/api/logs/stream` | SSE live log stream |

## Tool Namespacing

Backend `memory` with tool `search_notes` → exposed to Claude Code as `memory__search_notes`.

The double-underscore separator avoids collisions between backends. The gateway parses the prefix at call time to route to the right backend client.

## Transport Support

| Backend transport | Config value |
|---|---|
| MCP Streamable HTTP | `"transport": "http"` |
| MCP SSE (legacy) | `"transport": "sse"` |

## Development

Requires Node.js 22+.

```bash
npm install
npm run dev        # tsx hot-reload
npm run build      # compile TypeScript → dist/
```

Config is read from `./config/backends.json` in dev mode (set `CONFIG_PATH` env var to override).

## Versioning

Version is set in `package.json`. The gateway advertises it in the MCP `initialize` handshake and at `/api/health`. Git tags follow `v<semver>` (e.g. `v0.1.0`).

## Project Structure

```
src/
  index.ts            — entry point
  version.ts          — reads version from package.json
  types.ts            — shared interfaces
  logger.ts           — circular log buffer + SSE emitter
  config.ts           — load/save backends.json
  backend-registry.ts — MCP client connections + heartbeat
  tool-aggregator.ts  — namespace + route tool calls
  mcp-server.ts       — MCP HTTP server (session management)
  dashboard.ts        — Express app (REST API + SSE)
public/
  index.html          — dashboard SPA (no build step)
config/
  backends.json       — persisted backend definitions
```
