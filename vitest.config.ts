import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const packageSource = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))

export default defineConfig({
  resolve: {
    // Los tests resuelven los paquetes del monorepo a su fuente, no a dist:
    // así el bucle de desarrollo no depende de haber compilado antes.
    alias: {
      '@planner/domain': packageSource('domain'),
      '@planner/calendar': packageSource('calendar'),
      '@planner/explain': packageSource('explain'),
      '@planner/scheduler': packageSource('scheduler'),
      '@planner/workload': packageSource('workload'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'tools/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', '**/types.ts', '**/plan.ts', '**/__fixtures__/**'],
      reporter: ['text', 'lcov'],
      // Umbrales por paquete, no uno global: la aritmética de calendario y de
      // unidades es donde viven los casos límite y se exige el 95 % de ramas que
      // pide la puerta de la fase 1. El motor y la carga tienen muchas guardas
      // defensivas (`?? []`) que inflan el denominador sin aportar riesgo.
      //
      // Son un TRINQUETE: sólo suben. Si un cambio baja uno, se añaden tests, no
      // se baja el número.
      thresholds: {
        'packages/domain/src/**': { branches: 95, functions: 95, lines: 95, statements: 95 },
        'packages/calendar/src/**': { branches: 95, functions: 95, lines: 95, statements: 95 },
        'packages/scheduler/src/**': { branches: 80, functions: 90, lines: 90, statements: 90 },
        'packages/workload/src/**': { branches: 75, functions: 95, lines: 90, statements: 90 },
      },
    },
  },
})
