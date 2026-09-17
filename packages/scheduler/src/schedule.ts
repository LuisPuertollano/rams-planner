/**
 * El motor de planificación: CPM con calendarios, restricciones y explicaciones.
 *
 * Es una función pura. Todo lo que necesita entra por el snapshot y todo lo que
 * produce sale por el resultado (P2). Cada fecha que fija deja constancia de la
 * regla que la produjo y de la entrada responsable (P4).
 */

import {
  formatWorkMinutesAsHours,
  sortFindings,
  workMinutes,
  type CalendarDate,
  type Finding,
  type FindingPayload,
} from '@planner/domain'
import {
  addWorkingMinutes,
  addWorkingMinutesClamped,
  compileCalendar,
  snapToWorkingTime,
  subtractWorkingMinutesClamped,
  workingMinutesBetween,
  type CompiledCalendar,
  type PlanInstant,
} from '@planner/calendar'
import { NOOP_SINK, type DerivationSink } from '@planner/explain'
import { resolveTaskMetrics, type TaskMetrics } from './equation.js'
import { topologicalOrder } from './graph.js'
import { absoluteOf, earlierOf, endOfDay, formatInstant, laterOf, startOfDay } from './instant.js'
import type {
  AssignmentDefinition,
  DependencyDefinition,
  PlanSnapshot,
  ScheduleOutput,
  TaskDefinition,
  TaskResult,
  WbsNodeDefinition,
} from './plan.js'

export interface ScheduleOptions {
  /** Holgura por debajo de la cual una tarea se considera crítica. Por defecto 0. */
  readonly criticalSlackMinutes?: number
  readonly derivations?: DerivationSink
  /**
   * Retrasos de nivelación por tarea, en minutos laborables. Los calcula
   * `@planner/workload`; el motor sólo los aplica, después de las dependencias
   * y antes de las restricciones, para que una restricción dura siga ganando.
   */
  readonly levelingDelays?: ReadonlyMap<string, number>
}

interface Working {
  readonly node: WbsNodeDefinition
  readonly task: TaskDefinition
  readonly metrics: TaskMetrics
  readonly calendar: CompiledCalendar
  earlyStart: PlanInstant
  earlyFinish: PlanInstant
  lateStart: PlanInstant
  lateFinish: PlanInstant
}

export function schedulePlan(snapshot: PlanSnapshot, options: ScheduleOptions = {}): ScheduleOutput {
  const sink = options.derivations ?? NOOP_SINK
  const criticalSlack = options.criticalSlackMinutes ?? 0
  const horizonFrom = snapshot.horizon.from
  const findings: Finding[] = []

  const compiled = new Map<string, CompiledCalendar>()
  const calendarFor = (calendarId: string): CompiledCalendar => {
    const cached = compiled.get(calendarId)
    if (cached !== undefined) return cached
    const fresh = compileCalendar(snapshot.calendars, calendarId, snapshot.horizon)
    compiled.set(calendarId, fresh)
    return fresh
  }

  const calendarCodeById = new Map(snapshot.calendars.map((calendar) => [calendar.id, calendar.code]))
  const codeOf = (calendarId: string | undefined): string | null =>
    calendarId === undefined ? null : (calendarCodeById.get(calendarId) ?? calendarId)

  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]))
  const projectsById = new Map(snapshot.projects.map((project) => [project.id, project]))
  const resourcesById = new Map(snapshot.resources.map((resource) => [resource.id, resource]))
  const tasksByNode = new Map(snapshot.tasks.map((task) => [task.nodeId, task]))
  const assignmentsByNode = groupBy(snapshot.assignments, (assignment) => assignment.nodeId)
  const childrenByParent = groupBy(snapshot.nodes, (node) => node.parentId ?? '')

  // --- Hojas planificables --------------------------------------------------
  const leaves: Working[] = []
  for (const node of snapshot.nodes) {
    if (node.kind !== 'task' && node.kind !== 'milestone') continue
    const task = tasksByNode.get(node.id)
    if (task === undefined) continue
    const assignments = assignmentsByNode.get(node.id) ?? []
    const metrics = resolveTaskMetrics(task, assignments, sink)
    const calendarId = resolveCalendarId(task, node, assignments)
    const calendar = calendarFor(calendarId)
    sink.record({
      targetType: 'task.calendarUsedId',
      targetId: node.id,
      rule: 'CALENDAR_RESOLUTION',
      inputs: {
        taskCalendar: codeOf(task.calendarId),
        resourceCalendar: assignments.length === 1
          ? codeOf(resourcesById.get(assignments[0]?.resourceId ?? '')?.calendarId)
          : null,
        projectCalendar: codeOf(projectsById.get(node.projectId)?.calendarId),
        defaultCalendar: codeOf(snapshot.defaultCalendarId),
      },
      output: codeOf(calendarId),
    })
    const origin = startOfDay(horizonFrom)
    leaves.push({
      node,
      task,
      metrics,
      calendar,
      earlyStart: origin,
      earlyFinish: origin,
      lateStart: origin,
      lateFinish: origin,
    })
  }

  function resolveCalendarId(
    task: TaskDefinition,
    node: WbsNodeDefinition,
    assignments: readonly AssignmentDefinition[],
  ): string {
    if (task.calendarId !== undefined) return task.calendarId
    if (assignments.length === 1) {
      const resource = resourcesById.get(assignments[0]?.resourceId ?? '')
      if (resource?.calendarId !== undefined) return resource.calendarId
    }
    const project = projectsById.get(node.projectId)
    if (project?.calendarId !== undefined) return project.calendarId
    return snapshot.defaultCalendarId
  }

  const leafById = new Map(leaves.map((leaf) => [leaf.node.id, leaf]))

  // --- Dependencias normalizadas a hojas ------------------------------------
  const links = expandDependencies(snapshot.dependencies, nodesById, childrenByParent, leafById)
  const successorsOf = groupBy(links, (link) => link.predecessorNodeId)
  const predecessorsOf = groupBy(links, (link) => link.successorNodeId)

  // --- Validación del grafo -------------------------------------------------
  const { order, cycle } = topologicalOrder(
    leaves.map((leaf) => leaf.node.id),
    links,
  )
  if (cycle !== undefined) {
    const names = cycle.map((id) => nodesById.get(id)?.name ?? id).join(' → ')
    findings.push({
      severity: 'blocking',
      code: 'DEPENDENCY_CYCLE',
      entityType: 'dependency',
      entityId: cycle[0] ?? 'desconocido',
      message: `Hay un ciclo de dependencias: ${names}. El cálculo no puede continuar; rompe uno de los enlaces.`,
      // Los nombres, no los identificadores: es lo que la frase enseña.
      payload: { cycle: names },
    })
    return { taskResults: [], findings: sortFindings(findings), compiledCalendars: compiled, completed: false }
  }

  // Los enlaces que no se pueden aplicar porque el otro extremo no está en el
  // plan. Avisa **antes** de calcular, porque lo que sigue son fechas que salen
  // sin ese enlace: si alguien archivó el proyecto de la predecesora, la
  // sucesora se adelanta, y eso tiene que verse en vez de pasar en silencio.
  for (const suelto of snapshot.dependenciesOutOfPlan) {
    findings.push({
      severity: 'warning',
      code: 'DEPENDENCY_OUT_OF_PLAN',
      entityType: 'dependency',
      entityId: suelto.id,
      message:
        `«${suelto.nodeName}» ${suelto.missingIsPredecessor ? 'espera a' : 'es predecesora de'} ` +
        `«${suelto.otherName}» (${suelto.otherProjectCode}), que está fuera del plan: ` +
        `su proyecto está ${suelto.reason === 'plantilla' ? 'guardado como plantilla' : suelto.reason}. ` +
        'El enlace no se aplica y las fechas salen sin él.',
      payload: {
        variant: suelto.missingIsPredecessor ? 'falta-la-predecesora' : 'falta-la-sucesora',
        task: suelto.nodeName,
        other: suelto.otherName,
        project: suelto.otherProjectCode,
        reason: suelto.reason,
      },
    })
  }

  // --- Paso adelante --------------------------------------------------------
  for (const nodeId of order) {
    const leaf = leafById.get(nodeId)
    if (leaf === undefined) continue
    const project = projectsById.get(leaf.node.projectId)
    const projectStart = startOfDay(project?.statusStart ?? horizonFrom)

    let earlyStart = projectStart
    let reason = 'PROJECT_START'
    let reasonInput: string | null = null
    let reasonProject: string | null = project?.code ?? null
    let reasonLag: number | null = null

    for (const link of predecessorsOf.get(nodeId) ?? []) {
      const predecessor = leafById.get(link.predecessorNodeId)
      if (predecessor === undefined) continue
      const candidate = candidateStartFrom(link, predecessor, leaf)
      if (absoluteOf(candidate, horizonFrom) > absoluteOf(earlyStart, horizonFrom)) {
        earlyStart = candidate
        reason = `${link.kind}_LINK`
        reasonInput = nodesById.get(link.predecessorNodeId)?.name ?? link.predecessorNodeId
        reasonProject = null
        reasonLag = link.lagMinutes === 0 ? null : link.lagMinutes
      }
    }

    earlyStart = snapToWorkingTime(earlyStart, leaf.calendar, 'forward')

    const levelingDelay = options.levelingDelays?.get(nodeId) ?? 0
    if (levelingDelay > 0) {
      earlyStart = addWorkingMinutesClamped(earlyStart, levelingDelay, leaf.calendar)
      reason = 'LEVELING_DELAY'
      sink.record({
        targetType: 'task.levelingDelay',
        targetId: nodeId,
        rule: 'LEVELING_DELAY',
        inputs: { delayMinutes: levelingDelay },
        output: formatInstant(earlyStart),
      })
    }

    const constrained = applyConstraint(leaf, earlyStart, findings, sink, horizonFrom)
    leaf.earlyStart = constrained.start
    leaf.earlyFinish = constrained.finish

    sink.record({
      targetType: 'task.earlyStart',
      targetId: nodeId,
      rule: constrained.rule ?? reason,
      inputs: {
        predecessor: reasonInput,
        project: reasonProject,
        lagMinutes: reasonLag,
        constraintKind: leaf.task.constraintKind,
        constraintDate: leaf.task.constraintDate ?? null,
        calendar: codeOf(leaf.calendar.calendarId),
      },
      output: formatInstant(leaf.earlyStart),
    })
  }

  function candidateStartFrom(
    link: DependencyDefinition,
    predecessor: Working,
    successor: Working,
  ): PlanInstant {
    const base =
      link.kind === 'FS' || link.kind === 'FF' ? predecessor.earlyFinish : predecessor.earlyStart
    const withLag = applyLag(base, link.lagMinutes, successor.calendar)
    if (link.kind === 'FS' || link.kind === 'SS') return withLag
    // FF y SF fijan el FIN del sucesor: se retrocede su duración. Si eso se sale
    // del horizonte, el candidato se queda en su inicio: perderá la comparación
    // con el arranque del proyecto, que es lo correcto.
    return subtractWorkingMinutesClamped(withLag, successor.metrics.durationMinutes, successor.calendar)
  }

  // --- Paso atrás -----------------------------------------------------------
  // El fin de referencia es el de CADA proyecto, no el del plan entero: con el
  // global, un proyecto que acaba en junio tendría medio año de holgura sólo
  // porque otro acaba en diciembre, y su camino crítico desaparecería.
  const projectFinish = new Map<string, PlanInstant>()
  for (const leaf of leaves) {
    const current = projectFinish.get(leaf.node.projectId)
    projectFinish.set(
      leaf.node.projectId,
      current === undefined ? leaf.earlyFinish : laterOf(current, leaf.earlyFinish, horizonFrom),
    )
  }

  for (const nodeId of [...order].reverse()) {
    const leaf = leafById.get(nodeId)
    if (leaf === undefined) continue

    let lateFinish = projectFinish.get(leaf.node.projectId) ?? leaf.earlyFinish
    for (const link of successorsOf.get(nodeId) ?? []) {
      const successor = leafById.get(link.successorNodeId)
      if (successor === undefined) continue
      const candidate = candidateFinishFrom(link, successor, leaf)
      lateFinish = earlierOf(lateFinish, candidate, horizonFrom)
    }

    // Una restricción dura ancla también el paso atrás.
    if (leaf.task.constraintKind === 'must_start_on' || leaf.task.constraintKind === 'must_finish_on') {
      lateFinish = leaf.earlyFinish
    }

    leaf.lateFinish = snapToWorkingTime(lateFinish, leaf.calendar, 'backward')
    // Una restricción infeasible puede llevar el inicio tardío antes del
    // horizonte. La holgura negativa resultante ya es la señal; el conflicto se
    // ha emitido como hallazgo y no hace falta reventar el cálculo entero.
    leaf.lateStart = subtractWorkingMinutesClamped(
      leaf.lateFinish,
      leaf.metrics.durationMinutes,
      leaf.calendar,
    )
  }

  function candidateFinishFrom(
    link: DependencyDefinition,
    successor: Working,
    predecessor: Working,
  ): PlanInstant {
    const base = link.kind === 'FS' || link.kind === 'SS' ? successor.lateStart : successor.lateFinish
    const withoutLag = applyLag(base, -link.lagMinutes, predecessor.calendar)
    if (link.kind === 'FS' || link.kind === 'FF') return withoutLag
    // SS y SF limitan el INICIO del predecesor: se avanza su duración.
    return addWorkingMinutesClamped(withoutLag, predecessor.metrics.durationMinutes, predecessor.calendar)
  }

  // --- Holguras, criticidad y resultado de las hojas ------------------------
  const results: TaskResult[] = []
  for (const leaf of leaves) {
    const totalSlack = safeBetween(leaf.earlyFinish, leaf.lateFinish, leaf.calendar, horizonFrom)
    const successorStarts = (successorsOf.get(leaf.node.id) ?? [])
      .map((link) => leafById.get(link.successorNodeId)?.earlyStart)
      .filter((instant): instant is PlanInstant => instant !== undefined)
    const freeSlack =
      successorStarts.length === 0
        ? totalSlack
        : Math.min(
            ...successorStarts.map((start) => safeBetween(leaf.earlyFinish, start, leaf.calendar, horizonFrom)),
          )

    const alap = leaf.task.constraintKind === 'alap'
    const scheduledStart = alap ? leaf.lateStart : leaf.earlyStart
    const scheduledFinish = alap ? leaf.lateFinish : leaf.earlyFinish

    checkDeadline(leaf, scheduledFinish, findings, horizonFrom)
    checkWorkAndAssignments(leaf, assignmentsByNode.get(leaf.node.id) ?? [], findings)
    checkSkills(leaf, assignmentsByNode.get(leaf.node.id) ?? [], snapshot, findings)

    results.push({
      nodeId: leaf.node.id,
      projectId: leaf.node.projectId,
      earlyStart: leaf.earlyStart,
      earlyFinish: leaf.earlyFinish,
      lateStart: leaf.lateStart,
      lateFinish: leaf.lateFinish,
      scheduledStart,
      scheduledFinish,
      durationMinutes: leaf.metrics.durationMinutes,
      workMinutes: leaf.metrics.workMinutes,
      totalSlackMinutes: totalSlack,
      freeSlackMinutes: freeSlack,
      isCritical: totalSlack <= criticalSlack,
      levelingDelayMinutes: options.levelingDelays?.get(leaf.node.id) ?? 0,
      percentCompleteBp: leaf.task.percentCompleteBp,
      calendarUsedId: leaf.calendar.calendarId,
      isContainer: false,
    })
  }

  // --- Agregación de contenedores ------------------------------------------
  const resultByNode = new Map(results.map((result) => [result.nodeId, result]))
  const containers = snapshot.nodes.filter((node) => node.kind === 'phase' || node.kind === 'work_package')
  for (const container of [...containers].sort((left, right) => depthOf(right, nodesById) - depthOf(left, nodesById))) {
    const children = collectDescendantResults(container.id, childrenByParent, resultByNode)
    if (children.length === 0) continue
    const aggregated = aggregate(container, children, snapshot.defaultCalendarId, horizonFrom)
    resultByNode.set(container.id, aggregated)
    results.push(aggregated)
  }

  return {
    taskResults: results.sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    findings: sortFindings(findings),
    compiledCalendars: compiled,
    completed: true,
  }
}

// ---------------------------------------------------------------------------
// Restricciones
// ---------------------------------------------------------------------------

interface ConstrainedSpan {
  readonly start: PlanInstant
  readonly finish: PlanInstant
  readonly rule?: string
}

function applyConstraint(
  leaf: Working,
  dependencyStart: PlanInstant,
  findings: Finding[],
  sink: DerivationSink,
  horizonFrom: CalendarDate,
): ConstrainedSpan {
  const { task, calendar, metrics } = leaf
  const finishOf = (start: PlanInstant): PlanInstant =>
    addWorkingMinutes(start, metrics.durationMinutes, calendar)

  const date = task.constraintDate
  const naturalFinish = finishOf(dependencyStart)

  // La variante es la clase de restricción: discrimina exactamente las cuatro
  // situaciones que este código describe.
  const conflict = (message: string, extra: FindingPayload): void => {
    findings.push({
      severity: 'error',
      code: 'CONSTRAINT_CONFLICT',
      entityType: 'task',
      entityId: task.nodeId,
      message,
      payload: {
        variant: task.constraintKind,
        task: leaf.node.name,
        constraintDate: date ?? null,
        ...extra,
      },
    })
  }

  switch (task.constraintKind) {
    case 'asap':
    case 'alap':
      return { start: dependencyStart, finish: naturalFinish }

    case 'start_no_earlier_than': {
      if (date === undefined) return { start: dependencyStart, finish: naturalFinish }
      const floor = snapToWorkingTime(startOfDay(date), calendar, 'forward')
      const start = laterOf(dependencyStart, floor, horizonFrom)
      return { start, finish: finishOf(start), rule: 'CONSTRAINT_SNET' }
    }

    case 'start_no_later_than': {
      if (date !== undefined && absoluteOf(dependencyStart, horizonFrom) > absoluteOf(endOfDay(date), horizonFrom)) {
        conflict(
          `«${leaf.node.name}» no puede empezar antes del ${date}: sus predecesoras la empujan a ` +
            `${formatInstant(dependencyStart)}.`,
          { dependencyStart: formatInstant(dependencyStart) },
        )
      }
      return { start: dependencyStart, finish: naturalFinish }
    }

    case 'finish_no_earlier_than': {
      if (date === undefined) return { start: dependencyStart, finish: naturalFinish }
      const floor = snapToWorkingTime(endOfDay(date), calendar, 'backward')
      if (absoluteOf(naturalFinish, horizonFrom) >= absoluteOf(floor, horizonFrom)) {
        return { start: dependencyStart, finish: naturalFinish }
      }
      const start = subtractWorkingMinutesClamped(floor, metrics.durationMinutes, calendar)
      return { start, finish: floor, rule: 'CONSTRAINT_FNET' }
    }

    case 'finish_no_later_than': {
      if (date !== undefined && absoluteOf(naturalFinish, horizonFrom) > absoluteOf(endOfDay(date), horizonFrom)) {
        conflict(
          `«${leaf.node.name}» terminaría el ${formatInstant(naturalFinish)}, después del límite ${date}.`,
          { finish: formatInstant(naturalFinish) },
        )
      }
      return { start: dependencyStart, finish: naturalFinish }
    }

    case 'must_start_on': {
      if (date === undefined) return { start: dependencyStart, finish: naturalFinish }
      const start = snapToWorkingTime(startOfDay(date), calendar, 'forward')
      if (absoluteOf(dependencyStart, horizonFrom) > absoluteOf(start, horizonFrom)) {
        conflict(
          `«${leaf.node.name}» tiene que empezar el ${date}, pero sus predecesoras no lo permiten hasta ` +
            `${formatInstant(dependencyStart)}. Gana la restricción y el conflicto queda visible.`,
          { dependencyStart: formatInstant(dependencyStart) },
        )
      }
      sink.record({
        targetType: 'task.earlyStart',
        targetId: task.nodeId,
        rule: 'CONSTRAINT_MSO',
        inputs: { constraintDate: date },
        output: formatInstant(start),
      })
      return { start, finish: finishOf(start), rule: 'CONSTRAINT_MSO' }
    }

    case 'must_finish_on': {
      if (date === undefined) return { start: dependencyStart, finish: naturalFinish }
      const finish = snapToWorkingTime(endOfDay(date), calendar, 'backward')
      const start = subtractWorkingMinutesClamped(finish, metrics.durationMinutes, calendar)
      if (absoluteOf(dependencyStart, horizonFrom) > absoluteOf(start, horizonFrom)) {
        conflict(
          `«${leaf.node.name}» tiene que terminar el ${date}, lo que exige empezar el ${formatInstant(start)}, ` +
            'antes de lo que permiten sus predecesoras.',
          { start: formatInstant(start) },
        )
      }
      return { start, finish, rule: 'CONSTRAINT_MFO' }
    }
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** El desfase se mide en minutos laborables del calendario del sucesor. */
function applyLag(base: PlanInstant, lagMinutes: number, calendar: CompiledCalendar): PlanInstant {
  if (lagMinutes === 0) return base
  return lagMinutes > 0
    ? addWorkingMinutesClamped(base, lagMinutes, calendar)
    : subtractWorkingMinutesClamped(base, -lagMinutes, calendar)
}

/** Duración entre dos instantes que puede ser negativa sin que eso sea un error. */
function safeBetween(
  from: PlanInstant,
  to: PlanInstant,
  calendar: CompiledCalendar,
  horizonFrom: CalendarDate,
): number {
  if (absoluteOf(to, horizonFrom) >= absoluteOf(from, horizonFrom)) {
    return workingMinutesBetween(from, to, calendar)
  }
  return 0 - workingMinutesBetween(to, from, calendar)
}

function checkDeadline(
  leaf: Working,
  finish: PlanInstant,
  findings: Finding[],
  horizonFrom: CalendarDate,
): void {
  const deadline = leaf.task.deadline
  if (deadline === undefined) return
  if (absoluteOf(finish, horizonFrom) <= absoluteOf(endOfDay(deadline), horizonFrom)) return
  findings.push({
    severity: 'warning',
    code: 'DEADLINE_MISSED',
    entityType: 'task',
    entityId: leaf.node.id,
    occursOn: deadline,
    message: `«${leaf.node.name}» termina el ${formatInstant(finish)}, después de su fecha objetivo ${deadline}.`,
    payload: { task: leaf.node.name, deadline, finish: formatInstant(finish) },
  })
}

/**
 * Comprueba que quien hace una tarea sabe hacerla.
 *
 * No bloquea nada: la herramienta no está para decidir quién es capaz de qué,
 * sino para que quien lo decide lo sepa. Por eso son avisos y no errores, y por
 * eso distingue entre «no tiene la competencia» y «la tiene por debajo del
 * nivel que la tarea pide»: la primera suele ser un error de asignación, la
 * segunda es a menudo una decisión consciente de formar a alguien.
 */
function checkSkills(
  leaf: Working,
  assignments: readonly AssignmentDefinition[],
  snapshot: PlanSnapshot,
  findings: Finding[],
): void {
  const required = snapshot.skillRequirements.filter((item) => item.nodeId === leaf.node.id)
  if (required.length === 0 || assignments.length === 0) return

  for (const assignment of assignments) {
    const resource = snapshot.resources.find((item) => item.id === assignment.resourceId)
    if (resource === undefined) continue
    for (const requirement of required) {
      const skillName = snapshot.skillNames[requirement.skillId] ?? requirement.skillId
      const owned = resource.skills.find((item) => item.skillId === requirement.skillId)
      if (owned === undefined) {
        findings.push({
          severity: 'warning',
          code: 'SKILL_MISSING',
          entityType: 'assignment',
          entityId: assignment.id,
          message:
            `«${resource.displayName}» está en «${leaf.node.name}», que pide ${skillName}, ` +
            'y no la tiene declarada.',
          payload: { resource: resource.displayName, task: leaf.node.name, skill: skillName },
        })
      } else if (owned.level < requirement.minLevel) {
        findings.push({
          severity: 'info',
          code: 'SKILL_BELOW_LEVEL',
          entityType: 'assignment',
          entityId: assignment.id,
          message:
            `«${resource.displayName}» está en «${leaf.node.name}» con ${skillName} de nivel ` +
            `${String(owned.level)}; la tarea pide ${String(requirement.minLevel)}.`,
          payload: {
            resource: resource.displayName,
            task: leaf.node.name,
            skill: skillName,
            level: owned.level,
            required: requirement.minLevel,
          },
        })
      }
    }
  }
}

function checkWorkAndAssignments(
  leaf: Working,
  assignments: readonly AssignmentDefinition[],
  findings: Finding[],
): void {
  if (leaf.task.isMilestone) return
  if (assignments.length === 0 && leaf.metrics.workMinutes > 0) {
    findings.push({
      severity: 'info',
      code: 'TASK_UNASSIGNED',
      entityType: 'task',
      entityId: leaf.node.id,
      message: `«${leaf.node.name}» tiene trabajo estimado pero nadie asignado.`,
      payload: { task: leaf.node.name, workMinutes: leaf.metrics.workMinutes },
    })
  }
  if (leaf.metrics.workMinutes === 0 && leaf.metrics.durationMinutes > 0) {
    findings.push({
      severity: 'info',
      code: 'TASK_NO_WORK',
      entityType: 'task',
      entityId: leaf.node.id,
      message:
        `«${leaf.node.name}» ocupa ${formatWorkMinutesAsHours(workMinutes(leaf.metrics.durationMinutes))} h ` +
        'de calendario pero no consume trabajo de nadie.',
      payload: { task: leaf.node.name, durationMinutes: leaf.metrics.durationMinutes },
    })
  }
  const standard = leaf.task.standardEffortMinutes
  if (standard !== undefined && standard > 0 && leaf.metrics.workMinutes > standard) {
    findings.push({
      severity: 'warning',
      code: 'BUDGET_EXCEEDED',
      entityType: 'task',
      entityId: leaf.node.id,
      message:
        `«${leaf.node.name}» planifica ${formatWorkMinutesAsHours(workMinutes(leaf.metrics.workMinutes))} h ` +
        `frente a las ${formatWorkMinutesAsHours(workMinutes(standard))} h del esfuerzo estándar.`,
      payload: { task: leaf.node.name, planned: leaf.metrics.workMinutes, standard },
    })
  }
}

function expandDependencies(
  dependencies: readonly DependencyDefinition[],
  nodesById: ReadonlyMap<string, WbsNodeDefinition>,
  childrenByParent: ReadonlyMap<string, readonly WbsNodeDefinition[]>,
  leafById: ReadonlyMap<string, unknown>,
): readonly DependencyDefinition[] {
  const expanded: DependencyDefinition[] = []
  for (const dependency of dependencies) {
    const predecessors = leavesUnder(dependency.predecessorNodeId, nodesById, childrenByParent, leafById)
    const successors = leavesUnder(dependency.successorNodeId, nodesById, childrenByParent, leafById)
    for (const predecessor of predecessors) {
      for (const successor of successors) {
        if (predecessor === successor) continue
        expanded.push({ ...dependency, predecessorNodeId: predecessor, successorNodeId: successor })
      }
    }
  }
  return expanded
}

/** Un enlace desde un contenedor equivale a un enlace desde cada una de sus hojas. */
function leavesUnder(
  nodeId: string,
  nodesById: ReadonlyMap<string, WbsNodeDefinition>,
  childrenByParent: ReadonlyMap<string, readonly WbsNodeDefinition[]>,
  leafById: ReadonlyMap<string, unknown>,
): readonly string[] {
  if (leafById.has(nodeId)) return [nodeId]
  if (!nodesById.has(nodeId)) return []
  const found: string[] = []
  const pending = [nodeId]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) continue
    for (const child of childrenByParent.get(current) ?? []) {
      if (leafById.has(child.id)) found.push(child.id)
      else pending.push(child.id)
    }
  }
  return found.sort()
}

function collectDescendantResults(
  nodeId: string,
  childrenByParent: ReadonlyMap<string, readonly WbsNodeDefinition[]>,
  resultByNode: ReadonlyMap<string, TaskResult>,
): readonly TaskResult[] {
  const found: TaskResult[] = []
  for (const child of childrenByParent.get(nodeId) ?? []) {
    const result = resultByNode.get(child.id)
    if (result !== undefined) found.push(result)
    else found.push(...collectDescendantResults(child.id, childrenByParent, resultByNode))
  }
  return found
}

function aggregate(
  container: WbsNodeDefinition,
  children: readonly TaskResult[],
  defaultCalendarId: string,
  horizonFrom: CalendarDate,
): TaskResult {
  const first = children[0]
  if (first === undefined) throw new Error('aggregate necesita al menos un hijo')

  let start = first.scheduledStart
  let finish = first.scheduledFinish
  let work = 0
  let weightedProgress = 0
  let critical = false

  for (const child of children) {
    start = earlierOf(start, child.scheduledStart, horizonFrom)
    finish = laterOf(finish, child.scheduledFinish, horizonFrom)
    work += child.workMinutes
    weightedProgress += child.percentCompleteBp * child.workMinutes
    critical ||= child.isCritical
  }

  return {
    nodeId: container.id,
    projectId: container.projectId,
    earlyStart: start,
    earlyFinish: finish,
    lateStart: start,
    lateFinish: finish,
    scheduledStart: start,
    scheduledFinish: finish,
    durationMinutes: 0,
    workMinutes: work,
    totalSlackMinutes: 0,
    freeSlackMinutes: 0,
    isCritical: critical,
    levelingDelayMinutes: 0,
    // Avance ponderado por trabajo: la media aritmética de porcentajes deja que
    // una tarea de 2 h al 100 % compense a una de 200 h al 0 %.
    percentCompleteBp: work === 0 ? 0 : Math.round(weightedProgress / work),
    calendarUsedId: first.calendarUsedId || defaultCalendarId,
    isContainer: true,
  }
}

function depthOf(node: WbsNodeDefinition, nodesById: ReadonlyMap<string, WbsNodeDefinition>): number {
  let depth = 0
  let current = node.parentId
  while (current != null) {
    depth += 1
    current = nodesById.get(current)?.parentId
  }
  return depth
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): ReadonlyMap<string, readonly T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const bucket = map.get(key(item))
    if (bucket === undefined) map.set(key(item), [item])
    else bucket.push(item)
  }
  return map
}
