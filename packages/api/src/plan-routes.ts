/**
 * Rutas de edición del plan: proyectos, nodos del árbol, asignaciones y
 * dependencias.
 *
 * Lo que la importación de CSV hace de golpe, esto lo hace de uno en uno. Igual
 * que allí, cada escritura recalcula y devuelve la ejecución nueva: un plan
 * editado que sigue enseñando las fechas de antes es peor que no editarlo.
 */

import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  addDependency,
  createNode,
  createProject,
  duplicateProject,
  deleteDependency,
  readAssignments,
  readDependencies,
  renameNode,
  softDeleteAssignment,
  softDeleteNode,
  softDeleteProject,
  updateProject,
  upsertAssignment,
  withTransaction,
  type Pool,
} from '@planner/persistence'
import { calculate, defaultScenarioId } from './engine.js'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe ser AAAA-MM-DD')

/** Los errores de esquema que un usuario puede provocar escribiendo, en castellano. */
function describeDbError(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  const code = String(error.code)
  const constraint = 'constraint' in error ? String((error as { constraint: unknown }).constraint) : ''
  if (code === '23505') {
    if (constraint.includes('project_code')) return 'Ya existe un proyecto con ese código.'
    if (constraint.includes('assignment')) return 'Esa persona ya está asignada a esta tarea.'
    if (constraint.includes('dependency')) return 'Esa dependencia ya existe.'
    return 'Ya existe un registro con esos datos.'
  }
  if (code === '23514') return 'Los datos no cumplen una regla del esquema (revisa duraciones y fechas).'
  if (code === '23503') return 'Algo de lo que referencias ya no existe.'
  return null
}

export function registerPlanRoutes(app: FastifyInstance, pool: Pool): void {
  const write = async <T>(
    reply: FastifyReply,
    comment: string,
    reason: string,
    handler: (db: Parameters<Parameters<typeof withTransaction<T>>[1]>[0]) => Promise<T>,
  ): Promise<unknown> => {
    let result: T
    try {
      result = await withTransaction(pool, handler, { comment })
    } catch (error) {
      const message = describeDbError(error) ?? (error instanceof Error ? error.message : null)
      if (message === null) throw error
      return reply.status(422).send({ error: message })
    }
    const scenarioId = await withTransaction(pool, (db) => defaultScenarioId(db))
    return { result, run: await calculate(pool, scenarioId, reason) }
  }

  /** La estructura editable: quién está asignado a qué y qué depende de qué. */
  app.get('/api/plan/structure', async () =>
    withTransaction(pool, async (db) => ({
      assignments: await readAssignments(db),
      dependencies: await readDependencies(db),
    })),
  )

  app.post('/api/projects', async (request, reply) => {
    const body = z
      .object({
        code: z.string().min(1).max(60),
        name: z.string().min(1).max(200),
        statusStart: isoDate,
        calendarCode: z.string().max(60).optional(),
        asTemplate: z.boolean().optional(),
      })
      .parse(request.body)
    return write(reply, `alta del proyecto ${body.code}`, `alta del proyecto ${body.code}`, (db) =>
      createProject(db, body),
    )
  })

  /**
   * Copia un proyecto entero. Las tres cosas que se piden en la práctica son
   * esta misma llamada con distinto destino: guardar como plantilla, crear a
   * partir de una plantilla, y duplicar un proyecto.
   */
  app.post('/api/projects/:projectId/duplicate', async (request, reply) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        code: z.string().min(1).max(60),
        name: z.string().min(1).max(200),
        statusStart: isoDate,
        asTemplate: z.boolean().optional(),
      })
      .parse(request.body)
    return write(
      reply,
      body.asTemplate === true ? `plantilla «${body.name}»` : `proyecto «${body.code}» a partir de otro`,
      `copia del proyecto ${projectId}`,
      (db) => duplicateProject(db, projectId, body),
    )
  })

  app.patch('/api/projects/:projectId', async (request, reply) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        code: z.string().min(1).max(60).optional(),
        name: z.string().min(1).max(200).optional(),
        statusStart: isoDate.optional(),
        priority: z.number().int().min(0).max(10_000).optional(),
        isTemplate: z.boolean().optional(),
      })
      .parse(request.body)
    if (Object.keys(body).length === 0) return reply.status(400).send({ error: 'No hay nada que cambiar' })
    return write(reply, 'edición del proyecto', `edición del proyecto ${projectId}`, async (db) => {
      await updateProject(db, projectId, body)
    })
  })

  app.delete('/api/projects/:projectId', async (request, reply) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params)
    return write(reply, 'baja del proyecto', 'baja de un proyecto', async (db) => {
      await softDeleteProject(db, projectId)
    })
  })

  app.post('/api/nodes', async (request, reply) => {
    const body = z
      .object({
        projectId: z.string().uuid(),
        parentId: z.string().uuid().nullable().optional(),
        kind: z.enum(['phase', 'work_package', 'task', 'milestone']),
        name: z.string().min(1).max(300),
        durationMinutes: z.number().int().min(0).optional(),
      })
      .parse(request.body)
    return write(reply, `alta de «${body.name}»`, `alta de «${body.name}»`, (db) => createNode(db, body))
  })

  app.patch('/api/nodes/:nodeId', async (request, reply) => {
    const { nodeId } = z.object({ nodeId: z.string().uuid() }).parse(request.params)
    const body = z.object({ name: z.string().min(1).max(300) }).parse(request.body)
    return write(reply, 'renombrado', `renombrado de ${nodeId}`, async (db) => {
      await renameNode(db, nodeId, body.name)
    })
  })

  app.delete('/api/nodes/:nodeId', async (request, reply) => {
    const { nodeId } = z.object({ nodeId: z.string().uuid() }).parse(request.params)
    return write(reply, 'baja de una rama del plan', 'baja de una rama del plan', (db) => softDeleteNode(db, nodeId))
  })

  app.post('/api/assignments', async (request, reply) => {
    const body = z
      .object({
        nodeId: z.string().uuid(),
        resourceId: z.string().uuid(),
        unitsBp: z.number().int().min(0).max(20_000).default(10_000),
      })
      .parse(request.body)
    return write(reply, 'asignación', 'cambio de asignaciones', (db) =>
      upsertAssignment(db, body.nodeId, body.resourceId, body.unitsBp),
    )
  })

  app.delete('/api/assignments/:assignmentId', async (request, reply) => {
    const { assignmentId } = z.object({ assignmentId: z.string().uuid() }).parse(request.params)
    return write(reply, 'asignación retirada', 'cambio de asignaciones', async (db) => {
      await softDeleteAssignment(db, assignmentId)
    })
  })

  app.post('/api/dependencies', async (request, reply) => {
    const body = z
      .object({
        predecessorNodeId: z.string().uuid(),
        successorNodeId: z.string().uuid(),
        kind: z.enum(['FS', 'SS', 'FF', 'SF']).default('FS'),
        lagMinutes: z.number().int().default(0),
      })
      .parse(request.body)
    return write(reply, 'nueva dependencia', 'cambio de dependencias', (db) =>
      addDependency(db, body.predecessorNodeId, body.successorNodeId, body.kind, body.lagMinutes),
    )
  })

  app.delete('/api/dependencies/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    return write(reply, 'dependencia retirada', 'cambio de dependencias', async (db) => {
      await deleteDependency(db, id)
    })
  })
}
