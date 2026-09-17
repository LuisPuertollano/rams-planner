/**
 * Consultas de lectura para la API.
 *
 * Todas parten de las tablas derivadas de una ejecución concreta: cualquier
 * número que salga de aquí lleva su `runId` y por tanto se puede auditar.
 */

import type { CalendarDate } from '@planner/domain'
import type { Queryable } from './db.js'

export interface RunSummary {
  readonly id: string
  readonly scenarioId: string
  readonly engineVersion: string
  readonly inputHash: string
  readonly status: string
  readonly startedAt: string
  readonly durationMs: number | null
  readonly isFrozen: boolean
  readonly stats: Record<string, number>
  readonly triggerReason?: string | null
}

export async function latestRun(db: Queryable, scenarioId?: string): Promise<RunSummary | undefined> {
  const { rows } = await db.query<{
    id: string
    scenario_id: string
    engine_version: string
    input_hash: string
    status: string
    started_at: Date
    duration_ms: number | null
    is_frozen: boolean
    stats: Record<string, number> | null
  }>(
    `SELECT id, scenario_id, engine_version, input_hash, status, started_at, duration_ms, is_frozen, stats
     FROM calculation_run
     WHERE status = 'succeeded' AND ($1::uuid IS NULL OR scenario_id = $1)
     ORDER BY started_at DESC LIMIT 1`,
    [scenarioId ?? null],
  )
  const row = rows[0]
  if (row === undefined) return undefined
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    engineVersion: row.engine_version,
    inputHash: row.input_hash,
    status: row.status,
    startedAt: row.started_at.toISOString(),
    durationMs: row.duration_ms,
    isFrozen: row.is_frozen,
    stats: row.stats ?? {},
  }
}

export async function recentRuns(db: Queryable, limit = 12): Promise<readonly RunSummary[]> {
  const { rows } = await db.query<{
    id: string
    scenario_id: string
    engine_version: string
    input_hash: string
    status: string
    started_at: Date
    duration_ms: number | null
    is_frozen: boolean
    stats: Record<string, number> | null
    trigger_reason: string | null
  }>(
    `SELECT id, scenario_id, engine_version, input_hash, status, started_at, duration_ms, is_frozen, stats, trigger_reason
     FROM calculation_run WHERE status = 'succeeded' ORDER BY started_at DESC LIMIT $1`,
    [limit],
  )
  return rows.map((row) => ({
    id: row.id,
    scenarioId: row.scenario_id,
    engineVersion: row.engine_version,
    inputHash: row.input_hash,
    status: row.status,
    startedAt: row.started_at.toISOString(),
    durationMs: row.duration_ms,
    isFrozen: row.is_frozen,
    stats: row.stats ?? {},
    triggerReason: row.trigger_reason,
  }))
}

export interface LoadCell {
  readonly resourceId: string
  readonly projectId: string
  readonly nodeId: string
  readonly period: string
  readonly plannedMinutes: number
  readonly costCents: number
}

/** Carga agregada por recurso, proyecto y periodo. El grano diario manda. */
export async function readLoad(
  db: Queryable,
  runId: string,
  bucket: 'day' | 'week' | 'month' | 'quarter',
  options: { readonly byNode?: boolean } = {},
): Promise<readonly LoadCell[]> {
  const period = periodExpression(bucket)
  const nodeColumn = options.byNode === true ? 'n.id' : `''`
  const { rows } = await db.query<{
    resource_id: string
    project_id: string
    node_id: string
    period: string
    planned_minutes: string
    cost_cents: string
  }>(
    `SELECT a.resource_id, n.project_id, ${nodeColumn} AS node_id, ${period} AS period,
            SUM(tp.planned_minutes) AS planned_minutes, SUM(tp.cost_cents) AS cost_cents
     FROM assignment_timephased tp
     JOIN assignment a ON a.id = tp.assignment_id
     JOIN wbs_node   n ON n.id = a.node_id
     WHERE tp.run_id = $1
     GROUP BY 1, 2, 3, 4
     ORDER BY 1, 4, 2, 3`,
    [runId],
  )
  return rows.map((row) => ({
    resourceId: row.resource_id,
    projectId: row.project_id,
    nodeId: row.node_id,
    period: row.period,
    plannedMinutes: Number(row.planned_minutes),
    costCents: Number(row.cost_cents),
  }))
}

export interface UtilizationCell {
  readonly resourceId: string
  readonly period: string
  readonly plannedMinutes: number
  readonly capacityMinutes: number
  readonly utilizationBp: number | null
}

export async function readUtilization(
  db: Queryable,
  runId: string,
  bucket: 'day' | 'week' | 'month' | 'quarter',
): Promise<readonly UtilizationCell[]> {
  const period = periodExpression(bucket, 'c.work_date')
  const plannedPeriod = periodExpression(bucket, 'tp.work_date')
  const { rows } = await db.query<{
    resource_id: string
    period: string
    planned_minutes: string | null
    capacity_minutes: string | null
  }>(
    `WITH capacity AS (
        SELECT c.resource_id, ${period} AS period, SUM(c.capacity_minutes) AS capacity_minutes
        FROM resource_capacity_timephased c WHERE c.run_id = $1 GROUP BY 1, 2
     ), planned AS (
        SELECT a.resource_id, ${plannedPeriod} AS period, SUM(tp.planned_minutes) AS planned_minutes
        FROM assignment_timephased tp
        JOIN assignment a ON a.id = tp.assignment_id
        WHERE tp.run_id = $1 GROUP BY 1, 2
     )
     SELECT COALESCE(c.resource_id, p.resource_id) AS resource_id,
            COALESCE(c.period, p.period)           AS period,
            p.planned_minutes, c.capacity_minutes
     FROM capacity c
     FULL OUTER JOIN planned p ON p.resource_id = c.resource_id AND p.period = c.period
     ORDER BY 1, 2`,
    [runId],
  )
  return rows.map((row) => {
    const planned = Number(row.planned_minutes ?? 0)
    const capacity = Number(row.capacity_minutes ?? 0)
    return {
      resourceId: row.resource_id,
      period: row.period,
      plannedMinutes: planned,
      capacityMinutes: capacity,
      utilizationBp: capacity === 0 ? null : Math.round((planned * 10_000) / capacity),
    }
  })
}

export interface TaskRow {
  readonly nodeId: string
  readonly projectId: string
  readonly parentId: string | null
  readonly kind: string
  readonly code: string | null
  readonly name: string
  readonly path: string
  readonly scheduledStart: string | null
  readonly scheduledFinish: string | null
  readonly durationMinutes: number | null
  readonly workMinutes: number | null
  readonly totalSlackMinutes: number | null
  readonly isCritical: boolean | null
  readonly percentCompleteBp: number
  readonly constraintKind: string | null
  readonly deadline: CalendarDate | null
  readonly taskType: string | null
  readonly assignees: readonly string[]
  /** Datos DECLARADOS, los únicos editables. */
  readonly declaredDurationMinutes: number | null
  readonly declaredWorkMinutes: number | null
  readonly declaredPercentCompleteBp: number | null
}

export async function readTasks(db: Queryable, runId: string): Promise<readonly TaskRow[]> {
  const { rows } = await db.query<{
    node_id: string
    project_id: string
    parent_id: string | null
    node_kind: string
    code: string | null
    name: string
    path: string
    scheduled_start: Date | null
    scheduled_finish: Date | null
    duration_minutes: number | null
    work_minutes: number | null
    total_slack_minutes: number | null
    is_critical: boolean | null
    percent_complete_bp: number | null
    constraint_kind: string | null
    deadline: string | null
    task_type: string | null
    assignees: string[] | null
    declared_duration_minutes: number | null
    declared_work_minutes: number | null
    declared_percent_complete_bp: number | null
  }>(
    `SELECT n.id AS node_id, n.project_id, n.parent_id, n.node_kind, n.code, n.name, n.path,
            r.scheduled_start, r.scheduled_finish, r.duration_minutes, r.work_minutes,
            r.total_slack_minutes, r.is_critical, r.percent_complete_bp,
            t.constraint_kind, t.deadline::text, t.task_type,
            t.duration_minutes AS declared_duration_minutes,
            t.work_declared_minutes AS declared_work_minutes,
            t.percent_complete_bp AS declared_percent_complete_bp,
            ARRAY(SELECT res.display_name FROM assignment a
                  JOIN resource res ON res.id = a.resource_id
                  WHERE a.node_id = n.id AND a.deleted_at IS NULL
                  ORDER BY res.display_name) AS assignees
     FROM wbs_node n
     LEFT JOIN task_result r ON r.node_id = n.id AND r.run_id = $1
     LEFT JOIN task t ON t.node_id = n.id
     WHERE n.deleted_at IS NULL
     ORDER BY n.path`,
    [runId],
  )
  return rows.map((row) => ({
    nodeId: row.node_id,
    projectId: row.project_id,
    parentId: row.parent_id,
    kind: row.node_kind,
    code: row.code,
    name: row.name,
    path: row.path,
    scheduledStart: row.scheduled_start?.toISOString() ?? null,
    scheduledFinish: row.scheduled_finish?.toISOString() ?? null,
    durationMinutes: row.duration_minutes,
    workMinutes: row.work_minutes,
    totalSlackMinutes: row.total_slack_minutes,
    isCritical: row.is_critical,
    percentCompleteBp: row.percent_complete_bp ?? 0,
    constraintKind: row.constraint_kind,
    deadline: (row.deadline as CalendarDate | null) ?? null,
    taskType: row.task_type,
    assignees: row.assignees ?? [],
    declaredDurationMinutes: row.declared_duration_minutes,
    declaredWorkMinutes: row.declared_work_minutes,
    declaredPercentCompleteBp: row.declared_percent_complete_bp,
  }))
}

export async function readFindings(
  db: Queryable,
  runId: string,
): Promise<
  readonly {
    severity: string
    code: string
    entityType: string
    entityId: string
    entityName: string | null
    /** El proyecto del nodo señalado; `null` si el hallazgo es de una persona. */
    projectId: string | null
    occursOn: string | null
    message: string
  }[]
> {
  const { rows } = await db.query<{
    severity: string
    code: string
    entity_type: string
    entity_id: string
    entity_name: string | null
    project_id: string | null
    occurs_on: string | null
    message: string
  }>(
    `SELECT f.severity, f.code, f.entity_type, f.entity_id, f.occurs_on::text, f.message,
            n.project_id,
            COALESCE(n.name, res.display_name) AS entity_name
     FROM finding f
     LEFT JOIN wbs_node n  ON n.id = f.entity_id
     LEFT JOIN resource res ON res.id = f.entity_id
     WHERE f.run_id = $1
     ORDER BY CASE f.severity WHEN 'blocking' THEN 0 WHEN 'error' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
              f.code, f.occurs_on NULLS FIRST`,
    [runId],
  )
  return rows.map((row) => ({
    severity: row.severity,
    code: row.code,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityName: row.entity_name,
    projectId: row.project_id,
    occursOn: row.occurs_on,
    message: row.message,
  }))
}

export async function readDerivations(
  db: Queryable,
  runId: string,
  targetId: string,
): Promise<readonly { targetType: string; rule: string; inputs: unknown; output: unknown }[]> {
  const { rows } = await db.query<{ target_type: string; rule_code: string; inputs: unknown; output_value: unknown }>(
    `SELECT target_type, rule_code, inputs, output_value
     FROM derivation WHERE run_id = $1 AND target_id = $2 ORDER BY id`,
    [runId, targetId],
  )
  return rows.map((row) => ({
    targetType: row.target_type,
    rule: row.rule_code,
    inputs: row.inputs,
    output: row.output_value,
  }))
}

export async function readResources(
  db: Queryable,
): Promise<readonly { id: string; code: string; displayName: string; calendarCode: string | null }[]> {
  const { rows } = await db.query<{ id: string; code: string; display_name: string; calendar_code: string | null }>(
    `SELECT r.id, r.code, r.display_name, c.code AS calendar_code
     FROM resource r LEFT JOIN calendar c ON c.id = r.calendar_id
     WHERE r.deleted_at IS NULL AND r.resource_kind IN ('person', 'team')
     ORDER BY r.display_name`,
  )
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    displayName: row.display_name,
    calendarCode: row.calendar_code,
  }))
}

export interface ProjectSummary {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly statusStart: string
  readonly priority: number
  /** Una plantilla no se calcula: es un molde, no un proyecto en marcha. */
  readonly isTemplate: boolean
}

export async function readProjects(db: Queryable): Promise<readonly ProjectSummary[]> {
  const { rows } = await db.query<{
    id: string
    code: string
    name: string
    status_start: string
    priority: number
    is_template: boolean
  }>(
    `SELECT id, code, name, status_start::text, priority, is_template
     FROM project WHERE deleted_at IS NULL ORDER BY is_template, code`,
  )
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    statusStart: row.status_start,
    priority: row.priority,
    isTemplate: row.is_template,
  }))
}

export interface DailyCapacity {
  readonly resourceId: string
  readonly date: string
  readonly capacityMinutes: number
  readonly plannedMinutes: number
}

/**
 * Capacidad y carga día a día, para el calendario del equipo.
 *
 * Se lee de lo DERIVADO a propósito, en vez de reconstruirlo en el cliente a
 * partir del calendario y las ausencias: esta es la capacidad que el motor ha
 * usado de verdad para repartir el trabajo. Una vista que calculase lo suyo
 * por su cuenta acabaría enseñando un número distinto del que manda.
 *
 * Los días sin fila son días sin capacidad: fin de semana, festivo o ausencia.
 */
export async function readDailyCapacity(
  db: Queryable,
  runId: string,
  from: CalendarDate,
  to: CalendarDate,
): Promise<readonly DailyCapacity[]> {
  const { rows } = await db.query<{
    resource_id: string
    date: string
    capacity_minutes: number
    planned_minutes: string | null
  }>(
    `SELECT c.resource_id, c.work_date::text AS date, c.capacity_minutes,
            (SELECT SUM(tp.planned_minutes) FROM assignment_timephased tp
              JOIN assignment a ON a.id = tp.assignment_id
              WHERE tp.run_id = c.run_id AND a.resource_id = c.resource_id
                AND tp.work_date = c.work_date) AS planned_minutes
     FROM resource_capacity_timephased c
     WHERE c.run_id = $1 AND c.work_date BETWEEN $2 AND $3
     ORDER BY c.resource_id, c.work_date`,
    [runId, from, to],
  )
  return rows.map((row) => ({
    resourceId: row.resource_id,
    date: row.date,
    capacityMinutes: row.capacity_minutes,
    plannedMinutes: row.planned_minutes === null ? 0 : Number(row.planned_minutes),
  }))
}

function periodExpression(bucket: 'day' | 'week' | 'month' | 'quarter', column = 'tp.work_date'): string {
  switch (bucket) {
    case 'day':
      return `to_char(${column}, 'YYYY-MM-DD')`
    case 'week':
      return `to_char(${column}, 'IYYY-"S"IW')`
    case 'month':
      return `to_char(${column}, 'YYYY-MM')`
    case 'quarter':
      return `to_char(${column}, 'YYYY-"T"Q')`
  }
}

// ---------------------------------------------------------------------------
// Líneas base y comparación de ejecuciones
// ---------------------------------------------------------------------------

export interface BaselineSummary {
  readonly id: string
  readonly runId: string
  readonly name: string
  readonly capturedAt: string
  readonly note: string | null
}

export async function readBaselines(db: Queryable): Promise<readonly BaselineSummary[]> {
  const { rows } = await db.query<{
    id: string
    calculation_run_id: string
    name: string
    captured_at: Date
    note: string | null
  }>('SELECT id, calculation_run_id, name, captured_at, note FROM baseline ORDER BY captured_at DESC')
  return rows.map((row) => ({
    id: row.id,
    runId: row.calculation_run_id,
    name: row.name,
    capturedAt: row.captured_at.toISOString(),
    note: row.note,
  }))
}

/** Congelar una ejecución: es la única escritura de la API en la zona derivada. */
export async function freezeRun(db: Queryable, runId: string, name: string, note?: string): Promise<BaselineSummary> {
  await db.query('UPDATE calculation_run SET is_frozen = TRUE WHERE id = $1', [runId])
  const { rows } = await db.query<{ id: string; captured_at: Date }>(
    'INSERT INTO baseline (calculation_run_id, name, note) VALUES ($1, $2, $3) RETURNING id, captured_at',
    [runId, name, note ?? null],
  )
  const row = rows[0]
  if (row === undefined) throw new Error('No se pudo congelar la ejecución')
  return { id: row.id, runId, name, capturedAt: row.captured_at.toISOString(), note: note ?? null }
}

export interface TaskDiffRow {
  readonly nodeId: string
  readonly name: string
  readonly projectId: string
  readonly startFrom: string | null
  readonly startTo: string | null
  readonly finishFrom: string | null
  readonly finishTo: string | null
  readonly startDeltaDays: number | null
  readonly finishDeltaDays: number | null
  readonly workFrom: number | null
  readonly workTo: number | null
  readonly workDeltaMinutes: number | null
}

/**
 * Diff entre dos ejecuciones.
 *
 * Comparar el plan de hoy con la línea base es un `JOIN` entre dos `run_id`:
 * eso es lo que se gana al no guardar los resultados pegados a los datos
 * declarados.
 */
export async function readDiff(
  db: Queryable,
  baseRunId: string,
  targetRunId: string,
): Promise<readonly TaskDiffRow[]> {
  const { rows } = await db.query<{
    node_id: string
    name: string
    project_id: string
    start_from: Date | null
    start_to: Date | null
    finish_from: Date | null
    finish_to: Date | null
    work_from: number | null
    work_to: number | null
  }>(
    `SELECT n.id AS node_id, n.name, n.project_id,
            a.scheduled_start AS start_from, b.scheduled_start AS start_to,
            a.scheduled_finish AS finish_from, b.scheduled_finish AS finish_to,
            a.work_minutes AS work_from, b.work_minutes AS work_to
     FROM wbs_node n
     LEFT JOIN task_result a ON a.node_id = n.id AND a.run_id = $1
     LEFT JOIN task_result b ON b.node_id = n.id AND b.run_id = $2
     WHERE n.deleted_at IS NULL AND (a.node_id IS NOT NULL OR b.node_id IS NOT NULL)
     ORDER BY n.path`,
    [baseRunId, targetRunId],
  )

  const days = (from: Date | null, to: Date | null): number | null =>
    from === null || to === null ? null : Math.round((to.getTime() - from.getTime()) / 86_400_000)

  return rows
    .map((row) => ({
      nodeId: row.node_id,
      name: row.name,
      projectId: row.project_id,
      startFrom: row.start_from?.toISOString() ?? null,
      startTo: row.start_to?.toISOString() ?? null,
      finishFrom: row.finish_from?.toISOString() ?? null,
      finishTo: row.finish_to?.toISOString() ?? null,
      startDeltaDays: days(row.start_from, row.start_to),
      finishDeltaDays: days(row.finish_from, row.finish_to),
      workFrom: row.work_from,
      workTo: row.work_to,
      workDeltaMinutes: row.work_from === null || row.work_to === null ? null : row.work_to - row.work_from,
    }))
    .filter(
      (row) =>
        (row.startDeltaDays ?? 0) !== 0 ||
        (row.finishDeltaDays ?? 0) !== 0 ||
        (row.workDeltaMinutes ?? 0) !== 0 ||
        row.startFrom === null ||
        row.startTo === null,
    )
}

/** Valores de los campos personalizados, por entidad y clave. */
export async function readFieldValues(
  db: Queryable,
): Promise<readonly { entityId: string; fieldKey: string; label: string; value: string }[]> {
  const { rows } = await db.query<{ entity_id: string; field_key: string; label: string; value: string | null }>(
    `SELECT v.entity_id, d.field_key, d.label,
            COALESCE(v.value_text, v.value_number::text, v.value_integer::text, v.value_date::text,
                     v.value_boolean::text) AS value
     FROM field_value v
     JOIN field_definition d ON d.id = v.field_id
     WHERE d.deleted_at IS NULL
     ORDER BY d.display_order`,
  )
  return rows
    .filter((row): row is typeof row & { value: string } => row.value !== null)
    .map((row) => ({ entityId: row.entity_id, fieldKey: row.field_key, label: row.label, value: row.value }))
}
