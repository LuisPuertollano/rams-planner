/**
 * Edición del plan contra PostgreSQL de verdad.
 *
 * Lo que se comprueba aquí es lo que el árbol WBS no perdona: que el `path` que
 * mantiene la aplicación ordena bien, que la baja se lleva el subárbol entero y
 * sólo el subárbol, y que las invariantes de asignación y dependencia siguen en
 * pie. Se salta sin `DATABASE_URL`, como el resto de la integración.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { createPool, withTransaction } from './db.js'
import {
  addDependency,
  createNode,
  createProject,
  deleteDependency,
  readAssignments,
  readDependencies,
  softDeleteNode,
  softDeleteProject,
  upsertAssignment,
} from './plan-edit.js'
import { createResource } from './resources.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

afterAll(async () => {
  await pool?.end()
})

const unique = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`

/** Los nombres del subárbol de un proyecto, en el orden en que salen por `path`. */
async function namesOf(projectId: string): Promise<readonly string[]> {
  if (pool === null) return []
  const { rows } = await pool.query<{ name: string }>(
    'SELECT name FROM wbs_node WHERE project_id = $1 AND deleted_at IS NULL ORDER BY path',
    [projectId],
  )
  return rows.map((row) => row.name)
}

describe.skipIf(pool === null)('edición del plan', () => {
  it('construye un árbol ordenado por path y rechaza colgar de una hoja', async () => {
    if (pool === null) return
    const code = unique('ARBOL')

    const { projectId, faseB } = await withTransaction(pool, async (db) => {
      const project = await createProject(db, { code, name: 'Árbol', statusStart: '2026-03-02' })
      const a = await createNode(db, { projectId: project, kind: 'phase', name: 'A fase' })
      const b = await createNode(db, { projectId: project, kind: 'phase', name: 'B fase' })
      // Se crean en desorden alfabético a propósito: manda el orden de alta.
      await createNode(db, { projectId: project, parentId: b, kind: 'task', name: 'B primera' })
      await createNode(db, { projectId: project, parentId: a, kind: 'task', name: 'A primera' })
      await createNode(db, { projectId: project, parentId: a, kind: 'milestone', name: 'A hito' })
      return { projectId: project, faseB: b }
    })

    expect(await namesOf(projectId)).toEqual(['A fase', 'A primera', 'A hito', 'B fase', 'B primera'])

    // Una tarea no es un contenedor: colgar trabajo de ella rompería W3.
    const hoja = await pool.query<{ id: string }>(
      "SELECT id FROM wbs_node WHERE project_id = $1 AND name = 'B primera'",
      [projectId],
    )
    await expect(
      withTransaction(pool, async (db) => {
        await createNode(db, {
          projectId,
          parentId: hoja.rows[0]?.id ?? '',
          kind: 'task',
          name: 'Imposible',
        })
      }),
    ).rejects.toThrow(/fase o de un paquete de trabajo/)

    // Y el hito nace con duración cero, que es lo que lo hace un hito.
    const hito = await pool.query<{ duration_minutes: number; is_milestone: boolean }>(
      `SELECT t.duration_minutes, t.is_milestone FROM task t
       JOIN wbs_node n ON n.id = t.node_id WHERE n.project_id = $1 AND n.name = 'A hito'`,
      [projectId],
    )
    expect(hito.rows[0]).toEqual({ duration_minutes: 0, is_milestone: true })

    expect(faseB).toBeDefined()
  })

  it('la baja se lleva el subárbol entero y nada más', async () => {
    if (pool === null) return
    const code = unique('BAJA')

    const { projectId, faseA } = await withTransaction(pool, async (db) => {
      const project = await createProject(db, { code, name: 'Baja', statusStart: '2026-03-02' })
      const a = await createNode(db, { projectId: project, kind: 'phase', name: 'Fase A' })
      const b = await createNode(db, { projectId: project, kind: 'phase', name: 'Fase B' })
      await createNode(db, { projectId: project, parentId: a, kind: 'task', name: 'Hija de A' })
      await createNode(db, { projectId: project, parentId: b, kind: 'task', name: 'Hija de B' })
      return { projectId: project, faseA: a }
    })

    const bajas = await withTransaction(pool, (db) => softDeleteNode(db, faseA))
    expect(bajas).toBe(2)
    expect(await namesOf(projectId)).toEqual(['Fase B', 'Hija de B'])

    // Y la baja del proyecto se lleva lo que quede.
    await withTransaction(pool, async (db) => { await softDeleteProject(db, projectId) })
    expect(await namesOf(projectId)).toEqual([])
  })

  it('reasignar a quien ya está cambia su dedicación en vez de duplicarla', async () => {
    if (pool === null) return
    const code = unique('ASIG')

    const { nodeId, resourceId } = await withTransaction(pool, async (db) => {
      const project = await createProject(db, { code, name: 'Asignaciones', statusStart: '2026-03-02' })
      const fase = await createNode(db, { projectId: project, kind: 'phase', name: 'Fase' })
      const node = await createNode(db, { projectId: project, parentId: fase, kind: 'task', name: 'Tarea' })
      const resource = await createResource(db, { code: unique('persona'), displayName: 'Asignable' })
      await upsertAssignment(db, node, resource, 10_000)
      return { nodeId: node, resourceId: resource }
    })

    const primera = await withTransaction(pool, async (db) =>
      (await readAssignments(db)).filter((row) => row.nodeId === nodeId),
    )
    expect(primera).toHaveLength(1)
    expect(primera[0]?.unitsBp).toBe(10_000)

    await withTransaction(pool, async (db) => { await upsertAssignment(db, nodeId, resourceId, 2_500) })

    const segunda = await withTransaction(pool, async (db) =>
      (await readAssignments(db)).filter((row) => row.nodeId === nodeId),
    )
    // Invariante A1: una persona aparece una sola vez en una tarea.
    expect(segunda).toHaveLength(1)
    expect(segunda[0]?.unitsBp).toBe(2_500)
  })

  it('enlaza dos tareas, rechaza el bucle de una consigo misma y desenlaza', async () => {
    if (pool === null) return
    const code = unique('DEP')

    const { primera, segunda } = await withTransaction(pool, async (db) => {
      const project = await createProject(db, { code, name: 'Dependencias', statusStart: '2026-03-02' })
      const fase = await createNode(db, { projectId: project, kind: 'phase', name: 'Fase' })
      return {
        primera: await createNode(db, { projectId: project, parentId: fase, kind: 'task', name: 'Primera' }),
        segunda: await createNode(db, { projectId: project, parentId: fase, kind: 'task', name: 'Segunda' }),
      }
    })

    const id = await withTransaction(pool, (db) => addDependency(db, primera, segunda, 'FS', 480))
    const enlaces = await withTransaction(pool, async (db) =>
      (await readDependencies(db)).filter((row) => row.successorNodeId === segunda),
    )
    expect(enlaces).toHaveLength(1)
    expect(enlaces[0]?.lagMinutes).toBe(480)

    await expect(
      withTransaction(pool, async (db) => { await addDependency(db, segunda, segunda, 'FS', 0) }),
    ).rejects.toThrow(/sí misma/)

    // Repetir el enlace lo actualiza, no lo duplica.
    await withTransaction(pool, async (db) => { await addDependency(db, primera, segunda, 'SS', 0) })
    const tras = await withTransaction(pool, async (db) =>
      (await readDependencies(db)).filter((row) => row.successorNodeId === segunda),
    )
    expect(tras).toHaveLength(1)
    expect(tras[0]?.kind).toBe('SS')

    await withTransaction(pool, async (db) => { await deleteDependency(db, id) })
    const vacio = await withTransaction(pool, async (db) =>
      (await readDependencies(db)).filter((row) => row.successorNodeId === segunda),
    )
    expect(vacio).toEqual([])
  })

  it('una tarea dada de baja sale del árbol pero no de la tabla (P7)', async () => {
    if (pool === null) return
    const code = unique('LECTURA')

    const { projectId, nodeId } = await withTransaction(pool, async (db) => {
      const project = await createProject(db, { code, name: 'Lectura', statusStart: '2026-03-02' })
      const fase = await createNode(db, { projectId: project, kind: 'phase', name: 'Fase' })
      return {
        projectId: project,
        nodeId: await createNode(db, { projectId: project, parentId: fase, kind: 'task', name: 'Se va a ir' }),
      }
    })

    await withTransaction(pool, async (db) => { await softDeleteNode(db, nodeId) })

    // Fuera del árbol que leen las consultas...
    expect(await namesOf(projectId)).toEqual(['Fase'])
    const { rows } = await pool.query<{ deleted_at: Date | null }>(
      'SELECT deleted_at FROM wbs_node WHERE id = $1',
      [nodeId],
    )
    // ...pero la fila sigue ahí, con su marca: nada se borra nunca.
    expect(rows[0]?.deleted_at).not.toBeNull()
  })
})
