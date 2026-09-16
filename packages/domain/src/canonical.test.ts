import { describe, expect, it } from 'vitest'
import { canonicalize, CanonicalizationError, type JsonValue } from './canonical.js'

describe('canonicalize', () => {
  it('serializa los primitivos', () => {
    expect(canonicalize(null)).toBe('null')
    expect(canonicalize(true)).toBe('true')
    expect(canonicalize(false)).toBe('false')
    expect(canonicalize(42)).toBe('42')
    expect(canonicalize('hola "mundo"')).toBe('"hola \\"mundo\\""')
  })

  it('ordena las claves, de modo que el orden de construcción no cambia el hash (P3)', () => {
    const built = canonicalize({ b: 1, a: 2 })
    const other = canonicalize({ a: 2, b: 1 })
    expect(built).toBe('{"a":2,"b":1}')
    expect(built).toBe(other)
  })

  it('conserva el orden de los arrays, que sí es significativo', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]')
  })

  it('normaliza -0 a 0', () => {
    expect(canonicalize(-0)).toBe('0')
  })

  it('anida objetos y arrays sin espacios', () => {
    const value: JsonValue = { z: [{ y: 1, x: 2 }], a: null }
    expect(canonicalize(value)).toBe('{"a":null,"z":[{"x":2,"y":1}]}')
  })

  it('rechaza lo que no se puede serializar de forma determinista', () => {
    expect(() => canonicalize(Number.NaN)).toThrow(CanonicalizationError)
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(CanonicalizationError)
    expect(() => canonicalize({ a: undefined } as unknown as JsonValue)).toThrow(CanonicalizationError)
    expect(() => canonicalize(10n as unknown as JsonValue)).toThrow(CanonicalizationError)
  })

  it('nombra la ruta del valor problemático, incluida la raíz', () => {
    expect(() => canonicalize(Number.NaN)).toThrow(/<raíz>/)
    expect(() => canonicalize({ plan: { tasks: [Number.NaN] } })).toThrow(/plan\.tasks\.0/)
  })
})
