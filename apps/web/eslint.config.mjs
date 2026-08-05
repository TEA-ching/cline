import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // On ignore le dossier de build
    ignores: ['dist', 'node_modules'],
  },
  {
    // On applique cette config aux fichiers TypeScript et React
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // Intégration des règles recommandées pour les hooks
      ...reactHooks.configs.recommended.rules,
      // Configuration de react-refresh pour Vite
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Vous pouvez ajouter d'autres règles personnalisées ici
    },
  },
);
