/**
 * La tarea que dura una fase, de punta a punta y contra PostgreSQL.
 *
 * La prueba de unidad demuestra que el motor coloca la ventana. Ésta demuestra
 * la cadena que alguien usa de verdad: un CSV con las columnas `horas;desde;
 * hasta`, las puertas del proyecto puestas en su ficha, y la carga repartida
 * por toda la fase en vez de apilada al principio.
 *
 * Y comprueba la vuelta atrás, que es lo que hace que esto se pueda usar sin
 * miedo: si una de las dos puertas no tiene fecha, el plan **sale igual** — con
 * la tarea calculada como siempre y el aviso al lado.
 */

import { afterAll, describe, expect, it } from 'vitest'
import {
  createPool, withTransaction, setProjectGates, loadSnapshot,
} from '@planner/persistence'
import { schedulePlan } from '@planner/scheduler'
import { computeWorkload } from '@planner/workload'
import { importPlanCsv, ImportError } from './import-plan.js'
import { resolveHorizonFor } from './engine.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)
const sufijo = `${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`
const PROY = `VEN-${sufijo}`

afterAll(async () => {
  if (pool !== null) {
    await withTransaction(pool, async (db) => {
      await db.query('DELETE FROM project WHERE code LIKE $1', ['VEN-%'])
      await db.query('DELETE FROM resource WHERE display_name LIKE $1', ['Quien sea %'])
    })
  }
  await pool?.end()
})

const describeSiHayBase = pool === null ? describe.skip : describe

const CSV = [
  'proyecto;nombre_proyecto;tarea;dias;horas;desde;hasta;predecesoras;recurso;no_antes_de',
  `${PROY};Proyecto con gestión;Arrancar;10;;;;;Quien sea ${sufijo};2026-03-02`,
  `${PROY};;Gestión del proyecto;5;300;arranque;PES;Arrancar;Quien sea ${sufijo};`,
].join('\n')

describeSiHayBase('la tarea que dura una fase, de punta a punta', () => {
  it('se declara en el CSV, se coloca entre las puertas y la carga se reparte', async () => {
    if (pool === null) return

    const projectId = await withTransaction(pool, async (db) => {
      await importPlanCsv(db, CSV)
      const { rows } = await db.query<{ id: string }>('SELECT id FROM project WHERE code = $1', [PROY])
      return rows[0]?.id ?? ''
    })

    // Sin la puerta, el plan sale y lo dice. Es el primer día de cualquiera:
    // la tarea está declarada antes que las fechas de las puertas.
    const sinPuerta = await withTransaction(pool, async (db) =>
      schedulePlan(await loadSnapshot(db, { horizon: await resolveHorizonFor(db) })),
    )
    const aviso = sinPuerta.findings.find((f) => f.code === 'SPAN_ANCHOR_MISSING')
    expect(aviso, 'sin la puerta PES tiene que avisar').toBeDefined()
    expect(aviso?.payload?.['falta']).toBe('PES')

    // Y con la puerta puesta, la tarea ocupa la fase entera.
    const snapshot = await withTransaction(pool, async (db) => {
      await setProjectGates(db, projectId, [{ gate: 'PES', date: '2026-10-30', notes: null }])
      return loadSnapshot(db, { horizon: await resolveHorizonFor(db) })
    })
    const plan = schedulePlan(snapshot)
    expect(plan.findings.some((f) => f.code === 'SPAN_ANCHOR_MISSING')).toBe(false)

    const conNombre = new Map(
      (await withTransaction(pool, (db) =>
        db.query<{ id: string; name: string }>(
          'SELECT id, name FROM wbs_node WHERE project_id = $1 AND deleted_at IS NULL', [projectId],
        ),
      )).rows.map((f) => [f.name, f.id]),
    )
    const gestion = plan.taskResults.find((r) => r.nodeId === conNombre.get('Gestión del proyecto'))
    expect(gestion?.scheduledStart.date).toBe('2026-03-02')
    expect(gestion?.scheduledFinish.date).toBe('2026-10-30')
    // No la empuja su predecesora, que termina en marzo: va en paralelo.
    expect(gestion?.workMinutes).toBe(300 * 60)

    // Lo que importa de verdad: la curva. 300 h en ocho meses son un goteo, no
    // un bloque; y el último mes de la fase tiene carga.
    const { timephased } = computeWorkload(snapshot, plan)
    const deGestion = timephased.filter((c) => c.nodeId === conNombre.get('Gestión del proyecto'))
    expect(deGestion.length).toBeGreaterThan(150)
    expect(Math.max(...deGestion.map((c) => c.plannedMinutes))).toBeLessThan(180)
    expect(deGestion.some((c) => c.date >= '2026-10-01')).toBe(true)
  })

  it('media ventana la rechaza la importación, con la fila y el porqué', async () => {
    if (pool === null) return
    const malo = [
      'proyecto;nombre_proyecto;tarea;dias;desde;hasta',
      `${PROY}-X;Otro;Gestión;5;arranque;`,
    ].join('\n')
    await expect(
      withTransaction(pool, (db) => importPlanCsv(db, malo)),
    ).rejects.toThrow(ImportError)
  })

  it('la base tampoco deja media ventana, aunque se escriba a mano', async () => {
    if (pool === null) return
    // El CHECK es la red de abajo: la validación del importador se puede
    // saltar por otra ruta, la de la base no.
    await expect(
      withTransaction(pool, async (db) => {
        const { rows } = await db.query<{ node_id: string }>(
          `SELECT t.node_id FROM task t JOIN wbs_node n ON n.id = t.node_id
           JOIN project p ON p.id = n.project_id WHERE p.code = $1 LIMIT 1`,
          [PROY],
        )
        await db.query('UPDATE task SET span_from = $2, span_to = NULL WHERE node_id = $1', [
          rows[0]?.node_id ?? '',
          'arranque',
        ])
      }),
    ).rejects.toThrow(/task_span_entero_o_nada/)
  })
})
