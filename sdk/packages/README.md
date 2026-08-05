# Packages Overview

This directory is the single documentation source for package-level responsibilities.

- High-level package roles: this file (`packages/README.md`)
- Package interaction and runtime flows: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

## Package Responsibilities

| Package | Primary responsibility | Typical consumers | Internal deps |
| --- | --- | --- | --- |
| `@sctg/cline-shared` | Cross-package shared primitives (path resolution, session common types, indexing helpers) | `@sctg/cline-agents`, `@sctg/cline-core`, apps | None |
| `@sctg/cline-llms` | Model catalog + provider settings schema + handler creation SDK | `@sctg/cline-agents`, `@sctg/cline-core`, apps | None |
| `@sctg/cline-agents` | Stateless agent runtime loop (tools, hooks, extensions, teams, streaming) | `@sctg/cline-core`, apps | `@sctg/cline-llms`, `@sctg/cline-shared` |
| `@sctg/cline-core` | Stateful runtime orchestration (runtime composition, session lifecycle/storage, local and hub runtime services, hub discovery and client helpers) | CLI/Desktop apps | `@sctg/cline-agents`, `@sctg/cline-llms`, `@sctg/cline-shared` |
| `@sctg/cline-ui` | Internal framework-neutral web theme, Tailwind adapter, and optional base styles | Cline web apps | None |

## How Packages Work Together

1. `@sctg/cline-llms` defines model/provider capabilities and builds concrete handlers.
2. `@sctg/cline-agents` runs the agent loop on top of those handlers and tool execution primitives.
3. `@sctg/cline-core` composes runtime behavior with persistent sessions/storage and local or hub-backed runtime services.
4. `@sctg/cline-core` hub services orchestrate scheduled runtime execution, execution history, and schedule command handling.
5. `@sctg/cline-core/hub` exposes discovery, the detached hub daemon, and session-oriented client APIs (`HubSessionClient`, `HubUIClient`) when hosts need a shared daemon.
6. `@sctg/cline-shared` provides the shared contracts and path/session primitives used across the stack.

## Practical Boundary Rules

- Put provider/model schema, cataloging, and handler wiring in `@sctg/cline-llms`.
- Put loop/tool/hook/team execution behavior in `@sctg/cline-agents`.
- Put persistence, session lifecycle, and runtime assembly in `@sctg/cline-core`.
- Put scheduled execution and schedule persistence in `@sctg/cline-core` hub services.
- Put hub discovery, attach flows, and session-oriented client adapters in `@sctg/cline-core/hub`.
- Put cross-package utility types and path/session constants in `@sctg/cline-shared`.
- Put remote-config schemas, materialization, telemetry normalization, and blob upload primitives in `@sctg/cline-shared/remote-config`.
- Put shared web tokens and visual foundations in `@sctg/cline-ui`; keep fonts,
  shell layout, and product-specific animation with each consuming app.

## Runtime Entry Points

- Node-oriented imports exist where packages expose a distinct Node alias.
- `@sctg/cline-core` itself is now the Node/runtime-oriented entry point for host/session services.
- Browser entry points still exist in packages that intentionally publish a browser surface, but `@sctg/cline-core` no longer does.

## Notes for Doc Consolidation

Nested package `README.md` and `ARCHITECTURE.md` files can be reduced or removed after references are updated to point here.
