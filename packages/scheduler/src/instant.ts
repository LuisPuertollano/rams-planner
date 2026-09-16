/** Comparación de instantes entre calendarios distintos. */

import { addDays, daysBetween, type CalendarDate } from '@planner/domain'
import { planInstant, type PlanInstant } from '@planner/calendar'

const MINUTES_PER_DAY = 1440

/**
 * Minutos desde el inicio del horizonte, **sin depender de un calendario**.
 * Es la escala común que permite comparar el fin de una tarea de 35 h con el
 * inicio de otra de 40 h.
 */
export function absoluteOf(instant: PlanInstant, horizonFrom: CalendarDate): number {
  return daysBetween(horizonFrom, instant.date) * MINUTES_PER_DAY + instant.minuteOfDay
}

export function instantOf(absolute: number, horizonFrom: CalendarDate): PlanInstant {
  const dayIndex = Math.floor(absolute / MINUTES_PER_DAY)
  return planInstant(addDays(horizonFrom, dayIndex), absolute - dayIndex * MINUTES_PER_DAY)
}

/** Inicio del día (00:00). */
export function startOfDay(date: CalendarDate): PlanInstant {
  return planInstant(date, 0)
}

/** Final del día (24:00, normalizado al día siguiente a las 00:00). */
export function endOfDay(date: CalendarDate): PlanInstant {
  return planInstant(date, MINUTES_PER_DAY)
}

export function laterOf(left: PlanInstant, right: PlanInstant, horizonFrom: CalendarDate): PlanInstant {
  return absoluteOf(left, horizonFrom) >= absoluteOf(right, horizonFrom) ? left : right
}

export function earlierOf(left: PlanInstant, right: PlanInstant, horizonFrom: CalendarDate): PlanInstant {
  return absoluteOf(left, horizonFrom) <= absoluteOf(right, horizonFrom) ? left : right
}

export function formatInstant(instant: PlanInstant): string {
  const hours = Math.floor(instant.minuteOfDay / 60)
  const minutes = instant.minuteOfDay % 60
  return `${instant.date} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}
