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
import { COMMITMENT_LEVELS } from '@planner/domain'
import {
  addDependency,
  createNode,
  createProject,
  duplicateProject,
  deleteDependency,
  readAssignments,
  readDependencies,
  readNodeDocumentsWithProject,
  renameNode,
  softDeleteAssignment,
  softDeleteNode,
  softDeleteProject,
  updateProject,
  upsertAssignment,
  withTransaction,
  type Pool,
} from '@planner/persistence'
import { frasesSinPermiso, puede } from './auth-routes.js'
import { describeDbError, fallar } from './errors.js'
import {
  EN_TODA_LA_HERRAMIENTA,
  PERMISSION_BY_CODE,
  RECORTADO,
  desde,
  enProyecto,
  porAsignacion,
  porDependencia,
  porNodo,
} from './permissions.js'
import { onlyVisible, visibleProjects } from './visibility.js'
import { calculate, defaultScenarioId } from './engine.js'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe ser AAAA-MM-DD')

/**
 * El 403 de las plantillas, en un sitio y no en dos.
 *
 * Es el mismo permiso denegado que monta el guardián, pero aquí lo comprueba la
 * ruta: crear un proyecto *a partir de* una plantilla y guardar uno *como*
 * plantilla entran por la misma puerta con distinta bandera.
 */
function sinPermisoDePlantillas(reply: FastifyReply): FastifyReply {
  const etiqueta = PERMISSION_BY_CODE.get('plantillas.gestionar')?.label ?? 'plantillas.gestionar'
  return fallar(reply, 403, 'SIN_PERMISO', frasesSinPermiso['sin-mas'](etiqueta), {
    permiso: 'plantillas.gestionar',
    etiqueta,
    donde: 'sin-mas',
  })
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
      const fallo = describeDbError(error, 'plan')
      if (fallo !== null) return fallar(reply, 422, fallo.code, fallo.mensaje)
      // Un error de escritura que el esquema no explica: se manda el detalle
      // tal cual, dentro de una frase que sí se puede traducir.
      if (!(error instanceof Error)) throw error
      return fallar(reply, 422, 'ESCRITURA_RECHAZADA', error.message, { detalle: error.message })
    }
    const scenarioId = await withTransaction(pool, (db) => defaultScenarioId(db))
    return { result, run: await calculate(pool, scenarioId, reason) }
  }

  /** La estructura editable: quién está asignado a qué y qué depende de qué. */
  app.get('/api/plan/structure', { config: { permission: 'plan.ver', project: RECORTADO } }, async (request) =>
    withTransaction(pool, async (db) => {
      const visibles = visibleProjects(request, 'plan.ver')
      // De una dependencia que cruza dos proyectos se ve la que llega al tuyo:
      // es la que te mueve las fechas y la que tienes que poder explicar.
      return {
        assignments: onlyVisible(visibles, await readAssignments(db), (row) => row.projectId),
        dependencies: onlyVisible(
          visibles,
          await readDependencies(db),
          (row) => row.successorProjectId,
        ),
        // Qué entrega cada tarea. Viaja aquí y no en una ruta propia porque se
        // pinta en la misma pantalla y con los mismos permisos que el resto de
        // la estructura.
        documents: onlyVisible(
          visibles,
          await readNodeDocumentsWithProject(db),
          (row) => row.projectId,
        ).map((row) => ({ nodeId: row.nodeId, documentTypeId: row.documentTypeId })),
      }
    }),
  )

  app.post('/api/projects', { config: { permission: 'plan.estructura', project: EN_TODA_LA_HERRAMIENTA } }, async (request, reply) => {
    const body = z
      .object({
        code: z.string().min(1).max(60),
        name: z.string().min(1).max(200),
        statusStart: isoDate,
        calendarCode: z.string().max(60).optional(),
        asTemplate: z.boolean().optional(),
        commitment: z.enum(COMMITMENT_LEVELS).optional(),
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
  app.post('/api/projects/:projectId/duplicate', { config: { permission: 'plantillas.usar' } }, async (request, reply) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        code: z.string().min(1).max(60),
        name: z.string().min(1).max(200),
        statusStart: isoDate,
        asTemplate: z.boolean().optional(),
      })
      .parse(request.body)
    // Crear un proyecto *a partir de* una plantilla es usarla; guardar uno
    // *como* plantilla es cambiar el catálogo de moldes del equipo. La ruta es
    // la misma, el permiso no.
    if (body.asTemplate === true && !puede(request, 'plantillas.gestionar')) {
      return sinPermisoDePlantillas(reply)
    }
    return write(
      reply,
      body.asTemplate === true ? `plantilla «${body.name}»` : `proyecto «${body.code}» a partir de otro`,
      `copia del proyecto ${projectId}`,
      (db) => duplicateProject(db, projectId, body),
    )
  })

  app.patch('/api/projects/:projectId', { config: { permission: 'plan.estructura', project: desde(enProyecto()) } }, async (request, reply) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        code: z.string().min(1).max(60).optional(),
        name: z.string().min(1).max(200).optional(),
        statusStart: isoDate.optional(),
        priority: z.number().int().min(0).max(10_000).optional(),
        isTemplate: z.boolean().optional(),
        commitment: z.enum(COMMITMENT_LEVELS).optional(),
        currentBaselineId: z.string().uuid().nullable().optional(),
      })
      .parse(request.body)
    if (Object.keys(body).length === 0) return fallar(reply, 400, 'NADA_QUE_CAMBIAR', 'No hay nada que cambiar.')
    // Convertir un proyecto en molde, o dejar de serlo, no es editar un
    // proyecto: es tocar el catálogo de plantillas.
    if (body.isTemplate !== undefined && !puede(request, 'plantillas.gestionar')) {
      return sinPermisoDePlantillas(reply)
    }
    return write(reply, 'edición del proyecto', `edición del proyecto ${projectId}`, async (db) => {
      await updateProject(db, projectId, body)
    })
  })

  app.delete('/api/projects/:projectId', { config: { permission: 'plan.estructura', project: desde(enProyecto()) } }, async (request, reply) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params)
    return write(reply, 'baja del proyecto', 'baja de un proyecto', async (db) => {
      await softDeleteProject(db, projectId)
    })
  })

  app.post('/api/nodes', { config: { permission: 'plan.estructura', project: desde(enProyecto('projectId', 'body')) } }, async (request, reply) => {
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

  app.patch('/api/nodes/:nodeId', { config: { permission: 'plan.editar', project: desde(porNodo()) } }, async (request, reply) => {
    const { nodeId } = z.object({ nodeId: z.string().uuid() }).parse(request.params)
    const body = z.object({ name: z.string().min(1).max(300) }).parse(request.body)
    return write(reply, 'renombrado', `renombrado de ${nodeId}`, async (db) => {
      await renameNode(db, nodeId, body.name)
    })
  })

  app.delete('/api/nodes/:nodeId', { config: { permission: 'plan.estructura', project: desde(porNodo()) } }, async (request, reply) => {
    const { nodeId } = z.object({ nodeId: z.string().uuid() }).parse(request.params)
    return write(reply, 'baja de una rama del plan', 'baja de una rama del plan', (db) => softDeleteNode(db, nodeId))
  })

  app.post('/api/assignments', { config: { permission: 'asignaciones.editar', project: desde(porNodo('nodeId', 'body')) } }, async (request, reply) => {
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

  app.delete('/api/assignments/:assignmentId', { config: { permission: 'asignaciones.editar', project: desde(porAsignacion()) } }, async (request, reply) => {
    const { assignmentId } = z.object({ assignmentId: z.string().uuid() }).parse(request.params)
    return write(reply, 'asignación retirada', 'cambio de asignaciones', async (db) => {
      await softDeleteAssignment(db, assignmentId)
    })
  })

  app.post('/api/dependencies', {
    config: {
      permission: 'dependencias.editar',
      // Los dos extremos: una dependencia ata dos tareas y puede cruzar dos
      // proyectos. Poder en uno solo no autoriza a atar el del vecino.
      project: desde(porNodo('predecessorNodeId', 'body'), porNodo('successorNodeId', 'body')),
    },
  }, async (request, reply) => {
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

  app.delete('/api/dependencies/:id', { config: { permission: 'dependencias.editar', project: desde(porDependencia()) } }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    return write(reply, 'dependencia retirada', 'cambio de dependencias', async (db) => {
      await deleteDependency(db, id)
    })
  })
}
