import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { applyBasisPoints, distributeInteger } from './integer-math.js'
import { basisPoints, UnitError } from './units.js'

describe('applyBasisPoints', () => {
  it('aplica porcentajes exactos', () => {
    expect(applyBasisPoints(480, basisPoints(10_000))).toBe(480)
    expect(applyBasisPoints(480, basisPoints(5_000))).toBe(240)
    expect(applyBasisPoints(480, basisPoints(0))).toBe(0)
  })

  it('redondea los empates hacia arriba en valor absoluto', () => {
    // 5 × 50 % = 2,5 -> 3 ; -5 × 50 % = -2,5 -> -3
    expect(applyBasisPoints(5, basisPoints(5_000))).toBe(3)
    expect(applyBasisPoints(-5, basisPoints(5_000))).toBe(-3)
  })

  it('rechaza valores no enteros', () => {
    expect(() => applyBasisPoints(1.5, basisPoints(10_000))).toThrow(UnitError)
  })
})

describe('distributeInteger', () => {
  it('reparte proporcionalmente cuando la división es exacta', () => {
    expect(distributeInteger(480, [1, 1, 1, 1])).toEqual([120, 120, 120, 120])
  })

  it('reparte 1000 minutos entre 7 días sin perder ni inventar minutos', () => {
    const result = distributeInteger(1000, [1, 1, 1, 1, 1, 1, 1])
    expect(result.reduce((a, b) => a + b, 0)).toBe(1000)
    // 142 × 7 = 994; los 6 minutos sobrantes van a los 6 primeros días.
    expect(result).toEqual([143, 143, 143, 143, 143, 143, 142])
  })

  it('respeta los pesos', () => {
    expect(distributeInteger(100, [3, 1])).toEqual([75, 25])
  })

  it('desempata por índice ascendente, de forma reproducible', () => {
    const first = distributeInteger(10, [1, 1, 1])
    const second = distributeInteger(10, [1, 1, 1])
    expect(first).toEqual([4, 3, 3])
    expect(second).toEqual(first)
  })

  it('admite pesos fraccionarios', () => {
    expect(distributeInteger(100, [0.5, 0.25, 0.25])).toEqual([50, 25, 25])
  })

  it('reparte cero entre cubos vacíos o sin peso', () => {
    expect(distributeInteger(0, [])).toEqual([])
    expect(distributeInteger(0, [0, 0])).toEqual([0, 0])
  })

  it('rechaza repartos imposibles en vez de inventar un resultado', () => {
    expect(() => distributeInteger(10, [])).toThrow(UnitError)
    expect(() => distributeInteger(10, [0, 0])).toThrow(UnitError)
    expect(() => distributeInteger(-1, [1])).toThrow(UnitError)
    expect(() => distributeInteger(1.5, [1])).toThrow(UnitError)
    expect(() => distributeInteger(10, [-1, 2])).toThrow(UnitError)
    expect(() => distributeInteger(10, [Number.NaN])).toThrow(UnitError)
  })

  it('propiedad: la suma del reparto es siempre el total (P5)', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }),
        fc.array(fc.nat({ max: 1000 }), { minLength: 1, maxLength: 60 }),
        (total, weights) => {
          const hasWeight = weights.some((weight) => weight > 0)
          if (!hasWeight && total > 0) return true
          const result = distributeInteger(total, weights)
          return result.reduce((a, b) => a + b, 0) === total
        },
      ),
      { numRuns: 500 },
    )
  })

  it('propiedad: ningún cubo recibe más que el total ni menos que cero', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 100_000 }),
        fc.array(fc.nat({ max: 100 }), { minLength: 1, maxLength: 30 }),
        (total, weights) => {
          if (!weights.some((weight) => weight > 0)) return true
          return distributeInteger(total, weights).every((value) => value >= 0 && value <= total)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('propiedad: un cubo con peso cero nunca recibe nada', () => {
    fc.assert(
      fc.property(fc.nat({ max: 10_000 }), fc.array(fc.nat({ max: 50 }), { minLength: 1, maxLength: 20 }), (total, weights) => {
        const padded = [0, ...weights, 0]
        if (!padded.some((weight) => weight > 0)) return true
        const result = distributeInteger(total, padded)
        return result[0] === 0 && result[result.length - 1] === 0
      }),
      { numRuns: 300 },
    )
  })
})
