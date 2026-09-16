import { describe, expect, it } from 'vitest'
import {
  addCents,
  addWorkMinutes,
  basisPoints,
  calendarDate,
  cents,
  UnitError,
  workMinutes,
} from './units.js'

describe('workMinutes', () => {
  it('acepta enteros no negativos', () => {
    expect(workMinutes(0)).toBe(0)
    expect(workMinutes(480)).toBe(480)
  })

  it('rechaza decimales, porque el núcleo no usa horas decimales (P5)', () => {
    expect(() => workMinutes(7.5)).toThrow(UnitError)
  })

  it('rechaza valores negativos', () => {
    expect(() => workMinutes(-1)).toThrow(UnitError)
  })

  it('rechaza NaN e infinitos', () => {
    expect(() => workMinutes(Number.NaN)).toThrow(UnitError)
    expect(() => workMinutes(Number.POSITIVE_INFINITY)).toThrow(UnitError)
  })
})

describe('basisPoints', () => {
  it('acepta 0, 10000 y valores por encima del 100 %', () => {
    expect(basisPoints(0)).toBe(0)
    expect(basisPoints(10_000)).toBe(10_000)
    expect(basisPoints(20_000)).toBe(20_000)
  })

  it('rechaza decimales y negativos', () => {
    expect(() => basisPoints(33.33)).toThrow(UnitError)
    expect(() => basisPoints(-1)).toThrow(UnitError)
  })
})

describe('cents', () => {
  it('admite negativos porque existen los ajustes', () => {
    expect(cents(-2500)).toBe(-2500)
  })

  it('rechaza decimales', () => {
    expect(() => cents(10.5)).toThrow(UnitError)
  })
})

describe('calendarDate', () => {
  it('acepta fechas válidas', () => {
    expect(calendarDate('2026-03-14')).toBe('2026-03-14')
    expect(calendarDate('2028-02-29')).toBe('2028-02-29')
  })

  it('rechaza formatos que no son YYYY-MM-DD', () => {
    expect(() => calendarDate('14/03/2026')).toThrow(UnitError)
    expect(() => calendarDate('2026-3-14')).toThrow(UnitError)
  })

  it('rechaza fechas que no existen', () => {
    expect(() => calendarDate('2026-02-30')).toThrow(UnitError)
    expect(() => calendarDate('2026-13-01')).toThrow(UnitError)
    expect(() => calendarDate('2027-02-29')).toThrow(UnitError)
  })
})

describe('sumas tipadas', () => {
  it('suma minutos y céntimos manteniendo la validación', () => {
    expect(addWorkMinutes(workMinutes(480), workMinutes(120))).toBe(600)
    expect(addCents(cents(1000), cents(-250))).toBe(750)
  })

  it('una suma que se sale del rango entero seguro falla al sumarse, no después', () => {
    expect(() => addCents(cents(Number.MAX_SAFE_INTEGER), cents(1))).toThrow(UnitError)
  })
})
