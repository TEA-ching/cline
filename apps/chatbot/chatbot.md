# 🚀 Guide d'Enrichissement du Chatbot Agentique

**Objectif** : Dépasser Perplexity en ajoutant des sources visibles, des actions sur les messages et de nouveaux outils puissants. Toutes les étapes sont modulaires et s'appuient sur votre architecture existante (Web Worker, VFS, hooks).

---

## Étape 1 TERMINÉE: Ajout des citations et du panneau des sources

**Fichier cible** : `src/components/chat/AssistantMessage.tsx` et `src/components/chat/ChatView.tsx`  
**But** : Afficher les sources (sites web, articles) dans un panneau latéral, avec des renvois numérotés dans le texte de l'assistant.

**1.1 Modifier le rendu des messages pour injecter les citations**
Dans `AssistantMessage.tsx`, on va parser le contenu Markdown pour détecter des balises spéciales (ex: `[citation:1]`) et les transformer en liens HTML.

```tsx
// src/components/chat/AssistantMessage.tsx
// Dans le useEffect qui génère le HTML sécurisé (vers ligne 80)

// Ajoutez cette fonction avant le marked.parse
function injectCitationLinks(html: string, sourcesCount: number): string {
  // Remplace [citation:1] par <sup class="citation">[1]</sup>
  return html.replace(/\[citation:(\d+)\]/g, (match, num) => {
    const idx = parseInt(num, 10);
    if (idx <= sourcesCount) {
      return `<sup class="citation"><a href="#source-${idx}" class="text-primary-500 hover:underline">[${idx}]</a></sup>`;
    }
    return match;
  });
}

// Dans le useEffect :
const html = await marked.parse(content);
const safe = DOMPurify.sanitize(html, PURIFY_CONFIG) as string;
// On passe le nombre de sources via un attribut data ou on le récupère du contexte
// On va plutôt stocker les sources dans le composant parent.
```

**1.2 Créer le panneau latéral `SourcesPanel`**
Créez un nouveau fichier : `src/components/chat/SourcesPanel.tsx`.

```tsx
// src/components/chat/SourcesPanel.tsx
import React from 'react';
import { X, ExternalLink, FileText } from 'lucide-react';

export interface Source {
  id: number;
  title: string;
  url: string;
  snippet: string;
}

interface Props {
  sources: Source[];
  onClose: () => void;
}

export const SourcesPanel: React.FC<Props> = ({ sources, onClose }) => {
  return (
    <div className="w-80 border-l border-default-200 bg-background flex flex-col h-full">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">📚 Sources ({sources.length})</h3>
        <button onClick={onClose} className="p-1 hover:bg-default-100 rounded">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {sources.map((src) => (
          <div key={src.id} id={`source-${src.id}`} className="border-l-2 border-primary-400 pl-3 py-1">
            <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary-600 hover:underline flex items-center gap-1">
              {src.title} <ExternalLink className="h-3 w-3" />
            </a>
            <p className="text-xs text-default-500 mt-1 line-clamp-2">{src.snippet}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
```

**1.3 Intégration dans `ChatView.tsx`**
- Ajoutez un état `sources` et `showSources`.
- Lorsque l'agent génère une réponse, parcourez les `messages` pour extraire les sources des appels d'outils (`search_web`, `fetch_web_content`).

```tsx
// src/components/chat/ChatView.tsx
// Vers ligne 150 (après les hooks)

const [sources, setSources] = useState<Source[]>([]);
const [showSources, setShowSources] = useState(false);

// Effet pour extraire les sources des messages
useEffect(() => {
  const extracted: Source[] = [];
  messages.forEach(msg => {
    if (msg.role === 'tool' && msg.toolName === 'search_web' && msg.toolResult) {
      const results = (msg.toolResult as any)?.results || [];
      results.forEach((r: any, idx: number) => {
        extracted.push({
          id: extracted.length + 1,
          title: r.title || 'Source',
          url: r.url || '#',
          snippet: r.description || r.markdown?.slice(0, 200) || '',
        });
      });
    }
  });
  setSources(extracted);
}, [messages]);

// Dans le rendu, ajoutez le bouton et le panneau
<div className="flex items-center gap-1 ...">
  {/* ... boutons existants ... */}
  <Button isIconOnly variant="ghost" size="sm" onPress={() => setShowSources(v => !v)}>
    <FileText className="h-4 w-4" />
  </Button>
</div>

// A côté du conteneur principal
{showSources && (
  <SourcesPanel sources={sources} onClose={() => setShowSources(false)} />
)}
```

**✅ Test** : Lancez une recherche avec `search_web`. Les résultats doivent apparaître dans le panneau.

---

## Étape 2 : Actions avancées sur les messages (Éditer / Régénérer)

**Fichiers cibles** : `src/components/chat/MessageItem.tsx`, `src/components/chat/MessageList.tsx`, `src/hooks/useAgent.ts`  
**But** : Permettre à l'utilisateur de modifier son dernier message ou de régénérer une réponse.

**2.1 Ajouter les méthodes dans `useAgent.ts`**

```tsx
// src/hooks/useAgent.ts
// Ajoutez ces fonctions dans le retour du hook (vers ligne 350)

const regenerate = useCallback(() => {
  // Trouve le dernier message utilisateur
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return;
  // On supprime le message assistant suivant s'il existe, puis on renvoie le message user
  const lastUserIndex = messages.findIndex(m => m.id === lastUser.id);
  const updatedMessages = messages.slice(0, lastUserIndex + 1);
  loadMessages(updatedMessages); // Restaure l'état du worker
  sendMessage(lastUser.content, lastUser.images);
}, [messages, loadMessages, sendMessage]);

const editAndResend = useCallback((messageId: string, newContent: string) => {
  const index = messages.findIndex(m => m.id === messageId);
  if (index === -1) return;
  // On garde tout avant ce message, on le remplace par le nouveau contenu
  const updated = messages.slice(0, index);
  const editedMsg = { ...messages[index], content: newContent };
  const finalMessages = [...updated, editedMsg];
  loadMessages(finalMessages);
  // On relance l'agent sur ce nouveau message
  sendMessage(newContent);
}, [messages, loadMessages, sendMessage]);

// N'oubliez pas d'ajouter regenerate et editAndResend dans le type UseAgentReturn et dans l'objet retourné.
```

**2.2 Modifier `MessageItem.tsx` pour ajouter les boutons**

```tsx
// src/components/chat/MessageItem.tsx
// Dans le composant, ajoutez des props : onRegenerate, onEdit

interface Props {
  message: ChatMessage;
  onImageCaptured?: (path: string, dataUrl: string) => void;
  onFork?: (messageId: string) => void;
  onRegenerate?: () => void; // Nouveau
  onEdit?: (id: string, newText: string) => void; // Nouveau
}

// Dans le rendu des messages assistant (role !== 'user'), ajoutez :
<div className="flex flex-col gap-1">
  <CopyButton text={message.content} light={isUser} />
  {onRegenerate && !message.isStreaming && !isUser && (
    <button onClick={onRegenerate} title="Régénérer" className="...">
      <RefreshCw className="h-3 w-3" />
    </button>
  )}
  {isUser && onEdit && (
    <button onClick={() => setIsEditing(true)} title="Éditer" className="...">
      <Pen className="h-3 w-3" />
    </button>
  )}
</div>

// Gérez l'état d'édition localement :
const [isEditing, setIsEditing] = useState(false);
if (isEditing && isUser) {
  return (
    <div className="flex gap-2 w-full">
      <textarea defaultValue={message.content} onKeyDown={(e) => { if(e.key === 'Enter') { onEdit(message.id, e.currentTarget.value); setIsEditing(false); } }} />
      <button onClick={() => setIsEditing(false)}>Annuler</button>
    </div>
  );
}
```

**2.3 Transmission dans `MessageList` et `ChatView`**
Dans `ChatView`, passez `onRegenerate={() => handleRegenerate(msgId)}` et `onEdit={handleEdit}` aux composants enfants.

**✅ Test** : Régénérez une réponse ou éditez un message précédent. La conversation doit se mettre à jour et l'agent répondre en contexte.

---

## Étape 3 : Affichage structuré des résultats de recherche

**Fichier cible** : `src/components/chat/ToolCallCard.tsx`  
**But** : Lorsque l'outil `search_web` est appelé, afficher les résultats sous forme de cartes plutôt que de JSON brut.

**3.1 Détecter le nom de l'outil dans `ToolCallCard.tsx`**

```tsx
// src/components/chat/ToolCallCard.tsx
// Modifiez le rendu pour afficher un composant personnalisé si toolName === 'search_web'

const renderResult = () => {
  if (toolName === 'search_web' && result && typeof result === 'object' && Array.isArray((result as any).results)) {
    const items = (result as any).results;
    return (
      <div className="space-y-2 max-h-60 overflow-y-auto">
        {items.map((item: any, idx: number) => (
          <div key={idx} className="border-b border-default-100 pb-2 last:border-0">
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary-600 hover:underline">
              {item.title}
            </a>
            <p className="text-xs text-default-500 line-clamp-2">{item.description || item.markdown?.slice(0, 150)}</p>
          </div>
        ))}
      </div>
    );
  }
  return <pre className="...">{JSON.stringify(result, null, 2)}</pre>;
};

// Dans le rendu, remplacez le bloc du résultat par {renderResult()}
```

**3.2 Adapter l'outil `search_web` dans `src/tools/index.ts`**  
Assurez-vous que l'outil retourne un objet avec un tableau `results` bien structuré (c'est déjà le cas grâce à Firecrawl). Vérifiez juste que le mapping est correct vers `title`, `url`, `description`.

**✅ Test** : Faites une recherche web et cliquez sur la carte de l'outil. Vous devez voir les résultats sous forme de liste épurée.

---

## Étape 4 : Ajout de l'outil "Deep Research" (Recherche approfondie)

**Fichier cible** : `src/tools/worker-tools.ts`  
**But** : Permettre à l'agent de lancer plusieurs recherches, de les agréger et de produire un rapport structuré.

**4.1 Implémenter le nouvel outil**

```tsx
// src/tools/worker-tools.ts
// Ajoutez ce bloc dans la fonction createOptionalTools

if (toolId.includes('deep_research')) {
  tools.push(createTool({
    name: 'deep_research',
    description: 'Effectue une recherche approfondie sur un sujet. Lance plusieurs requêtes, extrait les informations clés et synthétise un rapport avec citations.',
    inputSchema: z.object({
      query: z.string().describe('Sujet de recherche principal'),
      depth: z.number().int().min(1).max(3).default(2).describe('Nombre de niveaux de recherche (sous-requêtes)'),
    }),
    execute: async ({ query, depth }) => {
      // Logique simplifiée pour un junior :
      // 1. On fait une recherche initiale
      // 2. On extrait les URLs des 3 premiers résultats
      // 3. On scrape chaque URL
      // 4. On génère un résumé (ici on renvoie les données brutes en attendant)

      const searchResults = await searchWithFirecrawl(query, { endpoint: ctx.firecrawlEndpoint, apiKey: pickFirecrawlKey(ctx.firecrawlKeys, 0) });
      const topUrls = searchResults.slice(0, 3).map(r => r.url);
      
      const scrapedPages = await Promise.all(topUrls.map(async (url) => {
        try {
          return await scrapeWithFirecrawl(url, { endpoint: ctx.firecrawlEndpoint, apiKey: pickFirecrawlKey(ctx.firecrawlKeys, 1) });
        } catch { return null; }
      }));

      const report = {
        query,
        sources: searchResults.map(r => ({ title: r.title, url: r.url })),
        content: scrapedPages.map(p => p?.markdown?.slice(0, 500)).filter(Boolean).join('\n\n---\n\n'),
        summary: `Recherche effectuée sur "${query}". ${scrapedPages.length} pages analysées.`,
      };

      return report;
    },
  }));
}
```

**4.2 Activer l'outil dans `ChatView`**  
Ajoutez `'deep_research'` dans la liste des outils optionnels dans `builtin.ts` ou dans le `ToolManager`.

**✅ Test** : Dans le chat, tapez `/tools`, activez "Deep Research", puis demandez "Fais une recherche approfondie sur les énergies renouvelables". L'agent doit appeler cet outil.

---

## Étape 5 : Ajout de l'outil "Query Data" (SQL sur CSV/JSON)

**Fichier cible** : `src/tools/worker-tools.ts` et `package.json`  
**But** : Exécuter des requêtes SQL sur des fichiers CSV/JSON présents dans le VFS.

**5.1 Installation de la dépendance**
```bash
npm install sql.js
```

**5.2 Implémentation de l'outil**

```tsx
// src/tools/worker-tools.ts
// En haut du fichier
import initSqlJs from 'sql.js';
// Note : sql.js est auto-hébergé ou chargé via CDN, on utilisera le mode wasm.

if (toolId.includes('query_data')) {
  tools.push(createTool({
    name: 'query_data',
    description: 'Exécute une requête SQL (SELECT) sur un fichier CSV ou JSON stocké dans le VFS. Utilise la syntaxe SQLite.',
    inputSchema: z.object({
      filePath: z.string().describe('Chemin du fichier dans le VFS (ex: data.csv)'),
      query: z.string().describe('Requête SQL (ex: SELECT * FROM data WHERE age > 30)'),
    }),
    execute: async ({ filePath, query }) => {
      if (!ctx?.vfs) return { error: 'VFS non disponible' };
      const content = ctx.vfs.read(filePath);
      if (!content) return { error: `Fichier ${filePath} introuvable` };

      // Charger sql.js
      const SQL = await initSqlJs({ locateFile: () => 'https://sql.js.org/dist/sql-wasm.wasm' });
      const db = new SQL.Database();

      // Parser CSV simple
      const rows = content.split('\n').filter(line => line.trim()).map(line => line.split(','));
      if (rows.length < 2) return { error: 'Fichier CSV invalide' };
      const headers = rows[0];
      const data = rows.slice(1);

      // Créer une table temporaire
      const createTable = `CREATE TABLE data (${headers.map(h => `\`${h.trim()}\` TEXT`).join(', ')});`;
      db.run(createTable);
      
      const insertStmt = db.prepare(`INSERT INTO data VALUES (${headers.map(() => '?').join(', ')});`);
      data.forEach(row => insertStmt.run(row));
      insertStmt.free();

      // Exécuter la requête
      const results = db.exec(query);
      db.close();

      if (results.length === 0) return { message: 'Aucun résultat' };
      return { columns: results[0].columns, values: results[0].values };
    },
  }));
}
```

**✅ Test** : Téléchargez un fichier CSV dans le gestionnaire de fichiers, puis demandez à l'agent de l'interroger (ex: "Analyse mon fichier ventes.csv en SQL").

---

## Étape 6 : Ajout de l'outil "News Fetcher" (Actualités)

**Fichier cible** : `src/tools/worker-tools.ts`  
**But** : Récupérer les dernières actualités via une API publique gratuite (NewsAPI ou RSS).

**6.1 Implémentation avec RSS2JSON (gratuit, sans clé)**

```tsx
if (toolId.includes('get_news')) {
  tools.push(createTool({
    name: 'get_news',
    description: 'Récupère les dernières actualités pour un sujet donné (ex: technologie, santé, sports). Utilise des flux RSS publics.',
    inputSchema: z.object({
      topic: z.string().optional().default('technology').describe('Sujet : technology, business, health, science, sports, entertainment'),
      limit: z.number().int().min(1).max(20).default(5),
    }),
    execute: async ({ topic, limit }) => {
      // Utilisation du service RSS2JSON (API gratuite sans clé)
      const rssMap: Record<string, string> = {
        technology: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
        business: 'https://feeds.bbci.co.uk/news/business/rss.xml',
        health: 'https://feeds.bbci.co.uk/news/health/rss.xml',
        science: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
        sports: 'https://feeds.bbci.co.uk/sport/rss.xml',
        entertainment: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml',
      };
      const feedUrl = rssMap[topic] || rssMap.technology;

      const response = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`);
      const data = await response.json();

      if (data.status !== 'ok') return { error: 'Impossible de récupérer les actualités' };

      return {
        topic,
        items: data.items.slice(0, limit).map((item: any) => ({
          title: item.title,
          link: item.link,
          pubDate: item.pubDate,
          description: item.description?.replace(/<[^>]*>/g, '').slice(0, 200),
          author: item.author,
        })),
      };
    },
  }));
}
```

**✅ Test** : Activez l'outil "News" et demandez "Quelles sont les dernières nouvelles en science ?". L'agent doit afficher la liste des articles.

---

## Étape 7 : Visualisation des appels d'outils en arborescence (Bonus)

**Fichier cible** : `src/components/chat/ToolCallCard.tsx`  
**But** : Afficher les appels imbriqués (quand un outil en appelle un autre) sous forme de liste indentée.

- Dans `useAgent.ts`, les outils ne s'appellent pas encore entre eux dans le Worker de manière imbriquée (le LLM décide de l'ordre). Cependant, vous pouvez ajouter un chronomètre ou un affichage "Dépendance" en surveillant les événements `tool-started` et `tool-finished`.

**Mise en œuvre simplifiée** : Ajoutez un compteur de tours et un identifiant parent aux messages `tool`. Dans `agent.worker.ts`, propagez un `parentId` optionnel dans l'événement.

---

## Étape 8 TERMINÉE: BYOK (Bring Your Own Key) pour les utilisateurs externes

**Objectif** : Permettre aux utilisateurs de fournir leurs propres clés API au lieu d'utiliser le coffre-fort distant.  
**Périmètre** : Gestion des clés, sélection des modèles/crawlers, stockage local, statistiques d'usage en local.  
**Fichiers impactés** :  
- `src/hooks/useVault.tsx`  
- `src/hooks/useKeypoolRotation.ts`  
- `src/lib/keypool-usage.ts` (ajout d'une base IndexedDB)  
- `src/components/auth/LoginScreen.tsx`  
- `src/components/settings/SettingsPanel.tsx` (ajout d'un onglet BYOK)  
- `src/types/ai-config.ts` (déjà existant)

---

### 8.1 Préparer l'endpoint public pour la liste des modèles

Le endpoint `(new URL(import.meta.env.KEYPOOL_VAULT_URL).origin)/v1/keypool/byok/models` retourne une structure conforme à `AiConfig` mais avec des tableaux `keys` vides. Vous devez la récupérer au moment du login BYOK.

Créez une fonction dans `src/lib/vault-api.ts` :

```ts
// src/lib/vault-api.ts
export async function fetchPublicModels(): Promise<AiConfig> {
  const baseUrl = new URL(import.meta.env.KEYPOOL_VAULT_URL as string).origin;
  const res = await fetch(`${baseUrl}/v1/keypool/byok/models`);
  if (!res.ok) throw new Error(`Impossible de récupérer la liste des modèles : ${res.status}`);
  return res.json();
}
```

---

### 8.2 Modifier le hook `useVault` pour supporter deux modes

Ajoutez un état `mode: 'vault' | 'byok'` et une méthode `switchToBYOK(config: AiConfig)`.

```tsx
// src/hooks/useVault.tsx
type VaultMode = 'vault' | 'byok';

interface VaultContextType {
  config: AiConfig | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  mode: VaultMode;
  firecrawlKeys: string[];
  login: (token: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  switchToBYOK: (localConfig: AiConfig) => void; // nouvelle
}

export const VaultProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<VaultMode>(() => {
    // Au chargement, on regarde si un config BYOK est présent dans localStorage
    const stored = localStorage.getItem('byok_config');
    return stored ? 'byok' : 'vault';
  });
  const [config, setConfig] = useState<AiConfig | null>(() => {
    if (mode === 'byok') {
      const stored = localStorage.getItem('byok_config');
      return stored ? JSON.parse(stored) : null;
    }
    return null;
  });

  // ... autres états (loading, error, isAuthenticated)

  const login = async (token: string) => {
    // mode vault existant
    VaultApi.setToken(token);
    setIsAuthenticated(true);
    await refresh();
  };

  const logout = () => {
    VaultApi.clearToken();
    setIsAuthenticated(false);
    setConfig(null);
    setMode('vault');
    localStorage.removeItem('byok_config');
  };

  const switchToBYOK = (localConfig: AiConfig) => {
    localStorage.setItem('byok_config', JSON.stringify(localConfig));
    setConfig(localConfig);
    setMode('byok');
    setIsAuthenticated(true); // on considère comme authentifié
  };

  // Modifier refresh : si mode byok, ne pas appeler VaultApi
  const refresh = async () => {
    if (mode === 'byok') return;
    // ... existing fetch logic
  };

  // ... retour du contexte avec mode et switchToBYOK
};
```

---

### 8.3 Interface de login BYOK

Dans `LoginScreen.tsx`, ajoutez un switch et un formulaire conditionnel.

```tsx
// src/components/auth/LoginScreen.tsx
import { Switch, Input, Select, SelectItem } from '@heroui/react';

export const LoginScreen: React.FC = () => {
  const [isBYOK, setIsBYOK] = useState(false);
  const [availableModels, setAvailableModels] = useState<AiConfig | null>(null);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [providerKeys, setProviderKeys] = useState<Record<string, { apiKey: string, modelId: string }>>({});

  const { login, switchToBYOK, loading } = useVault();

  // Charger la liste des modèles publics au premier clic sur le switch
  useEffect(() => {
    if (isBYOK && !availableModels) {
      fetchPublicModels()
        .then(setAvailableModels)
        .catch(err => setError(err.message));
    }
  }, [isBYOK]);

  const handleAddProvider = () => {
    if (!selectedProvider || !apiKey) return;
    // On construit un objet AiConfig local
    const localConfig = availableModels ? { ...availableModels } : { version: 1, providers: {}, crawlers: {} };
    // On ajoute la clé au provider choisi
    const provider = localConfig.providers[selectedProvider];
    if (provider) {
      provider.keys.push({ key: apiKey, owner: 'user' });
      // On mémorise le modèle sélectionné (sera utilisé par useModelSelection)
      // On peut stocker le modèle préféré dans un autre localStorage ou le passer via le config.
      // Pour simplifier, on enregistre le provider/model dans le state du hook useModelSelection via localStorage.
      localStorage.setItem('selectedProviderId', selectedProvider);
      localStorage.setItem('selectedModelId', selectedModel);
    }
    // Mettre à jour le state
    switchToBYOK(localConfig);
  };

  return (
    <div className="...">
      <Switch isSelected={isBYOK} onValueChange={setIsBYOK}>
        Bring your own key (BYOK)
      </Switch>

      {isBYOK && availableModels && (
        <div className="mt-4 space-y-3">
          <Select
            label="Provider"
            selectedKeys={selectedProvider ? [selectedProvider] : []}
            onSelectionChange={(keys) => setSelectedProvider([...keys][0] as string)}
          >
            {Object.keys(availableModels.providers).map(p => (
              <SelectItem key={p}>{p}</SelectItem>
            ))}
          </Select>

          <Select
            label="Modèle"
            selectedKeys={selectedModel ? [selectedModel] : []}
            onSelectionChange={(keys) => setSelectedModel([...keys][0] as string)}
            isDisabled={!selectedProvider}
          >
            {selectedProvider && availableModels.providers[selectedProvider]?.models.map(m => (
              <SelectItem key={m.id}>{m.id}</SelectItem>
            ))}
          </Select>

          <Input
            type="password"
            label="Clé API"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
          />

          <Button onPress={handleAddProvider} isDisabled={!selectedProvider || !apiKey}>
            Ajouter / Se connecter
          </Button>
        </div>
      )}

      {!isBYOK && (
        // Formulaire token existant
        <Form onSubmit={handleSubmit}>
          <Input type="password" placeholder="Vault token" ... />
          <Button type="submit">Connect</Button>
        </Form>
      )}
    </div>
  );
};
```

---

### 8.4 Gestion des statistiques d'usage en local

Pour le mode BYOK, les statistiques doivent être stockées en IndexedDB et non envoyées au worker distant.

Créez un fichier `src/lib/local-usage-store.ts` :

```ts
// src/lib/local-usage-store.ts
import { openDB, IDBPDatabase } from 'idb';

let db: IDBPDatabase | null = null;

async function getDB() {
  if (!db) {
    db = await openDB('byok-usage', 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('usage')) {
          const store = database.createObjectStore('usage', { keyPath: 'id', autoIncrement: true });
          store.createIndex('provider', 'provider');
          store.createIndex('keyHint', 'keyHint');
          store.createIndex('timestamp', 'timestamp');
        }
        if (!database.objectStoreNames.contains('errors')) {
          database.createObjectStore('errors', { keyPath: 'id', autoIncrement: true });
        }
      }
    });
  }
  return db;
}

export async function recordLocalUsage(entry: { provider: string; modelId: string; keyOwner: string; keyHint: string; promptTokens: number; completionTokens: number }) {
  const database = await getDB();
  await database.add('usage', { ...entry, timestamp: Date.now() });
}

export async function recordLocalError(entry: { provider: string; modelId: string; keyOwner: string; keyHint: string; errorCode: number | null }) {
  const database = await getDB();
  await database.add('errors', { ...entry, timestamp: Date.now() });
}

export async function getLocalStats(period: 'hour' | 'day' | 'week' | 'month'): Promise<any[]> {
  // Implémentez la logique d'agrégation (par provider, keyHint) sur la plage de temps.
  // Exemple simplifié : retourne tout
  const database = await getDB();
  const all = await database.getAll('usage');
  // Filtrer selon période (à faire)
  return all;
}
```

Modifiez `recordKeyUsage` et `recordKeyError` dans `src/lib/keypool-usage.ts` pour utiliser ces fonctions si le mode BYOK est actif. Pour détecter le mode, vous pouvez lire le localStorage `byok_config` ou utiliser un contexte.

---

### 8.5 Adapter `useKeypoolRotation` pour les stats locales

Dans `useKeypoolRotation`, la fonction `getUsageStats` doit renvoyer des données locales si BYOK est actif. Passez un paramètre `mode` ou utilisez le contexte.

```tsx
// src/hooks/useKeypoolRotation.ts
import { getLocalStats } from '@/lib/local-usage-store';

// Dans useEffect pour fetch stats :
const stats = mode === 'byok' ? await getLocalStats('day') : await getUsageStats('day');
setStats(stats);
```

N'oubliez pas d'exposer le mode depuis `useVault` et de le passer au hook.

---

### 8.6 Panneau de gestion des clés dans les paramètres

Ajoutez un onglet ou une section dans `SettingsPanel.tsx` pour la gestion BYOK :

- Afficher les providers et leurs clés (avec possibilité d'en ajouter/supprimer).
- Afficher les statistiques d'usage (périodes : 1h, 1j, 1s, 1m, all) sous forme de tableau.
- Un bouton pour exporter/importer la configuration (optionnel).

Exemple de squelette :

```tsx
// src/components/settings/SettingsPanel.tsx
if (mode === 'byok') {
  return (
    <div>
      <h3>Gestion BYOK</h3>
      {Object.entries(config.providers).map(([providerId, provider]) => (
        <div key={providerId}>
          <p>{providerId}</p>
          {provider.keys.map((k, idx) => (
            <div key={idx}>
              <span>{maskKey(k.key)}</span>
              <button onClick={() => removeKey(providerId, idx)}>Supprimer</button>
            </div>
          ))}
          <button onClick={() => addKey(providerId)}>Ajouter une clé</button>
        </div>
      ))}
      <div>
        <h4>Statistiques</h4>
        <select onChange={(e) => setPeriod(e.target.value)}>
          <option value="hour">1h</option>
          <option value="day">1j</option>
          <option value="week">1s</option> {/* 1 semaine? on peut mettre 'week' */}
          <option value="month">1m</option>
          <option value="all">Tout</option>
        </select>
        <table>...</table>
      </div>
    </div>
  );
}
```

---

### 8.7 Intégration finale

- Assurez-vous que `ChatView` reçoit bien le `vaultConfig` depuis `useVault` (déjà le cas).
- Les outils et le worker utilisent les clés du config (déjà géré).
- La rotation des clés fonctionne avec les stats locales.

---

## Résumé des modifications pour l'étape 8

1. **`src/lib/vault-api.ts`** : ajout de `fetchPublicModels()`.
2. **`src/hooks/useVault.tsx`** : ajout du mode `byok`, état `mode`, méthode `switchToBYOK`.
3. **`src/components/auth/LoginScreen.tsx`** : interface BYOK avec switch, sélection provider/model, saisie clé.
4. **`src/lib/local-usage-store.ts`** : IndexedDB pour stocker usage/errors en local.
5. **`src/lib/keypool-usage.ts`** : conditionner l'envoi des stats selon le mode (via un paramètre ou contexte).
6. **`src/hooks/useKeypoolRotation.ts`** : utiliser `getLocalStats` en mode BYOK.
7. **`src/components/settings/SettingsPanel.tsx`** : ajout d'un panneau de gestion BYOK.

**✅ Test** : Lancez l'application en mode BYOK, sélectionnez un provider, saisissez une clé, puis démarrez une conversation. Vérifiez que les appels fonctionnent et que les statistiques apparaissent dans le panneau de gestion.

---

Parfait ! Vous avez raison, j'ai omis ces propositions cruciales dans le guide précédent. Je les intègre dès maintenant en tant qu'**Étapes 9 à 14** (en réservant le numéro 8 comme convenu).

Voici la suite du guide, directement adaptable à votre code source.

---

## Étape 9 PARTIELLE (doublon avec affichage de sortie des outils): Afficher le raisonnement (Chain-of-Thought / CoT)

**Fichiers cibles** : `src/components/chat/AssistantMessage.tsx`, `src/components/chat/ChatView.tsx`, `src/hooks/useAgent.ts`  
**But** : Permettre à l'utilisateur d'afficher la "chaîne de pensée" de l'agent (les appels d'outils et les déductions internes) dans un bloc dépliable.

**9.1 Capturer le raisonnement dans `useAgent.ts`**
Lorsque l'agent exécute des outils, on va accumuler les appels dans un tableau `reasoningSteps`.

```tsx
// src/hooks/useAgent.ts
// Dans le corps du hook, ajoutez un état :
const [reasoningSteps, setReasoningSteps] = useState<string[]>([]);

// Dans le switch du worker onmessage, interceptez 'tool-started' :
case 'event': {
  const event = msg.event
  if (event.type === 'tool-started') {
    // Ajoute une étape de raisonnement
    setReasoningSteps(prev => [...prev, `🔧 Appel de l'outil "${event.toolCall.toolName}" avec les paramètres : ${JSON.stringify(event.toolCall.input)}`]);
  } else if (event.type === 'assistant-text-delta') {
    // On peut aussi capturer le début du raisonnement si le modèle émet des balises • ... (ex: <thinking>)
    // Pour l'exemple, on se contente des outils.
  }
  // ... reste du switch
}

// Ajoutez `reasoningSteps` au type `UseAgentReturn` et à l'objet retourné.
```

**9.2 Ajouter un bouton bascule dans `ChatView.tsx`**

```tsx
// src/components/chat/ChatView.tsx
// Dans la barre d'en-tête (vers ligne 300), ajoutez un état et un bouton :
const [showReasoning, setShowReasoning] = useLocalStorageState('show_reasoning', false);

<Button
  isIconOnly variant="ghost" size="sm"
  onPress={() => setShowReasoning(v => !v)}
  aria-label="Afficher le raisonnement"
  className={showReasoning ? 'text-primary-500' : ''}
>
  <Brain className="h-4 w-4" />
</Button>
```

**9.3 Afficher le raisonnement dans `AssistantMessage.tsx`**
On va ajouter un bloc `<details>` juste avant le contenu principal si `showReasoning` est `true`.

```tsx
// src/components/chat/AssistantMessage.tsx
// Modifiez les props pour recevoir `reasoning` et `showReasoning`
interface Props {
  content: string;
  isStreaming?: boolean;
  reasoning?: string[]; // Nouveau
  showReasoning?: boolean; // Nouveau
}

// Dans le rendu, avant le div contentRef :
{showReasoning && reasoning && reasoning.length > 0 && (
  <details className="mb-3 text-xs bg-default-50 rounded-md p-2 border border-default-200">
    <summary className="cursor-pointer font-mono text-default-500 hover:text-default-700">
      🧠 Voir le raisonnement ({reasoning.length} étapes)
    </summary>
    <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
      {reasoning.map((step, idx) => (
        <div key={idx} className="border-l-2 border-primary-300 pl-2 py-0.5 text-default-600">
          {step}
        </div>
      ))}
    </div>
  </details>
)}
```

**✅ Test** : Demandez à l'agent d'utiliser plusieurs outils (`recherche une recette et calcule les calories`). Activez le bouton "🧠", vous verrez les appels d'outils défiler dans un bloc dépliable.

---

## Étape 10 TERMINÉE: Météo et géolocalisation (`search_location` + `get_weather_forecast`)
### Révision
Météoblue https://business.meteoblue.com/products/weather-apis/free-weather-api offre une API gratuite avec une clé et 5000 requêtes
AiConfig a un type `weatherApi` pour configurer le provider météo. Chaque provider peut avoir de multiples clés API.
```ts
/**
 * Represents a Weather API configuration.
 */
export interface WeatherApi { 
  protocol: WeatherApiProtocol;
  endpoint: string;
  keys: WeatherApiKey[];
}
```
`WeatherApiKey` contient déjà `sharedSecret?: string;` et `signatureType?: 'hmac-md5' | 'hmac-sha256' | 'hmac-sha512';` pour gérer la signature obligatoire de certaines API météo.
page de documentation: https://my.meteoblue.com/packages/redoc#tag/Overview-Structure/paths/~1packages~1%7Bpackages%7D/get
openapi: https://my.meteoblue.com/packages/openapi.yml
exemple de signature:
```js
const sharedSecret = "MySharedSecret";
const query = "/packages/basic-1h?lat=47.1&lon=8.6&apikey=DEMOKEY&expire=1924948800"; // Note demander plusieurs packages en même temps ne compte que pour 1 requête api exemple "basic-1h,basic-day"

const sig = require('crypto').createHmac('sha256', sharedSecret).update(query).digest('hex');
const signedUrl = `https://my.meteoblue.com${query}&sig=${sig}`;
```

**Fichiers modifiés** :
- `src/tools/worker-tools.ts` — deux outils : `search_location` + `get_weather_forecast`
- `src/tools/builtin.ts` — entrée `weather` (icône CloudSun)
- `src/hooks/useAgent.ts` — `weatherApiKeys` + `weatherApiEndpoint` dans `AgentConfig`
- `src/components/chat/ChatView.tsx` — extraction des clés depuis `vaultConfig.weatherApi`
- `src/workers/agent.worker.ts` — champs ajoutés à `InitMessage`, transmis à `createOptionalTools`

**Architecture** : les clés viennent du vault sous `weatherApi.keys` (type `AiKey` avec champ `sharedSecret` et `signatureType`). Le signing HMAC-SHA256 est réalisé via `crypto.subtle` (Web Crypto, dispo dans le Web Worker). Si aucun `sharedSecret` n'est présent, la requête est envoyée sans signature (mode DEMOKEY).

**Étape de recherche de lieu** : l'agent DOIT appeler `search_location` en premier lorsque l'utilisateur donne un nom de ville, puis utiliser les coordonnées retournées pour `get_weather_forecast`.

**10.1 Implémentation de l'outil**

```tsx
// At the top, import CloudRain or any icon from lucide-react (but icons are only used in builtin.ts)
// For the tool itself, we don't need an icon.

// In createOptionalTools signature:
export function createOptionalTools(
  toolId: string[],
  ctx?: {
    // ... existing ...
    meteoblueKeys?: string[]
  }
): AgentTool<any, any>[] {
  // ... existing tools ...

  if (toolId.includes('weather')) {
    let callCount = 0
    tools.push(createTool({
      name: 'get_weather_forecast',
      description: [
        'Get weather forecast for a location using the meteoblue Forecast API.',
        'Supports various packages (basic, clouds, wind, etc.) and time resolutions.',
        'Returns JSON with metadata, units, and forecast data for the requested packages.',
      ].join(' '),
      inputSchema: z.object({
        lat: z.number().min(-90).max(90).describe('Latitude in degrees (WGS84)'),
        lon: z.number().min(-180).max(180).describe('Longitude in degrees (WGS84)'),
        packages: z.string().default('basic-1h').describe(
          'Comma-separated list of packages (e.g., "basic-1h,clouds-1h,wind-1h"). See meteoblue docs for available packages.'
        ),
        forecastDays: z.number().int().min(0).optional().describe('Number of forecast days to return (0 = all available)'),
        historyDays: z.number().int().min(0).max(4).optional().describe('Number of past days to return (max 4)'),
        timezone: z.string().optional().describe('IANA timezone (e.g., "Europe/Paris", "UTC"). If not provided, auto-detected.'),
        format: z.enum(['json', 'csv']).default('json').describe('Response format (json recommended)'),
        temperatureUnit: z.enum(['C', 'K', 'F']).default('C').describe('Temperature unit'),
        windSpeedUnit: z.enum(['m/s', 'km/h', 'mph', 'kn', 'bft']).default('m/s').describe('Wind speed unit'),
        windDirectionUnit: z.enum(['degree', '2char', '3char']).default('degree').describe('Wind direction unit'),
        precipitationUnit: z.enum(['metric', 'imperial']).default('metric').describe('Precipitation unit'),
      }),
      execute: async (input) => {
        const keys = ctx?.meteoblueKeys ?? []
        if (keys.length === 0) {
          throw new Error('No meteoblue API key found in vault. Please add a meteoblue crawler key.')
        }
        const apiKey = keys[callCount++ % keys.length] // round-robin

        const baseUrl = 'https://my.meteoblue.com/packages/' + encodeURIComponent(input.packages)
        const params = new URLSearchParams({
          lat: input.lat.toString(),
          lon: input.lon.toString(),
          format: input.format,
          temperatureUnit: input.temperatureUnit,
          windSpeedUnit: input.windSpeedUnit,
          windDirectionUnit: input.windDirectionUnit,
          precipitationUnit: input.precipitationUnit,
          apikey: apiKey,
        })
        if (input.forecastDays !== undefined) params.append('forecastDays', input.forecastDays.toString())
        if (input.historyDays !== undefined) params.append('historyDays', input.historyDays.toString())
        if (input.timezone) params.append('tz', input.timezone)

        const url = `${baseUrl}?${params.toString()}`
        const response = await fetch(url, {
          headers: { 'Accept': 'application/json' },
        })
        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`meteoblue API error (${response.status}): ${errorText}`)
        }
        const data = await response.json()
        return data
      },
    }))
  }
  return tools
}
```

**10.2 Activer l'outil**  
Ajoutez `'get_weather'` dans la liste des outils optionnels dans `src/tools/builtin.ts`.

**✅ Test** : Demandez "Quel temps fait-il à Lyon ?". L'agent doit appeler l'outil et vous afficher la température et les prévisions.

---

## Étape 11 (ÉTUDE À REVOIR): Données financières et devises (`get_currency`, `get_stock`)

**Fichier cible** : `src/tools/worker-tools.ts`  
**But** : Obtenir des taux de change en temps réel et des cours d'actions.  
**API** : `exchangerate.host` pour les devises (gratuit), et Alpha Vantage (clé gratuite) pour les actions.

**11.1 Implémentation des outils**

```tsx
// src/tools/worker-tools.ts
if (toolId.includes('get_currency')) {
  tools.push(createTool({
    name: 'get_currency',
    description: 'Convertit un montant entre deux devises ou obtient le taux de change actuel.',
    inputSchema: z.object({
      from: z.string().length(3).describe('Code devise source (ex: EUR, USD, GBP)'),
      to: z.string().length(3).describe('Code devise cible (ex: EUR, USD, GBP)'),
      amount: z.number().positive().optional().default(1).describe('Montant à convertir'),
    }),
    execute: async ({ from, to, amount }) => {
      const response = await fetch(`https://api.exchangerate.host/convert?from=${from}&to=${to}&amount=${amount}`);
      const data = await response.json();
      if (!data.success) return { error: 'Devise introuvable ou API indisponible' };
      return {
        from,
        to,
        amount,
        converted: data.result,
        rate: data.info?.rate || 'N/A',
        date: data.date,
      };
    },
  }));
}

if (toolId.includes('get_stock')) {
  tools.push(createTool({
    name: 'get_stock',
    description: 'Récupère le cours actuel d\'une action. Nécessite une clé API Alpha Vantage (gratuite) placée dans les variables d\'environnement.',
    inputSchema: z.object({
      symbol: z.string().describe('Symbole boursier (ex: AAPL, TSLA, MSFT)'),
    }),
    execute: async ({ symbol }) => {
      const apiKey = import.meta.env.VITE_ALPHA_VANTAGE_KEY || 'demo'; // 'demo' fonctionne en lecture seule
      const response = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${apiKey}`);
      const data = await response.json();

      const quote = data['Global Quote'];
      if (!quote || !quote['05. price']) {
        return { error: `Symbole ${symbol} introuvable.` };
      }

      return {
        symbol: quote['01. symbol'],
        price: quote['05. price'],
        change: quote['09. change'],
        changePercent: quote['10. change percent'],
        dayHigh: quote['03. high'],
        dayLow: quote['04. low'],
        volume: quote['06. volume'],
        lastUpdated: quote['07. latest trading day'],
      };
    },
  }));
}
```

**✅ Test** : 
- Demandez "Convertis 100 euros en dollars".
- Demandez "Quel est le cours de l'action Tesla ?" (en configurant `VITE_ALPHA_VANTAGE_KEY` dans `.env`).

---

## Étape 12 TERMINÉE: Génération et extraction de PDF (`pdf_tool`)

**Fichier cible** : `src/tools/worker-tools.ts` + `package.json`  
**But** : Générer un PDF depuis du Markdown/HTML, et extraire le texte d'un PDF existant dans le VFS.

**12.1 Installation des dépendances**
```bash
npm install jspdf pdf-lib pdfjs-dist
```

**12.2 Implémentation de l'outil**

```tsx
// src/tools/worker-tools.ts
if (toolId.includes('pdf_tool')) {
  tools.push(createTool({
    name: 'pdf_tool',
    description: 'Génère un PDF à partir de texte/Markdown ou extrait le texte d\'un PDF existant dans le VFS.',
    inputSchema: z.discriminatedUnion('operation', [
      z.object({
        operation: z.literal('generate'),
        content: z.string().describe('Contenu Markdown ou texte à transformer en PDF'),
        filename: z.string().default('document.pdf'),
      }),
      z.object({
        operation: z.literal('extract'),
        path: z.string().describe('Chemin du fichier PDF dans le VFS'),
      }),
    ]),
    execute: async (input) => {
      if (input.operation === 'generate') {
        // On utilise pdf-lib pour créer un PDF basique
        const { PDFDocument, rgb } = await import('pdf-lib');
        const doc = await PDFDocument.create();
        const page = doc.addPage([600, 800]);
        const { width, height } = page.getSize();
        // On ajoute du texte simple (pour le markdown, il faudrait un renderer plus avancé)
        const lines = input.content.split('\n').filter(l => l.trim());
        let y = height - 50;
        for (const line of lines.slice(0, 40)) { // Limité en hauteur
          if (y < 50) break;
          page.drawText(line, { x: 50, y, size: 12, color: rgb(0, 0, 0) });
          y -= 20;
        }
        const pdfBytes = await doc.save();
        const base64 = btoa(String.fromCharCode(...pdfBytes));
        const dataUrl = `data:application/pdf;base64,${base64}`;

        // On sauvegarde dans le VFS
        if (ctx?.vfs) {
          ctx.vfs.write(input.filename, base64, 'application/pdf');
          ctx.onFileCreated?.(input.filename, dataUrl);
        }
        return { success: true, message: `PDF généré : ${input.filename}`, vfsPath: input.filename };
      } else {
        // Extraction de texte d'un PDF existant
        const { getDocument } = await import('pdfjs-dist');
        const content = ctx?.vfs?.read(input.path);
        if (!content) return { error: `Fichier ${input.path} introuvable` };
        // Le contenu est en base64, on le convertit en Uint8Array
        const binary = atob(content);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const pdf = await getDocument({ data: bytes }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((item: any) => item.str).join(' ');
          fullText += `\n--- Page ${i} ---\n${pageText}`;
        }
        return { success: true, text: fullText, pages: pdf.numPages };
      }
    },
  }));
}
```

**✅ Test** : 
- Téléchargez un PDF via le gestionnaire de fichiers, puis demandez "Extrais le texte de mon fichier rapport.pdf".
- Demandez "Génère un PDF avec le texte 'Bonjour le monde'".

---

## Étape 13 : Visualisation de données (`create_chart`)

**Fichier cible** : `src/tools/worker-tools.ts` + `package.json`  
**But** : Générer un graphique (barres, lignes, camembert) à partir de données tabulaires et retourner une image SVG intégrée dans le chat.

**13.1 Installation**
```bash
npm install vega vega-lite
```

**13.2 Implémentation**

```tsx
// src/tools/worker-tools.ts
if (toolId.includes('create_chart')) {
  tools.push(createTool({
    name: 'create_chart',
    description: 'Génère un graphique (barres, lignes, scatter, camembert) à partir de données JSON.',
    inputSchema: z.object({
      data: z.array(z.record(z.any())).describe('Tableau d\'objets (ex: [{x: "A", y: 10}, {x: "B", y: 20}])'),
      chartType: z.enum(['bar', 'line', 'pie', 'scatter']).default('bar'),
      xField: z.string().describe('Nom du champ pour l\'axe X'),
      yField: z.string().describe('Nom du champ pour l\'axe Y'),
      title: z.string().optional().describe('Titre du graphique'),
    }),
    execute: async ({ data, chartType, xField, yField, title }) => {
      if (!data || data.length === 0) return { error: 'Aucune donnée fournie' };

      // Importer vega-lite et vega pour la compilation
      const vl = await import('vega-lite');
      const vega = await import('vega');

      const mark = chartType === 'pie' ? 'arc' : chartType;

      // Construction de la spécification Vega-Lite
      const spec = {
        $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
        description: title || 'Graphique',
        data: { values: data },
        mark: mark,
        encoding: {
          x: { field: xField, type: 'nominal' },
          y: { field: yField, type: 'quantitative' },
        },
        ...(title ? { title: title } : {}),
      };

      // Pour un camembert, on utilise l'angle
      if (chartType === 'pie') {
        spec.encoding = {
          theta: { field: yField, type: 'quantitative' },
          color: { field: xField, type: 'nominal' },
        };
      }

      // Compilation en SVG
      const view = new vega.View(vega.parse(vl.compile(spec).spec), { renderer: 'svg' });
      const svg = await view.toSVG();

      // Intégration dans le chat via une image data URI
      const dataUrl = `data:image/svg+xml;base64,${btoa(svg)}`;

      // On stocke dans le VFS pour le gestionnaire de fichiers
      const vfsPath = `charts/chart_${Date.now()}.svg`;
      if (ctx?.vfs) {
        ctx.vfs.write(vfsPath, svg, 'image/svg+xml');
        ctx.onFileCreated?.(vfsPath, dataUrl);
      }

      return {
        success: true,
        image: dataUrl,
        vfsPath,
        message: 'Graphique généré et affiché ci-dessous. Téléchargez-le depuis le gestionnaire de fichiers.',
      };
    },
  }));
}
```

**✅ Test** : 
Demandez à l'agent : "Génère un graphique à barres avec les données suivantes : {villes: ['Paris','Lyon'], population: [2.2, 0.5]}". L'agent doit appeler l'outil et afficher l'image SVG directement dans le chat.

---

## Étape 14 TERMINÉE: Exécution de code Python dans le navigateur (`execute_python_code`)

**Fichier cible** : `src/tools/worker-tools.ts` + `package.json`  
**But** : Exécuter du code Python dans un sandbox via Pyodide (WebAssembly).

**14.1 Installation**
```bash
npm install pyodide
```

**14.2 Implémentation de l'outil**
**Note** : Pyodide est lourd (~7 Mo). On le charge à la demande (lazy loading) pour ne pas impacter le temps de chargement initial.

```tsx
// src/tools/worker-tools.ts
if (toolId.includes('execute_python_code')) {
  tools.push(createTool({
    name: 'execute_python_code',
    description: 'Exécute du code Python dans un sandbox Pyodide (WebAssembly). Supporte la plupart des bibliothèques scientifiques (numpy, pandas, etc.). Attention : chargement initial lent.',
    inputSchema: z.object({
      code: z.string().describe('Code Python à exécuter'),
      use_libraries: z.array(z.string()).optional().default([]).describe('Liste de bibliothèques à charger (ex: ["numpy", "pandas"])'),
    }),
    timeoutMs: 60_000,
    execute: async ({ code, use_libraries }) => {
      try {
        // Chargement lazy de Pyodide
        const { loadPyodide } = await import('pyodide');
        const pyodide = await loadPyodide({
          indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.0/full/',
        });

        // Charger les bibliothèques demandées
        for (const lib of use_libraries) {
          await pyodide.loadPackage(lib);
        }

        // Exécution du code avec capture de la sortie
        pyodide.runPython(`
import sys
from io import StringIO
sys.stdout = StringIO()
        `);

        try {
          pyodide.runPython(code);
        } catch (err) {
          // Récupérer la sortie même en cas d'erreur
        }

        const output = pyodide.runPython('sys.stdout.getvalue()');

        return {
          success: true,
          output: output || '(aucune sortie)',
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  }));
}
```

**14.3 Ajout dans les outils optionnels**

```ts
// src/tools/builtin.ts
{
  id: 'execute_python_code',
  name: 'Python Sandbox',
  description: 'Exécute du code Python (via Pyodide) avec support de numpy/pandas. Chargement initial lent (~7Mo).',
  icon: BookOpen, // ou un icone Python spécifique
  tools: ['execute_python_code'],
}
```

**✅ Test** : 
Activez l'outil et demandez à l'agent : "Exécute ce code Python : `print('Hello')`". Le chargement initial peut prendre 5 à 10 secondes. Ensuite, le code s'exécute et affiche "Hello".
