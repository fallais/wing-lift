import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  { ignores: ['dist/'] },
  js.configs.recommended,
  { languageOptions: { globals: globals.browser } },
  { files: ['src/particles.worker.js'], languageOptions: { globals: globals.worker } },
  { files: ['*.config.js'], languageOptions: { globals: globals.node } },
  prettier,
];
