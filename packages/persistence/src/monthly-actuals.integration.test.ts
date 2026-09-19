/**
 * Las horas que vienen por mes, contra PostgreSQL.
 *
 * La prueba de unidad del reparto vive en `@planner/report` y es pura. Ésta
 * demuestra lo que sólo se ve con la base delante:
 *
 *   1. Volver a cargar un mes lo **reemplaza**, no lo suma. Es la diferencia
 *      con el parte diario, y equivocarse aquí duplica horas en silencio.
 *   2. Cambiar una declaración borra lo que ya no viene. Sin eso, un 60/40 que
 *      pasa a ser 100 % en una tarea dejaría una suma del 140 % y el mes
 *      entero se quedaría sin repartir.
 *   3. Las dos vías —el parte diario y la mensual— no se suman nunca para el
 *      mismo mes del mismo proyecto.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPool, withTransaction } from './db.js'
import { saveActuals } from './actuals.js'
import {
  readAllActualsInPeriod,
  reconcileActuals,
  writeMonthlyActuals,
  writeSplits,
} from './monthly-actuals.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)
const sufijo = `${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`
const CODIGO = `MES-${sufijo}`

let projectId = ''
let resourceId = ''
let tareaA = ''
let tareaB = ''

const describeSiHayBase = pool === null ? describe.skip : describe

beforeAll(async () => {
  if (pool === null) return
  await withTransaction(pool, async (db) => {
    const proyecto = await db.query<{ id: string }>(
      `INSERT INTO project (code, name, status_start) VALUES ($1, 'Proyecto del mes', '2026-01-01')
       RETURNING id`,
      [CODIGO],
    )
    projectId = proyecto.rows[0]?.id ?? ''
    const persona = await db.query<{ id: string }>(
      `INSERT INTO resource (code, display_name, resource_kind) VALUES ($1, $2, 'person') RETURNING id`,
      [CODIGO, `Quien sea ${sufijo}`],
    )
    resourceId = persona.rows[0]?.id ?? ''
    for (const [nombre, destino] of [['Tarea A', 'a'], ['Tarea B', 'b']] as const) {
      const nodo = await db.query<{ id: string }>(
        `INSERT INTO wbs_node (project_id, node_kind, name, path, sort_key)
         VALUES ($1, 'task', $2, $3, 0) RETURNING id`,
        [projectId, nombre, `${destino}-${sufijo}`],
      )
      const id = nodo.rows[0]?.id ?? ''
      await db.query(
        `INSERT INTO task (node_id, task_type, duration_minutes, work_declared_minutes)
         VALUES ($1, 'fixed_duration', 480, 0)`,
        [id],
      )
      if (destino === 'a') tareaA = id
      else tareaB = id
    }
  })
})

afterAll(async () => {
  if (pool !== null) {
    await withTransaction(pool, async (db) => {
      await db.query('DELETE FROM project WHERE code = $1', [CODIGO])
      await db.query('DELETE FROM resource WHERE code = $1', [CODIGO])
    })
  }
  await pool?.end()
})

describeSiHayBase('las horas que vienen por mes', () => {
  it('volver a cargar un mes lo reemplaza, no lo suma', async () => {
    if (pool === null) return
    await withTransaction(pool, async (db) => {
      await writeMonthlyActuals(db, [{ resourceId, projectId, period: '2026-04', minutes: 2400 }])
      await writeMonthlyActuals(db, [{ resourceId, projectId, period: '2026-04', minutes: 3000 }])
      const { rows } = await db.query<{ minutes: number }>(
        'SELECT minutes FROM actual_month WHERE resource_id = $1 AND project_id = $2',
        [resourceId, projectId],
      )
      expect(rows).toHaveLength(1)
      // 3000, no 5400: una fila de `actual_month` ES el total del mes.
      expect(rows[0]?.minutes).toBe(3000)
    })
  })

  it('el mismo fichero con la clave repetida no revienta el ON CONFLICT', async () => {
    if (pool === null) return
    // «command cannot affect row a second time»: un export los trae, y sin
    // deduplicar antes la importación entera se cae.
    await withTransaction(pool, (db) =>
      writeMonthlyActuals(db, [
        { resourceId, projectId, period: '2026-05', minutes: 100 },
        { resourceId, projectId, period: '2026-05', minutes: 200 },
      ]),
    )
    await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{ minutes: number }>(
        `SELECT minutes FROM actual_month
         WHERE resource_id = $1 AND project_id = $2 AND period = '2026-05-01'`,
        [resourceId, projectId],
      )
      expect(rows[0]?.minutes).toBe(200)
    })
  })

  it('la declaración se reemplaza entera: lo que no viene, se borra', async () => {
    if (pool === null) return
    await withTransaction(pool, async (db) => {
      await writeSplits(db, [
        { resourceId, projectId, period: '2026-04', nodeId: tareaA, shareBp: 6000 },
        { resourceId, projectId, period: '2026-04', nodeId: tareaB, shareBp: 4000 },
      ])
      await writeSplits(db, [
        { resourceId, projectId, period: '2026-04', nodeId: tareaA, shareBp: 10_000 },
      ])
      const { rows } = await db.query<{ node_id: string; share_bp: number }>(
        `SELECT node_id, share_bp FROM actual_split
         WHERE resource_id = $1 AND project_id = $2 AND period = '2026-04-01'`,
        [resourceId, projectId],
      )
      // Si la fila del 40 % siguiera, la suma daría 140 % y abril entero se
      // quedaría sin repartir sin que nadie hubiera tocado abril.
      expect(rows).toHaveLength(1)
      expect(rows[0]?.share_bp).toBe(10_000)
    })
  })

  it('el reparto cae sobre las tareas y la conciliación cuadra', async () => {
    if (pool === null) return
    const { reparto } = await withTransaction(pool, (db) =>
      reconcileActuals(db, '2026-04-01', '2026-04-30'),
    )
    const mias = reparto.allocated.filter((fila) => fila.projectId === projectId)
    expect(mias).toHaveLength(1)
    expect(mias[0]?.nodeId).toBe(tareaA)
    expect(mias[0]?.actualMinutes).toBe(3000)
    expect(reparto.descuadres.filter((f) => f.projectId === projectId)).toEqual([])
  })

  it('un mes que ya tiene parte diario no se reparte: contaría dos veces', async () => {
    if (pool === null) return
    await withTransaction(pool, (db) =>
      saveActuals(db, [
        { nodeId: tareaB, resourceId, workDate: '2026-04-15', minutes: 480, source: 'timesheet' },
      ]),
    )
    const { reparto } = await withTransaction(pool, (db) =>
      reconcileActuals(db, '2026-04-01', '2026-04-30'),
    )
    const mios = reparto.descuadres.filter((fila) => fila.projectId === projectId)
    expect(mios[0]?.motivo).toBe('dos-caminos')
    expect(reparto.allocated.filter((fila) => fila.projectId === projectId)).toEqual([])

    // Y lo que el informe recibe son las 8 h del parte diario, una sola vez.
    const todas = await withTransaction(pool, (db) =>
      readAllActualsInPeriod(db, '2026-04-01', '2026-04-30'),
    )
    const deEsteProyecto = todas.filter((fila) => fila.projectId === projectId)
    expect(deEsteProyecto).toHaveLength(1)
    expect(deEsteProyecto[0]?.actualMinutes).toBe(480)
  })
})
