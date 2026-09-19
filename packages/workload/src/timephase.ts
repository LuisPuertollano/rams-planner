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
  formatWorkMinutesAsHours,
  workMinutes as asWorkMinutes,
  sortFindings,
  type CalendarDate,
  type Finding,
} from '@planner/domain'
import { planInstant, workingMinutesBetween, type CompiledCalendar, type PlanInstant } from '@planner/calendar'
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
    const reparto = cellsForAssignment(snapshot, compiled, assignment, result, resource, sink)
    cells.push(...reparto.cells)
    findings.push(...reparto.findings)
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

/** Lo que el reparto de UNA asignación produce: sus celdas y lo que haya que avisar. */
export interface AssignmentCells {
  readonly cells: readonly TimephasedCell[]
  readonly findings: readonly Finding[]
}

/**
 * El reparto de una sola asignación en días.
 *
 * Vive aparte porque la nivelación lo llama de una en una: retrasar una tarea
 * mueve tres de mil ochocientas —medido—, y rehacer el reparto entero para eso
 * era el 93 % del coste de nivelar. Que sea **esta misma función** la que usan
 * las dos rutas no es comodidad: es lo que garantiza que el camino incremental
 * y el completo den la misma celda, hasta el minuto.
 */
/**
 * Las asignaciones de cada tarea, calculadas una vez por instantánea.
 *
 * La clave es el propio array: dos llamadas con la misma instantánea comparten
 * el índice, y una instantánea nueva se construye el suyo. Sin esto, repartir
 * la carga sería cuadrático — y `levelPlan` llama aquí una vez por asignación y
 * por vuelta.
 */
const indicePorTarea = new WeakMap<
  readonly PlanSnapshot['assignments'][number][],
  ReadonlyMap<string, readonly PlanSnapshot['assignments'][number][]>
>()

function asignacionesDe(
  snapshot: PlanSnapshot,
  nodeId: string,
): readonly PlanSnapshot['assignments'][number][] {
  let indice = indicePorTarea.get(snapshot.assignments)
  if (indice === undefined) {
    const construido = new Map<string, PlanSnapshot['assignments'][number][]>()
    for (const asignacion of snapshot.assignments) {
      const bolsa = construido.get(asignacion.nodeId) ?? []
      bolsa.push(asignacion)
      construido.set(asignacion.nodeId, bolsa)
    }
    indice = construido
    indicePorTarea.set(snapshot.assignments, construido)
  }
  return indice.get(nodeId) ?? []
}

/**
 * El trabajo que le toca a una asignación.
 *
 * Es el trabajo de la TAREA repartido entre sus asignaciones en proporción a la
 * dedicación de cada una — **no** `duración × dedicación`.
 *
 * Para una tarea normal las dos cuentas dan exactamente lo mismo, y por eso
 * esto no mueve una sola cifra de lo que ya salía: la duración de una tarea
 * sale del trabajo dividido entre la dedicación (`equation.ts`), así que al
 * multiplicar otra vez por la dedicación se cancela.
 *
 * Donde deja de dar lo mismo es en una tarea continua (ADR-0051): ahí la
 * duración la ponen dos puertas, y `duración × dedicación` pondría a una
 * persona a jornada completa durante los siete meses de la fase por haber
 * declarado 300 h de gestión. El trabajo declarado es el que manda.
 *
 * El reparto va con `distributeInteger` para que la suma de las partes sea
 * exactamente el trabajo de la tarea aunque no divida (P5).
 */
function loQueLeToca(
  snapshot: PlanSnapshot,
  assignment: PlanSnapshot['assignments'][number],
  result: TaskResult,
): number {
  const hermanas = asignacionesDe(snapshot, assignment.nodeId)
  // Sin dedicación declarada en ninguna, el trabajo de la tarea se reparte a
  // partes iguales: es lo que ya hacía `applyBasisPoints` con la dedicación
  // efectiva del 100 % que pone la ecuación.
  const pesos = hermanas.map((hermana) => (hermana.unitsBp === 0 ? 1 : hermana.unitsBp))
  const partes = distributeInteger(result.workMinutes, pesos)
  const cual = hermanas.findIndex((hermana) => hermana.id === assignment.id)
  return cual < 0
    ? applyBasisPoints(result.durationMinutes, basisPoints(assignment.unitsBp))
    : (partes[cual] ?? 0)
}

export function cellsForAssignment(
  snapshot: PlanSnapshot,
  // Mutable a propósito: `calendarFor` memoiza dentro. Con un ReadonlyMap se
  // recompilaría el calendario en cada llamada, que es justo lo que se evita.
  compiled: Map<string, CompiledCalendar>,
  assignment: PlanSnapshot['assignments'][number],
  result: TaskResult | undefined,
  resource: PlanSnapshot['resources'][number] | undefined,
  sink: DerivationSink = NOOP_SINK,
): AssignmentCells {
  const cells: TimephasedCell[] = []
  const findings: Finding[] = []
  const vacio = { cells, findings }
  {
    if (result === undefined || resource === undefined || result.isContainer) return vacio
    if (resource.kind === 'cost' || resource.kind === 'material') return vacio

    const calendar = calendarFor(snapshot, compiled, resource.calendarId ?? snapshot.defaultCalendarId)
    const workMinutes = assignment.workDeclaredMinutes ?? loQueLeToca(snapshot, assignment, result)
    if (workMinutes === 0) return vacio

    if (assignment.contour === 'manual' && assignment.manualContour !== undefined) {
      const declared = assignment.manualContour.reduce((sum, entry) => sum + entry.minutes, 0)
      if (declared !== workMinutes) {
        findings.push({
          severity: 'warning',
          code: 'CONTOUR_MISMATCH',
          entityType: 'assignment',
          entityId: assignment.id,
          message:
            `El reparto manual suma ${formatWorkMinutesAsHours(asWorkMinutes(declared))} h y la asignación ` +
            `declara ${formatWorkMinutesAsHours(asWorkMinutes(workMinutes))} h. Se respeta el reparto manual.`,
          payload: { resource: resource.displayName, declared, expected: workMinutes },
        })
      }
      for (const entry of assignment.manualContour) {
        cells.push(cellFor(assignment.id, resource.id, result, entry.date, entry.minutes, rateOn(resource, entry.date)))
      }
      return { cells, findings }
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
        payload: { resource: resource.displayName },
      })
      return { cells, findings }
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
  return { cells, findings }
}

interface AvailableDay {
  readonly date: CalendarDate
  readonly availableMinutes: number
}

/**
 * Días laborables del recurso dentro del tramo de la tarea y de la ventana.
 *
 * Cuenta los minutos **dentro del tramo**, no los del día entero: una tarea que
 * empieza el viernes a las 17:00 no trabaja el viernes, y una que acaba el
 * martes a mediodía no trabaja el martes por la tarde. Dar el día completo por
 * bueno infla la carga del primer y del último día, y con ella la saturación.
 */
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
    if ((calendar.dayMinutes[dayIndex] ?? 0) === 0) continue

    const dayFrom = date === result.scheduledStart.date ? result.scheduledStart : planInstant(date, 0)
    const dayTo = date === result.scheduledFinish.date ? result.scheduledFinish : planInstant(date, MINUTES_PER_DAY)
    if (toComparable(dayFrom) >= toComparable(dayTo)) continue

    const availableMinutes = workingMinutesBetween(dayFrom, dayTo, calendar)
    if (availableMinutes > 0) days.push({ date, availableMinutes })
  }
  return days
}

const MINUTES_PER_DAY = 1440

function toComparable(instant: PlanInstant): string {
  return `${instant.date}T${String(instant.minuteOfDay).padStart(4, '0')}`
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
      resource: resourcesById.get(summary.resourceId)?.displayName ?? summary.resourceId,
      month: summary.month,
      days: summary.days,
      peakDate: summary.peakDate,
      // -1 significa «ese día no tenía capacidad», que es distinto de un 0 %.
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


