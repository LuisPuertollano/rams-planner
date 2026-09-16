/**
 * El snapshot de entrada del motor y los tipos de su resultado.
 *
 * Un snapshot es **todo** lo que el motor necesita: nada se lee de la base de
 * datos ni del reloj durante el cálculo (P2). Por eso un snapshot guardado se
 * puede volver a pasar por el motor años después y dar el mismo resultado.
 */

import type { CalendarDate, Finding } from '@planner/domain'
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

export interface ResourceDefinition {
  readonly id: string
  readonly code: string
  readonly displayName: string
  readonly kind: ResourceKind
  readonly calendarId?: string
  readonly maxUnitsBp: number
  readonly availability: readonly AvailabilityPeriod[]
  readonly absences: readonly AbsencePeriod[]
  readonly costRates: readonly CostRate[]
}

export interface ProjectDefinition {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly calendarId?: string
  readonly statusStart: CalendarDate
  /** Menor es más prioritario. Desempate determinista en la nivelación. */
  readonly priority: number
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

export interface PlanSnapshot {
  readonly horizon: Horizon
  readonly defaultCalendarId: string
  readonly calendars: readonly CalendarDefinition[]
  readonly resources: readonly ResourceDefinition[]
  readonly projects: readonly ProjectDefinition[]
  readonly nodes: readonly WbsNodeDefinition[]
  readonly tasks: readonly TaskDefinition[]
  readonly dependencies: readonly DependencyDefinition[]
  readonly assignments: readonly AssignmentDefinition[]
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
