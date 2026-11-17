import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', 'dist-server/**', 'node_modules/**', '.npm-cache/**', '.superpowers/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  { files: ['**/*.js'], languageOptions: { sourceType: 'module' } },
  { files: ['e2e/fake-youtube.js'], languageOptions: { globals: { window: 'readonly', document: 'readonly', setTimeout: 'readonly' } } },
);
