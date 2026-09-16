/**
 * API REST.
 *
 * Regla transversal: **toda respuesta que contenga números derivados lleva el
 * `runId` que los produjo**. Un número sin `runId` es un bug, porque no se
 * puede auditar.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  latestRun,
  readDerivations,
  readFindings,
  readLoad,
  readProjects,
  readResources,
  readTasks,
  readUtilization,
  withTransaction,
  type Pool,
} from '@planner/persistence'
import { calculate, defaultScenarioId } from './engine.js'

const bucketSchema = z.enum(['day', 'week', 'month', 'quarter']).default('month')

export function registerRoutes(app: FastifyInstance, pool: Pool): void {
  const withDb = <T>(handler: Parameters<typeof withTransaction<T>>[1]): Promise<T> =>
    withTransaction(pool, handler)

  app.get('/api/health', async () => {
    const { rows } = await pool.query<{ version: string }>('SELECT version()')
    const version = rows[0]?.version
    return { status: 'ok', database: version === undefined ? 'desconocida' : version.split(' ').slice(0, 2).join(' ') }
  })

  /** Estado inicial: la ejecución vigente, los proyectos y el equipo. */
  app.get('/api/state', async () =>
    withDb(async (db) => {
      const run = await latestRun(db)
      const projects = await readProjects(db)
      const resources = await readResources(db)
      return { run: run ?? null, projects, resources }
    }),
  )

  app.post('/api/calculate', async (request) => {
    const body = z.object({ reason: z.string().max(200).optional() }).parse(request.body ?? {})
    const scenarioId = await withDb((db) => defaultScenarioId(db))
    return calculate(pool, scenarioId, body.reason ?? 'recálculo manual')
  })

  app.get('/api/runs/:runId/tasks', async (request) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params)
    return { runId, tasks: await withDb((db) => readTasks(db, runId)) }
  })

  app.get('/api/runs/:runId/load', async (request) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params)
    const query = z.object({ bucket: bucketSchema, byNode: z.coerce.boolean().default(false) }).parse(request.query)
    return {
      runId,
      bucket: query.bucket,
      cells: await withDb((db) => readLoad(db, runId, query.bucket, { byNode: query.byNode })),
    }
  })

  app.get('/api/runs/:runId/utilization', async (request) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params)
    const query = z.object({ bucket: bucketSchema }).parse(request.query)
    return {
      runId,
      bucket: query.bucket,
      cells: await withDb((db) => readUtilization(db, runId, query.bucket)),
    }
  })

  app.get('/api/runs/:runId/findings', async (request) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params)
    return { runId, findings: await withDb((db) => readFindings(db, runId)) }
  })

  /** El panel «¿por qué?»: la traza de derivación de una entidad. */
  app.get('/api/runs/:runId/explain/:targetId', async (request) => {
    const { runId, targetId } = z
      .object({ runId: z.string().uuid(), targetId: z.string().uuid() })
      .parse(request.params)
    return { runId, targetId, derivations: await withDb((db) => readDerivations(db, runId, targetId)) }
  })

  /** Edición de datos DECLARADOS. Lo derivado no se toca nunca por aquí (P1). */
  app.patch('/api/tasks/:nodeId', async (request, reply) => {
    const { nodeId } = z.object({ nodeId: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        durationMinutes: z.number().int().min(0).optional(),
        workDeclaredMinutes: z.number().int().min(0).optional(),
        percentCompleteBp: z.number().int().min(0).max(10_000).optional(),
        constraintKind: z
          .enum([
            'asap',
            'alap',
            'start_no_earlier_than',
            'start_no_later_than',
            'finish_no_earlier_than',
            'finish_no_later_than',
            'must_start_on',
            'must_finish_on',
          ])
          .optional(),
        constraintDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        comment: z.string().max(500).optional(),
      })
      .parse(request.body)

    const updates: string[] = []
    const values: unknown[] = [nodeId]
    const set = (column: string, value: unknown): void => {
      values.push(value)
      updates.push(`${column} = $${String(values.length)}`)
    }
    if (body.durationMinutes !== undefined) set('duration_minutes', body.durationMinutes)
    if (body.workDeclaredMinutes !== undefined) set('work_declared_minutes', body.workDeclaredMinutes)
    if (body.percentCompleteBp !== undefined) set('percent_complete_bp', body.percentCompleteBp)
    if (body.constraintKind !== undefined) set('constraint_kind', body.constraintKind)
    if (body.constraintDate !== undefined) set('constraint_date', body.constraintDate)
    if (body.deadline !== undefined) set('deadline', body.deadline)

    if (updates.length === 0) {
      return reply.status(400).send({ error: 'No hay nada que cambiar' })
    }

    await withTransaction(
      pool,
      async (db) => {
        await db.query(`UPDATE task SET ${updates.join(', ')} WHERE node_id = $1`, values)
      },
      { comment: body.comment ?? 'edición desde la interfaz' },
    )

    // El cambio es de datos declarados: el plan que hay en pantalla ya no vale.
    const scenarioId = await withDb((db) => defaultScenarioId(db))
    return calculate(pool, scenarioId, `edición de la tarea ${nodeId}`)
  })

  /** Historial de cambios de una entidad: quién, cuándo y con qué comentario. */
  app.get('/api/history/:entityId', async (request) => {
    const { entityId } = z.object({ entityId: z.string().uuid() }).parse(request.params)
    const { rows } = await pool.query<{
      occurred_at: Date
      operation: string
      entity_type: string
      before_value: unknown
      after_value: unknown
      comment: string | null
    }>(
      `SELECT occurred_at, operation, entity_type, before_value, after_value, comment
       FROM change_event WHERE entity_id = $1 ORDER BY occurred_at DESC LIMIT 100`,
      [entityId],
    )
    return {
      entityId,
      events: rows.map((row) => ({
        occurredAt: row.occurred_at.toISOString(),
        operation: row.operation,
        entityType: row.entity_type,
        before: row.before_value,
        after: row.after_value,
        comment: row.comment,
      })),
    }
  })
}
