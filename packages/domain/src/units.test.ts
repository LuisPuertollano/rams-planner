import { describe, expect, it } from 'vitest'
import {
  addCents,
  addWorkMinutes,
  basisPoints,
  calendarDate,
  cents,
  daysInMonth,
  isLeapYear,
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

describe('daysInMonth e isLeapYear', () => {
  it('aplica la regla gregoriana completa, no sólo el múltiplo de 4', () => {
    expect(isLeapYear(2024)).toBe(true)
    expect(isLeapYear(2025)).toBe(false)
    expect(isLeapYear(1900)).toBe(false)
    expect(isLeapYear(2000)).toBe(true)
  })

  it('devuelve los días de cada mes', () => {
    expect(daysInMonth(2026, 1)).toBe(31)
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 4)).toBe(30)
    expect(daysInMonth(2026, 12)).toBe(31)
  })

  it('devuelve 0 para un mes fuera de rango en vez de indefinido', () => {
    expect(daysInMonth(2026, 13)).toBe(0)
  })
})

describe('calendarDate en los años de dos dígitos', () => {
  it('acepta años anteriores a 1900, que Date.UTC reinterpretaría', () => {
    expect(calendarDate('0000-03-01')).toBe('0000-03-01')
    expect(calendarDate('0099-12-31')).toBe('0099-12-31')
  })
})
