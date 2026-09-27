import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'data/**'],
  },
  {
    // Plain Node scripts and config files: not covered by the TS parser, so
    // no-undef needs Node's globals spelled out explicitly.
    files: ['scripts/**/*.mjs', '*.js', '*.mjs', '**/vitest.config.ts', '**/vitest.setup.ts'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
);
