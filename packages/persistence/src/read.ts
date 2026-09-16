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
  }>(
    `SELECT n.id AS node_id, n.project_id, n.parent_id, n.node_kind, n.code, n.name, n.path,
            r.scheduled_start, r.scheduled_finish, r.duration_minutes, r.work_minutes,
            r.total_slack_minutes, r.is_critical, r.percent_complete_bp,
            t.constraint_kind, t.deadline::text, t.task_type,
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
  }))
}

export async function readFindings(
  db: Queryable,
  runId: string,
): Promise<readonly { severity: string; code: string; entityType: string; entityId: string; entityName: string | null; occursOn: string | null; message: string }[]> {
  const { rows } = await db.query<{
    severity: string
    code: string
    entity_type: string
    entity_id: string
    entity_name: string | null
    occurs_on: string | null
    message: string
  }>(
    `SELECT f.severity, f.code, f.entity_type, f.entity_id, f.occurs_on::text, f.message,
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

export async function readProjects(
  db: Queryable,
): Promise<readonly { id: string; code: string; name: string; statusStart: string }[]> {
  const { rows } = await db.query<{ id: string; code: string; name: string; status_start: string }>(
    'SELECT id, code, name, status_start::text FROM project WHERE deleted_at IS NULL ORDER BY code',
  )
  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, statusStart: row.status_start }))
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
