/**
 * Propuesta de reparto de trabajo, y su aplicación de una en una.
 *
 * El cálculo de las propuestas es una **lectura**: no escribe nada, no crea
 * ejecución y se puede pedir tantas veces como se quiera. Aplicar una sí
 * escribe, y entonces sí recalcula, como cualquier otro cambio de asignaciones.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { schedulePlan } from '@planner/scheduler'
import { computeWorkload, proposeRebalance } from '@planner/workload'
import {
  loadSnapshot,
  softDeleteAssignment,
  upsertAssignment,
  withTransaction,
  type Pool,
} from '@planner/persistence'
import { calculate, defaultScenarioId, resolveHorizonFor } from './engine.js'
import { RECORTADO, desde, porAsignacion, porNodo } from './permissions.js'
import { onlyVisible, visibleProjects } from './visibility.js'

export function registerRebalanceRoutes(app: FastifyInstance, pool: Pool): void {
  /**
   * Las propuestas se calculan sobre el estado actual, no sobre una ejecución
   * guardada: son una recomendación de ahora mismo, no un resultado que haya
   * que poder auditar dentro de tres años.
   */
  app.get('/api/rebalance', { config: { permission: 'reparto.ver', project: RECORTADO } }, async (request) => {
    const query = z
      .object({ threshold: z.coerce.number().int().min(1_000).max(30_000).default(10_000) })
      .parse(request.query)

    return withTransaction(pool, async (db) => {
      const horizon = await resolveHorizonFor(db)
      const snapshot = await loadSnapshot(db, { horizon })
      const schedule = schedulePlan(snapshot)
      const { timephased, capacity } = computeWorkload(snapshot, schedule)
      const { proposals, findings } = proposeRebalance(snapshot, timephased, capacity, {
        thresholdBp: query.threshold,
      })
      // Una propuesta dice quién suelta trabajo y quién lo recoge: eso es carga
      // de otra persona, y sólo se enseña sobre proyectos que se pueden ver.
      const visibles = visibleProjects(request, 'reparto.ver')
      return {
        thresholdBp: query.threshold,
        proposals: onlyVisible(visibles, proposals, (proposal) => proposal.projectId),
        // Los hallazgos del reparto hablan de personas, no de proyectos: se
        // sirven enteros o no se sirven.
        findings: visibles === 'all' ? findings : [],
      }
    })
  })

  /** Aplica un movimiento: quita la asignación de quien la tenía y la pone en otro. */
  app.post('/api/rebalance/apply', {
    config: {
      permission: 'reparto.aplicar',
      // De dónde sale el trabajo y a dónde va: los dos, porque quitar una
      // asignación del proyecto ajeno es tan cambio como ponerla en el tuyo.
      project: desde(porAsignacion('assignmentId', 'body'), porNodo('nodeId', 'body')),
    },
  }, async (request) => {
    const body = z
      .object({
        assignmentId: z.string().uuid(),
        nodeId: z.string().uuid(),
        toResourceId: z.string().uuid(),
        unitsBp: z.number().int().min(0).max(20_000).default(10_000),
      })
      .parse(request.body)

    await withTransaction(
      pool,
      async (db) => {
        await softDeleteAssignment(db, body.assignmentId)
        await upsertAssignment(db, body.nodeId, body.toResourceId, body.unitsBp)
      },
      { comment: 'reparto de trabajo aceptado' },
    )

    const scenarioId = await withTransaction(pool, (db) => defaultScenarioId(db))
    return { run: await calculate(pool, scenarioId, 'reparto de trabajo') }
  })
}
