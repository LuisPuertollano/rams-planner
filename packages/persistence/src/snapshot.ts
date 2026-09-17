/**
 * Carga del snapshot desde PostgreSQL.
 *
 * Todo lo que el motor necesita se lee **una vez** y se le pasa entero: durante
 * el cálculo no hay ni una consulta más (P2). Eso es lo que permite guardar el
 * snapshot, volver a pasarlo por el motor años después y obtener el mismo
 * resultado.
 *
 * Nota sobre el tiempo: el motor razona en hora local del calendario. Al
 * persistir instantes se guarda esa hora de pared interpretada como UTC, y al
 * leerla se hace la conversión inversa. La ida y vuelta es exacta y no depende
 * de la zona del servidor.
 */

import { calendarDate, type CalendarDate } from '@planner/domain'
import type { CalendarDefinition, Horizon } from '@planner/calendar'
import type {
  AssignmentDefinition,
  ContourKind,
  ConstraintKind,
  DependencyDefinition,
  DependencyKind,
  NodeKind,
  PlanSnapshot,
  ProjectDefinition,
  ResourceDefinition,
  ResourceKind,
  TaskDefinition,
  TaskType,
  WbsNodeDefinition,
  SkillRequirement,
} from '@planner/scheduler'
import type { Queryable } from './db.js'

export interface LoadOptions {
  readonly horizon: Horizon
  readonly defaultCalendarCode?: string
}

/**
 * Carga el snapshot completo.
 *
 * **Toda consulta de este fichero lleva un `ORDER BY` total.** No es estilo: sin
 * un orden completo PostgreSQL devuelve las filas como le conviene según el plan
 * de ejecución, y entonces dos cargas idénticas producen snapshots con hash
 * distinto. Eso rompe el principio P2 —mismo snapshot, mismo resultado, bit a
 * bit— y con él la comparación contra una línea base congelada hace meses.
 *
 * «Total» quiere decir que los empates se rompen hasta la clave primaria: ni el
 * nombre de una persona ni el código de un proyecto son únicos.
 */
export async function loadSnapshot(db: Queryable, options: LoadOptions): Promise<PlanSnapshot> {
  // En serie a propósito: `db` puede ser un cliente dentro de una transacción,
  // y un cliente de pg no admite consultas concurrentes.
  const calendars = await loadCalendars(db)
  const resources = await loadResources(db)
  const projects = await loadProjects(db)
  const nodes = await loadNodes(db)
  const tasks = await loadTasks(db)
  const dependencies = await loadDependencies(db)
  const assignments = await loadAssignments(db)
  const { skillRequirements, skillNames } = await loadSkills(db)
  const defaultCalendarId = await resolveDefaultCalendar(db, options.defaultCalendarCode ?? 'base_bw')

  return {
    horizon: options.horizon,
    defaultCalendarId,
    calendars,
    resources,
    projects,
    nodes,
    tasks,
    dependencies,
    assignments,
    skillRequirements,
    skillNames,
  }
}

/**
 * Los requisitos de competencia de las tareas vivas, y el nombre de cada
 * competencia. El nombre viaja en el snapshot porque los hallazgos se escriben
 * dentro del motor, que es puro y no puede ir a preguntarlo a la base de datos.
 */
async function loadSkills(db: Queryable): Promise<{
  skillRequirements: readonly SkillRequirement[]
  skillNames: Record<string, string>
}> {
  // El ORDER BY no es cosmético: sin él PostgreSQL puede devolver las filas en
  // cualquier orden, el hash del snapshot cambia entre dos cargas idénticas y
  // el motor deja de ser determinista (P2). Cualquier consulta que alimente el
  // snapshot lleva un orden total y explícito.
  const requirements = await db.query<{ node_id: string; skill_id: string; min_level: number }>(
    `SELECT r.node_id, r.skill_id, r.min_level
     FROM node_skill_requirement r
     JOIN wbs_node n ON n.id = r.node_id AND n.deleted_at IS NULL
     JOIN project  p ON p.id = n.project_id AND p.deleted_at IS NULL AND NOT p.is_template
     ORDER BY r.node_id, r.skill_id`,
  )
  const names = await db.query<{ id: string; name: string }>('SELECT id, name FROM skill ORDER BY id')
  const skillNames: Record<string, string> = {}
  for (const row of names.rows) skillNames[row.id] = row.name
  return {
    skillRequirements: requirements.rows.map((row) => ({
      nodeId: row.node_id,
      skillId: row.skill_id,
      minLevel: row.min_level,
    })),
    skillNames,
  }
}

async function resolveDefaultCalendar(db: Queryable, code: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM calendar WHERE code = $1 AND deleted_at IS NULL', [
    code,
  ])
  const found = rows[0]?.id
  if (found !== undefined) return found
  const fallback = await db.query<{ id: string }>(
    'SELECT id FROM calendar WHERE deleted_at IS NULL ORDER BY code LIMIT 1',
  )
  const id = fallback.rows[0]?.id
  if (id === undefined) throw new Error('No hay ningún calendario en la base de datos')
  return id
}

async function loadCalendars(db: Queryable): Promise<readonly CalendarDefinition[]> {
  const calendars = await db.query<{ id: string; code: string; parent_id: string | null }>(
    'SELECT id, code, parent_id FROM calendar WHERE deleted_at IS NULL ORDER BY id',
  )
  const slots = await db.query<{
    calendar_id: string
    valid_from: string
    valid_to: string | null
    weekday: number
    start_minute: number
    end_minute: number
  }>(`SELECT calendar_id, valid_from::text, valid_to::text, weekday, start_minute, end_minute
     FROM calendar_week_slot ORDER BY calendar_id, valid_from, weekday, start_minute`)
  const exceptions = await db.query<{
    id: string
    calendar_id: string
    name: string
    date_from: string
    date_to: string
    is_working: boolean
    recurrence_rule: string | null
  }>(
    `SELECT id, calendar_id, name, date_from::text, date_to::text, is_working, recurrence_rule
     FROM calendar_exception ORDER BY calendar_id, date_from, id`,
  )
  const exceptionSlots = await db.query<{ exception_id: string; start_minute: number; end_minute: number }>(
    'SELECT exception_id, start_minute, end_minute FROM calendar_exception_slot ORDER BY exception_id, start_minute',
  )

  const slotsByCalendar = groupBy(slots.rows, (row) => row.calendar_id)
  const exceptionsByCalendar = groupBy(exceptions.rows, (row) => row.calendar_id)
  const slotsByException = groupBy(exceptionSlots.rows, (row) => row.exception_id)

  return calendars.rows.map((calendar) => ({
    id: calendar.id,
    code: calendar.code,
    parentId: calendar.parent_id,
    weekSlots: (slotsByCalendar.get(calendar.id) ?? []).map((slot) => ({
      weekday: slot.weekday as 1,
      startMinute: slot.start_minute,
      endMinute: slot.end_minute,
      validFrom: calendarDate(slot.valid_from),
      ...(slot.valid_to !== null ? { validTo: calendarDate(slot.valid_to) } : {}),
    })),
    exceptions: (exceptionsByCalendar.get(calendar.id) ?? []).map((exception) => ({
      name: exception.name,
      dateFrom: calendarDate(exception.date_from),
      dateTo: calendarDate(exception.date_to),
      isWorking: exception.is_working,
      slots: (slotsByException.get(exception.id) ?? []).map((slot) => ({
        startMinute: slot.start_minute,
        endMinute: slot.end_minute,
      })),
      ...(exception.recurrence_rule !== null ? { recurrenceRule: exception.recurrence_rule } : {}),
    })),
  }))
}

async function loadResources(db: Queryable): Promise<readonly ResourceDefinition[]> {
  const resources = await db.query<{
    id: string
    code: string
    display_name: string
    resource_kind: string
    calendar_id: string | null
    max_units_bp: number
    indirect_bp: number
    reserve_bp: number
  }>(
    'SELECT id, code, display_name, resource_kind, calendar_id, max_units_bp, indirect_bp, reserve_bp ' +
      'FROM resource WHERE deleted_at IS NULL ORDER BY display_name, id',
  )
  const availability = await db.query<{ resource_id: string; from: string; to: string; units_bp: number }>(
    `SELECT resource_id, lower(valid_period)::text AS from, (upper(valid_period) - 1)::text AS to, units_bp
     FROM resource_availability ORDER BY resource_id, lower(valid_period)`,
  )
  const absences = await db.query<{
    resource_id: string
    absence_kind: string
    date_from: string
    date_to: string
    minutes_per_day: number | null
  }>(`SELECT resource_id, absence_kind, date_from::text, date_to::text, minutes_per_day
     FROM absence ORDER BY resource_id, date_from, absence_kind`)
  const rates = await db.query<{ resource_id: string; from: string; to: string; standard_cents_hour: string }>(
    `SELECT resource_id, lower(valid_period)::text AS from, (upper(valid_period) - 1)::text AS to, standard_cents_hour
     FROM resource_cost_rate ORDER BY resource_id, lower(valid_period)`,
  )
  const skills = await db.query<{ resource_id: string; skill_id: string; level: number }>(
    'SELECT resource_id, skill_id, level FROM resource_skill ORDER BY resource_id, skill_id',
  )

  const availabilityBy = groupBy(availability.rows, (row) => row.resource_id)
  const absencesBy = groupBy(absences.rows, (row) => row.resource_id)
  const ratesBy = groupBy(rates.rows, (row) => row.resource_id)
  const skillsBy = groupBy(skills.rows, (row) => row.resource_id)

  return resources.rows.map((resource) => ({
    id: resource.id,
    code: resource.code,
    displayName: resource.display_name,
    kind: resource.resource_kind as ResourceKind,
    ...(resource.calendar_id !== null ? { calendarId: resource.calendar_id } : {}),
    maxUnitsBp: resource.max_units_bp,
    indirectBp: resource.indirect_bp,
    reserveBp: resource.reserve_bp,
    availability: (availabilityBy.get(resource.id) ?? []).map((row) => ({
      from: calendarDate(row.from),
      to: calendarDate(row.to),
      unitsBp: row.units_bp,
    })),
    absences: (absencesBy.get(resource.id) ?? []).map((row) => ({
      kind: row.absence_kind,
      from: calendarDate(row.date_from),
      to: calendarDate(row.date_to),
      ...(row.minutes_per_day !== null ? { minutesPerDay: row.minutes_per_day } : {}),
    })),
    costRates: (ratesBy.get(resource.id) ?? []).map((row) => ({
      from: calendarDate(row.from),
      to: calendarDate(row.to),
      standardCentsPerHour: Number(row.standard_cents_hour),
    })),
    skills: (skillsBy.get(resource.id) ?? []).map((row) => ({
      skillId: row.skill_id,
      level: row.level,
    })),
  }))
}

async function loadProjects(db: Queryable): Promise<readonly ProjectDefinition[]> {
  const { rows } = await db.query<{
    id: string
    code: string
    name: string
    calendar_id: string | null
    status_start: string
    priority: number
  }>(
    `SELECT id, code, name, calendar_id, status_start::text, priority
     FROM project WHERE deleted_at IS NULL AND NOT is_template ORDER BY code, id`,
  )
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    ...(row.calendar_id !== null ? { calendarId: row.calendar_id } : {}),
    statusStart: calendarDate(row.status_start),
    priority: row.priority,
  }))
}

async function loadNodes(db: Queryable): Promise<readonly WbsNodeDefinition[]> {
  const { rows } = await db.query<{
    id: string
    project_id: string
    parent_id: string | null
    node_kind: string
    code: string | null
    name: string
    sort_key: number
  }>(
    `SELECT n.id, n.project_id, n.parent_id, n.node_kind, n.code, n.name, n.sort_key
     FROM wbs_node n JOIN project p ON p.id = n.project_id
     WHERE n.deleted_at IS NULL AND p.deleted_at IS NULL AND NOT p.is_template
     ORDER BY n.path, n.id`,
  )
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id,
    kind: row.node_kind as NodeKind,
    ...(row.code !== null ? { code: row.code } : {}),
    name: row.name,
    sortKey: row.sort_key,
  }))
}

async function loadTasks(db: Queryable): Promise<readonly TaskDefinition[]> {
  const { rows } = await db.query<{
    node_id: string
    task_type: string
    is_effort_driven: boolean
    duration_minutes: number
    work_declared_minutes: number
    calendar_id: string | null
    constraint_kind: string
    constraint_date: string | null
    deadline: string | null
    percent_complete_bp: number
    standard_effort_minutes: number | null
    is_milestone: boolean
  }>(
    `SELECT t.node_id, t.task_type, t.is_effort_driven, t.duration_minutes, t.work_declared_minutes,
            t.calendar_id, t.constraint_kind, t.constraint_date::text, t.deadline::text,
            t.percent_complete_bp, t.standard_effort_minutes, t.is_milestone
     FROM task t
     JOIN wbs_node n ON n.id = t.node_id AND n.deleted_at IS NULL
     JOIN project  p ON p.id = n.project_id AND p.deleted_at IS NULL AND NOT p.is_template
     ORDER BY t.node_id`,
  )
  return rows.map((row) => ({
    nodeId: row.node_id,
    taskType: row.task_type as TaskType,
    effortDriven: row.is_effort_driven,
    durationMinutes: row.duration_minutes,
    workDeclaredMinutes: row.work_declared_minutes,
    ...(row.calendar_id !== null ? { calendarId: row.calendar_id } : {}),
    constraintKind: row.constraint_kind as ConstraintKind,
    ...(row.constraint_date !== null ? { constraintDate: calendarDate(row.constraint_date) } : {}),
    ...(row.deadline !== null ? { deadline: calendarDate(row.deadline) } : {}),
    percentCompleteBp: row.percent_complete_bp,
    isMilestone: row.is_milestone,
    ...(row.standard_effort_minutes !== null ? { standardEffortMinutes: row.standard_effort_minutes } : {}),
  }))
}

async function loadDependencies(db: Queryable): Promise<readonly DependencyDefinition[]> {
  const { rows } = await db.query<{
    id: string
    predecessor_node_id: string
    successor_node_id: string
    dependency_kind: string
    lag_minutes: number
  }>(
    `SELECT d.id, d.predecessor_node_id, d.successor_node_id, d.dependency_kind, d.lag_minutes
     FROM dependency d
     JOIN wbs_node s ON s.id = d.successor_node_id   AND s.deleted_at IS NULL
     JOIN wbs_node q ON q.id = d.predecessor_node_id AND q.deleted_at IS NULL
     JOIN project  p ON p.id = s.project_id AND p.deleted_at IS NULL AND NOT p.is_template
     ORDER BY d.id`,
  )
  return rows.map((row) => ({
    id: row.id,
    predecessorNodeId: row.predecessor_node_id,
    successorNodeId: row.successor_node_id,
    kind: row.dependency_kind as DependencyKind,
    lagMinutes: row.lag_minutes,
  }))
}

async function loadAssignments(db: Queryable): Promise<readonly AssignmentDefinition[]> {
  const { rows } = await db.query<{
    id: string
    node_id: string
    resource_id: string
    units_bp: number
    work_declared_minutes: number | null
    contour_kind: string
    window_from: string | null
    window_to: string | null
  }>(
    `SELECT a.id, a.node_id, a.resource_id, a.units_bp, a.work_declared_minutes, a.contour_kind,
            a.window_from::text, a.window_to::text
     FROM assignment a
     JOIN wbs_node n ON n.id = a.node_id AND n.deleted_at IS NULL
     JOIN resource r ON r.id = a.resource_id AND r.deleted_at IS NULL
     WHERE a.deleted_at IS NULL
     ORDER BY a.id`,
  )
  const contours = await db.query<{ assignment_id: string; work_date: string; minutes: number }>(
    'SELECT assignment_id, work_date::text, minutes FROM assignment_manual_contour ORDER BY assignment_id, work_date',
  )
  const contoursBy = groupBy(contours.rows, (row) => row.assignment_id)

  return rows.map((row) => {
    const manual = contoursBy.get(row.id)
    return {
      id: row.id,
      nodeId: row.node_id,
      resourceId: row.resource_id,
      unitsBp: row.units_bp,
      ...(row.work_declared_minutes !== null ? { workDeclaredMinutes: row.work_declared_minutes } : {}),
      contour: row.contour_kind as ContourKind,
      ...(row.window_from !== null ? { windowFrom: calendarDate(row.window_from) } : {}),
      ...(row.window_to !== null ? { windowTo: calendarDate(row.window_to) } : {}),
      ...(manual !== undefined
        ? { manualContour: manual.map((entry) => ({ date: calendarDate(entry.work_date), minutes: entry.minutes })) }
        : {}),
    }
  })
}

export function toCalendarDate(value: string): CalendarDate {
  return calendarDate(value.slice(0, 10))
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): ReadonlyMap<string, readonly T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const bucket = map.get(key(row))
    if (bucket === undefined) map.set(key(row), [row])
    else bucket.push(row)
  }
  return map
}
