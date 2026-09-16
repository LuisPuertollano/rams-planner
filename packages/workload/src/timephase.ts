/**
 * Distribución temporal: convierte un plan en «cuántos minutos trabaja cada
 * persona cada día». Es el paso que contesta la pregunta por la que existe la
 * herramienta.
 *
 * Todo lo demás —la vista mensual, el mapa de calor, el informe por proyecto—
 * es una agregación de esta tabla. Una sola fuente: dos pantallas no pueden
 * contradecirse.
 */

import {
  addDays,
  applyBasisPoints,
  basisPoints,
  daysBetween,
  distributeInteger,
  sortFindings,
  type CalendarDate,
  type Finding,
} from '@planner/domain'
import type { CompiledCalendar } from '@planner/calendar'
import { NOOP_SINK, type DerivationSink } from '@planner/explain'
import type { PlanSnapshot, ScheduleOutput, TaskResult } from '@planner/scheduler'
import { calendarFor, computeCapacity, rateOn, type CapacityIndex } from './capacity.js'
import { contourWeights } from './contours.js'

export interface TimephasedCell {
  readonly assignmentId: string
  readonly resourceId: string
  readonly nodeId: string
  readonly projectId: string
  readonly date: CalendarDate
  readonly plannedMinutes: number
  readonly costCents: number
}

export interface WorkloadOutput {
  readonly timephased: readonly TimephasedCell[]
  readonly capacity: CapacityIndex
  readonly findings: readonly Finding[]
}

export interface WorkloadOptions {
  readonly derivations?: DerivationSink
  /** Saturación a partir de la cual se avisa. Por defecto 10000 (100 %). */
  readonly overallocationThresholdBp?: number
}

export function computeWorkload(
  snapshot: PlanSnapshot,
  schedule: ScheduleOutput,
  options: WorkloadOptions = {},
): WorkloadOutput {
  const sink = options.derivations ?? NOOP_SINK
  const findings: Finding[] = []
  const compiled = new Map(schedule.compiledCalendars)
  const capacity = computeCapacity(snapshot, compiled)

  const resultByNode = new Map(schedule.taskResults.map((result) => [result.nodeId, result]))
  const resourcesById = new Map(snapshot.resources.map((resource) => [resource.id, resource]))
  const cells: TimephasedCell[] = []

  for (const assignment of snapshot.assignments) {
    const result = resultByNode.get(assignment.nodeId)
    const resource = resourcesById.get(assignment.resourceId)
    if (result === undefined || resource === undefined || result.isContainer) continue
    if (resource.kind === 'cost' || resource.kind === 'material') continue

    const calendar = calendarFor(snapshot, compiled, resource.calendarId ?? snapshot.defaultCalendarId)
    const workMinutes =
      assignment.workDeclaredMinutes ??
      applyBasisPoints(result.durationMinutes, basisPoints(assignment.unitsBp))
    if (workMinutes === 0) continue

    if (assignment.contour === 'manual' && assignment.manualContour !== undefined) {
      const declared = assignment.manualContour.reduce((sum, entry) => sum + entry.minutes, 0)
      if (declared !== workMinutes) {
        findings.push({
          severity: 'warning',
          code: 'CONTOUR_MISMATCH',
          entityType: 'assignment',
          entityId: assignment.id,
          message:
            `El reparto manual suma ${String(declared)} minutos y la asignación declara ` +
            `${String(workMinutes)}. Se respeta el reparto manual.`,
          payload: { declared, expected: workMinutes },
        })
      }
      for (const entry of assignment.manualContour) {
        cells.push(cellFor(assignment.id, resource.id, result, entry.date, entry.minutes, rateOn(resource, entry.date)))
      }
      continue
    }

    const days = workingDaysWithin(calendar, snapshot.horizon.from, result, assignment.windowFrom, assignment.windowTo)
    if (days.length === 0) {
      findings.push({
        severity: 'warning',
        code: 'RESOURCE_NO_CAPACITY',
        entityType: 'assignment',
        entityId: assignment.id,
        message:
          `«${resource.displayName}» no tiene ningún día laborable dentro de la tarea, así que su ` +
          'trabajo no se puede repartir. Revisa su calendario o las fechas de la tarea.',
      })
      continue
    }

    const profile = contourWeights(assignment.contour, days.length)
    const weights = days.map((day, index) => day.availableMinutes * (profile[index] ?? 1))
    const distribution = distributeInteger(workMinutes, weights)

    days.forEach((day, index) => {
      const minutes = distribution[index] ?? 0
      if (minutes === 0) return
      cells.push(cellFor(assignment.id, resource.id, result, day.date, minutes, rateOn(resource, day.date)))
    })

    sink.record({
      targetType: 'assignment.timephased',
      targetId: assignment.id,
      rule: `CONTOUR_${assignment.contour.toUpperCase()}`,
      inputs: {
        workMinutes,
        dayCount: days.length,
        calendarId: calendar.calendarId,
        from: days[0]?.date ?? null,
        to: days[days.length - 1]?.date ?? null,
      },
      output: workMinutes,
    })
  }

  findings.push(...detectOverallocation(cells, capacity, resourcesById, options.overallocationThresholdBp ?? 10_000))

  return {
    timephased: cells.sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.resourceId.localeCompare(right.resourceId) ||
        left.assignmentId.localeCompare(right.assignmentId),
    ),
    capacity,
    findings: sortFindings(findings),
  }
}

interface AvailableDay {
  readonly date: CalendarDate
  readonly availableMinutes: number
}

/** Días laborables del recurso dentro del tramo de la tarea y de la ventana. */
function workingDaysWithin(
  calendar: CompiledCalendar,
  horizonFrom: CalendarDate,
  result: TaskResult,
  windowFrom: CalendarDate | undefined,
  windowTo: CalendarDate | undefined,
): readonly AvailableDay[] {
  const from = maxDate(result.scheduledStart.date, windowFrom)
  const to = minDate(result.scheduledFinish.date, windowTo)
  const days: AvailableDay[] = []

  for (let date = from; date <= to; date = addDays(date, 1)) {
    const dayIndex = daysBetween(horizonFrom, date)
    if (dayIndex < 0 || dayIndex >= calendar.dayCount) continue
    const availableMinutes = calendar.dayMinutes[dayIndex] ?? 0
    if (availableMinutes > 0) days.push({ date, availableMinutes })
  }
  return days
}

function cellFor(
  assignmentId: string,
  resourceId: string,
  result: TaskResult,
  date: CalendarDate,
  minutes: number,
  centsPerHour: number,
): TimephasedCell {
  return {
    assignmentId,
    resourceId,
    nodeId: result.nodeId,
    projectId: result.projectId,
    date,
    plannedMinutes: minutes,
    // Céntimos enteros: minutos × (céntimos/hora) / 60, redondeado una sola vez.
    costCents: Math.round((minutes * centsPerHour) / 60),
  }
}

function detectOverallocation(
  cells: readonly TimephasedCell[],
  capacity: CapacityIndex,
  resourcesById: ReadonlyMap<string, { displayName: string }>,
  thresholdBp: number,
): readonly Finding[] {
  const perDay = new Map<string, number>()
  for (const cell of cells) {
    const key = `${cell.resourceId}|${cell.date}`
    perDay.set(key, (perDay.get(key) ?? 0) + cell.plannedMinutes)
  }

  // Un hallazgo por recurso y mes, con el pico y los días afectados: una lista
  // de 300 avisos diarios no la lee nadie.
  interface MonthSummary {
    resourceId: string
    month: string
    days: number
    peakBp: number
    peakDate: CalendarDate
  }
  const perMonth = new Map<string, MonthSummary>()

  for (const [key, planned] of perDay) {
    const [resourceId, date] = key.split('|') as [string, CalendarDate]
    const available = capacity.capacityOf(resourceId, date)
    const utilizationBp = available === 0 ? Number.POSITIVE_INFINITY : Math.round((planned * 10_000) / available)
    if (utilizationBp <= thresholdBp) continue

    const month = date.slice(0, 7)
    const monthKey = `${resourceId}|${month}`
    const current = perMonth.get(monthKey)
    if (current === undefined) {
      perMonth.set(monthKey, { resourceId, month, days: 1, peakBp: utilizationBp, peakDate: date })
    } else {
      current.days += 1
      if (utilizationBp > current.peakBp) {
        current.peakBp = utilizationBp
        current.peakDate = date
      }
    }
  }

  return [...perMonth.values()].map((summary) => ({
    severity: 'warning' as const,
    code: 'RESOURCE_OVERALLOCATED' as const,
    entityType: 'resource',
    entityId: summary.resourceId,
    occursOn: summary.peakDate,
    message:
      `«${resourcesById.get(summary.resourceId)?.displayName ?? summary.resourceId}» supera su capacidad ` +
      `${String(summary.days)} día(s) de ${summary.month}. El peor, el ${summary.peakDate}: ` +
      `${Number.isFinite(summary.peakBp) ? `${(summary.peakBp / 100).toFixed(0)} %` : 'sin capacidad ese día'}.`,
    payload: {
      month: summary.month,
      days: summary.days,
      peakUtilizationBp: Number.isFinite(summary.peakBp) ? summary.peakBp : -1,
    },
  }))
}

function maxDate(left: CalendarDate, right: CalendarDate | undefined): CalendarDate {
  return right === undefined || left >= right ? left : right
}

function minDate(left: CalendarDate, right: CalendarDate | undefined): CalendarDate {
  return right === undefined || left <= right ? left : right
}


