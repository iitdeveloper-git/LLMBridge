import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['dist', 'out', 'node_modules', '.vscode-test', '*.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrors: 'none' }], 'no-restricted-syntax': ['error',
      { selector: "Identifier[name='rejectUnauthorized']", message: 'Never disable TLS verification.' }] } },
);
