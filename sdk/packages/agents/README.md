# [experimental] @sctg/cline-agents

`@sctg/cline-agents` is the runtime-agnostic agent loop package in the Cline SDK.
It gives you the core primitives for building tool-using LLM agents without
bringing in session storage, hub transport, or host-specific default tools.

## What You Get

- `Agent` / `AgentRuntime` — the same class under two names — for running and
  continuing tool-using agent conversations
- `createAgent` / `createAgentRuntime` — factory-function equivalents
- `AgentRuntimeHooks` for lifecycle interception (`beforeRun`, `afterRun`,
  `beforeModel`, `afterModel`, `beforeTool`, `afterTool`, `onEvent`)
- Event streaming via `agent.subscribe(listener)` and the `hooks.onEvent`
  callback
- Plugin setup callbacks for contributing tools and hooks at boot

## What This Package Does Not Include

`@sctg/cline-agents` does not ship a full application runtime by itself.

- Default host tools like filesystem access, shell execution, or web fetching live in `@sctg/cline-core`
- Session persistence and stateful orchestration live in `@sctg/cline-core`
- Shared hub runtime/session transport lives in `@sctg/cline-core` (see `@sctg/cline-core/hub`)
- Sub-agent and team coordination primitives live in `@sctg/cline-core`

That split keeps this package usable in Node, browser, and custom host
environments where you want to supply your own tools and runtime policy.

## Installation

```bash
npm install @sctg/cline-agents @sctg/cline-shared @sctg/cline-llms
```

## Quick Start

```ts
import { Agent } from "@sctg/cline-agents";
import type { AgentTool } from "@sctg/cline-shared";

const getWeather: AgentTool<{ city: string }, { forecast: string }> = {
	name: "get_weather",
	description: "Return the current weather for a city.",
	inputSchema: {
		type: "object",
		properties: { city: { type: "string" } },
		required: ["city"],
	},
	async execute({ city }) {
		return { forecast: `sunny in ${city}` };
	},
};

const agent = new Agent({
	providerId: "anthropic",
	modelId: "claude-sonnet-4-6",
	apiKey: process.env.ANTHROPIC_API_KEY,
	systemPrompt: "You are a concise assistant.",
	tools: [getWeather],
});

const result = await agent.run("What's the weather in San Francisco?");
console.log(result.outputText);
```

## Two Ways to Configure

`Agent` / `AgentRuntime` accepts two config shapes:

**Provider form** — friendly entrypoint. The runtime builds an `AgentModel` for
you via `@sctg/cline-llms`:

```ts
new Agent({
	providerId: "openai",
	modelId: "gpt-5",
	apiKey: process.env.OPENAI_API_KEY,
	// baseUrl, headers also supported
	tools: [/* ... */],
});
```

**Model form** — advanced. Supply a pre-built `AgentModel` directly. Useful
when the host already owns gateway construction (this is what `@sctg/cline-core`
uses internally):

```ts
import { createGateway } from "@sctg/cline-llms";

const gateway = createGateway({ providerConfigs: [/* ... */] });
const model = gateway.createAgentModel({ providerId, modelId });

new Agent({
	model,
	tools: [/* ... */],
});
```

## KeypoolLive — Automatic Key Rotation

`keypoollive` is a built-in provider that loads API keys from an AES-256-CBC
encrypted vault and rotates them automatically on 401 / 403 / 429 errors, with
no extra code in your agent.

### Vault format

Create a `ai.json` file with your keys grouped by provider, then encrypt it
with `openssl`:

```bash
openssl enc -aes-256-cbc -a -pbkdf2 -iter 100000 -salt \
  -in ai.json -out vault/ai.json.enc \
  -pass pass:"$KEYPOOL_LIVE_SECRET"
```

```json
{
  "version": 1,
  "providers": {
    "mistral": {
      "protocol": "openai",
      "endpoint": "https://api.mistral.ai/v1",
      "keys": [
        { "key": "sk-key1", "owner": "account-1", "type": "paid" },
        { "key": "sk-key2", "owner": "account-2", "type": "paid" }
      ],
      "models": [{ "id": "devstral-latest", "contextLength": 131072 }]
    }
  }
}
```

Supported protocols: `"openai"` (OpenAI-compatible), `"anthropic"`, `"gemini"`.

### Using the provider

Set two environment variables, then pass `providerId: "keypoollive"` to `Agent`.
The `modelId` is in `"vaultProviderName/modelId"` format, and `apiKey: "auto"`
tells the provider to load the vault automatically:

```bash
export KEYPOOL_VAULT_URL=https://my-server.example.com/vault/ai.json.enc
# or a local file:
export KEYPOOL_VAULT_URL=file:///absolute/path/to/vault/ai.json.enc
export KEYPOOL_LIVE_SECRET=my-vault-password
```

```ts
import { Agent } from "@sctg/cline-agents";

const agent = new Agent({
  providerId: "keypoollive",
  modelId: "mistral/devstral-latest",  // "<vaultProvider>/<modelId>"
  apiKey: "auto",                       // loads vault from env vars
  systemPrompt: "You are a concise assistant.",
  tools: [/* ... */],
});

const result = await agent.run("Summarise the last 10 upstream commits.");
console.log(result.outputText);
```

The vault is cached for 5 minutes. On each 401 / 403 / 429 the failing key is
cooled down and the next available key is tried (up to 5 attempts). After 3
failures a key enters a 15-minute cooldown before being eligible again.

### Manual key rotation

If you detect a key error outside the normal stream flow (e.g. in a health
check), force rotation with `rotateKeypoolliveKey`:

```ts
import { rotateKeypoolliveKey } from "@sctg/cline-llms/providers/vendors/keypoollive";

// Mark the key as failed and clear the vault cache
rotateKeypoolliveKey("mistral", failingApiKey);

// Mark the key as failed without clearing the vault cache
rotateKeypoolliveKey("mistral", failingApiKey, false);
```

## Core Concepts

### Tools

Tools conform to the `AgentTool<TInput, TOutput>` interface from
`@sctg/cline-shared`. Each tool has a JSON Schema `inputSchema` and an
`execute(input, context)` function that returns the tool output directly:

```ts
import type { AgentTool } from "@sctg/cline-shared";

const summarize: AgentTool<{ text: string }, { summary: string }> = {
	name: "summarize_text",
	description: "Summarize text into a short preview.",
	inputSchema: {
		type: "object",
		properties: { text: { type: "string" } },
		required: ["text"],
	},
	async execute({ text }, context) {
		// context.signal — aborts when the run is cancelled
		// context.emitUpdate(...) — stream progress as `tool-updated` events
		return { summary: text.slice(0, 120) };
	},
};
```

The runtime wraps successful tool outputs in an internal tool-result message.
Throw from `execute(...)` to report a tool failure, or use an `afterTool` hook
to transform the internal `AgentToolResult` envelope.

### Events

Subscribe to the `AgentRuntimeEvent` stream in one of two ways:

```ts
// 1. Attach a listener after construction. Returns an unsubscribe function.
const unsubscribe = agent.subscribe((event) => {
	if (event.type === "assistant-text-delta") {
		process.stdout.write(event.text);
	}
});

// 2. Register an `onEvent` hook at construction time.
new Agent({
	providerId,
	modelId,
	apiKey,
	hooks: {
		onEvent(event) {
			// fires for every runtime event
		},
	},
});
```

`AgentRuntimeEvent` covers run/turn boundaries, assistant text and reasoning
deltas, tool lifecycle, usage updates, and run completion/failure. See
`AgentRuntimeEvent` in `@sctg/cline-shared` for the full union.

### Conversation Control

- `agent.run(input)` — start a run. `input` may be a string, an `AgentMessage`,
  or an array of messages. Also accepts `undefined` to continue without adding
  a new user turn.
- `agent.continue(input?)` — convenience alias for `run(input?)`.
- `agent.abort(reason?)` — cancel the active run. `.run()` resolves with
  `status: "aborted"`.
- `agent.snapshot()` — immutable view of the current
  `AgentRuntimeStateSnapshot` (messages, usage, iteration, status, etc.).
- `agent.restore(messages)` — replace the conversation with a persisted
  message array. Resets run/turn state but preserves subscribers, tools,
  hooks, plugins, and the model.
- `initialMessages` in the constructor seeds the conversation on boot.

### Hooks

Pass a `hooks` bag (`AgentRuntimeHooks`) to observe or influence the loop.
All hooks may be async; any that return `{ stop: true, reason }` will halt the
run with an `aborted` status.

```ts
new Agent({
	providerId,
	modelId,
	apiKey,
	tools: [/* ... */],
	hooks: {
		beforeModel({ request }) {
			// mutate messages/tools/options before the model call
			return { options: { temperature: 0.2 } };
		},
		beforeTool({ tool, input }) {
			// block a tool call based on policy
			if (tool.name === "get_weather" && !(input as { city?: string }).city) {
				return { skip: true, reason: "city required" };
			}
			return undefined;
		},
		afterRun({ result }) {
			console.log("done", result.usage);
		},
	},
});
```

For richer, host-side hook orchestration (15-stage `HookEngine`,
subprocess-backed hooks, MCP extensions), use `@sctg/cline-core`.

### Preparing Requests with `prepareTurn`

`prepareTurn` runs before messages are sent to the provider. It can rewrite the
messages or system prompt for the next request:

```text
saved transcript
        |
        | turn preparation
        v
prepareTurn
        |
        v
prepared provider request
```

Returned messages affect only the provider request for the current model call.
They do not replace saved history and are not returned from
`AgentRunResult.messages`.

```text
prepareTurn returns prepared messages
        |
        +--> provider request: yes
        +--> saved transcript: no
        +--> AgentRunResult.messages: no
```

This is intentionally different from changing saved history. Hosts that need
durable redaction, normalization, or policy filtering must apply that change
before a message enters the transcript.

### Plugins

Plugins can contribute tools and hooks at setup time:

```ts
import type { AgentRuntimePlugin } from "@sctg/cline-shared";

const loggingPlugin: AgentRuntimePlugin = {
	name: "logging",
	setup({ agentId }) {
		return {
			hooks: {
				afterTool({ tool, result }) {
					console.log(agentId, tool.name, result.isError);
					return undefined; // hook may return an AgentAfterToolResult
				},
			},
		};
	},
};

new Agent({
	providerId,
	modelId,
	apiKey,
	plugins: [loggingPlugin],
});
```

### Teams and Spawn

For multi-agent workflows, use `@sctg/cline-core`:

```ts
import {
	createSpawnAgentTool,
	AgentTeamsRuntime,
	createAgentTeamsTools,
	bootstrapAgentTeams,
} from "@sctg/cline-core";
```

These helpers provide coordination primitives for delegated runs,
mailboxes, task management, and outcome convergence.

## Entry Point

- `@sctg/cline-agents` — the single package entrypoint. The `package.json`
  `exports` map automatically serves a browser-safe bundle when bundlers
  resolve the `browser` condition.

## Related Packages

- `@sctg/cline-shared`: shared types (`AgentTool`, `AgentMessage`,
  `AgentRuntimeEvent`, `AgentRuntimeHooks`, etc.)
- `@sctg/cline-llms`: provider settings, model catalogs, and gateway/handler
  creation — including the built-in `keypoollive` provider with automatic
  key rotation (`rotateKeypoolliveKey`)
- `@sctg/cline-core`: stateful runtime assembly, storage, default tools,
  subprocess hooks, hub transport, and MCP integration

## More Examples

- Repo examples:
  [examples/plugins](https://github.com/cline/sdk/tree/main/examples/plugins),
  [examples/hooks](https://github.com/cline/sdk/tree/main/examples/hooks),
  [examples/cron](https://github.com/cline/sdk/tree/main/examples/cron)
- Workspace overview: [README.md](https://github.com/cline/sdk/blob/main/README.md)
- API and architecture references:
  [DOC.md](https://github.com/cline/sdk/blob/main/DOC.md),
  [ARCHITECTURE.md](https://github.com/cline/sdk/blob/main/ARCHITECTURE.md)
