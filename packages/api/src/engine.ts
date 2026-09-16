/**
 * Orquestación del cálculo: cargar el snapshot, pasarlo por el motor puro y
 * guardar el resultado como una ejecución identificada.
 *
 * El recálculo es **explícito** (`POST /api/calculate`): nada se recalcula por
 * arte de magia al leer una pantalla, porque entonces no se sabría de qué
 * ejecución vienen los números.
 */

import { addDays, calendarDate } from '@planner/domain'
import { createDerivationCollector } from '@planner/explain'
import { schedulePlan } from '@planner/scheduler'
import { computeWorkload, levelPlan } from '@planner/workload'
import {
  loadSnapshot,
  saveRun,
  withTransaction,
  type Pool,
  type Queryable,
} from '@planner/persistence'
import type { Horizon } from '@planner/calendar'

export interface CalculationSummary {
  readonly runId: string
  readonly durationMs: number
  readonly tasks: number
  readonly timephasedCells: number
  readonly findings: number
  readonly completed: boolean
  /** Sólo en ejecuciones niveladas. */
  readonly leveledTasks?: number
  readonly converged?: boolean
}

/** Horizonte: un mes antes del proyecto más temprano y cuatro años en total. */
export async function resolveHorizonFor(db: Queryable): Promise<Horizon> {
  const { rows } = await db.query<{ earliest: string | null }>(
    'SELECT MIN(status_start)::text AS earliest FROM project WHERE deleted_at IS NULL',
  )
  const earliest = rows[0]?.earliest
  const from = addDays(calendarDate(earliest ?? '2026-01-01'), -31)
  return { from, to: addDays(from, 365 * 4) }
}

export async function calculate(
  pool: Pool,
  scenarioId: string,
  reason: string,
  options: { readonly level?: boolean } = {},
): Promise<CalculationSummary> {
  const started = Date.now()
  const collector = createDerivationCollector()

  return withTransaction(pool, async (db) => {
    const horizon = await resolveHorizonFor(db)
    const snapshot = await loadSnapshot(db, { horizon })

    // Nivelar produce su **propia ejecución**, no una columna más: así se
    // compara con la vista que ya existe y se ve qué ha costado que quepa.
    const leveled = options.level === true ? levelPlan(snapshot) : null
    const schedule =
      leveled?.schedule ??
      schedulePlan(snapshot, { derivations: collector.sink })
    const workload =
      leveled?.workload ??
      computeWorkload(snapshot, schedule, { derivations: collector.sink })
    const durationMs = Date.now() - started

    const runId = await saveRun(db, {
      scenarioId,
      snapshot,
      schedule: leveled === null ? schedule : { ...schedule, findings: [...schedule.findings, ...leveled.findings] },
      workload,
      derivations: collector.derivations,
      triggerReason: reason,
      durationMs,
      ...(leveled === null
        ? {}
        : { leveling: { delayedTasks: leveled.delays.size, converged: leveled.converged } }),
    })

    return {
      runId,
      durationMs,
      tasks: schedule.taskResults.length,
      timephasedCells: workload.timephased.length,
      findings: schedule.findings.length + workload.findings.length + (leveled?.findings.length ?? 0),
      completed: schedule.completed,
      ...(leveled === null ? {} : { leveledTasks: leveled.delays.size, converged: leveled.converged }),
    }
  })
}

export async function defaultScenarioId(db: Queryable): Promise<string> {
  const existing = await db.query<{ id: string }>(
    "SELECT id FROM scenario WHERE scenario_kind = 'working' ORDER BY created_at LIMIT 1",
  )
  const found = existing.rows[0]?.id
  if (found !== undefined) return found
  const created = await db.query<{ id: string }>(
    "INSERT INTO scenario (name, scenario_kind, description) VALUES ('Plan vivo', 'working', 'Escenario de trabajo por defecto') RETURNING id",
  )
  const id = created.rows[0]?.id
  if (id === undefined) throw new Error('No se pudo crear el escenario por defecto')
  return id
}
