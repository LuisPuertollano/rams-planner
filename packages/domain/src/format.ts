/**
 * Borde de presentación (principio P5).
 *
 * **Este es el único módulo del núcleo autorizado a producir decimales.** El
 * motor trabaja siempre con enteros; los decimales sólo aparecen cuando un
 * número va a leerlo una persona.
 */

import { BASIS_POINTS_ONE, MINUTES_PER_HOUR, type BasisPoints, type Cents, type WorkMinutes } from './units.js'

export interface FormatOptions {
  /** Número de decimales. Por defecto 1 para horas, 2 para dinero. */
  readonly decimals?: number
  /** Separador decimal. Por defecto ',' (convención alemana y española). */
  readonly decimalSeparator?: string
}

/** Formatea minutos laborables como horas, p. ej. 8400 -> "140,0". */
export function formatWorkMinutesAsHours(minutes: WorkMinutes, options: FormatOptions = {}): string {
  const decimals = options.decimals ?? 1
  return fixedPoint(minutes, MINUTES_PER_HOUR, decimals, options.decimalSeparator ?? ',')
}

/** Formatea puntos base como porcentaje, p. ej. 10700 -> "107,0". */
export function formatBasisPointsAsPercent(bp: BasisPoints, options: FormatOptions = {}): string {
  const decimals = options.decimals ?? 1
  return fixedPoint(bp, BASIS_POINTS_ONE / 100, decimals, options.decimalSeparator ?? ',')
}

/** Formatea céntimos como unidades monetarias, p. ej. 123456 -> "1234,56". */
export function formatCents(value: Cents, options: FormatOptions = {}): string {
  const decimals = options.decimals ?? 2
  return fixedPoint(value, 100, decimals, options.decimalSeparator ?? ',')
}

/**
 * Divide `value` entre `divisor` y devuelve el resultado con `decimals`
 * decimales, redondeando la mitad hacia arriba en valor absoluto. Todo el
 * cálculo es entero (BigInt) para que el redondeo no dependa de la coma
 * flotante.
 */
function fixedPoint(value: number, divisor: number, decimals: number, separator: string): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) {
    throw new RangeError(`decimals debe ser un entero entre 0 y 9, recibido ${String(decimals)}`)
  }
  const negative = value < 0
  const scale = 10n ** BigInt(decimals)
  const numerator = BigInt(Math.abs(value)) * scale
  const denominator = BigInt(divisor)
  const scaled = (numerator * 2n + denominator) / (denominator * 2n)

  const digits = scaled.toString().padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const fraction = decimals === 0 ? '' : separator + digits.slice(digits.length - decimals)
  return `${negative ? '-' : ''}${whole}${fraction}`
}
