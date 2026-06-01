# MCP Agent Server

An MCP server that exposes an AI agent powered by any OpenAI-compatible endpoint —
works with OpenAI, the Groq Bridge Proxy (`https://s.zombiecoder.my.id`), LM Studio,
Ollama, or any other drop-in replacement.

---

## Setup

```bash
npm install
cp .env .env.local   # optional — .env already has sane defaults
npm run build
npm start
```

### Environment variables (`.env`)

| Variable            | Default                          | Purpose                                                   |
|---------------------|----------------------------------|-----------------------------------------------------------|
| `OPENAI_BASE_URL`   | `https://api.openai.com`         | Base URL of the OpenAI-compatible endpoint (`/v1` added automatically) |
| `OPENAI_API_KEY`    | `proxy-no-auth`                  | API key — use a real key for api.openai.com; any non-empty string works for proxies that ignore it |
| `AGENT_MODEL`       | `auto`                           | Model name exactly as the server reports it (`auto` for proxy auto-select) |
| `AGENT_MAX_STEPS`   | `10`                             | Maximum agent reasoning iterations                        |
| `AGENT_TEMPERATURE` | `0`                              | Sampling temperature (0–2)                                |
| `MCP_SERVER_PORT`   | `3000`                           | Port the MCP server listens on                            |
| `MCP_SERVER_HOST`   | `localhost`                      | Host the MCP server binds to                              |

#### Groq Bridge Proxy example

```env
OPENAI_BASE_URL=https://s.zombiecoder.my.id
OPENAI_API_KEY=proxy-no-auth
AGENT_MODEL=auto
```

#### OpenAI direct example

```env
OPENAI_BASE_URL=https://api.openai.com
OPENAI_API_KEY=sk-...
AGENT_MODEL=gpt-4o
```

---

## Tools

### `ping_agent`
Health check. Reads env vars and returns the active config. No network call.

### `verify_session`
Sends a minimal one-token request to the endpoint to confirm the URL, key, and model
are all accepted. Returns `Session OK` or a detailed error message.

Optional overrides: `model`, `base_url`, `api_key`.

### `run_agent`
Runs an OpenAI-compatible agent against a prompt. Streams per-step progress as MCP
log messages so editors show real-time feedback while the agent works.

| Parameter       | Type                        | Required | Description                                       |
|-----------------|-----------------------------|----------|---------------------------------------------------|
| `prompt`        | string                      | Yes      | Task for the agent                                |
| `servers`       | `Record<string, ServerDef>` | No       | MCP servers the agent can call                    |
| `model`         | string                      | No       | Overrides `AGENT_MODEL`                           |
| `base_url`      | string                      | No       | Overrides `OPENAI_BASE_URL`                       |
| `api_key`       | string                      | No       | Overrides `OPENAI_API_KEY`                        |
| `temperature`   | number (0–2)                | No       | Overrides `AGENT_TEMPERATURE`                     |
| `max_steps`     | integer                     | No       | Overrides `AGENT_MAX_STEPS`                       |
| `system_prompt` | string                      | No       | Custom system prompt prepended to agent           |

`ServerDef` shape: `{ "command": "npx", "args": ["@playwright/mcp@latest"] }`

---

## Inspector

After `npm start`, open `http://localhost:3000/inspector` to browse and call tools
interactively in your browser.

---

## Connecting editors

Point your editor's MCP config at `mcp.json`. All variables are injected at runtime
from your shell environment — nothing is hardcoded in the file.

**Cursor** → Settings → MCP → Add → select `mcp.json`

**VS Code (Copilot)** → copy the `mcpServers` block into `.vscode/mcp.json`

**Claude Desktop** → merge `mcpServers` into `claude_desktop_config.json`

### Workspace auto-connect

This repo now boots the local MCP server directly from the workspace so editors can
attach without extra manual wiring:

* VS Code reads [`.vscode/mcp.json`](/home/sahon/Desktop/m/.vscode/mcp.json)
* Zed reads [`.zed/settings.json`](/home/sahon/Desktop/m/.zed/settings.json)
* Windsurf uses `~/.codeium/windsurf/mcp_config.json` with the same local server command

On startup the server also writes [`.zombiecoder/runtime.json`](/home/sahon/Desktop/m/.zombiecoder/runtime.json)
with the active workspace root, bridge URL, model, and editor integration map. That
file is the lightweight runtime marker for background automation.

### Agent calls

`run_agent` requires a `prompt` string. If you invoke it directly from an MCP client
or editor, make sure the payload includes `prompt`, for example:

```json
{
  "prompt": "Summarize the current workspace layout and suggest next steps."
}
```
