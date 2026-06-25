/*
 * MIT License
 *
 * Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { Calculator, CalendarClock, Lock, Dice6, Palette, Zap, BookOpen, Search, Image, BarChart2, Terminal, CloudSun, FileSearch } from 'lucide-react'
import type { ElementType } from 'react'
import type { AiModel } from '@/types/ai-config'

export interface OptionalToolMeta {
  id: string
  name: string
  description: string
  icon: ElementType
  tools: string[]
  filter?: (model: AiModel, providerId: string) => boolean
}

export const BUILTIN_OPTONAL_TOOLS: OptionalToolMeta[] = [
  {
    id: 'search_documents',
    name: 'Document Search (RAG)',
    description:
      'Search through uploaded documents for relevant passages. ' +
      'Uses BM25 lexical scoring, or semantic search when an embedding model is configured in the vault. ' +
      'Upload text/markdown/PDF files to enable this tool.',
    icon: FileSearch,
    tools: ['search_documents'],
  },
  {
    id: 'calculator',
    name: 'Calculator',
    description: 'Evaluate math expressions: sin, cos, sqrt, log, pow, etc. Constants PI and E.',
    icon: Calculator,
    tools: ['calculate'],
  },
  {
    id: 'datetime',
    name: 'Date & Time',
    description: 'Get current date/time in various formats and IANA timezones.',
    icon: CalendarClock,
    tools: ['get_datetime'],
  },
  {
    id: 'encoding',
    name: 'Encoding Tools',
    description: 'Base64, URL-encode, hex encode/decode; JSON format and minify.',
    icon: Lock,
    tools: ['encode_decode'],
  },
  {
    id: 'uuid',
    name: 'ID Generator',
    description: 'Generate UUID v4, hex tokens, or random alphanumeric strings.',
    icon: Dice6,
    tools: ['generate_id'],
  },
  {
    id: 'color',
    name: 'Color Tools',
    description: 'Convert colors between hex, RGB, and HSL formats.',
    icon: Palette,
    tools: ['color_convert'],
  },
  {
    id: 'execute_js',
    name: 'JS / TS Sandbox',
    description:
      'Execute JavaScript or TypeScript in a secure QuickJS WASM sandbox. ' +
      'Full access to the virtual filesystem via the global vfs object (vfs.read, vfs.write, vfs.list, vfs.delete, vfs.exists). ' +
      'Files created with vfs.write() appear instantly in the file manager. ' +
      'Network access (fetch) is available when allow_network: true is passed. ' +
      'CPU timeout: 30 s (sync) / 120 s (with network). No DOM, no Node.js APIs.',
    icon: Zap,
    tools: ['execute_js'],
    /**
     * Tests prompts (french):
     * ```markdown
     * 1. Écris un fichier "test.txt" avec le contenu "Hello, VFS!"
     * 2. Lis le fichier pour vérifier son contenu
     * 3. Liste tous les fichiers du VFS
     * 4. Vérifie que le fichier existe avec vfs.exists()
     * 5. Crée un dossier "subdir" et un fichier "subdir/nested.txt"
     * 6. Supprime le fichier "test.txt"
     * 7. Vérifie que le fichier a été supprimé
     * 
     *  Utilise le sandbox JS/TS pour tester les opérations sur le VFS :
     * ```
     *
     * ```markdown
     * Utilise le sandbox JS/TS avec l'option allow_network: true pour :
     * 
     * 1. Faire une requête GET vers "https://jsonplaceholder.typicode.com/todos/1"
     * 2. Affiche le statut de la réponse
     * 3. Parse et affiche le JSON retourné
     * 4. Gère les erreurs réseau de manière appropriée
     * 
     * Note: Utilise TypeScript et ajoute des logs détaillés.
     * ```
     */
  },
  {
    id: 'search_wikipedia',
    name: 'Wikipedia',
    description: 'Search and extract articles from Wikipedia in various languages using the Wikipedia REST API.',
    icon: BookOpen,
    tools: ['search_wikipedia'],
  },

  /** Test prompt
   * ```markdown
   * 1. Valide ce code TypeScript simple :
   *    ```typescript
   *    function add(a: number, b: number): number {
   *      return a + b;
   *    }
   *    const result = add(2, 3);
   *    console.log(result);
   *    ```
   *
   * 2. Teste la détection d'erreurs de typage :
   *    ```typescript
   *    const name: string = "Alice";
   *    name = 42; // Devrait générer une erreur de type
   *    ```
   *
   * 3. Valide un code avec interface et classe :
   *    ```typescript
   *    interface User {
   *      id: number;
   *      name: string;
   *      email: string;
   *    }
   *
   *    class UserService {
   *      getUser(id: number): User {
   *        return { id, name: "John Doe", email: "john@example.com" };
   *      }
   *    }
   *    ```
   *
   * 4. Teste la compilation avec différentes cibles (ES2015, ES2020)
   *    et différents systèmes de modules (CommonJS, ES2015)
   * ```
   */
  {
    id: 'validate_typescript',
    name: 'TypeScript Validator',
    description: 'Validate TypeScript code compilation using the TypeScript compiler API. Supports various ECMAScript targets and module systems.',
    icon: Search,
    tools: ['validate_typescript'],
  },
  {
    id: 'generate_image',
    name: 'Image Generation',
    description: 'Generate images from text descriptions using Mistral image generation. Requires a Mistral model with outputModalities: image (e.g. mistral-medium-latest).',
    icon: Image,
    tools: ['generate_image'],
    filter: (model, providerId) =>
      providerId === 'mistral' && (model.outputModalities?.includes('image') ?? false),
  },
  /**
   * Test prompt (french):
   * ```markdown
   * Utilise l'outil de création de DOCX pour convertir ce contenu Markdown en document Word :
   * ```markdown
   * # Titre du document
   * ## Section 1
   * Voici un paragraphe avec du **texte en gras**, de l'*italique*, et une [lien](https://example.com).
   * - Liste à puces
   * - Deuxième élément
   *
   * ## Section 2
   * Voici un tableau :
   * | Colonne 1 | Colonne 2 |
   * |------------|------------|
   * | Cellule A1 | Cellule B1 |
   * | Cellule A2 | Cellule B2 |
   * ```
   */
  {
    id: 'create_docx',
    name: 'DOCX Creator',
    description: 'Create DOCX documents from Markdown content. Converts Markdown to Word document format.',
    icon: BookOpen,
    tools: ['create_docx'],
  },
  {
    id: 'pdf_tool',
    name: 'PDF Tools',
    description: 'Generate PDFs from Markdown (headings, lists, tables, code blocks, images, Mermaid diagrams) or extract text from existing PDFs. Note: emoji and non-Latin characters are stripped (Latin/WinAnsi fonts only).',
    icon: BookOpen,
    tools: ['pdf_tool'],
  },
  {
    id: 'create_chart',
    name: 'Chart Creator',
    description: 'Generate charts (bar, line, pie, scatter) from JSON data using simple data to svg',
    icon: BarChart2,
    tools: ['create_chart'],
  },
  {
    id: 'weather',
    name: 'Weather Forecast',
    description:
      'Search locations by name and retrieve weather forecasts using the Meteoblue API. ' +
      'Requires a meteoblue API key in the vault (weatherApi section). ' +
      'Supports combining packages (basic, current, clouds, wind, etc.) in a single request.',
    icon: CloudSun,
    tools: ['search_location', 'get_weather_forecast'],
  },
  {
    id: 'execute_python_code',
    name: 'Python Sandbox',
    description:
      'Execute Python code in a Pyodide WASM sandbox. ' +
      'Supports scientific packages: numpy, pandas, sympy, scipy, etc. ' +
      'VFS read/write access via "import vfs". First load requires ~7 MB download.',
    icon: Terminal,
    tools: ['execute_python_code'],
  },
]
