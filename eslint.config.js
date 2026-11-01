import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

const noDirectDate = [
  'error',
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'Use clock.now() from server/src/lib/time.js (FND-13).',
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'Use clock.now() from server/src/lib/time.js (FND-13).',
  },
];

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/dev-dist/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] },
  },
  {
    files: ['server/src/**/*.js'],
    ignores: ['server/src/lib/time.js', '**/__tests__/**'],
    rules: { 'no-restricted-syntax': noDirectDate },
  },
  {
    files: ['client/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: '19' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
  {
    files: ['**/*.test.{js,jsx}', '**/test/**', '**/__tests__/**', '**/e2e/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
