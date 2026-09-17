/**
 * Las lecturas que necesita un informe.
 *
 * Las de `read.ts` agregan la ejecución entera; un informe se pide sobre un
 * periodo que el usuario elige, y un mes a medio entrar tiene que contar sólo
 * los días que caen dentro. Recortar en memoria lo que la base ya sabe
 * recortar sería traerse el año completo para enseñar mayo.
 */

import type { Queryable } from './db.js'

export interface ReportLoadRow {
  readonly resourceId: string
  readonly projectId: string
  /** Mes `AAAA-MM`. El grano diario manda; el mes es sólo cómo se enseña. */
  readonly period: string
  readonly plannedMinutes: number
  readonly costCents: number
}

export interface ReportCapacityRow {
  readonly resourceId: string
  readonly period: string
  readonly capacityMinutes: number
}

/** Carga por persona, proyecto y mes, contando sólo los días del periodo. */
export async function readLoadInPeriod(
  db: Queryable,
  runId: string,
  from: string,
  to: string,
): Promise<readonly ReportLoadRow[]> {
  const { rows } = await db.query<{
    resource_id: string
    project_id: string
    period: string
    planned_minutes: string
    cost_cents: string
  }>(
    `SELECT a.resource_id, n.project_id, to_char(tp.work_date, 'YYYY-MM') AS period,
            SUM(tp.planned_minutes) AS planned_minutes, SUM(tp.cost_cents) AS cost_cents
     FROM assignment_timephased tp
     JOIN assignment a ON a.id = tp.assignment_id
     JOIN wbs_node   n ON n.id = a.node_id
     WHERE tp.run_id = $1 AND tp.work_date BETWEEN $2::date AND $3::date
     GROUP BY 1, 2, 3
     ORDER BY 1, 3, 2`,
    [runId, from, to],
  )
  return rows.map((row) => ({
    resourceId: row.resource_id,
    projectId: row.project_id,
    period: row.period,
    plannedMinutes: Number(row.planned_minutes),
    costCents: Number(row.cost_cents),
  }))
}

/**
 * Capacidad por persona y mes dentro del periodo.
 *
 * Es de la persona entera, no de un proyecto: la capacidad no se reparte entre
 * proyectos, y recortarla por alcance haría que alguien pareciera libre porque
 * el informe no mira el proyecto que le llena la agenda.
 */
export async function readCapacityInPeriod(
  db: Queryable,
  runId: string,
  from: string,
  to: string,
): Promise<readonly ReportCapacityRow[]> {
  const { rows } = await db.query<{
    resource_id: string
    period: string
    capacity_minutes: string
  }>(
    `SELECT c.resource_id, to_char(c.work_date, 'YYYY-MM') AS period,
            SUM(c.capacity_minutes) AS capacity_minutes
     FROM resource_capacity_timephased c
     WHERE c.run_id = $1 AND c.work_date BETWEEN $2::date AND $3::date
     GROUP BY 1, 2
     ORDER BY 1, 2`,
    [runId, from, to],
  )
  return rows.map((row) => ({
    resourceId: row.resource_id,
    period: row.period,
    capacityMinutes: Number(row.capacity_minutes),
  }))
}
