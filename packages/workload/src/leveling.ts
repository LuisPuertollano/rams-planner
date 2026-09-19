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

import { addDays, calendarDate, sortFindings, type Finding, type FindingPayload } from '@planner/domain'
import { planInstant, workingMinutesBetween } from '@planner/calendar'
import { schedulePlan, type PlanSnapshot, type ScheduleOutput, type TaskResult } from '@planner/scheduler'
import { computeCapacity, type CapacityIndex } from './capacity.js'
import { cellsForAssignment, computeWorkload, type TimephasedCell, type WorkloadOutput } from './timephase.js'
import type { CompiledCalendar } from '@planner/calendar'

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

/**
 * La carga del plan en la forma que la nivelación necesita: agregada por
 * (recurso, día), y **parcheable**.
 *
 * Existe por una medición. El bucle de nivelar repetía el reparto completo en
 * cada vuelta —1 683 asignaciones, 168 616 celdas— para mover, de mediana,
 * **tres tareas de mil ochocientas**. Eran 703 ms de los 844 ms de cada
 * iteración, y con el tope en 400 vueltas, seis minutos que además terminaban
 * sin converger.
 *
 * Aquí se reparte una vez y después se parchea: se restan las celdas de los
 * nodos que se han movido, se vuelven a repartir **esos** y se suman. Las
 * celdas las produce `cellsForAssignment`, la misma función que usa el reparto
 * completo, así que el agregado es el mismo que saldría de rehacerlo entero.
 */
interface CargaPorDia {
  minutos: number
  /**
   * El recurso y el día, ya partidos.
   *
   * La clave del índice es `recurso|día` y `firstConflict` los necesita por
   * separado. Guardarlos aquí no es redundancia: es no hacer un `split` y dos
   * concatenaciones por cada día y cada vuelta, que con 27 personas y cuatro
   * años son millones de cadenas que el recolector luego tiene que barrer.
   */
  readonly resourceId: string
  readonly date: string
  /** La capacidad de esa persona ese día. No depende del plan, así que no cambia. */
  readonly capacidad: number
  /** Minutos de cada asignación ese día: la nivelación mira la más grande. */
  readonly porAsignacion: Map<string, number>
}

class IndiceDeCarga {
  private readonly celdasPorNodo = new Map<string, readonly TimephasedCell[]>()
  private readonly porRecursoYDia = new Map<string, CargaPorDia>()

  constructor(
    private readonly snapshot: PlanSnapshot,
    private readonly compiled: Map<string, CompiledCalendar>,
    private readonly asignacionesPorNodo: ReadonlyMap<string, readonly PlanSnapshot['assignments'][number][]>,
    private readonly recursos: ReadonlyMap<string, PlanSnapshot['resources'][number]>,
    private readonly capacidad: CapacityIndex,
  ) {}

  /** Reparte de cero. Una vez por nivelación. */
  build(schedule: ScheduleOutput): void {
    this.celdasPorNodo.clear()
    this.porRecursoYDia.clear()
    const resultado = new Map(schedule.taskResults.map((r) => [r.nodeId, r]))
    for (const nodeId of this.asignacionesPorNodo.keys()) this.rehacer(nodeId, resultado.get(nodeId))
  }

  /** Rehace sólo los nodos cuyo tramo ha cambiado. */
  patch(schedule: ScheduleOutput, movidos: Iterable<string>): void {
    const resultado = new Map(schedule.taskResults.map((r) => [r.nodeId, r]))
    for (const nodeId of movidos) {
      if (!this.asignacionesPorNodo.has(nodeId)) continue
      this.quitar(nodeId)
      this.rehacer(nodeId, resultado.get(nodeId))
    }
  }

  private quitar(nodeId: string): void {
    for (const celda of this.celdasPorNodo.get(nodeId) ?? []) {
      const clave = `${celda.resourceId}|${celda.date}`
      const dia = this.porRecursoYDia.get(clave)
      if (dia === undefined) continue
      dia.minutos -= celda.plannedMinutes
      const resto = (dia.porAsignacion.get(celda.assignmentId) ?? 0) - celda.plannedMinutes
      if (resto <= 0) dia.porAsignacion.delete(celda.assignmentId)
      else dia.porAsignacion.set(celda.assignmentId, resto)
      // Un día sin nada ya no es un día: si se quedara con cero, `firstConflict`
      // lo recorrería para siempre sin que nunca sea un conflicto.
      if (dia.porAsignacion.size === 0) this.porRecursoYDia.delete(clave)
    }
    this.celdasPorNodo.delete(nodeId)
  }

  private rehacer(nodeId: string, result: TaskResult | undefined): void {
    const celdas: TimephasedCell[] = []
    for (const assignment of this.asignacionesPorNodo.get(nodeId) ?? []) {
      const reparto = cellsForAssignment(
        this.snapshot,
        this.compiled,
        assignment,
        result,
        this.recursos.get(assignment.resourceId),
      )
      celdas.push(...reparto.cells)
    }
    this.celdasPorNodo.set(nodeId, celdas)
    for (const celda of celdas) {
      const clave = `${celda.resourceId}|${celda.date}`
      let dia = this.porRecursoYDia.get(clave)
      if (dia === undefined) {
        dia = {
          minutos: 0,
          resourceId: celda.resourceId,
          date: celda.date,
          capacidad: this.capacidad.capacityOf(celda.resourceId, celda.date),
          porAsignacion: new Map<string, number>(),
        }
        this.porRecursoYDia.set(clave, dia)
      }
      dia.minutos += celda.plannedMinutes
      dia.porAsignacion.set(
        celda.assignmentId,
        (dia.porAsignacion.get(celda.assignmentId) ?? 0) + celda.plannedMinutes,
      )
    }
  }

  get dias(): ReadonlyMap<string, CargaPorDia> {
    return this.porRecursoYDia
  }

  /** Todas las celdas, para poder compararlas con las del reparto completo. */
  get celdas(): readonly TimephasedCell[] {
    return [...this.celdasPorNodo.values()].flat()
  }
}

export function levelPlan(snapshot: PlanSnapshot, options: LevelingOptions = {}): LevelingResult {
  const maxIterations = options.maxIterations ?? 400
  // Dos años laborables. Un plan que necesite más que eso no tiene un problema
  // de nivelación: tiene un problema de plantilla, y eso lo dicen los hallazgos
  // de sobrecarga, no un retraso automático.
  const maxDelay = options.maxDelayMinutes ?? 500 * WORKING_DAY

  const delays = new Map<string, number>()
  // Los hallazgos hablan de personas y de tareas, no de identificadores.
  const nombreDeNodo = new Map(snapshot.nodes.map((node) => [node.id, node.name]))
  const nombreDeRecurso = new Map(snapshot.resources.map((resource) => [resource.id, resource.displayName]))
  const nombreNodo = (nodeId: string): string => nombreDeNodo.get(nodeId) ?? nodeId
  const nombreRecurso = (resourceId: string): string => nombreDeRecurso.get(resourceId) ?? resourceId
  const priorityOf = new Map(snapshot.projects.map((project) => [project.id, project.priority]))
  const assignmentsByNode = new Map<string, string[]>()
  for (const assignment of snapshot.assignments) {
    const bucket = assignmentsByNode.get(assignment.nodeId) ?? []
    bucket.push(assignment.id)
    assignmentsByNode.set(assignment.nodeId, bucket)
  }
  const nodeOfAssignment = new Map(snapshot.assignments.map((assignment) => [assignment.id, assignment.nodeId]))
  // Lo que nivelar no puede mover. Además de las restricciones duras, las
  // tareas continuas (ADR-0051): su ventana la ponen dos puertas, y retrasar la
  // gestión de un proyecto «para descargar a alguien» la sacaría de la fase que
  // la define. Lo que se descarga es otra cosa.
  const hardConstraint = new Set(
    snapshot.tasks
      .filter(
        (task) =>
          task.constraintKind === 'must_start_on' ||
          task.constraintKind === 'must_finish_on' ||
          (task.spanFrom !== undefined && task.spanTo !== undefined),
      )
      .map((task) => task.nodeId),
  )

  let schedule = schedulePlan(snapshot, { levelingDelays: delays })
  // La capacidad NO depende del plan: sale del calendario y de la jornada de
  // cada persona. Rehacerla en cada vuelta costaba 105 ms para dar siempre lo
  // mismo, así que se calcula una vez y se reutiliza.
  const compiled = new Map(schedule.compiledCalendars)
  const capacity = computeCapacity(snapshot, compiled)
  const asignacionesPorNodo = new Map<string, PlanSnapshot['assignments'][number][]>()
  for (const assignment of snapshot.assignments) {
    const bucket = asignacionesPorNodo.get(assignment.nodeId) ?? []
    bucket.push(assignment)
    asignacionesPorNodo.set(assignment.nodeId, bucket)
  }
  const recursosPorId = new Map(snapshot.resources.map((resource) => [resource.id, resource]))
  const carga = new IndiceDeCarga(snapshot, compiled, asignacionesPorNodo, recursosPorId, capacity)
  carga.build(schedule)
  /** Dónde está cada tarea ahora, para saber cuáles se mueven al retrasar una. */
  let tramos = tramosDe(schedule)
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
    const conflict = firstConflict(carga.dias, unresolvable)
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
      findings.push(
        impossible(conflict, nombreRecurso(conflict.resourceId), 'restriccion-dura', {
          reason: 'todas las tareas implicadas tienen una restricción dura',
        }),
      )
      return finish(false)
    }

    // Se empuja **más allá del día en conflicto de una vez**, no un día por
    // iteración: retrasando de uno en uno, dos tareas que se solapan se
    // persiguen sin converger nunca.
    const current = delays.get(chosen.nodeId) ?? 0
    const increment = pushPastConflict(chosen.result, conflict.blockEnd, schedule)
    if (current + increment > maxDelay) {
      findings.push(
        impossible(conflict, nombreRecurso(conflict.resourceId), 'retraso-maximo', {
          task: nombreNodo(chosen.nodeId),
          reason: `«${nombreNodo(chosen.nodeId)}» ya acumula el retraso máximo permitido`,
        }),
      )
      return finish(false)
    }

    delays.set(chosen.nodeId, current + increment)
    beingPushed.set(stickyKey, chosen.nodeId)

    // Retrasar puede empujar una tarea fuera del horizonte compilado. Eso no es
    // un fallo del motor: es que el plan no cabe. Se deshace el último retraso
    // y se dice, en vez de reventar con un error de calendario.
    try {
      schedule = schedulePlan(snapshot, { levelingDelays: delays })
      const siguientes = tramosDe(schedule)
      carga.patch(schedule, movidos(tramos, siguientes))
      tramos = siguientes
    } catch {
      delays.set(chosen.nodeId, current)
      schedule = schedulePlan(snapshot, { levelingDelays: delays })
      const siguientes = tramosDe(schedule)
      carga.patch(schedule, movidos(tramos, siguientes))
      tramos = siguientes
      findings.push(
        impossible(conflict, nombreRecurso(conflict.resourceId), 'fuera-del-horizonte', {
          reason: 'el retraso necesario se sale del horizonte del cálculo',
        }),
      )
      return finish(false)
    }
    iterations += 1
  }

  const remaining = firstConflict(carga.dias, unresolvable)
  if (remaining !== undefined) {
    findings.push(
      impossible(remaining, nombreRecurso(remaining.resourceId), 'iteraciones-agotadas', {
        iterations: maxIterations,
        reason: `se agotaron las ${String(maxIterations)} iteraciones`,
      }),
    )
    return finish(false)
  }
  return finish(true)

  function finish(converged: boolean): LevelingResult {
    for (const [resourceId, summary] of tooBig) {
      findings.push(tooBigForTheDay(resourceId, nombreRecurso(resourceId), summary))
    }
    for (const [nodeId, delay] of delays) {
      findings.push({
        severity: 'info',
        code: 'LEVELING_DELAYED',
        entityType: 'task',
        entityId: nodeId,
        message:
          `Para que quepa en la capacidad del equipo, «${nombreNodo(nodeId)}» se retrasa ` +
          `${(delay / WORKING_DAY).toFixed(0)} día(s) laborable(s).`,
        payload: { task: nombreNodo(nodeId), delayMinutes: delay },
      })
    }
    return {
      schedule,
      // El reparto que SE DEVUELVE lo hace la función completa, una sola vez y
      // al final. El índice de arriba sólo sirve para decidir qué tarea cede;
      // así, lo que sale de nivelar es lo mismo que salía antes, producido por
      // el mismo código, y esta optimización no puede desviar el resultado.
      workload: computeWorkload(snapshot, schedule),
      delays,
      findings: sortFindings(findings),
      iterations,
      converged,
    }
  }
}

/**
 * Dónde cae cada tarea, en una cadena comparable.
 *
 * Es lo único que hace falta para saber si su reparto cambia: si una tarea
 * empieza y acaba donde estaba, sus celdas son las mismas.
 */
function tramosDe(schedule: ScheduleOutput): ReadonlyMap<string, string> {
  const tramos = new Map<string, string>()
  for (const result of schedule.taskResults) {
    tramos.set(
      result.nodeId,
      `${result.scheduledStart.date}|${String(result.scheduledStart.minuteOfDay)}|` +
        `${result.scheduledFinish.date}|${String(result.scheduledFinish.minuteOfDay)}|` +
        String(result.durationMinutes),
    )
  }
  return tramos
}

/** Las tareas cuyo tramo ha cambiado, y las que han aparecido o desaparecido. */
function movidos(
  antes: ReadonlyMap<string, string>,
  despues: ReadonlyMap<string, string>,
): readonly string[] {
  const lista: string[] = []
  for (const [nodeId, tramo] of despues) if (antes.get(nodeId) !== tramo) lista.push(nodeId)
  for (const nodeId of antes.keys()) if (!despues.has(nodeId)) lista.push(nodeId)
  return lista
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
function firstConflict(
  dias: ReadonlyMap<string, CargaPorDia>,
  skip: ReadonlySet<string>,
): Conflict | undefined {
  // Una sola pasada y sin construir nada que luego se tire.
  //
  // Antes esto montaba un objeto por cada día sobrecargado —con su
  // `Math.max(...)` y su `[...keys()].sort()`— y ordenaba la lista entera para
  // quedarse con el primero. Con 27 personas y cuatro años de horizonte son
  // decenas de miles de días recorridos en cada una de las mil y pico vueltas,
  // y el 90 % del trabajo se tiraba. Ahora se busca el mínimo con el mismo
  // criterio —día y, en empate, recurso— y las cuentas caras se hacen una vez,
  // sobre el que gana.
  //
  // El resultado es idéntico: coger el primero de una lista ordenada y buscar
  // el mínimo con ese mismo orden son la misma cosa.
  let mejor: CargaPorDia | undefined
  // Los días sobrecargados de cada persona, sólo la fecha: hacen falta para
  // saber hasta dónde llega el bloque de sobrecarga del que gane.
  const diasPorRecurso = new Map<string, string[]>()

  for (const [key, bucket] of dias) {
    if (bucket.minutos <= bucket.capacidad) continue
    if (skip.has(key)) continue
    const suyos = diasPorRecurso.get(bucket.resourceId)
    if (suyos === undefined) diasPorRecurso.set(bucket.resourceId, [bucket.date])
    else suyos.push(bucket.date)
    if (
      mejor === undefined ||
      bucket.date < mejor.date ||
      (bucket.date === mejor.date && bucket.resourceId < mejor.resourceId)
    ) {
      mejor = bucket
    }
  }
  if (mejor === undefined) return undefined

  // El bloque de sobrecarga seguido del mismo recurso: empujar más allá del
  // bloque entero convierte decenas de iteraciones en una. Tres días naturales
  // de tolerancia para no cortar en un fin de semana.
  let blockEnd = mejor.date
  for (const date of (diasPorRecurso.get(mejor.resourceId) ?? []).sort()) {
    if (date <= blockEnd) continue
    if (daysApart(blockEnd, date) > 3) break
    blockEnd = date
  }

  return {
    resourceId: mejor.resourceId,
    date: mejor.date,
    plannedMinutes: mejor.minutos,
    capacityMinutes: mejor.capacidad,
    largestSingleMinutes: Math.max(...mejor.porAsignacion.values()),
    assignmentIds: [...mejor.porAsignacion.keys()].sort(),
    blockEnd,
  }
}

/**
 * Un aviso por persona, no uno por día: cuarenta líneas diciendo lo mismo no
 * las lee nadie, y lo que hay que cambiar es siempre lo mismo.
 */
function tooBigForTheDay(
  resourceId: string,
  resource: string,
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
      `de «${resource}» que ya no cabe en la jornada. El peor, el ${summary.worst.date}: pide ` +
      `${hours(summary.worst.largestSingleMinutes)} h y la persona tiene ${hours(summary.worst.capacityMinutes)} h. ` +
      'Moverla de fecha no arregla nada: hay que cambiar la dedicación, la duración o el calendario.',
    payload: {
      variant: 'no-cabe-en-la-jornada',
      resource,
      first: summary.first,
      last: summary.last,
      days: summary.days,
      peakDate: summary.worst.date,
      largestSingleMinutes: summary.worst.largestSingleMinutes,
      capacityMinutes: summary.worst.capacityMinutes,
    },
  }
}

/**
 * La nivelación se rinde en un día concreto.
 *
 * `variant` dice por qué, y `reason` guarda la frase castellana de siempre para
 * que un hallazgo antiguo siga legible. El texto que se enseña se construye de
 * la variante, no de esa frase.
 */
function impossible(
  conflict: Conflict,
  resource: string,
  variant: 'restriccion-dura' | 'retraso-maximo' | 'fuera-del-horizonte' | 'iteraciones-agotadas',
  extra: FindingPayload & { readonly reason: string },
): Finding {
  return {
    severity: 'error',
    code: 'LEVELING_IMPOSSIBLE',
    entityType: 'resource',
    entityId: conflict.resourceId,
    occursOn: conflict.date as never,
    message:
      `La nivelación no puede resolver la sobrecarga de «${resource}» del ${conflict.date}: ` +
      `${extra.reason}. La sobrecarga se deja visible en vez de esconderla.`,
    payload: {
      variant,
      resource,
      date: conflict.date,
      plannedMinutes: conflict.plannedMinutes,
      capacityMinutes: conflict.capacityMinutes,
      ...extra,
    },
  }
}
