/** Constructor de planes de juguete para las pruebas del motor. */

import { calendarDate, type CalendarDate } from '@planner/domain'
import type { CalendarDefinition } from '@planner/calendar'
import type {
  AssignmentDefinition,
  ConstraintKind,
  DependencyDefinition,
  DependencyOutOfPlan,
  DependencyKind,
  PlanSnapshot,
  ProjectDefinition,
  ResourceDefinition,
  SkillRequirement,
  TaskDefinition,
  WbsNodeDefinition,
} from '../plan.js'

const d = calendarDate

/** L-V 08:00-12:00 y 13:00-17:00 = 480 min/día. */
export const CAL_40H: CalendarDefinition = {
  id: 'cal-40h',
  code: 'cal_40h',
  parentId: null,
  weekSlots: [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday: weekday as 1, startMinute: 480, endMinute: 720 },
    { weekday: weekday as 1, startMinute: 780, endMinute: 1020 },
  ]),
  exceptions: [],
}

/** L-V 08:00-12:00 y 13:00-16:00 = 420 min/día. */
export const CAL_35H: CalendarDefinition = {
  ...CAL_40H,
  id: 'cal-35h',
  code: 'cal_35h',
  weekSlots: [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday: weekday as 1, startMinute: 480, endMinute: 720 },
    { weekday: weekday as 1, startMinute: 780, endMinute: 960 },
  ]),
}

export class PlanBuilder {
  private readonly nodes: WbsNodeDefinition[] = []
  private readonly tasks: TaskDefinition[] = []
  private readonly dependencies: DependencyDefinition[] = []
  private readonly dependenciesOutOfPlan: DependencyOutOfPlan[] = []
  private readonly assignments: AssignmentDefinition[] = []
  private readonly resources: ResourceDefinition[] = []
  private readonly skillRequirements: SkillRequirement[] = []
  private readonly skillNames: Record<string, string> = {}
  private readonly projects: ProjectDefinition[] = [
    {
      id: 'p1', code: 'P1', name: 'Proyecto', status: 'activo',
      statusStart: d('2026-03-02'), priority: 500, scheduleMode: 'adelante',
    },
  ]

  project(project: Partial<ProjectDefinition> & { id: string }): this {
    this.projects.push({
      code: project.id.toUpperCase(),
      name: project.id,
      status: 'activo',
      statusStart: d('2026-03-02'),
      scheduleMode: 'adelante',
      priority: 500,
      ...project,
    })
    return this
  }

  /**
   * Un enlace declarado cuyo otro extremo no está en el plan: el proyecto de
   * enfrente está en pausa, archivado, o es una plantilla.
   */
  danglingLink(
    nodeId: string,
    options: Partial<DependencyOutOfPlan> = {},
  ): this {
    this.dependenciesOutOfPlan.push({
      id: `suelto-${nodeId}`,
      nodeId,
      nodeName: nodeId,
      otherName: 'La de enfrente',
      otherProjectCode: 'OTRO',
      reason: 'archivado',
      missingIsPredecessor: true,
      ...options,
    })
    return this
  }

  container(id: string, options: Partial<WbsNodeDefinition> = {}): this {
    this.nodes.push({
      id,
      projectId: 'p1',
      kind: 'work_package',
      name: id,
      sortKey: this.nodes.length,
      ...options,
    })
    return this
  }

  task(id: string, options: Partial<TaskDefinition & WbsNodeDefinition> = {}): this {
    this.nodes.push({
      id,
      projectId: options.projectId ?? 'p1',
      kind: options.isMilestone === true ? 'milestone' : 'task',
      name: options.name ?? id,
      sortKey: this.nodes.length,
      ...(options.parentId !== undefined ? { parentId: options.parentId } : {}),
    })
    this.tasks.push({
      nodeId: id,
      taskType: 'fixed_duration',
      effortDriven: true,
      durationMinutes: 480,
      workDeclaredMinutes: 0,
      constraintKind: 'asap',
      percentCompleteBp: 0,
      isMilestone: false,
      ...stripNodeKeys(options),
    })
    return this
  }

  milestone(id: string, options: Partial<TaskDefinition & WbsNodeDefinition> = {}): this {
    return this.task(id, { ...options, isMilestone: true, durationMinutes: 0, workDeclaredMinutes: 0 })
  }

  link(
    predecessorNodeId: string,
    successorNodeId: string,
    kind: DependencyKind = 'FS',
    lagMinutes = 0,
  ): this {
    this.dependencies.push({
      id: `${predecessorNodeId}->${successorNodeId}`,
      predecessorNodeId,
      successorNodeId,
      kind,
      lagMinutes,
    })
    return this
  }

  /** Una competencia que exige una tarea, con su nombre legible. */
  requireSkill(nodeId: string, skillId: string, minLevel = 3, name = skillId): this {
    this.skillRequirements.push({ nodeId, skillId, minLevel })
    this.skillNames[skillId] = name
    return this
  }

  resource(id: string, options: Partial<ResourceDefinition> = {}): this {
    this.resources.push({
      id,
      code: id,
      displayName: id,
      kind: 'person',
      calendarId: 'cal-40h',
      maxUnitsBp: 10_000,
      indirectBp: 0,
      reserveBp: 0,
      availability: [{ from: d('2026-01-01'), to: d('2027-12-31'), unitsBp: 10_000 }],
      absences: [],
      costRates: [{ from: d('2026-01-01'), to: d('2027-12-31'), standardCentsPerHour: 6_000 }],
      skills: [],
      ...options,
    })
    return this
  }

  assign(nodeId: string, resourceId: string, options: Partial<AssignmentDefinition> = {}): this {
    this.assignments.push({
      id: `${nodeId}:${resourceId}`,
      nodeId,
      resourceId,
      unitsBp: 10_000,
      contour: 'flat',
      ...options,
    })
    return this
  }

  build(horizonTo: CalendarDate = d('2026-12-31')): PlanSnapshot {
    return {
      horizon: { from: d('2026-03-01'), to: horizonTo },
      defaultCalendarId: 'cal-40h',
      calendars: [CAL_40H, CAL_35H],
      resources: this.resources,
      projects: this.projects,
      nodes: this.nodes,
      tasks: this.tasks,
      dependencies: this.dependencies,
      dependenciesOutOfPlan: this.dependenciesOutOfPlan,
      skillRequirements: this.skillRequirements,
      skillNames: this.skillNames,
      assignments: this.assignments,
    }
  }
}

const NODE_KEYS = new Set(['projectId', 'parentId', 'kind', 'name', 'sortKey', 'id'])

/** Separa los campos del nodo de los de la tarea, que viven en tablas distintas. */
function stripNodeKeys(
  options: Partial<TaskDefinition & WbsNodeDefinition>,
): Partial<TaskDefinition> {
  return Object.fromEntries(
    Object.entries(options).filter(([key]) => !NODE_KEYS.has(key)),
  )
}

export const CONSTRAINTS: readonly ConstraintKind[] = [
  'asap',
  'alap',
  'start_no_earlier_than',
  'start_no_later_than',
  'finish_no_earlier_than',
  'finish_no_later_than',
  'must_start_on',
  'must_finish_on',
]
