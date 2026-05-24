<p align="center">
  <img src="assets/icons/icon.png" width="80" alt="Cline" />
</p>

<h1 align="center">Cline</h1>

<p align="center">
The open source coding agent in your IDE and terminal.
</p>

<div align="center">

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://docs.cline.bot" target="_blank"><strong>Docs</strong></a>
</td>
<td align="center">
<a href="https://discord.gg/cline" target="_blank"><strong>Discord</strong></a>
</td>
<td align="center">
<a href="https://www.reddit.com/r/cline/" target="_blank"><strong>r/cline</strong></a>
</td>
<td align="center">
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>Feature Requests</strong></a>
</td>
<td align="center">
<a href="https://cline.bot/join-us" target="_blank"><strong>Join us!</strong></a>
</td>
</tbody>
</table>
</div>

</div>

<br>

<div align="center">
<table>
<tr>
<td align="center" width="50%">

### CLI

Run Cline in your terminal.
Interactive chat or fully headless
for CI/CD and scripting.

```
npm i -g cline
```

<a href="./sdk/apps/cli/README.md">Learn more</a>
<br><br>

</td>
<td align="center" width="50%">

### Kanban

Run many agents in parallel from a
web-based task board. Each card gets its own
worktree, auto-commit, and dependency chains.

```
npm i -g kanban
```

<a href="https://github.com/cline/kanban">Learn more</a>
<br><br>

</td>
</tr>
<tr>
<td align="center" width="50%">

### VS Code Extension

AI coding assistant in your editor.
Create files, run commands, browse the web,
and use tools with human-in-the-loop approval.

<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev">Install from VS Marketplace</a>
<br><br>

</td>
<td align="center" width="50%">

### JetBrains Plugin

The same Cline experience in IntelliJ IDEA,
PyCharm, WebStorm, GoLand, and the rest of
the JetBrains family.

<a href="https://plugins.jetbrains.com/plugin/28247-cline">Install from JetBrains Marketplace</a>
<br><br>

</td>
</tr>
</table>
</div>

<div align="center">
<table>
<tr>
<td align="center">

### SDK

Build your own AI agents and integrations powered by the same engine that runs the CLI, Kanban, VS Code extension, and JetBrains plugin. Custom tools, multi-agent teams, connectors, scheduled automations, and more.

```
npm install @cline/sdk
```

<a href="https://docs.cline.bot/cline-sdk/overview">Documentation</a>
<br><br>

</td>
</tr>
</table>
</div>

---

## Index

| Product | Description | Location | CHANGELOG |
|---------|------------|--------------|--------------|
| **SDK** | Node.js programmatic agent API and extension exports. | [`sdk/`](https://github.com/cline/cline/tree/main/sdk) | [CHANGELOG.md](https://github.com/cline/cline/blob/main/sdk/CHANGELOG.md) |
| **CLI** | Terminal UI, headless mode, shell commands, and CLI-specific flows. | [`sdk/apps/cli/`](https://github.com/cline/cline/tree/main/sdk/apps/cli) | [CHANGELOG.md](https://github.com/cline/cline/blob/main/sdk/apps/cli/CHANGELOG.md) |
| **VS Code Extension** | The Marketplace extension and extension host integration. | [`/`](https://github.com/cline/cline/tree/main) (WIP migrating) | [CHANGELOG.md](https://github.com/cline/cline/blob/main/CHANGELOG.md) |
| **JetBrains Plugin** | JetBrains-hosted client that talks to the shared agent core. | Currently we are not open-sourcing JetBrains plugins | - |
| **Kanban** | Web-based multi-agent task board. | [`cline/kanban`](https://github.com/cline/kanban) | [CHANGELOG.md](https://github.com/cline/kanban/blob/main/CHANGELOG.md) |
| **Docs site** | Public documentation pages. | [`docs/`](https://docs.cline.bot/) | - |

## Edits Code Across Your Project

Cline reads your project structure, understands the relationships between files, and makes coordinated changes across your codebase. It monitors linter and compiler errors as it works, fixing issues like missing imports, type mismatches, and syntax errors before you even see them. In VS Code and JetBrains, every edit shows up as a diff you can review, modify, or revert. All changes are tracked with checkpoints, so you can easily undo the agent's work.

## Runs Bash Commands

Cline executes commands directly in your terminal and watches the output in real time. Install packages, run build scripts, execute tests, deploy applications, manage databases. For long-running processes like dev servers, Cline continues working in the background and reacts to new output as it appears, catching compile errors, test failures, and server crashes as they happen.

## Plan and Act

Toggle between Plan mode and Act mode. In Plan mode, Cline explores your codebase, asks clarifying questions, and lays out a strategy. Once you're aligned, switch to Act mode and Cline executes the plan. Every file edit and terminal command requires your approval, so you stay in control of what actually changes. Or toggle auto-approve and let Cline run autonomously.

## Rules and Skills

Define project-specific rules in `.clinerules` files that guide how Cline works in your codebase: coding standards, architecture conventions, deployment procedures, testing requirements. Rules are picked up automatically by the CLI, VS Code extension, and JetBrains plugin. Use skills to let the model load specific rules when needed. 

## Works With Every Model

Cline is not locked to a single AI provider. Use whichever model fits your workflow:

| Provider | Models |
|----------|--------|
| Anthropic | Claude Opus, Sonnet, Haiku |
| OpenAI | GPT series model |
| Google | Gemini series model |
| OpenRouter | 200+ models from any provider |
| Vercel AI Gateway | Models through Vercel AI Gateway |
| AWS Bedrock | Claude, Llama, and more |
| Azure / GCP Vertex | All hosted models |
| Cerebras / Groq | Fast inference models |
| Ollama / LM Studio | Run local models on your machine |
| Any OpenAI-compatible API | Self-hosted or third-party endpoints |

## Extend With Plugins or MCP Servers

Extend Cline's capabilities with plugins. Using the SDK, register tools and lifecycle hooks programmatically through the plugin system for logging, auditing, policy enforcement, or adding domain-specific capabilities. Simple plugin example below.

```typescript
import { Agent, createTool } from "@cline/sdk"

const deployTool = createTool({
  name: "deploy",
  description: "Deploy the current branch to staging.",
  inputSchema: { type: "object", properties: { env: { type: "string" } }, required: ["env"] },
  execute: async (input) => {
    // your deployment logic
  },
})

const agent = new Agent({ tools: [deployTool], /* ... */ })
```
...or use [MCP servers](https://github.com/modelcontextprotocol) to connect to databases, query APIs, manage cloud infrastructure, and interact with external systems. Use [community-built servers](https://github.com/modelcontextprotocol/servers) or ask Cline to create custom tools on the fly. In the CLI, manage servers with `cline mcp`.

## Multi-Agent Teams

Coordinate multiple agents working together on complex tasks. A coordinator agent breaks the work into subtasks and delegates to specialist agents, each with their own tools and context. Team state persists across sessions so you can pick up where you left off.

```bash
cline --team-name auth-sprint "Plan and implement user authentication with tests"
```

## Scheduled Agents

Run agents on cron schedules for recurring automations. Daily PR summaries, weekly dependency checks, codebase health reports. Schedules persist across restarts and run independently of any terminal session.

```bash
cline schedule create "PR summary" \
  --cron "0 9 * * MON-FRI" \
  --prompt "List all open PRs and their review status" \
  --workspace /path/to/repo
```

## Connect to Slack, Telegram, Discord, and More

Chat with your agent from any messaging platform: Telegram, Slack, Discord, Google Chat, WhatsApp, and Linear. Each conversation thread maps to an agent session with full context. Set up access control to restrict who can interact with your agent.

```bash
cline connect telegram -k $BOT_TOKEN
cline connect slack --token $SLACK_TOKEN --signing-secret $SECRET --base-url $URL
```

## Headless CLI for CI/CD

Run Cline with zero interaction for scripting and automation. Pipe input, get JSON output, chain commands, integrate into CI/CD pipelines.

```bash
cline "Run tests and fix any failures"
git diff origin/main | cline  "Review these changes for issues"
cline --json "List all TODO comments" | jq -r 'select(.type == "agent_event" and .event.text) | .event.text'
```

---

## Fork: KeypoolLive — Shared Encrypted API Key Pool

> This repository is a fork of [cline/cline](https://github.com/cline/cline) that adds the **KeypoolLive** provider: a shared, encrypted vault of API keys distributed over HTTP. Multiple users or machines can draw from the same pool; keys rotate automatically on rate-limit or auth errors.

### How It Works

1. A JSON vault file (`ai.json`) declares providers, models, and API keys with owner labels.
2. The vault is encrypted with AES-256-CBC (OpenSSL `pbkdf2` format) and served from any HTTPS URL (Cloudflare R2, S3, GitHub raw, …).
3. Cline fetches and decrypts the vault at runtime using a shared secret stored in the VS Code extension settings. The vault is cached for 5 minutes.
4. Keys are assigned per session and rotate automatically on HTTP 401/403/429. A manual rotate button is available in the chat toolbar.

### Vault Format

```json
{
  "version": 1,
  "providers": {
    "gemini": {
      "protocol": "gemini",
      "endpoint": "https://generativelanguage.googleapis.com/v1beta",
      "keys": [
        { "key": "AIza...", "owner": "alice", "type": "paid" },
        { "key": "AIza...", "owner": "bob",   "type": "free" }
      ],
      "models": [
        { "id": "gemini-2.5-flash-preview-05-20", "name": "Gemini 2.5 Flash" }
      ]
    },
    "openai": {
      "protocol": "openai",
      "keys": [{ "key": "sk-...", "owner": "carol", "type": "paid" }],
      "models": [{ "id": "gpt-4o" }]
    }
  }
}
```

Supported protocols: `anthropic`, `openai`, `gemini`.  
Key tiers (informational): `free`, `paid`, `premium`, `unlimited`, `expired`.

### Encrypting the Vault

```bash
openssl enc -aes-256-cbc -a -pbkdf2 -iter 100000 -salt \
  -in ai.json -out ai.json.enc \
  -pass pass:"YOUR_SECRET"
```

Upload `ai.json.enc` to any public HTTPS endpoint.

### VS Code Extension Settings

In the Cline settings panel, select **KeypoolLive** as the API provider and fill in:

| Setting | Description |
|---------|-------------|
| **Vault URL** | HTTPS URL of the encrypted `.enc` file |
| **Vault secret** | Decryption password (stored locally, never sent to the vault) |
| **Model** | `providerName/modelId` — e.g. `gemini/gemini-2.5-flash-preview-05-20` |
| **Use Cloudflare AI Gateway** *(optional)* | Route requests through a Cloudflare AI Gateway for logging/caching |
| **Gateway ID** *(optional)* | Your Cloudflare account ID + gateway slug |

### Key Rotation

- **Automatic:** on HTTP 401, 403, or 429 the extension picks the next available key and retries once, then shows a VS Code toast with the new owner and key hint.
- **Manual:** click the **⟳** (sync) button in the chat toolbar. The icon changes to a spinner while in-flight, then to ✓ on success or ✗ on failure for 2 seconds.

### Building the Fork

```bash
npm install
npm run compile        # TypeScript + esbuild

# Package the VSIX (includes better-sqlite3 compiled for VS Code's Electron):
npm run package:vsix
# This is equivalent to:
#   npm run rebuild:native   ← recompiles better-sqlite3 for VS Code's bundled Electron
#   npx @vscode/vsce package --allow-package-secrets sendgrid --out cline.vsix

code --install-extension cline.vsix
```

The `rebuild:native` step automatically detects the Electron version from your
installed VS Code (macOS / Windows / Linux). You can also override it explicitly:

```bash
VSCODE_ELECTRON_VERSION=39.8.8 npm run package:vsix
```

> **Note on `better-sqlite3`:** Key usage statistics are persisted to a local
> SQLite database using the native `better-sqlite3` module. The VSIX packages the
> prebuilt binary compiled for VS Code's Electron ABI. If for any reason the binary
> is incompatible, a warning is logged and the extension continues to work without
> persistence (graceful degradation).

---

## Contributing

Start with the [Contributing Guide](CONTRIBUTING.md). Join our [Discord](https://discord.gg/cline) and head to the `#contributors` channel to connect with other contributors. Check our [careers page](https://cline.bot/join-us) for full-time roles.

## License

[Apache 2.0 © 2026 Cline Bot Inc.](./LICENSE)
