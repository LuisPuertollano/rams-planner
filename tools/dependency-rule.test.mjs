import { describe, expect, it } from 'vitest'
import { checkDependencyRule, extractImports, layerOf } from './dependency-rule.mjs'

const pkg = (overrides) => ({ dir: 'domain', name: '@planner/domain', dependencies: [], imports: [], ...overrides })

describe('layerOf', () => {
  it('clasifica núcleo, adaptadores y desconocidos', () => {
    expect(layerOf('scheduler')).toBe('core')
    expect(layerOf('api')).toBe('adapter')
    expect(layerOf('cosas-varias')).toBe('unknown')
  })
})

describe('checkDependencyRule', () => {
  it('acepta un núcleo que sólo depende del núcleo', () => {
    const violations = checkDependencyRule([
      pkg({ dir: 'scheduler', dependencies: ['@planner/domain', '@planner/calendar'], imports: ['@planner/domain'] }),
    ])
    expect(violations).toEqual([])
  })

  it('acepta que un adaptador dependa de lo que quiera', () => {
    const violations = checkDependencyRule([
      pkg({ dir: 'api', dependencies: ['@planner/scheduler', 'fastify'], imports: ['node:crypto'] }),
    ])
    expect(violations).toEqual([])
  })

  it('rechaza que el núcleo declare una dependencia de un adaptador', () => {
    const violations = checkDependencyRule([pkg({ dir: 'workload', dependencies: ['@planner/persistence'] })])
    expect(violations).toHaveLength(1)
    expect(violations[0].kind).toBe('core-depends-on-adapter')
  })

  it('rechaza que el núcleo importe un módulo de Node', () => {
    const builtins = checkDependencyRule([pkg({ imports: ['node:fs'] })])
    const bare = checkDependencyRule([pkg({ imports: ['path'] })])
    expect(builtins[0].kind).toBe('core-imports-node-builtin')
    expect(bare[0].kind).toBe('core-imports-node-builtin')
  })

  it('rechaza que el núcleo importe un adaptador', () => {
    const violations = checkDependencyRule([pkg({ imports: ['@planner/persistence/dist/repo.js'] })])
    expect(violations[0].kind).toBe('core-imports-adapter')
  })

  it('avisa de un paquete sin capa declarada en vez de ignorarlo', () => {
    const violations = checkDependencyRule([pkg({ dir: 'utilidades' })])
    expect(violations[0].kind).toBe('unknown-layer')
  })

  it('no confunde una dependencia externa con un paquete del workspace', () => {
    expect(checkDependencyRule([pkg({ dependencies: ['zod'], imports: ['fast-check'] })])).toEqual([])
  })
})

describe('extractImports', () => {
  it('encuentra imports y reexports', () => {
    const source = [
      "import { a } from './a.js'",
      "import type { B } from '@planner/domain'",
      "export * from './c.js'",
      "export { d } from 'node:fs'",
      "const noEsImport = 'from \"trampa\"'",
    ].join('\n')
    expect(extractImports(source)).toEqual(['./a.js', '@planner/domain', './c.js', 'node:fs'])
  })

  it('devuelve vacío cuando no hay imports', () => {
    expect(extractImports('export const x = 1\n')).toEqual([])
  })
})
