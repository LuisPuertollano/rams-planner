/**
 * El snapshot de entrada del motor y los tipos de su resultado.
 *
 * Un snapshot es **todo** lo que el motor necesita: nada se lee de la base de
 * datos ni del reloj durante el cálculo (P2). Por eso un snapshot guardado se
 * puede volver a pasar por el motor años después y dar el mismo resultado.
 */

import type { CalendarDate, Finding, ProjectStatus, ScheduleMode } from '@planner/domain'
import type { CalendarDefinition, Horizon, PlanInstant } from '@planner/calendar'

export type TaskType = 'fixed_work' | 'fixed_duration' | 'fixed_units'

export type ConstraintKind =
  | 'asap'
  | 'alap'
  | 'start_no_earlier_than'
  | 'start_no_later_than'
  | 'finish_no_earlier_than'
  | 'finish_no_later_than'
  | 'must_start_on'
  | 'must_finish_on'

export type DependencyKind = 'FS' | 'SS' | 'FF' | 'SF'

export type NodeKind = 'phase' | 'work_package' | 'task' | 'milestone'

export type ContourKind = 'flat' | 'front_loaded' | 'back_loaded' | 'bell' | 'turtle' | 'manual'

export type ResourceKind = 'person' | 'team' | 'material' | 'cost'

export interface DateRange {
  readonly from: CalendarDate
  readonly to: CalendarDate
}

export interface AvailabilityPeriod extends DateRange {
  readonly unitsBp: number
}

export interface AbsencePeriod extends DateRange {
  readonly kind: string
  /** Minutos por día. Si falta, el día completo. */
  readonly minutesPerDay?: number
}

export interface CostRate extends DateRange {
  readonly standardCentsPerHour: number
}

/** Lo que alguien sabe hacer, y a qué nivel. */
export interface SkillLevel {
  readonly skillId: string
  /** 1 en formación · 2 con apoyo · 3 autónomo · 4 referencia · 5 experto. */
  readonly level: number
}

export interface ResourceDefinition {
  readonly id: string
  readonly code: string
  readonly displayName: string
  readonly kind: ResourceKind
  readonly calendarId?: string
  readonly maxUnitsBp: number
  /**
   * Lo que del día laborable **no llega nunca** a una tarea del plan: reuniones
   * de departamento, formación, revisar lo de otro, el correo. Es trabajo que
   * pasa, conocido y repetido.
   */
  readonly indirectBp: number
  /**
   * Lo que se **guarda** para lo que todavía no ha pasado: la baja de un día
   * que nadie vio venir. Es una decisión de riesgo, no una medida, y por eso no
   * se mezcla con la anterior.
   */
  readonly reserveBp: number
  readonly availability: readonly AvailabilityPeriod[]
  readonly absences: readonly AbsencePeriod[]
  readonly costRates: readonly CostRate[]
  readonly skills: readonly SkillLevel[]
}

/** Lo que una tarea exige de quien la haga. */
export interface SkillRequirement {
  readonly nodeId: string
  readonly skillId: string
  readonly minLevel: number
}

export interface ProjectDefinition {
  readonly id: string
  readonly code: string
  readonly name: string
  /**
   * Siempre `activo` aquí: la instantánea sólo carga lo que se calcula. Está
   * para que quien lea un `PlanSnapshot` no tenga que preguntárselo.
   */
  readonly status: ProjectStatus
  readonly calendarId?: string
  readonly statusStart: CalendarDate
  /** Menor es más prioritario. Desempate determinista en la nivelación. */
  readonly priority: number
  /**
   * Desde dónde se planifica este proyecto.
   *
   * `adelante` es lo de siempre: cada tarea a su fecha más temprana, y si no
   * llega a su puerta, un hallazgo.
   *
   * `atras` es como piensa un proyecto RAMS: la fecha que manda es la de la
   * puerta de certificación, y la pregunta no es «¿cuándo acabo?» sino
   * «¿cuándo tengo que empezar para llegar?». Las tareas se van a su fecha más
   * tardía y lo que sale es el margen que queda — o el que ya no queda.
   */
  readonly scheduleMode: ScheduleMode
  /**
   * Las puertas de certificación de este proyecto con su fecha, indexadas por
   * el nombre en mayúsculas (`normalizeGate`).
   *
   * Viajan en la instantánea desde ADR-0051 porque el motor las necesita para
   * colocar las tareas continuas. Antes sólo las leía `planGateDeadlines`, que
   * proponía fechas objetivo fuera del cálculo.
   */
  readonly gates: Readonly<Record<string, CalendarDate>>
}

export interface WbsNodeDefinition {
  readonly id: string
  readonly projectId: string
  readonly parentId?: string | null
  readonly kind: NodeKind
  readonly code?: string
  readonly name: string
  readonly sortKey: number
}

export interface TaskDefinition {
  readonly nodeId: string
  readonly taskType: TaskType
  readonly effortDriven: boolean
  readonly durationMinutes: number
  readonly workDeclaredMinutes: number
  readonly calendarId?: string
  readonly constraintKind: ConstraintKind
  readonly constraintDate?: CalendarDate
  readonly deadline?: CalendarDate
  readonly percentCompleteBp: number
  readonly isMilestone: boolean
  readonly standardEffortMinutes?: number
  /**
   * La ventana de una tarea continua: dos anclas, o ninguna.
   *
   * `spanFrom` es `arranque` o el nombre de una puerta; `spanTo`, el nombre de
   * una puerta. Cuando las dos están, la fase manda sobre la duración: la
   * tarea ocupa todo lo que hay entre las dos fechas y lo que el motor calcula
   * es la intensidad a la que hay que llevarla.
   */
  readonly spanFrom?: string
  readonly spanTo?: string
}

export interface DependencyDefinition {
  readonly id: string
  readonly predecessorNodeId: string
  readonly successorNodeId: string
  readonly kind: DependencyKind
  readonly lagMinutes: number
}

export interface AssignmentDefinition {
  readonly id: string
  readonly nodeId: string
  readonly resourceId: string
  readonly unitsBp: number
  readonly workDeclaredMinutes?: number
  readonly contour: ContourKind
  readonly windowFrom?: CalendarDate
  readonly windowTo?: CalendarDate
  /** Reparto manual, cuando `contour` es `manual`. */
  readonly manualContour?: readonly { readonly date: CalendarDate; readonly minutes: number }[]
}

/**
 * Un enlace que existe declarado y que el plan **no puede aplicar**, porque el
 * otro extremo no está dentro: su proyecto está en pausa, archivado, o es una
 * plantilla.
 *
 * Viaja en la instantánea en vez de deducirse aquí porque el motor no ve lo que
 * se quedó fuera: sabe que le falta un nodo, no por qué. El «por qué» lo sabe
 * quien cargó los datos, y sin él la frase no se puede escribir.
 *
 * Existe para que archivar un proyecto no mueva en silencio las fechas del de
 * al lado. Antes el enlace se saltaba sin más y la sucesora se adelantaba sola.
 */
export interface DependencyOutOfPlan {
  readonly id: string
  /** La tarea que **sí** está en el plan y que se queda sin el enlace. */
  readonly nodeId: string
  readonly nodeName: string
  /** Cómo se llama lo que se quedó fuera, para poder decirlo. */
  readonly otherName: string
  readonly otherProjectCode: string
  readonly reason: 'inactivo' | 'archivado' | 'plantilla'
  /** `true` si lo que falta es la predecesora de `nodeId`. */
  readonly missingIsPredecessor: boolean
}

export interface PlanSnapshot {
  readonly horizon: Horizon
  readonly defaultCalendarId: string
  readonly calendars: readonly CalendarDefinition[]
  readonly resources: readonly ResourceDefinition[]
  readonly projects: readonly ProjectDefinition[]
  readonly nodes: readonly WbsNodeDefinition[]
  readonly tasks: readonly TaskDefinition[]
  readonly dependencies: readonly DependencyDefinition[]
  /**
   * Los enlaces que no se pueden aplicar porque el otro extremo no está en el
   * plan. No se aplican, pero **se dicen**.
   */
  readonly dependenciesOutOfPlan: readonly DependencyOutOfPlan[]
  readonly assignments: readonly AssignmentDefinition[]
  readonly skillRequirements: readonly SkillRequirement[]
  /** Nombre legible de cada competencia, para que los hallazgos se entiendan. */
  readonly skillNames: Readonly<Record<string, string>>
}

export interface TaskResult {
  readonly nodeId: string
  readonly projectId: string
  readonly earlyStart: PlanInstant
  readonly earlyFinish: PlanInstant
  readonly lateStart: PlanInstant
  readonly lateFinish: PlanInstant
  readonly scheduledStart: PlanInstant
  readonly scheduledFinish: PlanInstant
  readonly durationMinutes: number
  readonly workMinutes: number
  readonly totalSlackMinutes: number
  readonly freeSlackMinutes: number
  readonly isCritical: boolean
  /** Retraso aplicado por la nivelación, en minutos laborables. */
  readonly levelingDelayMinutes: number
  readonly percentCompleteBp: number
  /** Calendario que se usó de verdad, para poder explicarlo. */
  readonly calendarUsedId: string
  /** `true` para fases y paquetes: sus cifras son agregación de sus hijos. */
  readonly isContainer: boolean
}

export interface ScheduleOutput {
  readonly taskResults: readonly TaskResult[]
  readonly findings: readonly Finding[]
  /** Calendarios ya compilados, para que la carga no los vuelva a compilar. */
  readonly compiledCalendars: ReadonlyMap<string, import('@planner/calendar').CompiledCalendar>
  /** `false` si un hallazgo bloqueante detuvo el cálculo. */
  readonly completed: boolean
}
