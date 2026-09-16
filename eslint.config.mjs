import js from '@eslint/js'
import tseslint from 'typescript-eslint'

const NODE_GLOBALS = { console: 'readonly', process: 'readonly', URL: 'readonly' }

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/.turbo/**'] },

  js.configs.recommended,

  // Scripts de herramientas: Node puro, sin reglas que necesiten tipos.
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: NODE_GLOBALS },
  },

  // TypeScript, con reglas que usan el compilador.
  ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: ['**/*.ts'] })),
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // P5: `any` esconde exactamente los errores de unidad que los tipos
      // nominales existen para evitar.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='eval']",
          message: 'Prohibido eval: las expresiones se evalúan con el intérprete acotado de @planner/rules.',
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: 'Prohibido new Function: las expresiones se evalúan con el intérprete acotado de @planner/rules.',
        },
      ],
    },
  },

  // El núcleo es puro (P2): sin I/O, sin reloj, sin aleatoriedad.
  {
    files: ['packages/{domain,calendar,scheduler,workload,explain,rules}/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'El núcleo no hace I/O (P2).' },
        { name: 'process', message: 'El núcleo no lee el entorno (P2).' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'El núcleo es determinista: el tiempo entra por el snapshot (P2).' },
        { object: 'Math', property: 'random', message: 'El núcleo es determinista (P2).' },
      ],
    },
  },
)
