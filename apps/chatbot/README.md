# @sctg/chatbot

**AI-powered chat assistant with agentic tools, web search, data analysis, and extensible tool system**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6.0-646cff)](https://vitejs.dev/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

---

## 🚀 What is @sctg/chatbot?

**@sctg/chatbot** is a next‑generation AI chat application that goes far beyond simple conversation. It combines a **secure vault** for API key management, a **virtual file system**, and a **growing ecosystem of tools** (web search, JavaScript/Python sandbox, chart generation, PDF creation, weather, financial data, and more) — all running in your browser with **zero data sent to our servers**.

Think of it as **Perplexity on steroids**, with full control over your own API keys and the ability to run code, analyse data, and generate documents directly in the chat.

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| **🔐 Bring Your Own Key (BYOK)** | Add your own OpenAI, Anthropic, Mistral, Groq, or other provider keys — no subscription, no telemetry. |
| **🌐 Web Search & Scraping** | Built‑in Firecrawl integration for real‑time search and page extraction. |
| **📁 Virtual File System** | Upload, view, edit, and download files directly in the chat — the agent can read/write to it. |
| **🧠 Agentic Tool Use** | The LLM can call tools like calculator, shell emulator, JavaScript/Python sandbox, SQL queries, chart creation, and more. |
| **📊 Data Analysis** | Run SQL on CSV/JSON, generate charts (bar, line, pie, scatter), and visualise data inline. |
| **📄 Document Generation** | Create PDFs and DOCX files from Markdown — with tables, code blocks, and Mermaid diagrams. |
| **☁️ Weather & Finance** | Get real‑time weather forecasts and currency/stock data via free APIs. |
| **🗂️ Session Persistence** | Conversations and VFS state are saved to IndexedDB — resume where you left off. |
| **📌 Sources & Citations** | Automatically extract and display sources with interactive tooltips and a dedicated sidebar. |
| **🧪 Python & JavaScript Sandboxes** | Execute code safely in the browser (Pyodide and QuickJS) with VFS access. |
| **📱 Responsive** | Works beautifully on desktop and mobile. |

---

## 🖥️ Demo

<img width="1618" height="1365" alt="image" src="https://github.com/user-attachments/assets/ad431497-e814-4c08-bd47-ba9e6261cf67" />

*The main chat view with file sidebar, context bar, and tool calls.*

<img width="1738" height="331" alt="image" src="https://github.com/user-attachments/assets/6bd2cde0-8c26-4aa3-b517-f5afb925b33f" />

*The research plan banner.*

<img width="1623" height="1363" alt="image" src="https://github.com/user-attachments/assets/7ea48319-b465-4085-be25-4110b176b706" />

*Sources panel with clickable citations and previews.*

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Browser (Client)                          │
├─────────────────────────────────────────────────────────────────────┤
│  React UI ──► Web Worker (agent.worker.ts) ──► @cline/agents SDK   │
│       │                     │                                       │
│       ├─ VFS (in‑memory)    └─ Tool execution                       │
│       ├─ Session storage                                              │
│       └─ Vault (BYOK or remote)                                      │
└─────────────────────────────────────────────────────────────────────┘
```

- **UI** built with React 19 + HeroUI + Tailwind.
- **Agent** runs in a separate Web Worker to keep UI responsive.
- **Vault** can be a remote encrypted endpoint or local BYOK configuration.
- **Tools** are dynamically loaded and can be toggled by the user.

---

## 📦 Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm

### 1. Clone the repository

```bash
git clone https://github.com/TEA-ching/cline.git
cd cline-chatbot
```

### 2. Install dependencies

```bash
bun install
bun run build:sdk
```

### 3. Configure environment

Create a `.env` file in the root:

```env
# Required for vault mode (remote encrypted config)
KEYPOOL_VAULT_URL=https://your-vault.example.com

# Optional: usage tracking (for key rotation)
KEYPOOL_USAGE_DB=https://your-usage-worker.example.com/v1/keypool/usage
```

### 4. Start the development server

```bash
cd apps/chatbot
bun run dev
```

Open `http://localhost:3001` in your browser.

### 5. Build for production

```bash
bun run build
```

---

## 🔑 Configuration Modes

### Vault Mode (default)
- A secure, encrypted `ai.json.enc` file is hosted on a remote server see https://github.com/sctg-development/ai-proxy-cloudflare.
- The client decrypts it using a password (the "vault token").
- All provider keys, models, and crawler configs are managed centrally.

### BYOK Mode (Bring Your Own Key)
- Click the **BYOK** switch on the login screen.
- Add your own API keys for AI providers, crawlers, and weather services.
- All keys are stored locally in your browser's `localStorage` — **never sent to any third party**.

---

## 🛠️ Tool Ecosystem

The chatbot comes with a rich set of tools that the agent can invoke automatically. You can enable/disable them via the **Tools** panel (`/tools`).

| Tool | Description |
|------|-------------|
| **Calculator** | Evaluate math expressions (sin, log, sqrt, etc.) |
| **Date & Time** | Current date/time in any timezone |
| **Encoding Tools** | Base64, URL, hex encode/decode; JSON format/minify |
| **UUID Generator** | Generate UUIDs, random hex or alphanumeric strings |
| **Color Converter** | Convert between hex, RGB, and HSL |
| **JS/TS Sandbox** | Execute JavaScript/TypeScript in QuickJS with VFS and optional network |
| **Wikipedia** | Search and extract articles in multiple languages |
| **TypeScript Validator** | Validate and compile TypeScript code |
| **Image Generation** | Generate images via Mistral (requires Mistral key) |
| **DOCX Creator** | Convert Markdown to Word documents |
| **PDF Tools** | Generate PDF from Markdown (with Mermaid diagrams) or extract text from PDFs |
| **Chart Creator** | Generate bar/line/pie/scatter charts from data (SVG) |
| **Weather Forecast** | Search locations and get Meteoblue weather data |
| **Python Sandbox** | Execute Python with numpy/pandas via Pyodide |
| **Shell Emulator** | Run a safe subset of shell commands (`grep`, `sed`, `sort`, `cat`, etc.) |

---

## ⌨️ Slash Commands

Type `/` in the input bar to see available commands:

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/clear` | Clear current conversation |
| `/new` | Start a fresh conversation |
| `/undo` | Remove the last user‑assistant exchange |
| `/compact` | Ask the AI to summarise the conversation |
| `/sessions` | Browse and restore saved conversations |
| `/tools` | Manage optional tools |
| `/prompt` | View or update the system prompt |

---

## 🧩 Extending the Toolset

To add a new tool, create a file in `src/tools/worker-tools/` that exports a function returning an `AgentTool` (using `@cline/agents`). Then register it in `worker-tools/index.ts` and add its metadata in `builtin.ts`.

Example:

```ts
// src/tools/worker-tools/my-tool.ts
import { createTool } from '@cline/agents'
import { z } from 'zod'

export function createMyTool() {
  return createTool({
    name: 'my_tool',
    description: 'Does something useful.',
    inputSchema: z.object({ param: z.string() }),
    execute: async ({ param }) => {
      return { result: `Hello ${param}` }
    },
  })
}
```

Then add it to `BUILTIN_OPTONAL_TOOLS` in `src/tools/builtin.ts` to make it visible in the UI.

---

## 📁 Project Structure

```
cline-chatbot/
├── src/
│   ├── components/         # React components (chat, settings, files, tools)
│   ├── hooks/              # Custom React hooks (useAgent, useVault, etc.)
│   ├── lib/                # Utilities (crypto, keypool, model-utils)
│   ├── session/            # IndexedDB session persistence
│   ├── tools/              # Tool definitions and implementations
│   │   ├── builtin.ts      # Tool metadata for UI
│   │   ├── firecrawl-client.ts
│   │   ├── shell-emulator.ts
│   │   ├── worker-tools/   # Individual tool implementations
│   │   └── index.ts
│   ├── types/              # TypeScript type definitions
│   ├── vfs/                # Virtual file system
│   ├── workers/            # Web Worker for agent execution
│   ├── App.tsx
│   └── main.tsx
├── vite.config.ts
├── package.json
└── README.md
```

---

## 🤝 Contributing

Contributions are welcome! Please open an issue or pull request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-tool`)
3. Commit your changes (`git commit -m 'Add amazing tool'`)
4. Push to the branch (`git push origin feature/amazing-tool`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the **MIT License** – see the [LICENSE](LICENSE) file for details.

---

**Made with ❤️ by [SCTG Development](https://sctg.dev)**
