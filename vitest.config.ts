import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'tools/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', '**/types.ts', '**/__fixtures__/**'],
      reporter: ['text', 'lcov'],
      // El núcleo se mide por ramas, no por líneas: las ramas son donde
      // viven los casos límite de calendario y redondeo.
      thresholds: { branches: 95, functions: 95, lines: 95, statements: 95 },
    },
  },
})
