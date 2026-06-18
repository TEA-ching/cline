# Plan d'action — apps/chatbot

Application web portant `apps/cli` en version browser : chat multi-tours avec agent IA, outils VFS, support images.

---

## Stack technique

| Technologie | Version | Source de référence |
|---|---|---|
| Vite | ^8.0 | apps/web |
| React | 19.x | monorepo |
| HeroUI | v3.1+ | apps/web |
| Tailwind CSS | v4.x | apps/web |
| TypeScript | ^6.0 | apps/web |
| ESLint | ^10.0 | apps/web |
| Bun | workspace | racine monorepo |

**Dépendances SDK (workspace)** :
- `@cline/agents` — boucle agentique browser-safe
- `@cline/llms` — bundle browser `/dist/index.browser.js`
- `@cline/shared` — types partagés, bundle browser

**LLM proxy** : Cloudflare Worker `ai-proxy-cloudflare` (endpoint `${VAULT_URL}/${providerId}/v1`)  
Le token vault = clé API pour le proxy OpenAI-compatible.

---

## Architecture

```
apps/chatbot/
├── chatbot.md
├── .env.example                       VITE_VAULT_URL=https://ai-proxy.example.com
├── package.json
├── tsconfig.json
├── vite.config.ts                     + worker ES modules + COOP/COEP headers
├── eslint.config.ts
├── index.html
└── src/
    ├── main.tsx                       HeroUI + AiProvider + React root
    ├── App.tsx                        Guard : LoginScreen | ChatView
    ├── styles/
    │   └── global.css                 @import "tailwindcss"
    ├── types/
    │   └── ai-config.ts               AiConfig, AiModel, AiProvider, Crawler, AiKey
    ├── lib/
    │   ├── vault-api.ts               GET /ai.json (Bearer token → config)
    │   └── model-utils.ts             modelSupportsImages(), listChatModels()
    ├── hooks/
    │   ├── useVault.ts                Context : login/logout/config/crawlerKeys
    │   ├── useAgent.ts                Worker lifecycle, stream events, tool bridge
    │   ├── useVirtualFS.ts            Upload, read, write, download URLs
    │   └── useSession.ts              IndexedDB : save/load/export session
    ├── components/
    │   ├── auth/
    │   │   └── LoginScreen.tsx        Token input → sessionStorage
    │   ├── chat/
    │   │   ├── ChatView.tsx           Layout principal
    │   │   ├── MessageList.tsx        Scroll + historique
    │   │   ├── MessageItem.tsx        User / assistant message
    │   │   ├── AssistantMessage.tsx   Markdown streaming + code highlighting
    │   │   ├── ToolCallCard.tsx       Outil + input + statut
    │   │   ├── ToolResultCard.tsx     Résultat + lien download si editor
    │   │   └── InputBar.tsx           Texte + images (si multimodal) + slash cmd
    │   ├── files/
    │   │   ├── FileManager.tsx        Sidebar : uploadés + générés
    │   │   ├── DropZone.tsx           Drag & drop overlay
    │   │   └── DownloadItem.tsx       Lien Blob URL
    │   ├── settings/
    │   │   ├── SettingsPanel.tsx      Drawer : provider + modèle
    │   │   └── ModelSelector.tsx      Filtre par usage='chat', badge multimodal
    │   └── approval/
    │       └── ToolApprovalDialog.tsx HeroUI Modal bloquant
    ├── vfs/
    │   └── virtual-fs.ts             Map<path, entry> + IndexedDB persistence
    ├── workers/
    │   └── agent.worker.ts           Agent @cline/agents + tool proxies → main thread
    ├── tools/
    │   ├── index.ts                  Catalogue : createBrowserTools(bridge)
    │   ├── firecrawl-client.ts       fetchWithFirecrawl() + searchWithFirecrawl()
    │   ├── vfs/
    │   │   ├── vfs-read.tool.ts      read_files → VFS
    │   │   ├── vfs-editor.tool.ts    editor → VFS + Blob URL
    │   │   ├── vfs-find.tool.ts      find
    │   │   ├── vfs-grep.tool.ts      grep / rg
    │   │   ├── vfs-sed.tool.ts       sed -i (s/pattern/replacement/flags)
    │   │   ├── vfs-head-tail.tool.ts head / tail
    │   │   ├── vfs-wc.tool.ts        wc -l/-w/-c
    │   │   ├── vfs-diff.tool.ts      diff unifié
    │   │   ├── vfs-sort-uniq.tool.ts sort | uniq
    │   │   ├── vfs-cat.tool.ts       cat
    │   │   ├── vfs-ls.tool.ts        ls -la
    │   │   └── vfs-mv-cp.tool.ts     mv / cp
    │   ├── web/
    │   │   ├── fetch-web.tool.ts     Firecrawl /scrape
    │   │   └── search-web.tool.ts    Firecrawl /search
    │   ├── ask-question.tool.ts      Modal HeroUI → bridge worker
    │   ├── docx.tool.ts              markdown → .docx + Blob URL
    │   └── run-commands.tool.ts      Stub désactivé avec message explicatif
    └── session/
        ├── session-store.ts          IndexedDB : save/load/list/delete
        └── session-export.ts         JSON download / upload
```

---

## Authentification et vault

Le token saisi au login est :
1. Le Bearer token HTTP pour `GET ${VAULT_URL}/ai.json`
2. La clé de déchiffrement AES-256-CBC du vault (géré par le Worker)
3. Stocké en `sessionStorage["ai_vault_token"]` → effacé à la fermeture du tab

Config chargée : `{ providers: {...}, crawlers: {...} }` (type `AiConfig`)

Les clés Firecrawl proviennent de `config.crawlers[id].keys[*].key` — round-robin simple.  
Les clés LLM ne sont **jamais** exposées en browser : le Worker proxy les injecte côté serveur.

---

## Support images

Détection de capacité multimodale :
```typescript
export function modelSupportsImages(model: AiModel): boolean {
  return model.supportsImages === true
    || model.inputModalities?.includes('image') === true
}
```

Quand le modèle sélectionné supporte les images :
- `InputBar` affiche un bouton 📎 (image attach)
- Drag & drop d'images sur la zone de saisie
- Images converties en `data:image/...;base64,...` inline
- Format message OpenAI multipart :
  ```json
  {
    "role": "user",
    "content": [
      { "type": "text", "text": "..." },
      { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
    ]
  }
  ```
- Le Worker proxy transmet le format multipart à l'API réelle sans modification
- Dans l'UI : thumbnails inline dans la bulle utilisateur

---

## Worker et agent multi-tours

```
Main Thread                              Worker (agent.worker.ts)
────────────────                         ────────────────────────
useAgent hook
  ├─ postMessage({type:'init', config}) → instancie Agent(@cline/agents)
  ├─ postMessage({type:'run', msg})     → agent.run(msg, {history})
  │                                         │ stream events
  │  ←── {type:'event', event}  ──────────── streaming tokens
  │  ←── {type:'tool_call', name, input, port} ←── outil appelé
  │       executeToolOnMainThread(name, input)
  │       port.postMessage({result}) ──────────→ agent continue
  └─ ←── {type:'turn_complete'}  ←────────── fin de tour
```

Chaque outil du Worker est un proxy async :
```typescript
async function toolProxy(name: string, input: unknown): Promise<unknown> {
  const { port1, port2 } = new MessageChannel()
  self.postMessage({ type: 'tool_call', name, input, port: port2 }, [port2])
  return new Promise(resolve => { port1.onmessage = e => resolve(e.data.result) })
}
```

L'instance `Agent` conserve l'historique entre les tours → sessions multi-tours.

---

## Outils VFS (équivalents shell)

| Outil | Équivalent | Paramètres clés |
|---|---|---|
| `vfs_find` | `find` | path, name (glob), type, maxdepth |
| `vfs_grep` | `grep`/`rg` | pattern (regex), paths[], context_lines, case_insensitive |
| `vfs_sed` | `sed -i` | path, expression (`s/foo/bar/g`), dry_run |
| `vfs_head_tail` | `head`/`tail` | path, lines, mode |
| `vfs_wc` | `wc` | paths[], count (lines/words/bytes/all) |
| `vfs_diff` | `diff` | path_a, path_b |
| `vfs_sort_uniq` | `sort\|uniq` | path, unique, reverse, numeric |
| `vfs_cat` | `cat` | paths[] |
| `vfs_ls` | `ls -la` | path?, recursive |
| `vfs_mv_cp` | `mv`/`cp` | from, to, operation |

---

## Outils web (Firecrawl)

Les clés Firecrawl proviennent du vault (`config.crawlers`).  
`firecrawl-client.ts` extrait les fonctions HTTP pures de `@cline/core` (0 dépendance Node).

| Outil | Endpoint Firecrawl | Résout |
|---|---|---|
| `fetch_web_content` | `POST /v1/scrape` | CORS, JS rendering, anti-bot |
| `search_web` | `POST /v1/search` | Recherche web avec domaines filtrés |

---

## Phases de développement

| Phase | Durée | Livrable |
|---|---|---|
| 1. Bootstrap | 1–2 j | Stack Vite/React/HeroUI/TS6 opérationnelle |
| 1.5. Auth/Vault | ½ j | LoginScreen + useVault + clés depuis vault |
| 2. Virtual FS | 1–2 j | Upload, read, write, download, IndexedDB |
| 3. Tools browser | 3–4 j | 7 outils CLI + 10 outils VFS + Firecrawl |
| 4. Worker runtime | 2–3 j | Agent multi-tours Worker + bridge tool/approval |
| 5. UI Chat | 3–4 j | Interface complète avec streaming + images |
| 6. File Manager | 1–2 j | Upload sidebar + téléchargements générés |
| 7. Settings | 1 j | Provider/modèle depuis vault, badge multimodal |
| 8. Sessions | 1–2 j | Historique IndexedDB, export/import |
| 9. Tests & polish | 2–3 j | Vitest, dark mode, responsive |
| **Total** | **~17–25 j** | |
