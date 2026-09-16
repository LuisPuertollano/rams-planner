/**
 * Aritmética de fechas de calendario, sin `Date` y sin zonas horarias.
 *
 * El motor razona en **hora local del calendario**, no en instantes UTC: «el
 * lunes a las 8:00» significa lo mismo en marzo y en noviembre aunque cambie el
 * horario de verano. La conversión a `TIMESTAMPTZ` ocurre en el borde de
 * persistencia, nunca aquí.
 *
 * Las conversiones usan el algoritmo civil de Howard Hinnant, que es aritmética
 * entera pura y vale para cualquier año proléptico gregoriano.
 */

import { calendarDate, UnitError, type CalendarDate } from './units.js'

/** Día de la semana ISO-8601: 1 = lunes … 7 = domingo. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** Días transcurridos desde 1970-01-01 (negativo para fechas anteriores). */
export function toEpochDay(date: CalendarDate): number {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const day = Number(date.slice(8, 10))

  const shiftedYear = month <= 2 ? year - 1 : year
  const era = Math.floor(shiftedYear / 400)
  const yearOfEra = shiftedYear - era * 400
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear

  return era * 146_097 + dayOfEra - 719_468
}

/** Inversa de `toEpochDay`. */
export function fromEpochDay(epochDay: number): CalendarDate {
  if (!Number.isSafeInteger(epochDay)) {
    throw new UnitError(`fromEpochDay espera un entero seguro, recibido ${String(epochDay)}`)
  }
  const shifted = epochDay + 719_468
  const era = Math.floor(shifted / 146_097)
  const dayOfEra = shifted - era * 146_097
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36_524) - Math.floor(dayOfEra / 146_096)) / 365,
  )
  const year = yearOfEra + era * 400
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100))
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153)
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1
  const month = monthPrime + (monthPrime < 10 ? 3 : -9)

  return calendarDate(
    `${pad(month <= 2 ? year + 1 : year, 4)}-${pad(month, 2)}-${pad(day, 2)}`,
  )
}

/** Día de la semana ISO de una fecha. 1970-01-01 fue jueves. */
export function isoWeekday(date: CalendarDate): Weekday {
  const shifted = (((toEpochDay(date) + 3) % 7) + 7) % 7
  return (shifted + 1) as Weekday
}

/** Desplaza una fecha un número entero de días naturales (puede ser negativo). */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  if (!Number.isSafeInteger(days)) {
    throw new UnitError(`addDays espera un entero seguro, recibido ${String(days)}`)
  }
  return fromEpochDay(toEpochDay(date) + days)
}

/** Días naturales de `from` a `to`. Negativo si `to` es anterior. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return toEpochDay(to) - toEpochDay(from)
}

/** Compara dos fechas: -1, 0 o 1. Las cadenas 'YYYY-MM-DD' ya ordenan bien. */
export function compareDates(left: CalendarDate, right: CalendarDate): -1 | 0 | 1 {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}
