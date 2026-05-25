# Agent de backport automatique avec validation par tests — Analyse & Guide technique

## Contexte et objectifs

Le dépôt [cline/cline](https://github.com/cline/cline) évolue rapidement sur sa branche `dev`.  
Nous maintenons un fork `TEA-ching/cline` avec **des modifications spécifiques** sur la branche `keypool-live`.  
L’objectif est d’**automatiser le backport** des commits upstream **commit par commit**, en **préservant nos propres ajouts** et en **exécutant les tests du projet** après chaque intégration pour garantir la stabilité.

L’agent utilise le SDK `@sctg/cline-sdk@preview` et le provider **KeypoolLive** (vault en ligne de clés et modèles, cf. [ai-proxy-cloudflare](https://github.com/sctg-development/ai-proxy-cloudflare)).  
Le modèle **devstral-latest** analyse les commits et pilote les opérations.

## Architecture fonctionnelle

```
┌──────────────┐      ┌───────────────────────────┐      ┌─────────────────────┐
│  GitHub       │      │  Agent backport (Node.js) │      │  Mistral API         │
│  upstream     │◄────►│  - wasm-git (mémoire)     │◄────►│  (via KeypoolLive)   │
│  cline/cline  │      │  - Outils git custom      │      │  devstral-latest     │
└──────────────┘      │  - Exécution des tests     │      └─────────────────────┘
                      └──────────┬────────────────┘
                                 │ push SSH (si tests ok)
                                 ▼
                        ┌────────────────┐
                        │  Fork distant   │
                        │  TEA-ching/cline│
                        └────────────────┘
```

**Flux principal (traitement commit par commit) :**
1. Initialisation du dépôt virtuel → `setup_repo`
2. Récupération des commits upstream et des commits déjà backportés
3. Détermination des commits manquants
4. Pour **chaque commit manquant** (dans l’ordre) :
   a. Cherry-pick sur `keypool-live`  
   b. Si conflit → résolution **obligatoire avec `--ours`** (garder nos modifications)  
   c. Exécution de la suite de tests  
   d. Si échec des tests → annulation du cherry-pick et signalement  
5. Push vers le fork uniquement si tous les commits ont passé les tests
6. Rapport final

---

## 1. Prérequis

| Composant         | Version / Exigence                  |
| ----------------- | ----------------------------------- |
| Node.js           | ≥ 22                                |
| npm               | ≥ 10                                |
| openssl           | ≥ 3 (pour le chiffrement du vault)  |
| Accès SSH         | Clé privée autorisée sur le fork    |
| Accès HTTPS       | Lecture du dépôt upstream           |

---

## 2. Structure du projet

```
backport-agent/
├── package.json
├── tsconfig.json
├── .env                    ← secrets (non versionné)
└── src/
    ├── git-tools.ts        ← outils git + exécution des tests
    └── agent.ts            ← point d'entrée
```

---

## 3. Gestion des clés – KeypoolLive (vault en ligne)

Le provider **KeypoolLive** charge dynamiquement un vault chiffré hébergé (ex. via [ai-proxy-cloudflare](https://github.com/sctg-development/ai-proxy-cloudflare)). Il contient les clés API Mistral et la liste des modèles, et assure la rotation automatique en cas d’erreur.

**Format du vault (clair) :**
```json
{
  "version": 1,
  "providers": {
    "mistral": {
      "protocol": "openai",
      "endpoint": "https://api.mistral.ai/v1",
      "keys": [
        { "key": "sk-...", "owner": "compte-1", "type": "paid" },
        { "key": "sk-...", "owner": "compte-2", "type": "paid" }
      ],
      "models": [
        { "id": "devstral-latest", "contextLength": 131072 }
      ]
    }
  }
}
```

**Chiffrement :**
```bash
openssl enc -aes-256-cbc -a -pbkdf2 -iter 100000 -salt \
  -in ai.json -out ai.json.enc \
  -pass pass:"${VAULT_PASSWORD}"
```

---

## 4. Installation

```bash
npm init -y
npm install @sctg/cline-sdk@preview wasm-git
npm install --save-dev typescript @types/node tsx
```

---

## 5. Implémentation des outils Git (avec tests)

```typescript
// src/git-tools.ts
import { createTool } from "@sctg/cline-sdk";
import initWasmGit from "wasm-git";

let lg: any, FS: any;
let stdoutBuffer: string[] = [];

async function initGit() {
  if (!lg) {
    const stdoutCallback = (line: string) => { stdoutBuffer.push(line); };
    const stderrCallback = (line: string) => { stdoutBuffer.push(line); }; // fusionné
    lg = await initWasmGit(stdoutCallback, stderrCallback);
    FS = lg.FS;
    const workingDir = "/working";
    FS.mkdir(workingDir);
    FS.mount(FS.filesystems.MEMFS, { root: '.' }, workingDir);
    FS.chdir(workingDir);
    FS.writeFile('/home/web_user/.gitconfig',
      '[user]\nname = Backport Agent\nemail = agent@example.com');
    // Injection de la clé SSH
    const sshDir = '/home/web_user/.ssh';
    FS.mkdir(sshDir);
    if (process.env.SSH_PRIVATE_KEY) {
      FS.writeFile(`${sshDir}/id_rsa`, process.env.SSH_PRIVATE_KEY);
      FS.chmod(`${sshDir}/id_rsa`, 0o600);
    }
  }
  return { lg, FS };
}

async function runGit(args: string[]): Promise<string> {
  await initGit();
  stdoutBuffer = [];
  try { await lg.callMain(args); }
  catch (err: any) { return `GIT_ERROR: ${err.message ?? String(err)}`; }
  return stdoutBuffer.join('\n').trim();
}

async function runGitSilent(args: string[]): Promise<string> {
  await initGit();
  stdoutBuffer = [];
  try { await lg.callMain(args); return ''; }
  catch (err: any) { return `GIT_ERROR: ${err.message ?? String(err)}`; }
}

const UPSTREAM_URL = "https://github.com/cline/cline.git";
const FORK_URL = process.env.FORK_URL ?? "git@github.com:TEA-ching/cline.git";
const UPSTREAM_BRANCH = process.env.UPSTREAM_BRANCH ?? "dev";
const TARGET_BRANCH = process.env.TARGET_BRANCH ?? "keypool-live";

// --- Outils de base ---
export const setupRepoTool = createTool({ /* ... identique à la version précédente ... */ });
export const listUpstreamCommitsTool = createTool({ /* ... */ });
export const listBackportedCommitsTool = createTool({ /* ... */ });

export const cherryPickTool = createTool({
  name: "cherry_pick",
  description: "Cherry-pick d'un commit.",
  inputSchema: { type: "object", properties: { sha: { type: "string" } }, required: ["sha"] },
  execute: async ({ sha }) => {
    await initGit();
    await runGitSilent(['checkout', TARGET_BRANCH]);
    try {
      await runGitSilent(['cherry-pick', '-x', sha]);
      return { success: true, sha };
    } catch (err: any) {
      const statusRaw = await runGit(['status', '--short']);
      const conflictFiles = statusRaw.split("\n")
        .filter(l => /^[UD]{2}/.test(l))
        .map(l => l.substring(3).trim());
      return { success: false, sha, conflictFiles, error: err.message ?? String(err) };
    }
  },
});

export const resolveConflictTool = createTool({
  name: "resolve_conflict",
  description: "Résout les conflits en conservant nos modifications (--ours).",
  inputSchema: {
    type: "object",
    properties: { conflictFiles: { type: "array", items: { type: "string" } } },
    required: ["conflictFiles"]
  },
  execute: async ({ conflictFiles }) => {
    await initGit();
    await runGitSilent(['checkout', TARGET_BRANCH]);
    for (const file of conflictFiles) {
      await runGitSilent(['checkout', '--ours', file]);
    }
    await runGitSilent(['add', ...conflictFiles]);
    return { success: true, conflictFiles, strategy: "ours" };
  },
});

export const cherryPickControlTool = createTool({
  name: "cherry_pick_control",
  description: "Continue, abort ou skip le cherry-pick en cours.",
  inputSchema: {
    type: "object",
    properties: { action: { type: "string", enum: ["continue", "abort", "skip"] } },
    required: ["action"]
  },
  execute: async ({ action }) => {
    await initGit();
    await runGitSilent(['checkout', TARGET_BRANCH]);
    try {
      if (action === "continue") await runGitSilent(['cherry-pick', '--continue']);
      else if (action === "abort") await runGitSilent(['cherry-pick', '--abort']);
      else if (action === "skip") await runGitSilent(['cherry-pick', '--skip']);
      return { success: true, action };
    } catch (err: any) {
      return { success: false, action, error: err.message ?? String(err) };
    }
  },
});

// --- Outil d'exécution des tests ---
export const runTestsTool = createTool({
  name: "run_tests",
  description: "Exécute la suite de tests du projet (npm test). Retourne le résultat.",
  inputSchema: { type: "object", properties: {} },
  execute: async () => {
    await initGit();
    // On suppose que le dépôt a un package.json avec une commande "test"
    // wasm-git ne donne pas accès à un shell, on utilise child_process via Node
    const { execSync } = await import("child_process");
    try {
      const output = execSync("npm test", { cwd: "/working/repo", encoding: "utf8", timeout: 120_000 });
      return { success: true, output };
    } catch (err: any) {
      return { success: false, output: err.stdout + "\n" + err.stderr };
    }
  },
});

export const pushBackportTool = createTool({ /* ... push vers origin ... */ });
export const reportDoneTool = createTool({ /* ... rapport final ... */ });
```

**Remarque importante** : L’outil `run_tests` utilise `child_process` pour lancer les tests dans le répertoire de travail virtuel de wasm-git. Cela n’est possible que si le dépôt backporté est physiquement accessible sur le disque (wasm-git peut monter un répertoire local via NODEFS si nécessaire). Une alternative plus robuste consiste à cloner le dépôt sur disque (hors wasm-git) pour exécuter les tests, mais cela complexifie l’architecture. L’exemple ci-dessus suppose que l’environnement d’exécution de l’agent a accès à un clone physique.

---

## 6. Implémentation de l’agent (traitement commit par commit)

Le prompt système décrit explicitement le traitement pas à pas et l’appel obligatoire à `run_tests` après chaque cherry-pick.

```typescript
// src/agent.ts
import { Agent } from "@sctg/cline-sdk";
import { ALL_TOOLS } from "./git-tools.js";

const SYSTEM_PROMPT = `
Tu es un agent expert en maintenance de fork.
Mission : backporter les commits de upstream/dev vers origin/keypool-live **un par un**, en conservant toutes les modifications du fork.
Procédure stricte :
1. setup_repo
2. list_upstream_commits + list_backported_commits → déduis les commits manquants
3. Pour chaque commit manquant (dans l'ordre chronologique) :
   a. cherry_pick
   b. Si conflit → resolve_conflict (stratégie "ours" obligatoire) puis cherry_pick_control continue
   c. run_tests
   d. Si les tests échouent → cherry_pick_control abort → signaler l'échec et arrêter le processus
4. Si tous les commits sont intégrés avec succès, push_backport
5. report_done

Ne jamais utiliser la stratégie "theirs". La fiabilité des tests est prioritaire.
`;

async function main() {
  const agent = new Agent({
    providerId: "keypoollive",
    modelId: "mistral/devstral-latest",
    apiKey: "auto",
    systemPrompt: SYSTEM_PROMPT,
    tools: ALL_TOOLS,
  });

  agent.subscribe(event => {
    if (event.type === "assistant-text-delta") process.stdout.write(event.text);
  });

  await agent.run("Backporte les derniers commits upstream manquants, un par un avec validation par tests.");
}

main().catch(console.error);
```

---

## 7. Configuration

Fichier `.env` :

```dotenv
KEYPOOL_VAULT_URL=https://vault.example.com/ai.json.enc
KEYPOOL_LIVE_SECRET=le_mot_de_passe_du_vault
FORK_URL=git@github.com:TEA-ching/cline.git
UPSTREAM_BRANCH=dev
TARGET_BRANCH=keypool-live
SSH_PRIVATE_KEY="-----BEGIN OPENSSH PRIVATE KEY-----..."
```

---

## 8. Exécution

### En local

```bash
set -a; source .env; set +a
npx tsx src/agent.ts
```

### CI (GitHub Actions)

```yaml
name: Backport + Tests
on:
  schedule: [{ cron: "0 3 * * *" }]
  workflow_dispatch:
jobs:
  backport:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22" }
      - name: Install dependencies
        run: npm ci
      - name: Run agent
        env:
          KEYPOOL_VAULT_URL: ${{ secrets.KEYPOOL_VAULT_URL }}
          KEYPOOL_LIVE_SECRET: ${{ secrets.KEYPOOL_LIVE_SECRET }}
          SSH_PRIVATE_KEY: ${{ secrets.DEPLOY_KEY }}
        run: npx tsx src/agent.ts
```

---

## 9. Dépannage

| Problème                                      | Cause probable                                   | Solution                                                                 |
| --------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| `run_tests` échoue car le dépôt n'est pas physique | wasm-git MEMFS inaccessible depuis Node        | Utiliser NODEFS pour lier le répertoire de travail, ou cloner sur disque  |
| Conflits non résolus malgré `--ours`          | Fichiers binaires ou structure modifiée          | Signaler le conflit à l’humain, ne pas forcer                             |
| Tests échouent après un cherry-pick           | Conflit sémantique non détecté                   | L’agent abandonne le commit, notification nécessaire                     |
| Erreurs 401/403 KeypoolLive                   | Clé invalide ou quota dépassé                    | Vérifier le vault et les clés                                            |

---

**Résumé** : L’agent backporte **commit par commit**, résout les conflits en faveur du fork, et **exécute les tests après chaque intégration**. Aucun commit n’est poussé si les tests ne passent pas.
