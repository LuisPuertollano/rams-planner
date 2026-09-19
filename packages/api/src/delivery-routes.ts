/**
 * Partir las tareas de un proyecto en las entregas que pide la Checkliste.
 *
 * Dos rutas, y la primera es la importante: enseña lo que haría la segunda sin
 * tocar nada. Es el mismo trato que las subactividades, y aquí pesa igual —una
 * tarea pasa a ser un paquete, nacen sus entregas y se mudan sus asignaciones—
 * con una diferencia que conviene mirar antes de aceptar: **el tamaño de la
 * tarea no cambia**. Si esas dos cifras no coinciden, no hay que aplicar.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  applyDeliverySplit,
  readDeliveries,
  readDeliveryInputs,
  readDocumentTypes,
  withTransaction,
  type Pool,
} from '@planner/persistence'
import { planDeliveries, type DeliveryPlanResult } from '@planner/scheduler'
import { desde, enProyecto } from './permissions.js'
import { calculate, defaultScenarioId } from './engine.js'

type Db = Parameters<Parameters<typeof withTransaction<unknown>>[1]>[0]

async function previewFor(db: Db, projectId: string): Promise<DeliveryPlanResult> {
  const entradas = await readDeliveryInputs(db, projectId)
  const documentos = await readDocumentTypes(db)
  return planDeliveries({
    tasks: entradas.tasks,
    deliveries: entradas.deliveries,
    documents: documentos.map((documento) => ({
      documentTypeId: documento.id,
      code: documento.code,
      name: documento.name,
      gate: documento.gate,
      weeksBeforeGate: documento.weeksBeforeGate,
    })),
    checkliste: (await readDeliveries(db)).map((entrega) => ({
      documentTypeId: entrega.documentTypeId,
      position: entrega.position,
      gate: entrega.gate,
      maturity: entrega.maturity,
      weeksBeforeGate: entrega.weeksBeforeGate,
      shareBp: entrega.shareBp,
    })),
    assignments: entradas.assignments,
    links: entradas.links,
  })
}

export function registerDeliveryRoutes(app: FastifyInstance, pool: Pool): void {
  /** Qué se partiría, en qué entregas, y qué no se toca y por qué. No escribe. */
  app.get(
    '/api/projects/:projectId/deliveries/plan',
    { config: { permission: 'plan.ver', project: desde(enProyecto()) } },
    async (request) => {
      const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params)
      return withTransaction(pool, async (db) => ({
        ...(await previewFor(db, projectId)),
        documents: await readDocumentTypes(db),
      }))
    },
  )

  /**
   * Parte las tareas marcadas y recalcula.
   *
   * Pide `plan.estructura` por lo mismo que las subactividades: esto no cambia
   * un número de una tarea, cambia de qué tareas se compone el plan.
   */
  app.post(
    '/api/projects/:projectId/deliveries/apply',
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
          const resumen = await applyDeliverySplit(db, plan, partir)
          return { ...resumen, skipped: plan.skipped, totals: plan.totals }
        },
        { comment: 'partir tareas en sus entregas' },
      )

      const scenarioId = await withTransaction(pool, (db) => defaultScenarioId(db))
      return {
        result: applied,
        run: await calculate(pool, scenarioId, 'partir tareas en sus entregas'),
      }
    },
  )
}
