/**
 * Las tres primitivas sobre las que se apoya todo el motor.
 *
 * Todo se mide en **minutos laborables**: sumar «3 días» significa sumar los
 * minutos laborables de tres días según un calendario concreto. Gracias a la
 * suma acumulada del calendario compilado, las tres son O(log n).
 *
 * Dos convenciones, que son las que hacen que el resto encaje:
 *
 * - `addWorkingMinutes` devuelve el instante **más temprano** con esa cantidad
 *   de trabajo por delante. Al caer justo en el final de un intervalo devuelve
 *   ese final, no el principio del siguiente: es una fecha de **fin**.
 * - `subtractWorkingMinutes` devuelve el **más tardío**. Al caer en un límite
 *   devuelve el principio del intervalo siguiente: es una fecha de **inicio**.
 *
 * Sumar cero **no** ajusta al horario laboral. Ajustar es una operación aparte
 * y explícita (`snapToWorkingTime`), para que no haya desplazamientos sorpresa.
 */

import { workMinutes, addDays, daysBetween, type CalendarDate, type WorkMinutes } from '@planner/domain'
import { CalendarError } from './errors.js'
import type { CompiledCalendar, PlanInstant, SnapDirection } from './types.js'

const MINUTES_PER_DAY = 1440

/**
 * Lectura con comprobación de límites sobre un índice denso.
 * @internal — expuesto sólo para poder probar el caso imposible.
 */
export function denseAt(array: Int32Array | readonly unknown[], index: number): number {
  const value = (array as { [key: number]: unknown })[index]
  if (typeof value !== 'number') {
    throw new CalendarError('INTERNAL', `Índice ${String(index)} fuera del calendario compilado`)
  }
  return value
}

/** Construye un instante en hora local del calendario. Admite 1440 y lo normaliza. */
export function planInstant(date: CalendarDate, minuteOfDay: number): PlanInstant {
  if (!Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay > MINUTES_PER_DAY) {
    throw new CalendarError(
      'INVALID_INSTANT',
      `minuteOfDay debe ser un entero entre 0 y 1440, recibido ${String(minuteOfDay)}`,
    )
  }
  if (minuteOfDay === MINUTES_PER_DAY) {
    return { date: addDays(date, 1), minuteOfDay: 0 }
  }
  return { date, minuteOfDay }
}

/** Minutos desde el inicio del horizonte. Falla si el instante se sale. */
export function toAbsoluteMinute(instant: PlanInstant, calendar: CompiledCalendar): number {
  const normalized = planInstant(instant.date, instant.minuteOfDay)
  const dayIndex = daysBetween(calendar.horizon.from, normalized.date)
  const absolute = dayIndex * MINUTES_PER_DAY + normalized.minuteOfDay
  const limit = calendar.dayCount * MINUTES_PER_DAY
  if (absolute < 0 || absolute > limit) {
    throw new CalendarError(
      'OUT_OF_HORIZON',
      `${normalized.date} queda fuera del horizonte ${calendar.horizon.from}..${calendar.horizon.to}`,
    )
  }
  return absolute
}

/** Inversa de `toAbsoluteMinute`. */
export function fromAbsoluteMinute(absolute: number, calendar: CompiledCalendar): PlanInstant {
  const dayIndex = Math.floor(absolute / MINUTES_PER_DAY)
  return planInstant(addDays(calendar.horizon.from, dayIndex), absolute % MINUTES_PER_DAY)
}

/** Minutos laborables acumulados desde el inicio del horizonte hasta `absolute`. */
function workingMinutesBefore(absolute: number, calendar: CompiledCalendar): number {
  const dayIndex = Math.floor(absolute / MINUTES_PER_DAY)
  if (dayIndex >= calendar.dayCount) {
    return denseAt(calendar.prefixSum, calendar.dayCount)
  }
  const minuteOfDay = absolute % MINUTES_PER_DAY
  let inDay = 0
  for (const slot of calendar.daySlots[dayIndex] ?? []) {
    if (minuteOfDay <= slot.startMinute) break
    inDay += Math.min(minuteOfDay, slot.endMinute) - slot.startMinute
  }
  return denseAt(calendar.prefixSum, dayIndex) + inDay
}

/** Instante más temprano que deja exactamente `target` minutos laborables detrás. */
function earliestWith(target: number, calendar: CompiledCalendar): number {
  if (target <= 0) return 0
  const total = denseAt(calendar.prefixSum, calendar.dayCount)
  if (target > total) {
    throw new CalendarError(
      'OUT_OF_HORIZON',
      `El horizonte sólo tiene ${String(total)} minutos laborables y se piden ${String(target)}. ` +
        'Amplía el horizonte del cálculo.',
    )
  }
  const dayIndex = firstDayWhere(calendar, (sum) => sum >= target)
  return positionInDay(calendar, dayIndex, target, false)
}

/** Instante más tardío que deja exactamente `target` minutos laborables detrás. */
function latestWith(target: number, calendar: CompiledCalendar): number {
  const total = denseAt(calendar.prefixSum, calendar.dayCount)
  if (target < 0) {
    throw new CalendarError(
      'OUT_OF_HORIZON',
      'El cálculo se sale del horizonte por el principio. Amplía el horizonte.',
    )
  }
  if (target > total) {
    throw new CalendarError(
      'OUT_OF_HORIZON',
      `El horizonte sólo tiene ${String(total)} minutos laborables y se piden ${String(target)}.`,
    )
  }
  if (target === total) return calendar.dayCount * MINUTES_PER_DAY
  const dayIndex = firstDayWhere(calendar, (sum) => sum > target)
  return positionInDay(calendar, dayIndex, target, true)
}

/** Menor `d` tal que `prefixSum[d + 1]` cumple el predicado. Búsqueda binaria. */
function firstDayWhere(calendar: CompiledCalendar, predicate: (sum: number) => boolean): number {
  let low = 0
  let high = calendar.dayCount - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (predicate(denseAt(calendar.prefixSum, middle + 1))) high = middle
    else low = middle + 1
  }
  return low
}

function positionInDay(
  calendar: CompiledCalendar,
  dayIndex: number,
  target: number,
  strict: boolean,
): number {
  let remaining = target - denseAt(calendar.prefixSum, dayIndex)
  for (const slot of calendar.daySlots[dayIndex] ?? []) {
    const length = slot.endMinute - slot.startMinute
    if (strict ? remaining < length : remaining <= length) {
      return dayIndex * MINUTES_PER_DAY + slot.startMinute + remaining
    }
    remaining -= length
  }
  throw new CalendarError('INTERNAL', `No se pudo situar el minuto ${String(target)} en el día ${String(dayIndex)}`)
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/** Minutos laborables entre dos instantes. `from` no puede ser posterior a `to`. */
export function workingMinutesBetween(
  from: PlanInstant,
  to: PlanInstant,
  calendar: CompiledCalendar,
): WorkMinutes {
  const fromAbsolute = toAbsoluteMinute(from, calendar)
  const toAbsolute = toAbsoluteMinute(to, calendar)
  if (toAbsolute < fromAbsolute) {
    throw new CalendarError(
      'NEGATIVE_DURATION',
      `workingMinutesBetween necesita los instantes ordenados: ${from.date} es posterior a ${to.date}`,
    )
  }
  return workMinutes(workingMinutesBefore(toAbsolute, calendar) - workingMinutesBefore(fromAbsolute, calendar))
}

/** Avanza `minutes` minutos laborables. Devuelve una fecha de **fin**. */
export function addWorkingMinutes(
  from: PlanInstant,
  minutes: number,
  calendar: CompiledCalendar,
): PlanInstant {
  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new CalendarError(
      'NEGATIVE_DURATION',
      `addWorkingMinutes espera un entero no negativo, recibido ${String(minutes)}. Usa subtractWorkingMinutes.`,
    )
  }
  const fromAbsolute = toAbsoluteMinute(from, calendar)
  if (minutes === 0) return fromAbsoluteMinute(fromAbsolute, calendar)
  return fromAbsoluteMinute(earliestWith(workingMinutesBefore(fromAbsolute, calendar) + minutes, calendar), calendar)
}

/** Retrocede `minutes` minutos laborables. Devuelve una fecha de **inicio**. */
export function subtractWorkingMinutes(
  from: PlanInstant,
  minutes: number,
  calendar: CompiledCalendar,
): PlanInstant {
  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new CalendarError(
      'NEGATIVE_DURATION',
      `subtractWorkingMinutes espera un entero no negativo, recibido ${String(minutes)}`,
    )
  }
  const fromAbsolute = toAbsoluteMinute(from, calendar)
  if (minutes === 0) return fromAbsoluteMinute(fromAbsolute, calendar)
  return fromAbsoluteMinute(latestWith(workingMinutesBefore(fromAbsolute, calendar) - minutes, calendar), calendar)
}

/**
 * Como `addWorkingMinutes`, pero si el trabajo no cabe en el horizonte devuelve
 * su último instante en vez de fallar.
 *
 * El motor la usa donde un desbordamiento no es un error sino un candidato que
 * va a perder una comparación (un desfase negativo enorme, un enlace SF).
 */
export function addWorkingMinutesClamped(
  from: PlanInstant,
  minutes: number,
  calendar: CompiledCalendar,
): PlanInstant {
  const total = denseAt(calendar.prefixSum, calendar.dayCount)
  const target = workingMinutesBefore(toAbsoluteMinute(from, calendar), calendar) + minutes
  if (target >= total) return fromAbsoluteMinute(calendar.dayCount * MINUTES_PER_DAY, calendar)
  return addWorkingMinutes(from, minutes, calendar)
}

/**
 * Como `subtractWorkingMinutes`, pero si se sale del horizonte por el principio
 * devuelve su primer instante en vez de fallar.
 */
export function subtractWorkingMinutesClamped(
  from: PlanInstant,
  minutes: number,
  calendar: CompiledCalendar,
): PlanInstant {
  const target = workingMinutesBefore(toAbsoluteMinute(from, calendar), calendar) - minutes
  if (target <= 0) return fromAbsoluteMinute(0, calendar)
  return subtractWorkingMinutes(from, minutes, calendar)
}

/**
 * Lleva un instante al horario laboral.
 *
 * `forward` devuelve el principio del siguiente minuto laborable; `backward`,
 * el final del último. Si el instante ya es laborable, no se mueve.
 */
export function snapToWorkingTime(
  instant: PlanInstant,
  calendar: CompiledCalendar,
  direction: SnapDirection,
): PlanInstant {
  const absolute = toAbsoluteMinute(instant, calendar)
  const before = workingMinutesBefore(absolute, calendar)
  const snapped = direction === 'forward' ? latestWith(before, calendar) : earliestWith(before, calendar)
  return fromAbsoluteMinute(snapped, calendar)
}

/** ¿El minuto que empieza en este instante es laborable? */
export function isWorkingTime(instant: PlanInstant, calendar: CompiledCalendar): boolean {
  const absolute = toAbsoluteMinute(instant, calendar)
  if (absolute >= calendar.dayCount * MINUTES_PER_DAY) return false
  return workingMinutesBefore(absolute + 1, calendar) > workingMinutesBefore(absolute, calendar)
}

/** Minutos laborables de un día concreto. */
export function workingMinutesOnDay(date: CalendarDate, calendar: CompiledCalendar): WorkMinutes {
  const dayIndex = daysBetween(calendar.horizon.from, date)
  if (dayIndex < 0 || dayIndex >= calendar.dayCount) {
    throw new CalendarError(
      'OUT_OF_HORIZON',
      `${date} queda fuera del horizonte ${calendar.horizon.from}..${calendar.horizon.to}`,
    )
  }
  return workMinutes(denseAt(calendar.dayMinutes, dayIndex))
}

/** Minutos laborables de todo el horizonte. */
export function totalWorkingMinutes(calendar: CompiledCalendar): WorkMinutes {
  return workMinutes(denseAt(calendar.prefixSum, calendar.dayCount))
}
