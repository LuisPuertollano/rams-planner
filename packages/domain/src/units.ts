/**
 * Unidades del sistema (principio P5: aritmética entera).
 *
 * Los tipos son nominales: el compilador impide sumar minutos a puntos base o
 * pasar céntimos donde se esperan minutos. Son `number` en tiempo de ejecución,
 * así que no cuestan nada.
 */

declare const unitBrand: unique symbol

type Unit<T, TName extends string> = T & { readonly [unitBrand]: TName }

/** Minutos laborables. Entero no negativo. NUNCA horas decimales. */
export type WorkMinutes = Unit<number, 'WorkMinutes'>

/** Puntos base. 10000 = 100,00 %. Entero no negativo (puede exceder 10000). */
export type BasisPoints = Unit<number, 'BasisPoints'>

/** Céntimos de la moneda. Entero, puede ser negativo (ajustes). */
export type Cents = Unit<number, 'Cents'>

/** Fecha de calendario 'YYYY-MM-DD', sin zona horaria. */
export type CalendarDate = Unit<string, 'CalendarDate'>

export const MINUTES_PER_HOUR = 60
export const MINUTES_PER_DAY = 1440
export const BASIS_POINTS_ONE = 10_000

/** Error de unidad. Se lanza en el borde, nunca dentro de un bucle de cálculo. */
export class UnitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnitError'
  }
}

const isSafeInteger = (value: number): boolean => Number.isSafeInteger(value)

/** Construye minutos laborables validando que sea un entero no negativo. */
export function workMinutes(value: number): WorkMinutes {
  if (!isSafeInteger(value)) {
    throw new UnitError(`WorkMinutes debe ser un entero seguro, recibido ${String(value)}`)
  }
  if (value < 0) {
    throw new UnitError(`WorkMinutes no puede ser negativo, recibido ${String(value)}`)
  }
  return value as WorkMinutes
}

/** Construye puntos base validando que sea un entero no negativo. */
export function basisPoints(value: number): BasisPoints {
  if (!isSafeInteger(value)) {
    throw new UnitError(`BasisPoints debe ser un entero seguro, recibido ${String(value)}`)
  }
  if (value < 0) {
    throw new UnitError(`BasisPoints no puede ser negativo, recibido ${String(value)}`)
  }
  return value as BasisPoints
}

/** Construye céntimos validando que sea un entero (el signo sí se permite). */
export function cents(value: number): Cents {
  if (!isSafeInteger(value)) {
    throw new UnitError(`Cents debe ser un entero seguro, recibido ${String(value)}`)
  }
  return value as Cents
}

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Construye una fecha de calendario validando el formato y que la fecha exista
 * de verdad (rechaza 2026-02-30). No hay zona horaria en juego.
 */
export function calendarDate(value: string): CalendarDate {
  const match = CALENDAR_DATE_PATTERN.exec(value)
  if (match === null) {
    throw new UnitError(`CalendarDate debe tener formato YYYY-MM-DD, recibido "${value}"`)
  }
  const [, yearText, monthText, dayText] = match
  // El patrón garantiza los tres grupos; noUncheckedIndexedAccess no lo sabe.
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const asUtc = new Date(Date.UTC(year, month - 1, day))
  const roundTrips =
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() === month - 1 &&
    asUtc.getUTCDate() === day
  if (!roundTrips) {
    throw new UnitError(`CalendarDate "${value}" no es una fecha existente`)
  }
  return value as CalendarDate
}

/** Suma de minutos laborables, manteniendo el tipo y la validación. */
export function addWorkMinutes(left: WorkMinutes, right: WorkMinutes): WorkMinutes {
  return workMinutes(left + right)
}

/** Suma de céntimos, manteniendo el tipo y la validación. */
export function addCents(left: Cents, right: Cents): Cents {
  return cents(left + right)
}
