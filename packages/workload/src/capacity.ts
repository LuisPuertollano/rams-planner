/**
 * Capacidad efectiva de un recurso, día a día.
 *
 *     capacidad = calendario ∩ disponibilidad ∩ ausencias
 *
 * Nunca negativa (invariante R2). Se calcula por día porque un recurso puede
 * estar equilibrado al mes y saturado tres días concretos, y ese es justo el
 * dato que duele.
 */

import { addDays, applyBasisPoints, basisPoints, type CalendarDate } from '@planner/domain'
import { compileCalendar, type CompiledCalendar } from '@planner/calendar'
import type { PlanSnapshot, ResourceDefinition } from '@planner/scheduler'

export interface CapacityCell {
  readonly resourceId: string
  readonly date: CalendarDate
  readonly capacityMinutes: number
}

export interface CapacityIndex {
  readonly cells: readonly CapacityCell[]
  /** Consulta rápida por recurso y día. */
  capacityOf(resourceId: string, date: CalendarDate): number
}

export function computeCapacity(
  snapshot: PlanSnapshot,
  compiled: Map<string, CompiledCalendar>,
): CapacityIndex {
  const cells: CapacityCell[] = []
  const index = new Map<string, number>()

  for (const resource of snapshot.resources) {
    if (resource.kind !== 'person' && resource.kind !== 'team') continue
    const calendar = calendarFor(snapshot, compiled, resource.calendarId ?? snapshot.defaultCalendarId)

    for (let dayIndex = 0; dayIndex < calendar.dayCount; dayIndex += 1) {
      const date = addDays(snapshot.horizon.from, dayIndex)
      const workingMinutes = calendar.dayMinutes[dayIndex] ?? 0
      if (workingMinutes === 0) continue

      const unitsBp = availabilityOn(resource, date)
      const available = applyBasisPoints(workingMinutes, basisPoints(unitsBp))
      const absent = absenceMinutesOn(resource, date, workingMinutes)
      const capacityMinutes = Math.max(0, available - absent)
      if (capacityMinutes === 0) continue

      cells.push({ resourceId: resource.id, date, capacityMinutes })
      index.set(`${resource.id}|${date}`, capacityMinutes)
    }
  }

  return {
    cells,
    capacityOf: (resourceId, date) => index.get(`${resourceId}|${date}`) ?? 0,
  }
}

export function calendarFor(
  snapshot: PlanSnapshot,
  compiled: Map<string, CompiledCalendar>,
  calendarId: string,
): CompiledCalendar {
  const cached = compiled.get(calendarId)
  if (cached !== undefined) return cached
  const fresh = compileCalendar(snapshot.calendars, calendarId, snapshot.horizon)
  compiled.set(calendarId, fresh)
  return fresh
}

/** El periodo de disponibilidad vigente ese día; si no hay ninguno, la dedicación máxima. */
function availabilityOn(resource: ResourceDefinition, date: CalendarDate): number {
  for (const period of resource.availability) {
    if (date >= period.from && date <= period.to) return period.unitsBp
  }
  return resource.maxUnitsBp
}

function absenceMinutesOn(
  resource: ResourceDefinition,
  date: CalendarDate,
  workingMinutes: number,
): number {
  let absent = 0
  for (const absence of resource.absences) {
    if (date < absence.from || date > absence.to) continue
    absent += absence.minutesPerDay ?? workingMinutes
  }
  return absent
}

/** Tarifa vigente ese día, en céntimos por hora. */
export function rateOn(resource: ResourceDefinition, date: CalendarDate): number {
  for (const rate of resource.costRates) {
    if (date >= rate.from && date <= rate.to) return rate.standardCentsPerHour
  }
  return 0
}
