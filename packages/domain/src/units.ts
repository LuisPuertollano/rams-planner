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
  // Validación aritmética, sin `Date`: Date.UTC reinterpreta los años 0-99 como
  // 1900+año, que es justo el rango donde una fecha válida se rechazaría.
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new UnitError(`CalendarDate "${value}" no es una fecha existente`)
  }
  return value as CalendarDate
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

/** Año bisiesto en el calendario gregoriano proléptico. */
export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

/** Días que tiene un mes (1-12) de un año concreto. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return DAYS_IN_MONTH[month - 1] ?? 0
}

/** Suma de minutos laborables, manteniendo el tipo y la validación. */
export function addWorkMinutes(left: WorkMinutes, right: WorkMinutes): WorkMinutes {
  return workMinutes(left + right)
}

/** Suma de céntimos, manteniendo el tipo y la validación. */
export function addCents(left: Cents, right: Cents): Cents {
  return cents(left + right)
}

/**
 * Cuánto de una demanda hay que servir de verdad.
 *
 * No es el tipo de trabajo —I+D, sostenimiento, cliente— sino la **confianza**
 * en que llegue. Son dos ejes distintos y mezclarlos es lo que convierte una
 * lista de tipos de proyecto en una lista que ya no sirve para sumar.
 *
 * Sumar las horas de una oferta a las de un contrato firmado y llamar plan al
 * total es la forma más rápida de que el plan no sirva para decidir: son la
 * misma unidad y no son la misma obligación.
 */
export const COMMITMENT_LEVELS = ['firme', 'probable', 'posible'] as const

export type CommitmentLevel = (typeof COMMITMENT_LEVELS)[number]

/**
 * Qué se hace con un proyecto.
 *
 * `inactivo` y `archivado` salen los dos del cálculo, y la diferencia es de
 * intención y no de motor: «va a volver» y «se acabó» son dos cosas distintas
 * para quien mira la lista, aunque el planificador las trate igual. Por eso son
 * dos estados y no un booleano.
 */
export const PROJECT_STATUSES = ['activo', 'inactivo', 'archivado'] as const

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/**
 * Desde dónde se planifica un proyecto.
 *
 * `adelante` empuja desde el arranque: cada tarea a su fecha más temprana. Es
 * lo que hace casi todo planificador y responde a «¿cuándo termina esto si
 * empiezo ya?».
 *
 * `atras` ancla en las puertas de certificación y va hacia atrás. Responde a
 * «¿cuándo tengo que empezar para llegar?», que en un proyecto RAMS es la
 * pregunta de verdad: la fecha de la revisión de diseño no la mueve nadie.
 *
 * Son dos modos y no dos herramientas porque conviven en la misma cartera: una
 * oferta se planifica hacia delante para saber qué se promete, y un proyecto en
 * marcha hacia atrás para saber si su puerta sigue siendo alcanzable.
 */
export const SCHEDULE_MODES = ['adelante', 'atras'] as const

export type ScheduleMode = (typeof SCHEDULE_MODES)[number]

