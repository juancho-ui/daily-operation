# Apollo MCP

Connect Apollo's 240M+ contact database, real-time enrichment engine, and sales engagement directly to your AI tool. Then run end-to-end GTM, all from a single conversation.

## Get started

There are multiple ways to connect to Apollo MCP.

| Method | Description |
|--------|-------------|
| AI Connectors | Connect through built-in integrations on ChatGPT, Claude, Perplexity, Replit, or Cursor. No coding required. |
| Coding Plug-ins | Install Apollo's first-party plug-in in Codex or Coworker. |
| Standalone MCP Server | Connect to any MCP-compatible client via Streamable HTTP and OAuth. |

Before you connect Apollo MCP, confirm that you have:

* An active Apollo account.
* Access to the Apollo features and records you want your AI client to use.
* Available credits for enrichment and other credit-consuming actions.
* Model training turned off in your AI account or client settings.

> **Private Practice**: Apollo prohibits AI model training with Apollo MCP integrations. Before you connect Apollo MCP to any AI client, confirm that model training is turned off.

## Set up your AI client

Use the following endpoint to connect to the standalone Apollo MCP server:

```text
https://mcp.apollo.io/mcp
```

| Setting | Value |
|---------|-------|
| Endpoint | `https://mcp.apollo.io/mcp` |
| Transport | Streamable HTTP |
| Authentication | OAuth 2.0 |
| Local install required | No |
| API key required | No. To connect a client that can't open a browser, use an API key instead of OAuth. |

### Claude Code

```bash
claude mcp add --transport http apollo https://mcp.apollo.io/mcp
```

Then run `/mcp` and complete the OAuth flow.

For multiple workspaces:

```bash
claude mcp add apollo-work --transport http https://mcp.apollo.io/mcp
claude mcp add apollo-personal --transport http https://mcp.apollo.io/mcp
```

### OpenAI Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.apollo]
url = "https://mcp.apollo.io/mcp"
```

Then authenticate:

```bash
codex mcp login apollo
```

### VS Code with GitHub Copilot

Create `.vscode/mcp.json`:

```json
{
  "servers": {
    "apollo": {
      "type": "http",
      "url": "https://mcp.apollo.io/mcp"
    }
  }
}
```

### OpenCode

Add to `~/.config/opencode/opencode.jsonc` under `"mcp"`:

```json
"apollo": {
  "type": "remote",
  "url": "https://mcp.apollo.io/mcp",
  "enabled": true,
  "oauth": {}
}
```

Then run:

```bash
opencode mcp auth apollo
```

### Claude Desktop

Open Claude Desktop settings → Connectors → Add connector with URL:

```text
https://mcp.apollo.io/mcp
```

### Other MCP clients

Add the Apollo MCP endpoint as a remote server:

```text
https://mcp.apollo.io/mcp
```

Use Streamable HTTP as the transport and OAuth 2.0 for authentication.

## Connect a headless or server-side client

For servers, containers, cron jobs, or CI pipelines that can't open a browser, authenticate with an Apollo API key instead.

| Setting | Value |
|---------|-------|
| Endpoint | `https://mcp.apollo.io/mcp` |
| Transport | Streamable HTTP |
| Authentication | `X-Api-Key` request header |
| Key type | Master key |
| Browser sign-in required | No |

```json
{
  "mcpServers": {
    "apollo": {
      "type": "http",
      "url": "https://mcp.apollo.io/mcp",
      "headers": {
        "X-Api-Key": "YOUR_API_KEY"
      }
    }
  }
}
```

### Test the connection

```bash
curl -sS https://mcp.apollo.io/mcp \
  -H "X-Api-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Use a master key

Apollo MCP needs a master key. When you create the key, turn on **Set as master key**.

A scoped key won't work. Apollo MCP isn't one of the endpoints you can select when you scope a key, so every scoped key is missing it and gets rejected with a `403` and the error code `API_INACCESSIBLE`.

Because a master key isn't tied to a list of endpoints, treat it like a password. Anyone holding it can take any API action your Apollo workspace allows.

### What the key can do

An API key isn't tied to the teammate who created it. Requests act as your workspace's longest-standing active admin, so creating the key from a limited-permission user doesn't narrow what a headless client can reach, and every call spends workspace credits.

### Keep tool access current

Apollo adds new MCP tools over time. How your client picks them up depends on how it authenticates:

- **OAuth**: Client can send you back through the sign-in flow and surface updated permissions.
- **API key**: No sign-in step, so there's no moment where Apollo can prompt you. Most clients fetch the tool list once when they connect and cache it for the life of the connection.

You don't need to rotate or re-scope the key. A master key isn't limited to a set of endpoints, so it reaches new tools as soon as Apollo ships them.
