import { describe, expect, it } from 'vitest'
import { formatBasisPointsAsPercent, formatCents, formatWorkMinutesAsHours } from './format.js'
import { basisPoints, cents, workMinutes } from './units.js'

describe('formatWorkMinutesAsHours', () => {
  it('convierte minutos en horas con un decimal por defecto', () => {
    expect(formatWorkMinutesAsHours(workMinutes(8400))).toBe('140,0')
    expect(formatWorkMinutesAsHours(workMinutes(450))).toBe('7,5')
  })

  it('admite otro número de decimales y otro separador', () => {
    expect(formatWorkMinutesAsHours(workMinutes(450), { decimals: 0 })).toBe('8')
    expect(formatWorkMinutesAsHours(workMinutes(450), { decimals: 2, decimalSeparator: '.' })).toBe('7.50')
  })

  it('redondea los empates hacia arriba', () => {
    // 7,25 h con 1 decimal -> 7,3
    expect(formatWorkMinutesAsHours(workMinutes(435))).toBe('7,3')
  })

  it('rellena con ceros cuando la parte entera es cero', () => {
    expect(formatWorkMinutesAsHours(workMinutes(3), { decimals: 2 })).toBe('0,05')
  })
})

describe('formatBasisPointsAsPercent', () => {
  it('convierte puntos base en porcentaje', () => {
    expect(formatBasisPointsAsPercent(basisPoints(10_700))).toBe('107,0')
    expect(formatBasisPointsAsPercent(basisPoints(3_333), { decimals: 2 })).toBe('33,33')
    expect(formatBasisPointsAsPercent(basisPoints(3_333), { decimals: 2, decimalSeparator: '.' })).toBe('33.33')
  })
})

describe('formatCents', () => {
  it('convierte céntimos en unidades monetarias', () => {
    expect(formatCents(cents(123_456))).toBe('1234,56')
    expect(formatCents(cents(123_456), { decimalSeparator: '.' })).toBe('1234.56')
  })

  it('conserva el signo de los importes negativos', () => {
    expect(formatCents(cents(-2_500))).toBe('-25,00')
  })

  it('rechaza un número de decimales absurdo', () => {
    expect(() => formatCents(cents(100), { decimals: 12 })).toThrow(RangeError)
    expect(() => formatCents(cents(100), { decimals: -1 })).toThrow(RangeError)
    expect(() => formatCents(cents(100), { decimals: 1.5 })).toThrow(RangeError)
  })
})
