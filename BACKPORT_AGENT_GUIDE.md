# Guide — Agent de backport avec KeypoolLive + devstral-latest

Cet agent utilise les packages `@sctg/cline-*@preview` (générés dynamiquement via CI/CD et publiés sur npmjs), le provider KeypoolLive
pour la rotation automatique des clefs Mistral, et le modèle **devstral-latest** pour analyser
les commits de [cline/cline](https://github.com/cline/cline.git) (branche `dev`) et les backporter dans
`git@github.com:TEA-ching/cline.git` sur la branche `keypool-live` ou des branches de feature dédiées.

---

## Objectifs de l'agent
- Automatiser le processus de backport des commits de `upstream/dev` vers `origin/keypool-live` via la branche `keypool-live-backport-[incremental]`.
- Utiliser le provider KeypoolLive pour gérer les clefs API de manière sécurisée et efficace.
- Implémenter une logique de cherry-pick intelligente qui gère les conflits et les dépendances entre commits.
- Fournir des outils de diagnostic et de reporting pour suivre l'état des backports.

## Table des matières

1. [Prérequis](#1-prérequis)
2. [Structure du projet](#2-structure-du-projet)
3. [Format du vault KeypoolLive](#3-format-du-vault-keypoollive)
4. [Création et chiffrement du vault](#4-création-et-chiffrement-du-vault)
5. [Installation des dépendances](#5-installation-des-dépendances)
6. [Utilisation du SDK et KeypoolLive](#6-utilisation-du-provider-keypoollive)
7. [Implémentation — `git-tools.ts`](#7-implémentation--git-toolsts)
8. [Implémentation — `agent.ts`](#8-implémentation--agentts)
9. [Configuration et variables d'environnement](#9-configuration-et-variables-denvironnement)
10. [Exécution](#10-exécution)
11. [Automatisation (cron / GitHub Actions)](#11-automatisation-cron)
12. [Dépannage](#12-dépannage)

---

## 1. Prérequis

| Outil | Version minimale | Vérification |
|---|---|---|
| Node.js | 22.x | `node --version` |
| npm | 10.x | `npm --version` |
| openssl | 3.x | `openssl version` |

> ⚠️ **Note**: Cet agent utilise [wasm-git](https://github.com/petersalomonsen/wasm-git) au lieu des commandes git natives. wasm-git est un portage WebAssembly de libgit2 qui fonctionne entièrement en JavaScript, éliminant le besoin d'avoir git installé sur le système.

La machine doit avoir accès SSH au dépôt fork `git@github.com:TEA-ching/cline.git` et une
connexion HTTPS vers `https://github.com/cline/cline.git`.

---

## 2. Structure du projet

```
backport-agent/
├── package.json
├── tsconfig.json
├── .env                    ← secrets (NON versionné)
└── src/
    ├── git-tools.ts        ← outils git pour l'agent (utilise wasm-git en mémoire)
    └── agent.ts            ← point d'entrée principal
```

> ⚠️ **Note**: Avec wasm-git, le dépôt git est entièrement géré en mémoire via MEMFS. Il n'y a plus besoin d'un répertoire `repo/` physique sur le disque. Toutes les opérations git s'exécutent dans le système de fichiers virtuel.

---

## 3. Format du vault KeypoolLive

Le vault est un fichier JSON clair (`ai.json`) qui contient les clefs API groupées par provider.
Il est chiffré en AES-256-CBC avant d'être déployé.

```json
{
  "version": 1,
  "providers": {
    "mistral": {
      "protocol": "openai",
      "endpoint": "https://api.mistral.ai/v1",
      "keys": [
        { "key": "sk-xxxxxxxxxxxxxxxxxx", "owner": "compte-1", "type": "paid" },
        { "key": "sk-yyyyyyyyyyyyyyyyyy", "owner": "compte-2", "type": "paid" }
      ],
      "models": [
        {
          "id": "devstral-latest",
          "contextLength": 131072,
          "supportsImages": false
        }
      ]
    }
  }
}
```

---

## 4. Création et chiffrement du vault
Le vault est géré grace au projet [ai-proxy-cloudflare](https://github.com/sctg-development/ai-proxy-cloudflare) qui fournit une ui de gestion et un endpoint de vault chiffré compatible avec le provider KeypoolLive du SDK.

### 4.1 Exemple de fichier clair

```bash
mkdir -p backport-agent/vault
cat > backport-agent/vault/ai.json << 'EOF'
{
  "version": 1,
  "providers": {
    "mistral": {
      "protocol": "openai",
      "endpoint": "https://api.mistral.ai/v1",
      "keys": [
        { "key": "sk-VOTRE_CLE_1", "owner": "compte-principal", "type": "paid" },
        { "key": "sk-VOTRE_CLE_2", "owner": "compte-backup",    "type": "paid" }
      ],
      "models": [
        { "id": "devstral-latest", "contextLength": 131072 }
      ]
    }
  }
}
EOF
```

### 4.2 Chiffrement avec openssl

```bash
openssl enc -aes-256-cbc -a -pbkdf2 -iter 100000 -salt \
  -in  backport-agent/vault/ai.json \
  -out backport-agent/vault/ai.json.enc \
  -pass pass:"MON_SECRET_VAULT"

rm backport-agent/vault/ai.json
```

---

## 5. Installation des dépendances

Le package `@sctg/cline-sdk` est le point d'entrée principal qui regroupe les fonctionnalités du core, des agents et des LLMs sous le scope `@sctg/` seules les versions tagged `@preview` sont disponibles.

```bash
cd backport-agent
npm init -y
npm install @sctg/cline-sdk@preview
npm install wasm-git
npm install --save-dev typescript @types/node tsx
```

---

## 6. Utilisation du provider KeypoolLive

Le provider **keypoollive** est intégré au SDK. En utilisant `providerId: "keypoollive"` et en configurant les variables `KEYPOOL_VAULT_URL` et `KEYPOOL_LIVE_SECRET`, le SDK gère :
- Le chargement et déchiffrement automatique du vault.
- La rotation transparente des clés sur erreurs `401/403/429`.
- Le format de `modelId` est `vaultProvider/modelId` (ex: `mistral/devstral-latest`).

---

## 7. Implémentation — `git-tools.ts`

```typescript
import { createTool } from "@sctg/cline-sdk"
import { default as initWasmGit } from "wasm-git"

// Initialisation de wasm-git avec système de fichiers en mémoire (MEMFS)
let lg: any, FS: any
async function initGit() {
  if (!lg) {
    const lgMod = await import("wasm-git")
    lg = await lgMod.default()
    FS = lg.FS

    // Création du système de fichiers en mémoire MEMFS comme dans les tests
    const APPFS = FS.filesystems.MEMFS
    const workingDir = "/working"
    FS.mkdir(workingDir)
    FS.mount(APPFS, { root: '.' }, workingDir)
    FS.chdir(workingDir)

    // Configuration git globale dans le système de fichiers virtuel
    FS.writeFile('/home/web_user/.gitconfig', '[user]\n' +
                'name = Backport Agent\n' +
                'email = backport-agent@example.com')
  }
  return { lg, FS }
}

const UPSTREAM_URL = "https://github.com/cline/cline.git"
const FORK_URL = process.env.FORK_URL ?? "git@github.com:TEA-ching/cline.git"
const UPSTREAM_BRANCH = process.env.UPSTREAM_BRANCH ?? "dev"
const TARGET_BRANCH = process.env.TARGET_BRANCH ?? "keypool-live"

// Fonction helper pour exécuter des commandes git via wasm-git
async function git(args: string[]): Promise<string> {
  await initGit()
  try {
    await lg.callMain(args)
    return ""
  } catch (err: any) {
    return `GIT_ERROR: ${err.message ?? String(err)}`
  }
}

// Fonction helper pour exécuter des commandes git et retourner la sortie
async function gitWithOutput(args: string[]): Promise<string> {
  await initGit()

  // Pour les commandes qui produisent de la sortie, nous devons capturer via FS
  // wasm-git n'a pas de mécanisme de capture de sortie direct, donc nous utilisons
  // des fichiers temporaires pour certaines commandes
  if (args[0] === 'log') {
    // Pour git log, nous écrivons dans un fichier temporaire et le lisons
    const tempFile = '/tmp/git-log-output.txt'
    const logArgs = [...args, `> ${tempFile}`]
    try {
      await lg.callMain(logArgs)
      return FS.readFile(tempFile, { encoding: 'utf8' })
    } catch (err) {
      return `GIT_ERROR: ${err.message ?? String(err)}`
    }
  }

  try {
    await lg.callMain(args)
    return ""
  } catch (err: any) {
    return `GIT_ERROR: ${err.message ?? String(err)}`
  }
}

export const setupRepoTool = createTool({
  name: "setup_repo",
  description: "Clone le fork, configure upstream, fetch et prépare la branche cible.",
  inputSchema: { type: "object", properties: {} },
  execute: async () => {
    await initGit()

    // Vérifier si le dépôt existe déjà
    let repoExists = false
    try {
      await lg.callMain(['rev-parse', '--is-inside-work-tree'])
      repoExists = true
    } catch (e) {
      repoExists = false
    }

    if (!repoExists) {
      // Cloner le fork
      await lg.callMain(['clone', FORK_URL, 'repo'])
      FS.chdir('repo')
    }

    // Vérifier et ajouter l'upstream si nécessaire
    let hasUpstream = false
    try {
      await lg.callMain(['remote', 'get-url', 'upstream'])
      hasUpstream = true
    } catch (e) {
      hasUpstream = false
    }

    if (!hasUpstream) {
      await lg.callMain(['remote', 'add', 'upstream', UPSTREAM_URL])
    }

    // Fetch des branches
    await lg.callMain(['fetch', 'upstream', '--prune'])
    await lg.callMain(['fetch', 'origin', '--prune'])

    // Vérifier et créer la branche cible si nécessaire
    let hasTargetBranch = false
    try {
      await lg.callMain(['branch', '--list', TARGET_BRANCH])
      hasTargetBranch = true
    } catch (e) {
      hasTargetBranch = false
    }

    if (!hasTargetBranch) {
      let hasRemoteBranch = false
      try {
        await lg.callMain(['branch', '-r', '--list', `origin/${TARGET_BRANCH}`])
        hasRemoteBranch = true
      } catch (e) {
        hasRemoteBranch = false
      }

      if (hasRemoteBranch) {
        await lg.callMain(['checkout', '--track', `origin/${TARGET_BRANCH}`])
      } else {
        await lg.callMain(['checkout', '-b', TARGET_BRANCH, `upstream/${UPSTREAM_BRANCH}`])
        await lg.callMain(['push', '-u', 'origin', TARGET_BRANCH])
      }
    } else {
      await lg.callMain(['checkout', TARGET_BRANCH])
      await lg.callMain(['pull', 'origin', TARGET_BRANCH])
    }

    return { status: "ok", branch: TARGET_BRANCH }
  },
})

export const listUpstreamCommitsTool = createTool({
  name: "list_upstream_commits",
  description: "Liste les derniers commits de upstream.",
  inputSchema: {
    type: "object",
    properties: {
      count: { type: "number", default: 50 },
      since: { type: "string" }
    }
  },
  execute: async ({ count = 50, since }) => {
    await initGit()

    const sinceArg = since ? `--since="${since}"` : ""
    const format = "%H|%an|%ai|%s"
    const raw = await gitWithOutput(['log', `upstream/${UPSTREAM_BRANCH}`, '--no-merges', `--format=${format}`, sinceArg, `-${count}`])

    if (raw.startsWith("GIT_ERROR")) return { error: raw }

    const commits = raw.split("\n").filter(Boolean).map(line => {
      const [sha, author, date, ...msg] = line.split("|")
      return { sha, author, date, message: msg.join("|") }
    })
    return { commits }
  }
})

export const listBackportedCommitsTool = createTool({
  name: "list_backported_commits",
  description: "SHAs déjà présents (via messages de cherry-pick).",
  inputSchema: { type: "object", properties: {} },
  execute: async () => {
    await initGit()

    const raw = await gitWithOutput(['log', `origin/${TARGET_BRANCH}`, '--no-merges', '--format=%s%n%b', '-500'])
    const cherryPickedShas = new Set<string>()
    const shaRegex = /cherry picked from commit ([0-9a-f]{40})/gi
    let match
    while ((match = shaRegex.exec(raw)) !== null) {
      cherryPickedShas.add(match[1])
    }
    return { cherryPickedFrom: [...cherryPickedShas] }
  }
})

export const cherryPickTool = createTool({
  name: "cherry_pick",
  description: "Cherry-pick d'un commit dans la branche cible.",
  inputSchema: { type: "object", properties: { sha: { type: "string" } }, required: ["sha"] },
  execute: async ({ sha }) => {
    await initGit()

    // Checkout de la branche cible
    await lg.callMain(['checkout', TARGET_BRANCH])

    // Exécution du cherry-pick
    try {
      await lg.callMain(['cherry-pick', '-x', sha])
      return { success: true, sha }
    } catch (err: any) {
      // Gestion des conflits
      const statusRaw = await gitWithOutput(['status', '--short'])
      const conflictFiles = statusRaw.split("\n")
        .filter(l => l.match(/^(UU|AA|DD)/))
        .map(l => l.substring(3).trim())

      return { success: false, sha, conflictFiles, error: err.message ?? String(err) }
    }
  }
})

export const resolveConflictTool = createTool({
  name: "resolve_conflict",
  description: "Résout les conflits après un cherry-pick échoué.",
  inputSchema: {
    type: "object",
    properties: {
      conflictFiles: { type: "array", items: { type: "string" } },
      resolutionStrategy: { type: "string", enum: ["theirs", "ours", "manual"] }
    },
    required: ["conflictFiles", "resolutionStrategy"]
  },
  execute: async ({ conflictFiles, resolutionStrategy }) => {
    await initGit()

    // Vérifier que nous sommes sur la bonne branche
    await lg.callMain(['checkout', TARGET_BRANCH])

    // Appliquer la stratégie de résolution
    for (const file of conflictFiles) {
      if (resolutionStrategy === "theirs") {
        await lg.callMain(['checkout', '--theirs', file])
      } else if (resolutionStrategy === "ours") {
        await lg.callMain(['checkout', '--ours', file])
      }
      // Pour "manual", nous laissons l'utilisateur gérer manuellement
    }

    // Marquer les conflits comme résolus
    await lg.callMain(['add', ...conflictFiles])

    return { success: true, conflictFiles, resolutionStrategy }
  }
})

export const cherryPickControlTool = createTool({
  name: "cherry_pick_control",
  description: "Contrôle le processus de cherry-pick (continue, abandonne, etc.).",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["continue", "abort", "skip"] }
    },
    required: ["action"]
  },
  execute: async ({ action }) => {
    await initGit()

    // Vérifier que nous sommes sur la bonne branche
    await lg.callMain(['checkout', TARGET_BRANCH])

    // Exécuter l'action demandée
    try {
      if (action === "continue") {
        await lg.callMain(['cherry-pick', '--continue'])
      } else if (action === "abort") {
        await lg.callMain(['cherry-pick', '--abort'])
      } else if (action === "skip") {
        await lg.callMain(['cherry-pick', '--skip'])
      }
      return { success: true, action }
    } catch (err: any) {
      return { success: false, action, error: err.message ?? String(err) }
    }
  }
})

export const pushBackportTool = createTool({
  name: "push_backport",
  description: "Pousse les commits backportés vers le dépôt distant.",
  inputSchema: { type: "object", properties: {} },
  execute: async () => {
    await initGit()

    // Vérifier que nous sommes sur la bonne branche
    await lg.callMain(['checkout', TARGET_BRANCH])

    // Pousser les changements vers le dépôt distant
    try {
      await lg.callMain(['push', 'origin', TARGET_BRANCH])
      return { success: true, branch: TARGET_BRANCH }
    } catch (err: any) {
      return { success: false, branch: TARGET_BRANCH, error: err.message ?? String(err) }
    }
  }
})

export const reportDoneTool = createTool({
  name: "report_done",
  description: "Génère un rapport des commits backportés et des éventuels problèmes.",
  inputSchema: { type: "object", properties: {} },
  execute: async () => {
    await initGit()

    // Obtenir les derniers commits
    const raw = await gitWithOutput(['log', `origin/${TARGET_BRANCH}`, '--no-merges', '--format=%H|%an|%ai|%s', '-50'])

    if (raw.startsWith("GIT_ERROR")) return { error: raw }

    const commits = raw.split("\n").filter(Boolean).map(line => {
      const [sha, author, date, ...msg] = line.split("|")
      return { sha, author, date, message: msg.join("|") }
    })

    return {
      success: true,
      branch: TARGET_BRANCH,
      commits,
      message: "Backport terminé avec succès."
    }
  }
})

export const ALL_TOOLS = [
  setupRepoTool,
  listUpstreamCommitsTool,
  listBackportedCommitsTool,
  cherryPickTool,
  resolveConflictTool,
  cherryPickControlTool,
  pushBackportTool,
  reportDoneTool
]
```

---

## 8. Implémentation — `agent.ts`

```typescript
import { Agent } from "@sctg/cline-sdk"
import { ALL_TOOLS } from "./git-tools.js"

const SYSTEM_PROMPT = `
Tu es un agent expert en maintenance de fork.
Mission : Backporter les commits de upstream/dev vers origin/keypool-live.
Workflow : setup_repo -> list_upstream_commits -> list_backported_commits -> identification -> cherry_pick (boucle) -> push.
`

async function main() {
  const agent = new Agent({
    providerId: "keypoollive",
    modelId: "mistral/devstral-latest",
    apiKey: "auto",
    systemPrompt: SYSTEM_PROMPT,
    tools: ALL_TOOLS,
  })

  agent.subscribe(event => {
    if (event.type === "assistant-text-delta") process.stdout.write(event.text)
  })

  await agent.run("Backporte les derniers commits non présents.")
}

main().catch(console.error)
```

---

## 9. Configuration (`.env`)

```dotenv
KEYPOOL_VAULT_URL=https://mon-vault.example.com/ai.json.enc
KEYPOOL_LIVE_SECRET=MON_SECRET
FORK_URL=git@github.com:TEA-ching/cline.git
UPSTREAM_BRANCH=dev
TARGET_BRANCH=keypool-live
```

> ⚠️ **Note**: La variable `REPO_DIR` a été supprimée car wasm-git fonctionne entièrement en mémoire. Plus besoin de spécifier un répertoire de travail physique.

---

## 11. GitHub Action

```yaml
name: Backport cline dev → keypool-live
on:
  schedule: [{cron: "0 3 * * *"}]
  workflow_dispatch:
jobs:
  backport:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: TEA-ching/cline
          ref: keypool-live
          ssh-key: ${{ secrets.DEPLOY_KEY }}
      - uses: actions/setup-node@v4
        with: {node-version: "22"}
      - name: Run agent
        env:
          KEYPOOL_VAULT_URL: ${{ secrets.KEYPOOL_VAULT_URL }}
          KEYPOOL_LIVE_SECRET: ${{ secrets.KEYPOOL_LIVE_SECRET }}
        run: npx tsx src/agent.ts
