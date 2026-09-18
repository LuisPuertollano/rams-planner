/**
 * Las puertas del proyecto y las fechas objetivo, contra PostgreSQL de verdad.
 *
 * Lo que una prueba en memoria no puede comprobar y aquí sí: que la fecha
 * objetivo **se escribe en `task.deadline`** y por tanto entra en la maquinaria
 * de hallazgos que ya existía, que declarar las puertas es un reemplazo de
 * verdad, y que dos personas no pueden dejar «CGR» y «cgr» conviviendo en el
 * mismo proyecto — que es lo que haría que la mitad de los entregables
 * encontraran fecha y la otra mitad no, sin que nada lo dijera.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  applyGateDeadlines,
  createPool,
  readGateInputs,
  readProjectGates,
  setProjectGates,
  withTransaction,
} from '@planner/persistence'
import { planGateDeadlines } from '@planner/scheduler'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

const unico = (prefijo: string): string =>
  `${prefijo}-${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`

const creados: string[] = []

afterAll(async () => {
  if (pool !== null && creados.length > 0) {
    await withTransaction(pool, async (db) => {
      await db.query('DELETE FROM project WHERE id = ANY($1::uuid[])', [creados])
      await db.query('DELETE FROM document_type WHERE code LIKE $1', ['PUERTA-%'])
    })
  }
  await pool?.end()
})

const describeSiHayBase = pool === null ? describe.skip : describe

/** Un proyecto con una tarea que entrega un documento que va a una puerta. */
async function monta(
  puerta: string | null,
  semanas: number | null,
): Promise<{ projectId: string; nodeId: string; documentTypeId: string }> {
  if (pool === null) throw new Error('sin base')
  return withTransaction(pool, async (db) => {
    const proyecto = await db.query<{ id: string }>(
      `INSERT INTO project (code, name, status_start) VALUES ($1, 'Proyecto con puertas', '2026-01-01')
       RETURNING id`,
      [unico('PUE')],
    )
    const projectId = proyecto.rows[0]?.id ?? ''
    creados.push(projectId)

    const documento = await db.query<{ id: string }>(
      `INSERT INTO document_type (code, name, gate, weeks_before_gate)
       VALUES ($1, 'Análisis de modos de fallo', $2, $3) RETURNING id`,
      [unico('PUERTA'), puerta, semanas],
    )
    const documentTypeId = documento.rows[0]?.id ?? ''

    const nodo = await db.query<{ id: string }>(
      `INSERT INTO wbs_node (project_id, parent_id, node_kind, code, path, sort_key, name)
       VALUES ($1, NULL, 'task', '1', '001', 1, 'Redactar el análisis') RETURNING id`,
      [projectId],
    )
    const nodeId = nodo.rows[0]?.id ?? ''
    await db.query(
      `INSERT INTO task (node_id, task_type, is_effort_driven, duration_minutes,
                         work_declared_minutes, constraint_kind, percent_complete_bp, is_milestone)
       VALUES ($1, 'fixed_duration', TRUE, 480, 0, 'asap', 0, FALSE)`,
      [nodeId],
    )
    await db.query(
      'INSERT INTO node_document (node_id, document_type_id) VALUES ($1, $2)',
      [nodeId, documentTypeId],
    )
    return { projectId, nodeId, documentTypeId }
  })
}

describeSiHayBase('las puertas del proyecto', () => {
  beforeAll(() => undefined)

  it('la fecha objetivo acaba en task.deadline, que es donde la mira el motor', async () => {
    if (pool === null) return
    const { projectId, nodeId } = await monta('CGR', 4)

    const escrito = await withTransaction(pool, async (db) => {
      await setProjectGates(db, projectId, [
        { gate: 'CGR', date: '2028-05-14', notes: null },
      ])
      const plan = planGateDeadlines(await readGateInputs(db, projectId))
      expect(plan.set).toHaveLength(1)
      expect(plan.set[0]?.deadline).toBe('2028-04-16')
      await applyGateDeadlines(db, plan, [nodeId])
      const { rows } = await db.query<{ deadline: string | null }>(
        'SELECT deadline::text AS deadline FROM task WHERE node_id = $1',
        [nodeId],
      )
      return rows[0]?.deadline ?? null
    })
    expect(escrito).toBe('2028-04-16')
  })

  it('aplicar sólo escribe los nodos que se le pasan', async () => {
    if (pool === null) return
    const { projectId, nodeId } = await monta('CGR', 0)
    const sinTocar = await withTransaction(pool, async (db) => {
      await setProjectGates(db, projectId, [{ gate: 'CGR', date: '2029-03-01', notes: null }])
      const plan = planGateDeadlines(await readGateInputs(db, projectId))
      // La lista de aplicar va vacía: la pantalla lo desmarcó todo.
      const resumen = await applyGateDeadlines(db, plan, [])
      expect(resumen.deadlinesSet).toBe(0)
      const { rows } = await db.query<{ deadline: string | null }>(
        'SELECT deadline::text AS deadline FROM task WHERE node_id = $1',
        [nodeId],
      )
      return rows[0]?.deadline ?? null
    })
    expect(sinTocar).toBeNull()
  })

  it('declarar las puertas reemplaza: lo que no viene, se va', async () => {
    if (pool === null) return
    const { projectId } = await monta('CGR', 2)
    const despues = await withTransaction(pool, async (db) => {
      await setProjectGates(db, projectId, [
        { gate: 'IGR', date: '2027-02-01', notes: null },
        { gate: 'CGR', date: '2028-05-14', notes: 'revisión de diseño' },
      ])
      await setProjectGates(db, projectId, [{ gate: 'CGR', date: '2028-06-01', notes: null }])
      return readProjectGates(db, projectId)
    })
    expect(despues.map((p) => p.gate)).toEqual(['CGR'])
    // Y la que se queda se actualiza, no se duplica.
    expect(despues[0]?.date).toBe('2028-06-01')
    expect(despues[0]?.notes).toBeNull()
  })

  it('«CGR» y «cgr» no pueden convivir en el mismo proyecto', async () => {
    if (pool === null) return
    const { projectId } = await monta('CGR', 1)
    await withTransaction(pool, (db) =>
      setProjectGates(db, projectId, [{ gate: 'CGR', date: '2028-05-14', notes: null }]),
    )
    await expect(
      withTransaction(pool, async (db) => {
        await db.query(
          'INSERT INTO project_gate (project_id, gate, gate_date) VALUES ($1, $2, $3::date)',
          [projectId, 'cgr', '2030-01-01'],
        )
      }),
    ).rejects.toThrow()
  })

  it('una puerta sin fechar sale por su nombre, no como un descarte mudo', async () => {
    if (pool === null) return
    const { projectId } = await monta('FQA', 3)
    const plan = await withTransaction(pool, async (db) =>
      planGateDeadlines(await readGateInputs(db, projectId)),
    )
    expect(plan.set).toHaveLength(0)
    expect(plan.totals.puertasSinFecha).toEqual(['FQA'])
    expect(plan.skipped[0]?.reason).toBe('puerta-sin-fecha')
  })
})
