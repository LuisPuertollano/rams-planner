/**
 * Calendarios de referencia para las pruebas.
 *
 * No son datos de adorno: cada uno existe para un caso límite concreto de los
 * que exige la puerta de la fase 1.
 */

import { calendarDate } from '@planner/domain'
import type { CalendarDefinition, Horizon, WeekSlot } from '../types.js'

const d = calendarDate

/** L-V, 08:00-12:00 y 13:00-17:00 = 480 min/día. */
export function fullDayWeek(endOfAfternoon = 1020, validity: Partial<WeekSlot> = {}): WeekSlot[] {
  const slots: WeekSlot[] = []
  for (const weekday of [1, 2, 3, 4, 5] as const) {
    slots.push({ weekday, startMinute: 480, endMinute: 720, ...validity })
    slots.push({ weekday, startMinute: 780, endMinute: endOfAfternoon, ...validity })
  }
  return slots
}

export const BASE_40H: CalendarDefinition = {
  id: 'base-40h',
  code: 'base_40h',
  parentId: null,
  weekSlots: fullDayWeek(),
  exceptions: [],
}

/** Hereda la jornada y añade festivos. Nochebuena es media jornada. */
export const HOLIDAYS: CalendarDefinition = {
  id: 'festivos',
  code: 'festivos',
  parentId: 'base-40h',
  weekSlots: [],
  exceptions: [
    { name: 'Nochebuena', dateFrom: d('2026-12-24'), dateTo: d('2026-12-24'), isWorking: true, slots: [{ startMinute: 480, endMinute: 720 }] },
    { name: '1. Weihnachtstag', dateFrom: d('2026-12-25'), dateTo: d('2026-12-25'), isWorking: false },
    { name: 'Turno especial', dateFrom: d('2026-03-17'), dateTo: d('2026-03-17'), isWorking: true, slots: [{ startMinute: 480, endMinute: 1200 }] },
  ],
}

/** Tercer nivel: hereda los festivos y sobrescribe la jornada a 35 h (420 min/día). */
export const REDUCED_35H: CalendarDefinition = {
  id: 'reducida-35h',
  code: 'reducida_35h',
  parentId: 'festivos',
  weekSlots: fullDayWeek(960),
  exceptions: [],
}

/** Jornada que se reduce a partir del 1 de julio de 2026. */
export const SHIFTING_PATTERN: CalendarDefinition = {
  id: 'jornada-variable',
  code: 'jornada_variable',
  parentId: null,
  weekSlots: [
    ...fullDayWeek(1020, { validTo: d('2026-06-30') }),
    ...fullDayWeek(960, { validFrom: d('2026-07-01') }),
  ],
  exceptions: [],
}

export const ALL_CALENDARS: readonly CalendarDefinition[] = [
  BASE_40H,
  HOLIDAYS,
  REDUCED_35H,
  SHIFTING_PATTERN,
]

/** Horizonte usado por casi todas las pruebas: once meses de 2026. */
export const HORIZON: Horizon = { from: d('2026-03-01'), to: d('2027-01-31') }
