/**
 * Nivelación de recursos.
 *
 * Redistribuye el plan para que nadie pase de su capacidad. Es un problema
 * **NP-duro**, así que esto es una heurística, está declarada como tal y viene
 * **desactivada por defecto**: mover el plan de alguien sin que lo haya pedido
 * es peor que enseñarle una sobrecarga.
 *
 * Lo que sí es exigible, y se cumple, es que sea **reproducible**: dos
 * ejecuciones con los mismos datos dan exactamente el mismo plan nivelado. Los
 * desempates llegan hasta el identificador de la tarea.
 *
 * El resultado nunca pisa `planned_minutes`: vive en su propia columna, para
 * poder comparar el plan que quieres con el plan que cabe.
 */

import { addDays, calendarDate, sortFindings, type Finding } from '@planner/domain'
import { planInstant, workingMinutesBetween } from '@planner/calendar'
import { schedulePlan, type PlanSnapshot, type ScheduleOutput, type TaskResult } from '@planner/scheduler'
import { computeWorkload, type WorkloadOutput } from './timephase.js'

export interface LevelingOptions {
  /** Tope de iteraciones. Cada una retrasa una tarea un día laborable. */
  readonly maxIterations?: number
  /** Retraso máximo por tarea, en minutos laborables. Por defecto 120 días. */
  readonly maxDelayMinutes?: number
}

export interface LevelingResult {
  readonly schedule: ScheduleOutput
  readonly workload: WorkloadOutput
  /** Retraso aplicado a cada tarea, en minutos laborables. */
  readonly delays: ReadonlyMap<string, number>
  readonly findings: readonly Finding[]
  readonly iterations: number
  /** `false` si se agotaron las iteraciones con sobrecargas todavía en pie. */
  readonly converged: boolean
}

const WORKING_DAY = 480

export function levelPlan(snapshot: PlanSnapshot, options: LevelingOptions = {}): LevelingResult {
  const maxIterations = options.maxIterations ?? 400
  // Dos años laborables. Un plan que necesite más que eso no tiene un problema
  // de nivelación: tiene un problema de plantilla, y eso lo dicen los hallazgos
  // de sobrecarga, no un retraso automático.
  const maxDelay = options.maxDelayMinutes ?? 500 * WORKING_DAY

  const delays = new Map<string, number>()
  const priorityOf = new Map(snapshot.projects.map((project) => [project.id, project.priority]))
  const assignmentsByNode = new Map<string, string[]>()
  for (const assignment of snapshot.assignments) {
    const bucket = assignmentsByNode.get(assignment.nodeId) ?? []
    bucket.push(assignment.id)
    assignmentsByNode.set(assignment.nodeId, bucket)
  }
  const nodeOfAssignment = new Map(snapshot.assignments.map((assignment) => [assignment.id, assignment.nodeId]))
  const hardConstraint = new Set(
    snapshot.tasks
      .filter((task) => task.constraintKind === 'must_start_on' || task.constraintKind === 'must_finish_on')
      .map((task) => task.nodeId),
  )

  let schedule = schedulePlan(snapshot, { levelingDelays: delays })
  let workload = computeWorkload(snapshot, schedule)
  const findings: Finding[] = []
  let iterations = 0

  // Una vez elegida la tarea que cede en un día concreto, se sigue empujando
  // **esa** hasta que ese día deja de estar sobrecargado. Sin esto, dos tareas
  // que se solapan se persiguen: se retrasa una, la otra pasa a tener más
  // holgura, se retrasa la otra, y así para siempre.
  //
  // La clave incluye el día a propósito. Atada sólo al recurso, la misma tarea
  // se empujaría eternamente aunque el conflicto ya fuese de otro día y de
  // otras tareas.
  const beingPushed = new Map<string, string>()

  // Días que ningún retraso puede arreglar: los que se van marcando abajo.
  const unresolvable = new Set<string>()
  const tooBig = new Map<string, { first: string; last: string; days: number; worst: Conflict }>()

  while (iterations < maxIterations) {
    const conflict = firstConflict(workload, unresolvable)
    if (conflict === undefined) break

    // Si una sola asignación ya no cabe en la jornada de la persona, moverla de
    // sitio no arregla nada: el problema es la dedicación o el calendario, no
    // la fecha. Se dice con precisión y se sigue con el resto del plan.
    if (conflict.largestSingleMinutes > conflict.capacityMinutes) {
      unresolvable.add(`${conflict.resourceId}|${conflict.date}`)
      const seen = tooBig.get(conflict.resourceId)
      if (seen === undefined) {
        tooBig.set(conflict.resourceId, { first: conflict.date, last: conflict.date, days: 1, worst: conflict })
      } else {
        seen.last = conflict.date
        seen.days += 1
        if (conflict.largestSingleMinutes - conflict.capacityMinutes >
            seen.worst.largestSingleMinutes - seen.worst.capacityMinutes) {
          seen.worst = conflict
        }
      }
      continue
    }

    const resultByNode = new Map(schedule.taskResults.map((result) => [result.nodeId, result]))
    const candidates = conflict.assignmentIds
      .map((assignmentId) => nodeOfAssignment.get(assignmentId))
      .filter((nodeId): nodeId is string => nodeId !== undefined && !hardConstraint.has(nodeId))
      .map((nodeId) => ({ nodeId, result: resultByNode.get(nodeId) }))
      .filter((entry): entry is { nodeId: string; result: TaskResult } => entry.result !== undefined)

    // Se retrasa lo menos importante y lo que más margen tiene. El último
    // desempate es el identificador: sin él, el resultado dependería del orden
    // de iteración y la nivelación dejaría de ser reproducible.
    candidates.sort(
      (left, right) =>
        (priorityOf.get(right.result.projectId) ?? 0) - (priorityOf.get(left.result.projectId) ?? 0) ||
        right.result.totalSlackMinutes - left.result.totalSlackMinutes ||
        right.result.scheduledStart.date.localeCompare(left.result.scheduledStart.date) ||
        left.nodeId.localeCompare(right.nodeId),
    )

    const stickyKey = `${conflict.resourceId}|${conflict.date}`
    const sticky = beingPushed.get(stickyKey)
    const chosen = candidates.find((candidate) => candidate.nodeId === sticky) ?? candidates[0]
    if (chosen === undefined) {
      findings.push(impossible(conflict, 'todas las tareas implicadas tienen una restricción dura'))
      return finish(false)
    }

    // Se empuja **más allá del día en conflicto de una vez**, no un día por
    // iteración: retrasando de uno en uno, dos tareas que se solapan se
    // persiguen sin converger nunca.
    const current = delays.get(chosen.nodeId) ?? 0
    const increment = pushPastConflict(chosen.result, conflict.blockEnd, schedule)
    if (current + increment > maxDelay) {
      findings.push(impossible(conflict, `«${chosen.nodeId}» ya acumula el retraso máximo permitido`))
      return finish(false)
    }

    delays.set(chosen.nodeId, current + increment)
    beingPushed.set(stickyKey, chosen.nodeId)

    // Retrasar puede empujar una tarea fuera del horizonte compilado. Eso no es
    // un fallo del motor: es que el plan no cabe. Se deshace el último retraso
    // y se dice, en vez de reventar con un error de calendario.
    try {
      schedule = schedulePlan(snapshot, { levelingDelays: delays })
      workload = computeWorkload(snapshot, schedule)
    } catch {
      delays.set(chosen.nodeId, current)
      schedule = schedulePlan(snapshot, { levelingDelays: delays })
      workload = computeWorkload(snapshot, schedule)
      findings.push(
        impossible(conflict, 'el retraso necesario se sale del horizonte del cálculo'),
      )
      return finish(false)
    }
    iterations += 1
  }

  const remaining = firstConflict(workload, unresolvable)
  if (remaining !== undefined) {
    findings.push(impossible(remaining, `se agotaron las ${String(maxIterations)} iteraciones`))
    return finish(false)
  }
  return finish(true)

  function finish(converged: boolean): LevelingResult {
    for (const [resourceId, summary] of tooBig) {
      findings.push(tooBigForTheDay(resourceId, summary))
    }
    for (const [nodeId, delay] of delays) {
      findings.push({
        severity: 'info',
        code: 'LEVELING_DELAYED',
        entityType: 'task',
        entityId: nodeId,
        message:
          `Para que quepa en la capacidad del equipo, esta tarea se retrasa ` +
          `${(delay / WORKING_DAY).toFixed(0)} día(s) laborable(s).`,
        payload: { delayMinutes: delay },
      })
    }
    return {
      schedule,
      workload,
      delays,
      findings: sortFindings(findings),
      iterations,
      converged,
    }
  }
}

function daysApart(from: string, to: string): number {
  return Math.abs(
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000),
  )
}

/** Minutos laborables que hay que sumar para que la tarea empiece tras el conflicto. */
function pushPastConflict(result: TaskResult, conflictDate: string, schedule: ScheduleOutput): number {
  const calendar = schedule.compiledCalendars.get(result.calendarUsedId)
  if (calendar === undefined) return WORKING_DAY
  const dayAfter = planInstant(addDays(calendarDate(conflictDate), 1), 0)
  try {
    return Math.max(WORKING_DAY, workingMinutesBetween(result.scheduledStart, dayAfter, calendar))
  } catch {
    // El instante cae fuera del horizonte compilado: se avanza un día y ya.
    return WORKING_DAY
  }
}

interface Conflict {
  readonly resourceId: string
  readonly date: string
  /** Último día del bloque de sobrecarga seguido al que pertenece `date`. */
  readonly blockEnd: string
  readonly plannedMinutes: number
  readonly capacityMinutes: number
  /** Minutos que pide ese día la asignación más grande, ella sola. */
  readonly largestSingleMinutes: number
  readonly assignmentIds: readonly string[]
}

/** El primer día sobreasignado en orden cronológico: se resuelve de izquierda a derecha. */
function firstConflict(workload: WorkloadOutput, skip: ReadonlySet<string>): Conflict | undefined {
  const perDay = new Map<string, { planned: number; byAssignment: Map<string, number> }>()
  for (const cell of workload.timephased) {
    const key = `${cell.resourceId}|${cell.date}`
    const bucket = perDay.get(key) ?? { planned: 0, byAssignment: new Map<string, number>() }
    bucket.planned += cell.plannedMinutes
    bucket.byAssignment.set(cell.assignmentId, (bucket.byAssignment.get(cell.assignmentId) ?? 0) + cell.plannedMinutes)
    perDay.set(key, bucket)
  }

  const conflicts: Omit<Conflict, 'blockEnd'>[] = []
  for (const [key, bucket] of perDay) {
    if (skip.has(key)) continue
    const [resourceId, date] = key.split('|') as [string, string]
    const capacity = workload.capacity.capacityOf(resourceId, date as never)
    if (bucket.planned <= capacity) continue
    conflicts.push({
      resourceId,
      date,
      plannedMinutes: bucket.planned,
      capacityMinutes: capacity,
      largestSingleMinutes: Math.max(...bucket.byAssignment.values()),
      assignmentIds: [...bucket.byAssignment.keys()].sort(),
    })
  }

  const ordered = conflicts.sort(
    (left, right) => left.date.localeCompare(right.date) || left.resourceId.localeCompare(right.resourceId),
  )
  const first = ordered[0]
  if (first === undefined) return undefined

  // El bloque de sobrecarga seguido del mismo recurso: empujar más allá del
  // bloque entero convierte decenas de iteraciones en una. Tres días naturales
  // de tolerancia para no cortar en un fin de semana.
  const sameResource = ordered.filter((conflict) => conflict.resourceId === first.resourceId).map((c) => c.date)
  let blockEnd = first.date
  for (const date of sameResource) {
    if (date <= blockEnd) continue
    if (daysApart(blockEnd, date) > 3) break
    blockEnd = date
  }

  return { ...first, blockEnd }
}

/**
 * Un aviso por persona, no uno por día: cuarenta líneas diciendo lo mismo no
 * las lee nadie, y lo que hay que cambiar es siempre lo mismo.
 */
function tooBigForTheDay(
  resourceId: string,
  summary: { first: string; last: string; days: number; worst: Conflict },
): Finding {
  const hours = (minutes: number): string => (minutes / 60).toFixed(1).replace('.', ',')
  return {
    severity: 'warning',
    code: 'LEVELING_IMPOSSIBLE',
    entityType: 'resource',
    entityId: resourceId,
    occursOn: summary.worst.date as never,
    message:
      `${String(summary.days)} día(s) entre el ${summary.first} y el ${summary.last} tienen una sola asignación ` +
      `que ya no cabe en la jornada. El peor, el ${summary.worst.date}: pide ` +
      `${hours(summary.worst.largestSingleMinutes)} h y la persona tiene ${hours(summary.worst.capacityMinutes)} h. ` +
      'Moverla de fecha no arregla nada: hay que cambiar la dedicación, la duración o el calendario.',
    payload: {
      days: summary.days,
      largestSingleMinutes: summary.worst.largestSingleMinutes,
      capacityMinutes: summary.worst.capacityMinutes,
    },
  }
}

function impossible(conflict: Conflict, reason: string): Finding {
  return {
    severity: 'error',
    code: 'LEVELING_IMPOSSIBLE',
    entityType: 'resource',
    entityId: conflict.resourceId,
    occursOn: conflict.date as never,
    message:
      `La nivelación no puede resolver la sobrecarga del ${conflict.date}: ${reason}. ` +
      'La sobrecarga se deja visible en vez de esconderla.',
    payload: { plannedMinutes: conflict.plannedMinutes, capacityMinutes: conflict.capacityMinutes },
  }
}
