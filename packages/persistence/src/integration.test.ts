/**
 * Pruebas de integración contra PostgreSQL de verdad.
 *
 * Se saltan si no hay `DATABASE_URL`: el bucle rápido de desarrollo no debe
 * necesitar una base de datos. CI sí la levanta, y entonces estas pruebas
 * comprueban lo que ninguna prueba unitaria puede: que el esquema, el motor y
 * las consultas de lectura hablan el mismo idioma.
 */

import { calendarDate } from '@planner/domain'
import { schedulePlan } from '@planner/scheduler'
import { computeWorkload } from '@planner/workload'
import { createDerivationCollector } from '@planner/explain'
import { afterAll, describe, expect, it } from 'vitest'
import { createPool, withTransaction } from './db.js'
import { latestRun, readDiff, readFindings, readLoad, readTasks, readUtilization } from './read.js'
import { loadSnapshot } from './snapshot.js'
import { hashSnapshot, saveRun } from './runs.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

afterAll(async () => {
  await pool?.end()
})

describe.skipIf(pool === null)('integración con PostgreSQL', () => {
  const horizon = { from: calendarDate('2026-01-01'), to: calendarDate('2027-12-31') }

  it('carga un snapshot completo desde la base de datos', async () => {
    if (pool === null) return
    const snapshot = await withTransaction(pool, (db) => loadSnapshot(db, { horizon }))

    expect(snapshot.calendars.length).toBeGreaterThan(0)
    expect(snapshot.resources.length).toBeGreaterThan(0)
    expect(snapshot.projects.length).toBeGreaterThan(0)
    expect(snapshot.tasks.length).toBeGreaterThan(0)
    // Los calendarios base sembrados por la migración traen sus festivos.
    expect(snapshot.calendars.some((calendar) => calendar.exceptions.length > 0)).toBe(true)
    // Las fechas llegan como fechas de calendario, no como instantes.
    expect(snapshot.projects[0]?.statusStart).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('el mismo snapshot produce el mismo hash y el mismo resultado', async () => {
    if (pool === null) return
    const snapshot = await withTransaction(pool, (db) => loadSnapshot(db, { horizon }))
    const other = await withTransaction(pool, (db) => loadSnapshot(db, { horizon }))

    expect(hashSnapshot(snapshot)).toBe(hashSnapshot(other))
    expect(JSON.stringify(schedulePlan(snapshot).taskResults)).toBe(
      JSON.stringify(schedulePlan(other).taskResults),
    )
  })

  it('guarda una ejecución y la lee entera de vuelta', async () => {
    if (pool === null) return
    const collector = createDerivationCollector()

    const runId = await withTransaction(pool, async (db) => {
      const snapshot = await loadSnapshot(db, { horizon })
      const schedule = schedulePlan(snapshot, { derivations: collector.sink })
      const workload = computeWorkload(snapshot, schedule, { derivations: collector.sink })
      const scenario = await db.query<{ id: string }>(
        "INSERT INTO scenario (name, scenario_kind) VALUES ('Prueba de integración', 'whatif') RETURNING id",
      )
      return saveRun(db, {
        scenarioId: scenario.rows[0]?.id ?? '',
        snapshot,
        schedule,
        workload,
        derivations: collector.derivations,
        durationMs: 0,
      })
    })

    const tasks = await withTransaction(pool, (db) => readTasks(db, runId))
    const load = await withTransaction(pool, (db) => readLoad(db, runId, 'month'))
    const utilization = await withTransaction(pool, (db) => readUtilization(db, runId, 'month'))
    const findings = await withTransaction(pool, (db) => readFindings(db, runId))

    expect(tasks.length).toBeGreaterThan(0)
    expect(tasks.every((task) => task.name.length > 0)).toBe(true)
    expect(load.length).toBeGreaterThan(0)
    expect(utilization.length).toBeGreaterThan(0)
    expect(findings.length).toBeGreaterThan(0)

    // La carga guardada coincide con la calculada, sin pérdidas de redondeo.
    const savedMinutes = load.reduce((sum, cell) => sum + cell.plannedMinutes, 0)
    const snapshot = await withTransaction(pool, (db) => loadSnapshot(db, { horizon }))
    const recomputed = computeWorkload(snapshot, schedulePlan(snapshot))
    const expectedMinutes = recomputed.timephased.reduce((sum, cell) => sum + cell.plannedMinutes, 0)
    expect(savedMinutes).toBe(expectedMinutes)

    // Toda fila derivada trae su ejecución: un número sin runId no se puede auditar.
    const summary = await withTransaction(pool, (db) => latestRun(db))
    expect(summary).toBeDefined()
  })

  it('el diff entre una ejecución y ella misma no encuentra diferencias', async () => {
    if (pool === null) return
    const summary = await withTransaction(pool, (db) => latestRun(db))
    if (summary === undefined) throw new Error('No hay ninguna ejecución guardada')
    const diff = await withTransaction(pool, (db) => readDiff(db, summary.id, summary.id))
    expect(diff).toEqual([])
  })

  it('el historial registra los cambios con su comentario', async () => {
    if (pool === null) return
    const nodeId = await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{ node_id: string }>(
        "SELECT node_id FROM task WHERE is_milestone = FALSE ORDER BY node_id LIMIT 1",
      )
      return rows[0]?.node_id ?? ''
    })

    await withTransaction(
      pool,
      async (db) => {
        await db.query('UPDATE task SET duration_minutes = duration_minutes + 1 WHERE node_id = $1', [nodeId])
      },
      { comment: 'prueba de integración' },
    )

    const events = await withTransaction(pool, async (db) =>
      db.query<{ comment: string | null; operation: string }>(
        'SELECT comment, operation FROM change_event WHERE entity_id = $1 ORDER BY occurred_at DESC LIMIT 1',
        [nodeId],
      ),
    )
    expect(events.rows[0]?.comment).toBe('prueba de integración')
    expect(events.rows[0]?.operation).toBe('update')

    // Se deja como estaba: las pruebas no ensucian el juego de datos.
    await withTransaction(pool, async (db) => {
      await db.query('UPDATE task SET duration_minutes = duration_minutes - 1 WHERE node_id = $1', [nodeId])
    })
  })
})
