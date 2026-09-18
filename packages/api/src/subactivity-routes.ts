/**
 * Partir las tareas de un proyecto en la cadena de subactividades de su
 * entregable.
 *
 * Dos rutas, y la primera es la importante: enseña lo que haría la segunda sin
 * tocar nada. Es el mismo trato que la matriz de documentos, y aquí pesa más
 * todavía — la matriz **añade** dependencias, y esto **reestructura el plan**:
 * una tarea pasa a ser un paquete, nacen sus hijos y se mudan sus asignaciones.
 *
 * La propuesta se vuelve a calcular en el momento de aplicar y no se cree la
 * que trajo el navegador: entre que se mira y se acepta, otro ha podido tocar
 * el plan o el catálogo. Lo que sí se respeta del cliente es lo que haya
 * desmarcado a mano.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  applySubactivitySplit,
  readActivities,
  readDocumentTypes,
  readSubactivityInputs,
  withTransaction,
  type Pool,
} from '@planner/persistence'
import { planSubactivities, type SubactivityPlanResult } from '@planner/scheduler'
import { desde, enProyecto } from './permissions.js'
import { calculate, defaultScenarioId } from './engine.js'

type Db = Parameters<Parameters<typeof withTransaction<unknown>>[1]>[0]

async function previewFor(db: Db, projectId: string): Promise<SubactivityPlanResult> {
  const entradas = await readSubactivityInputs(db, projectId)
  return planSubactivities({
    tasks: entradas.tasks,
    deliveries: entradas.deliveries,
    activities: (await readActivities(db)).map((actividad) => ({
      documentTypeId: actividad.documentTypeId,
      step: actividad.step,
      position: actividad.position,
      role: actividad.role,
      standardMinutes: actividad.standardMinutes,
    })),
    assignments: entradas.assignments,
    links: entradas.links,
  })
}

export function registerSubactivityRoutes(app: FastifyInstance, pool: Pool): void {
  /** Qué se partiría, en qué trozos, y qué no se toca y por qué. No escribe. */
  app.get(
    '/api/projects/:projectId/subactivities/plan',
    { config: { permission: 'plan.ver', project: desde(enProyecto()) } },
    async (request) => {
      const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params)
      return withTransaction(pool, async (db) => ({
        ...(await previewFor(db, projectId)),
        // El catálogo viaja con la propuesta: sin él, «el entregable 9f3c…» no
        // le dice nada a nadie. Misma razón que en la matriz.
        documents: await readDocumentTypes(db),
      }))
    },
  )

  /**
   * Parte las tareas que queden marcadas y recalcula, como toda edición.
   *
   * Pide `plan.estructura` y no `plan.editar`: esto no cambia un número de una
   * tarea, cambia de qué tareas se compone el plan. Quien puede lo primero no
   * tiene por qué poder lo segundo.
   */
  app.post(
    '/api/projects/:projectId/subactivities/apply',
    { config: { permission: 'plan.estructura', project: desde(enProyecto()) } },
    async (request) => {
      const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params)
      const body = z
        .object({ exclude: z.array(z.string().uuid()).max(5000).optional() })
        .parse(request.body ?? {})
      const excluidas = new Set(body.exclude ?? [])

      const applied = await withTransaction(
        pool,
        async (db) => {
          const plan = await previewFor(db, projectId)
          const partir = plan.split
            .map((propuesta) => propuesta.nodeId)
            .filter((nodeId) => !excluidas.has(nodeId))
          const resumen = await applySubactivitySplit(db, plan, partir)
          return { ...resumen, skipped: plan.skipped, totals: plan.totals }
        },
        { comment: 'partir tareas en subactividades' },
      )

      const scenarioId = await withTransaction(pool, (db) => defaultScenarioId(db))
      return {
        result: applied,
        run: await calculate(pool, scenarioId, 'partir tareas en subactividades'),
      }
    },
  )
}
