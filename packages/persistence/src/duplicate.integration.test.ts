/**
 * Copia de proyectos y plantillas, contra PostgreSQL de verdad.
 *
 * Lo que se comprueba es lo que distingue una copia útil de un `INSERT ... SELECT`:
 * que el árbol conserva su forma, que las dependencias se reapuntan a los nodos
 * nuevos en vez de seguir atadas al original, que las fechas absolutas se
 * desplazan con la fecha de referencia, y que la gente no viaja.
 */

import { calendarDate } from '@planner/domain'
import { afterAll, describe, expect, it } from 'vitest'
import { createPool, withTransaction } from './db.js'
import { duplicateProject } from './duplicate.js'
import {
  addDependency,
  createNode,
  createProject,
  readDependencies,
  upsertAssignment,
} from './plan-edit.js'
import { createResource } from './resources.js'
import { loadSnapshot } from './snapshot.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

afterAll(async () => {
  await pool?.end()
})

const unique = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`

/** Un proyecto pequeño pero con todo lo que complica una copia. */
async function seedSource(): Promise<{ projectId: string; code: string; nodeA: string; nodeB: string }> {
  if (pool === null) throw new Error('sin base de datos')
  const code = unique('ORIGEN')
  return withTransaction(pool, async (db) => {
    const projectId = await createProject(db, { code, name: 'Origen', statusStart: '2026-03-02' })
    const fase = await createNode(db, { projectId, kind: 'phase', name: 'Fase' })
    const nodeA = await createNode(db, { projectId, parentId: fase, kind: 'task', name: 'Primera' })
    const nodeB = await createNode(db, { projectId, parentId: fase, kind: 'task', name: 'Segunda' })
    await addDependency(db, nodeA, nodeB, 'FS', 480)
    await db.query(
      `UPDATE task SET constraint_kind = 'start_no_earlier_than', constraint_date = '2026-03-16',
                       deadline = '2026-04-30', percent_complete_bp = 4000
       WHERE node_id = $1`,
      [nodeA],
    )
    return { projectId, code, nodeA, nodeB }
  })
}

describe.skipIf(pool === null)('copia de proyectos', () => {
  it('copia el árbol y reapunta las dependencias a los nodos nuevos', async () => {
    if (pool === null) return
    const { projectId } = await seedSource()
    const destino = unique('COPIA')

    const result = await withTransaction(pool, (db) =>
      duplicateProject(db, projectId, { code: destino, name: 'Copia', statusStart: '2026-03-02' }),
    )
    expect(result.nodes).toBe(3)
    expect(result.dependencies).toBe(1)

    const enlaces = await withTransaction(pool, async (db) => {
      const todos = await readDependencies(db)
      const { rows } = await db.query<{ id: string }>(
        'SELECT id FROM wbs_node WHERE project_id = $1 AND deleted_at IS NULL',
        [result.projectId],
      )
      const mios = new Set(rows.map((row) => row.id))
      return todos.filter((link) => mios.has(link.successorNodeId))
    })

    expect(enlaces).toHaveLength(1)
    // Lo que de verdad importa: la predecesora es la copia, no el original.
    const { rows } = await pool.query<{ project_id: string }>(
      'SELECT project_id FROM wbs_node WHERE id = $1',
      [enlaces[0]?.predecessorNodeId],
    )
    expect(rows[0]?.project_id).toBe(result.projectId)
    expect(enlaces[0]?.lagMinutes).toBe(480)
  })

  it('desplaza las fechas absolutas con la fecha de referencia, y el avance no viaja', async () => {
    if (pool === null) return
    const { projectId } = await seedSource()
    const destino = unique('DESPLAZADA')

    // Del 2 de marzo al 1 de junio: 91 días naturales.
    const result = await withTransaction(pool, (db) =>
      duplicateProject(db, projectId, { code: destino, name: 'Desplazada', statusStart: '2026-06-01' }),
    )
    expect(result.shiftedDates).toBe(2)

    const { rows } = await pool.query<{
      constraint_date: string | null
      deadline: string | null
      percent_complete_bp: number
    }>(
      `SELECT t.constraint_date::text, t.deadline::text, t.percent_complete_bp
       FROM task t JOIN wbs_node n ON n.id = t.node_id
       WHERE n.project_id = $1 AND n.name = 'Primera'`,
      [result.projectId],
    )
    expect(rows[0]?.constraint_date).toBe('2026-06-15')
    expect(rows[0]?.deadline).toBe('2026-07-30')
    // Un proyecto nuevo empieza a cero: copiar un 40 % hecho no significaría nada.
    expect(rows[0]?.percent_complete_bp).toBe(0)
  })

  it('la gente no viaja en la copia', async () => {
    if (pool === null) return
    const { projectId, nodeA } = await seedSource()
    await withTransaction(pool, async (db) => {
      const resource = await createResource(db, { code: unique('persona'), displayName: 'No viaja' })
      await upsertAssignment(db, nodeA, resource, 10_000)
    })

    const result = await withTransaction(pool, (db) =>
      duplicateProject(db, projectId, { code: unique('SINGENTE'), name: 'Sin gente', statusStart: '2026-03-02' }),
    )

    const { rows } = await pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM assignment a
       JOIN wbs_node n ON n.id = a.node_id WHERE n.project_id = $1`,
      [result.projectId],
    )
    expect(rows[0]?.total).toBe('0')
  })
})

describe.skipIf(pool === null)('plantillas', () => {
  it('una plantilla no entra en el snapshot: no se calcula ni genera carga', async () => {
    if (pool === null) return
    const { projectId } = await seedSource()
    const codigo = unique('PLANTILLA')

    const result = await withTransaction(pool, (db) =>
      duplicateProject(db, projectId, {
        code: codigo,
        name: 'Como plantilla',
        statusStart: '2026-03-02',
        asTemplate: true,
      }),
    )

    const snapshot = await withTransaction(pool, (db) =>
      loadSnapshot(db, { horizon: { from: calendarDate('2026-01-01'), to: calendarDate('2027-12-31') } }),
    )

    expect(snapshot.projects.some((project) => project.id === result.projectId)).toBe(false)
    // Y tampoco sus nodos: si quedaran, apuntarían a un proyecto que el motor
    // no conoce, que es la manera fina de reventar un cálculo.
    expect(snapshot.nodes.some((node) => node.projectId === result.projectId)).toBe(false)
  })

  it('la base de datos impide asignar personas a una plantilla', async () => {
    if (pool === null) return
    const { projectId } = await seedSource()

    const result = await withTransaction(pool, (db) =>
      duplicateProject(db, projectId, {
        code: unique('SINEQUIPO'),
        name: 'Sin equipo',
        statusStart: '2026-03-02',
        asTemplate: true,
      }),
    )

    const nodeId = await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        "SELECT id FROM wbs_node WHERE project_id = $1 AND node_kind = 'task' LIMIT 1",
        [result.projectId],
      )
      return rows[0]?.id ?? ''
    })

    await expect(
      withTransaction(pool, async (db) => {
        const resource = await createResource(db, { code: unique('persona'), displayName: 'Intruso' })
        await upsertAssignment(db, nodeId, resource, 10_000)
      }),
    ).rejects.toThrow(/plantilla no lleva personas/)
  })

  it('la plantilla de serie trae el ciclo de vida completo y ninguna asignación', async () => {
    if (pool === null) return
    const { rows } = await pool.query<{ nodos: string; tareas: string; enlaces: string }>(
      `SELECT
         (SELECT count(*)::text FROM wbs_node WHERE project_id = p.id AND deleted_at IS NULL) AS nodos,
         (SELECT count(*)::text FROM task t JOIN wbs_node n ON n.id = t.node_id WHERE n.project_id = p.id) AS tareas,
         (SELECT count(*)::text FROM dependency d JOIN wbs_node n ON n.id = d.successor_node_id
           WHERE n.project_id = p.id) AS enlaces
       FROM project p WHERE p.code = 'PLANTILLA-RAMS'`,
    )
    expect(rows[0]).toEqual({ nodos: '31', tareas: '25', enlaces: '24' })
  })
})
