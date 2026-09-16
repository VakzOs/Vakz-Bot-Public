import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'prisma/migrations/**', '*.config.mjs', '*.config.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': 'warn',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Les scripts de maintenance s'exécutent au terminal : leur sortie EST leur
    // interface, le logger structuré du bot n'y a pas sa place.
    files: ['scripts/**/*.{ts,mjs}', 'src/scripts/simulate-*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // En JavaScript pur, `no-undef` est actif — TypeScript le désactive de son
    // côté, ayant mieux à dire sur le sujet. Sans les globales de Node
    // déclarées ici, `console` et `process` passent pour des fautes de frappe
    // et la CI échoue sur un script qui marche.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
);
