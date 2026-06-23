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
        ├── backend-a:8080          ← Docker container on mcp-gw-net
        ├── backend-b:8080          ← Docker container on mcp-gw-net
        └── 10.10.7.22:8123        ← External host (e.g. Home Assistant)
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

## Homelab Deployment

### First-time setup on a new machine

`config/backends.json` is gitignored (to prevent credentials from leaking). You must create it manually on every fresh clone:

```bash
mkdir -p config
cat > config/backends.json << 'EOF'
{
  "backends": []
}
EOF
```

Then start the gateway and register your backends via the dashboard or API.

### Persistent config across restarts

The `config/` directory is bind-mounted into the container (see `docker-compose.yml`). Any backends you register via the dashboard or API are written to `config/backends.json` on the host and survive container restarts automatically.

### Network topology

The gateway runs on a dedicated bridge network `mcp-gw-net` (172.22.0.0/16). Backend containers must be on this network. External hosts (like Home Assistant on your LAN) are reachable directly by IP — no network joining needed for those.

## Adding Backend MCP Servers

### Docker container backends

The container must be on the `mcp-gw-net` network:

```bash
# Attach an existing container
docker network connect mcp-gw-net <container-name>

# Or start a new backend directly on the network
docker run -d --name my-mcp --network mcp-gw-net my-mcp-image
```

Then register it:

```bash
curl -X POST http://localhost:3000/api/backends \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-mcp","url":"http://my-mcp:8080/mcp","transport":"http","enabled":true}'
```

### External host backends

Backends that run outside Docker (on a LAN IP, VM, or another machine) are registered by IP. No network setup needed — the gateway container reaches them over the host network.

```bash
curl -X POST http://localhost:3000/api/backends \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-service","url":"http://192.168.1.50:8080/mcp","transport":"http","enabled":true}'
```

### Authenticated backends (Bearer token / custom headers)

Pass a `headers` object to send arbitrary HTTP headers on every request to a backend. This is how you authenticate against services like Home Assistant:

```bash
curl -X POST http://localhost:3000/api/backends \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "my-service",
    "url": "http://192.168.1.50:8080/mcp",
    "transport": "sse",
    "enabled": true,
    "headers": {
      "Authorization": "Bearer <your-token-here>"
    }
  }'
```

The `headers` field is optional. Without it, requests are sent unauthenticated.

## Home Assistant Setup

Home Assistant's built-in MCP server is exposed at `/mcp_server/sse` and uses SSE transport. It requires a long-lived access token.

### Get a long-lived access token

1. Open Home Assistant → **Profile** (bottom-left avatar)
2. Scroll to **Long-Lived Access Tokens** → **Create Token**
3. Give it a name (e.g. `mcp-gateway`) and copy the token

### Register Home Assistant as a backend

```bash
curl -X POST http://localhost:3000/api/backends \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "homeassistant",
    "url": "http://<HA_IP>:8123/mcp_server/sse",
    "transport": "sse",
    "enabled": true,
    "headers": {
      "Authorization": "Bearer <your-long-lived-token>"
    }
  }'
```

Replace `<HA_IP>` with your Home Assistant host IP (e.g. `10.10.7.22`) and `<your-long-lived-token>` with the token from the previous step.

### Resulting tools in Claude Code

Once connected, Home Assistant tools appear namespaced as `homeassistant__<tool>`, for example:

- `homeassistant__HassTurnOn`
- `homeassistant__HassTurnOff`
- `homeassistant__HassSetVolume`

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

Home Assistant uses SSE. Most modern MCP servers use Streamable HTTP.

## config/backends.json

This file is **gitignored** because it typically contains auth tokens. It is created and maintained at runtime by the gateway — every dashboard or API action writes through to this file.

Template for a fresh deployment:

```json
{
  "backends": []
}
```

Start from the empty template and re-register your backends after cloning. The `config/` directory is bind-mounted so the file persists across `docker compose down / up` cycles.

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
  backends.json       — persisted backend definitions (gitignored)
```
