/**
 * Compilación de calendarios.
 *
 * Resuelve la cadena de herencia y produce un índice denso sobre el horizonte.
 * Todo el coste está aquí; después, las primitivas de aritmética son O(log n).
 */

import { addDays, compareDates, daysBetween, isoWeekday, type CalendarDate } from '@planner/domain'
import { CalendarError } from './errors.js'
import type {
  CalendarDefinition,
  CalendarException,
  CompiledCalendar,
  DaySlot,
  DaySource,
  Horizon,
  WeekSlot,
} from './types.js'

/** Tope de seguridad: 100 años de horizonte. Más que eso es un error de datos. */
const MAX_HORIZON_DAYS = 36_600

export function compileCalendar(
  definitions: readonly CalendarDefinition[],
  calendarId: string,
  horizon: Horizon,
): CompiledCalendar {
  const byId = indexDefinitions(definitions)
  const chain = resolveChain(byId, calendarId)
  for (const definition of chain) validateDefinition(definition)

  const dayCount = validateHorizon(horizon)

  const dayMinutes = new Int32Array(dayCount)
  const prefixSum = new Int32Array(dayCount + 1)
  const daySlots: (readonly DaySlot[])[] = []
  const daySource: DaySource[] = []

  // De la hoja a la raíz: lo más específico gana.
  const leafFirst = [...chain].reverse()

  let cumulative = 0
  for (let index = 0; index < dayCount; index += 1) {
    const date = addDays(horizon.from, index)
    const resolved = resolveDay(leafFirst, date)

    daySlots.push(resolved.slots)
    daySource.push(resolved.source)
    const minutes = resolved.slots.reduce((sum, slot) => sum + (slot.endMinute - slot.startMinute), 0)
    dayMinutes[index] = minutes
    prefixSum[index] = cumulative
    cumulative += minutes
  }
  prefixSum[dayCount] = cumulative

  return {
    calendarId,
    horizon,
    dayCount,
    dayMinutes,
    daySlots,
    prefixSum,
    daySource,
    chain: chain.map((definition) => definition.id),
  }
}

// ---------------------------------------------------------------------------
// Resolución de la cadena de herencia
// ---------------------------------------------------------------------------

function indexDefinitions(
  definitions: readonly CalendarDefinition[],
): ReadonlyMap<string, CalendarDefinition> {
  const byId = new Map<string, CalendarDefinition>()
  for (const definition of definitions) {
    if (byId.has(definition.id)) {
      throw new CalendarError('DUPLICATE_CALENDAR_ID', `Hay dos calendarios con el id "${definition.id}"`)
    }
    byId.set(definition.id, definition)
  }
  return byId
}

/** Devuelve la cadena de la raíz a la hoja, detectando ciclos y huecos. */
function resolveChain(
  byId: ReadonlyMap<string, CalendarDefinition>,
  calendarId: string,
): readonly CalendarDefinition[] {
  const leafToRoot: CalendarDefinition[] = []
  const visited = new Set<string>()
  let currentId: string | null | undefined = calendarId

  while (currentId != null) {
    if (visited.has(currentId)) {
      const cycle = [...leafToRoot.map((definition) => definition.id), currentId].join(' → ')
      throw new CalendarError('CALENDAR_CYCLE', `El calendario hereda de sí mismo: ${cycle}`)
    }
    visited.add(currentId)

    const definition = byId.get(currentId)
    if (definition === undefined) {
      throw new CalendarError('CALENDAR_NOT_FOUND', `No existe el calendario "${currentId}"`)
    }
    leafToRoot.push(definition)
    currentId = definition.parentId
  }

  return leafToRoot.reverse()
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

function validateDefinition(definition: CalendarDefinition): void {
  for (const slot of definition.weekSlots) {
    validateSlot(slot, `calendario "${definition.code}", día ${String(slot.weekday)}`)
    if (slot.weekday < 1 || slot.weekday > 7 || !Number.isInteger(slot.weekday)) {
      throw new CalendarError(
        'INVALID_SLOT',
        `El día de la semana debe ser 1..7 (ISO), recibido ${String(slot.weekday)} en "${definition.code}"`,
      )
    }
    if (slot.validFrom !== undefined && slot.validTo !== undefined && compareDates(slot.validFrom, slot.validTo) > 0) {
      throw new CalendarError(
        'INVALID_SLOT',
        `Vigencia invertida en "${definition.code}": ${slot.validFrom} > ${slot.validTo}`,
      )
    }
  }

  for (const exception of definition.exceptions) {
    if (exception.recurrenceRule !== undefined) {
      throw new CalendarError(
        'RECURRENCE_NOT_SUPPORTED',
        `La excepción "${exception.name}" usa recurrencia (RRULE), que todavía no está soportada. ` +
          'Enumera las fechas en vez de dejar que el compilador se las invente.',
      )
    }
    if (compareDates(exception.dateFrom, exception.dateTo) > 0) {
      throw new CalendarError(
        'INVALID_EXCEPTION',
        `La excepción "${exception.name}" acaba antes de empezar: ${exception.dateFrom} > ${exception.dateTo}`,
      )
    }
    if (exception.isWorking && (exception.slots === undefined || exception.slots.length === 0)) {
      throw new CalendarError(
        'INVALID_EXCEPTION',
        `La excepción laborable "${exception.name}" no define ningún intervalo. ` +
          'Una jornada especial sin horario es un día no laborable mal declarado.',
      )
    }
    for (const slot of exception.slots ?? []) {
      validateSlot(slot, `excepción "${exception.name}"`)
    }
    normalizeSlots(exception.slots ?? [], `excepción "${exception.name}"`)
  }
}

function validateSlot(slot: DaySlot, where: string): void {
  const { startMinute, endMinute } = slot
  if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute)) {
    throw new CalendarError('INVALID_SLOT', `Los minutos deben ser enteros (${where})`)
  }
  if (startMinute < 0 || endMinute > 1440) {
    throw new CalendarError('INVALID_SLOT', `Los minutos deben estar entre 0 y 1440 (${where})`)
  }
  if (endMinute <= startMinute) {
    throw new CalendarError(
      'INVALID_SLOT',
      `El intervalo acaba antes de empezar: ${String(startMinute)}-${String(endMinute)} (${where})`,
    )
  }
}

function validateHorizon(horizon: Horizon): number {
  const span = daysBetween(horizon.from, horizon.to)
  if (span < 0) {
    throw new CalendarError('INVALID_HORIZON', `El horizonte acaba antes de empezar: ${horizon.from} > ${horizon.to}`)
  }
  const dayCount = span + 1
  if (dayCount > MAX_HORIZON_DAYS) {
    throw new CalendarError(
      'INVALID_HORIZON',
      `Horizonte de ${String(dayCount)} días: pasa del tope de ${String(MAX_HORIZON_DAYS)}. Casi seguro es un error de datos.`,
    )
  }
  return dayCount
}

/** Ordena, comprueba que no se solapan y fusiona los contiguos. */
function normalizeSlots(slots: readonly DaySlot[], where: string): readonly DaySlot[] {
  if (slots.length === 0) return []
  const sorted = [...slots].sort((left, right) => left.startMinute - right.startMinute)
  const merged: DaySlot[] = []

  for (const slot of sorted) {
    const previous = merged[merged.length - 1]
    if (previous === undefined) {
      merged.push(slot)
      continue
    }
    if (slot.startMinute < previous.endMinute) {
      throw new CalendarError(
        'OVERLAPPING_SLOTS',
        `Intervalos solapados en ${where}: ${String(previous.startMinute)}-${String(previous.endMinute)} y ` +
          `${String(slot.startMinute)}-${String(slot.endMinute)}`,
      )
    }
    if (slot.startMinute === previous.endMinute) {
      merged[merged.length - 1] = { startMinute: previous.startMinute, endMinute: slot.endMinute }
      continue
    }
    merged.push(slot)
  }
  return merged
}

// ---------------------------------------------------------------------------
// Resolución de un día
// ---------------------------------------------------------------------------

interface ResolvedDay {
  readonly slots: readonly DaySlot[]
  readonly source: DaySource
}

function resolveDay(leafFirst: readonly CalendarDefinition[], date: CalendarDate): ResolvedDay {
  // 1. Excepciones: gana el calendario más específico que tenga una.
  for (const definition of leafFirst) {
    const exception = pickException(definition.exceptions, date)
    if (exception === undefined) continue
    return {
      slots: exception.isWorking ? normalizeSlots(exception.slots ?? [], exception.name) : [],
      source: { calendarId: definition.id, kind: 'exception', exceptionName: exception.name },
    }
  }

  // 2. Patrón semanal: gana el calendario más específico que defina uno vigente
  //    ese día, y se usa entero (sobrescribe al padre, no se mezcla con él).
  const weekday = isoWeekday(date)
  for (const definition of leafFirst) {
    const applicable = definition.weekSlots.filter((slot) => isSlotValidOn(slot, date))
    if (applicable.length === 0) continue
    const forWeekday = applicable.filter((slot) => slot.weekday === weekday)
    return {
      slots: normalizeSlots(forWeekday, `calendario "${definition.code}"`),
      source: { calendarId: definition.id, kind: 'week-pattern' },
    }
  }

  // 3. Ningún calendario de la cadena dice nada: día no laborable.
  const root = leafFirst[leafFirst.length - 1]
  if (root === undefined) {
    throw new CalendarError('INTERNAL', 'Cadena de calendarios vacía')
  }
  return { slots: [], source: { calendarId: root.id, kind: 'no-pattern' } }
}

/**
 * Entre las excepciones de un mismo calendario que cubren la fecha, gana la de
 * rango más corto (un festivo dentro de un cierre de verano sigue siendo el
 * festivo); a igual rango, la declarada más tarde.
 */
function pickException(
  exceptions: readonly CalendarException[],
  date: CalendarDate,
): CalendarException | undefined {
  let best: CalendarException | undefined
  let bestSpan = Number.POSITIVE_INFINITY

  for (const exception of exceptions) {
    if (compareDates(date, exception.dateFrom) < 0 || compareDates(date, exception.dateTo) > 0) continue
    const span = daysBetween(exception.dateFrom, exception.dateTo)
    if (span <= bestSpan) {
      best = exception
      bestSpan = span
    }
  }
  return best
}

function isSlotValidOn(slot: WeekSlot, date: CalendarDate): boolean {
  if (slot.validFrom !== undefined && compareDates(date, slot.validFrom) < 0) return false
  if (slot.validTo !== undefined && compareDates(date, slot.validTo) > 0) return false
  return true
}
