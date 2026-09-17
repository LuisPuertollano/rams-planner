/**
 * Capacidad efectiva de un recurso, día a día.
 *
 *     bruto = calendario ∩ disponibilidad ∩ ausencias
 *     neto  = bruto × (1 − indirecto) × (1 − reserva)
 *
 * Nunca negativa (invariante R2). Se calcula por día porque un recurso puede
 * estar equilibrado al mes y saturado tres días concretos, y ese es justo el
 * dato que duele.
 *
 * El **neto** es contra lo que se planifica, y lo que se guarda es el par: sin
 * el bruto al lado, «7,4 h» es un número que nadie puede comprobar (P4).
 *
 * Que sean dos factores y no uno importa: el indirecto es trabajo que pasa y la
 * reserva es sitio que se guarda por si acaso. Se multiplican en ese orden y no
 * se suman, y el orden es parte del contrato porque cada paso redondea a
 * minutos enteros (P5) —sumarlos daría otro número, y uno distinto según quién
 * lo calcule—.
 */

import {
  BASIS_POINTS_ONE as BP_UNO,
  addDays,
  applyBasisPoints,
  basisPoints,
  type CalendarDate,
} from '@planner/domain'
import { compileCalendar, type CompiledCalendar } from '@planner/calendar'
import type { PlanSnapshot, ResourceDefinition } from '@planner/scheduler'

export interface CapacityCell {
  readonly resourceId: string
  readonly date: CalendarDate
  /** Lo planificable: el bruto menos lo indirecto y menos la reserva. */
  readonly capacityMinutes: number
  /** Lo que daba el calendario tras la disponibilidad y las ausencias. */
  readonly grossMinutes: number
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
      const grossMinutes = Math.max(0, available - absent)
      if (grossMinutes === 0) continue

      // Los factores se aplican **al final**, sobre lo que queda: quien está de
      // vacaciones tampoco va a reuniones.
      const capacityMinutes = plannable(grossMinutes, resource)
      if (capacityMinutes === 0) continue

      cells.push({ resourceId: resource.id, date, capacityMinutes, grossMinutes })
      index.set(`${resource.id}|${date}`, capacityMinutes)
    }
  }

  return {
    cells,
    capacityOf: (resourceId, date) => index.get(`${resourceId}|${date}`) ?? 0,
  }
}

/**
 * Lo que de verdad se puede planificar ese día.
 *
 * Un recurso sin factores declarados devuelve el bruto **sin pasar por la
 * aritmética**, y no es una optimización: es lo que garantiza que una
 * instalación que no ha declarado nada siga dando exactamente los mismos
 * minutos que antes de que esto existiera (P2).
 */
export function plannable(grossMinutes: number, resource: ResourceDefinition): number {
  const indirecto = resource.indirectBp
  const reserva = resource.reserveBp
  if (indirecto === 0 && reserva === 0) return grossMinutes

  const trasIndirecto = applyBasisPoints(grossMinutes, basisPoints(BP_UNO - indirecto))
  return Math.max(0, applyBasisPoints(trasIndirecto, basisPoints(BP_UNO - reserva)))
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
