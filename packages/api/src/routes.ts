/**
 * API REST.
 *
 * Regla transversal: **toda respuesta que contenga números derivados lleva el
 * `runId` que los produjo**. Un número sin `runId` es un bug, porque no se
 * puede auditar.
 */

import type { FastifyInstance } from 'fastify'
import { calendarDate } from '@planner/domain'
import { z } from 'zod'
import {
  freezeRun,
  latestRun,
  readBaselines,
  recentRuns,
  readDailyCapacity,
  readDerivations,
  readDiff,
  readFieldValues,
  readFindings,
  readLoad,
  readProjects,
  readResources,
  readTasks,
  readUtilization,
  withTransaction,
  type Pool,
} from '@planner/persistence'
import { toCsv } from './csv.js'
import { calculate, defaultScenarioId } from './engine.js'
import { ImportError, importPlanCsv } from './import-plan.js'

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
  app.get('/api/state', { config: { permission: 'plan.ver' } }, async () =>
    withDb(async (db) => {
      const run = await latestRun(db)
      const projects = await readProjects(db)
      const resources = await readResources(db)
      const baselines = await readBaselines(db)
      const fields = await readFieldValues(db)
      return { run: run ?? null, projects, resources, baselines, fields }
    }),
  )

  app.post('/api/calculate', { config: { permission: 'calcular' } }, async (request) => {
    const body = z
      .object({ reason: z.string().max(200).optional(), level: z.boolean().default(false) })
      .parse(request.body ?? {})
    const scenarioId = await withDb((db) => defaultScenarioId(db))
    return calculate(pool, scenarioId, body.reason ?? (body.level ? 'nivelación de recursos' : 'recálculo manual'), {
      level: body.level,
    })
  })

  /** Las últimas ejecuciones, para poder compararlas entre sí. */
  app.get('/api/runs', { config: { permission: 'ejecuciones.ver' } }, async () => ({ runs: await withDb((db) => recentRuns(db)) }))

  app.get('/api/runs/:runId/tasks', { config: { permission: 'plan.ver' } }, async (request) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params)
    return { runId, tasks: await withDb((db) => readTasks(db, runId)) }
  })

  app.get('/api/runs/:runId/load', { config: { permission: 'carga.ver' } }, async (request) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params)
    const query = z.object({ bucket: bucketSchema, byNode: z.coerce.boolean().default(false) }).parse(request.query)
    return {
      runId,
      bucket: query.bucket,
      cells: await withDb((db) => readLoad(db, runId, query.bucket, { byNode: query.byNode })),
    }
  })

  app.get('/api/runs/:runId/utilization', { config: { permission: 'carga.ver' } }, async (request) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params)
    const query = z.object({ bucket: bucketSchema }).parse(request.query)
    return {
      runId,
      bucket: query.bucket,
      cells: await withDb((db) => readUtilization(db, runId, query.bucket)),
    }
  })

  /** Capacidad y carga día a día: el calendario del equipo. */
  app.get('/api/runs/:runId/capacity', { config: { permission: 'equipo.ver' } }, async (request) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params)
    const query = z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(request.query)
    return {
      runId,
      days: await withDb((db) => readDailyCapacity(db, runId, calendarDate(query.from), calendarDate(query.to))),
    }
  })

  app.get('/api/runs/:runId/findings', { config: { permission: 'plan.ver' } }, async (request) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params)
    return { runId, findings: await withDb((db) => readFindings(db, runId)) }
  })

  /** El panel «¿por qué?»: la traza de derivación de una entidad. */
  app.get('/api/runs/:runId/explain/:targetId', { config: { permission: 'plan.ver' } }, async (request) => {
    const { runId, targetId } = z
      .object({ runId: z.string().uuid(), targetId: z.string().uuid() })
      .parse(request.params)
    return { runId, targetId, derivations: await withDb((db) => readDerivations(db, runId, targetId)) }
  })

  /** Edición de datos DECLARADOS. Lo derivado no se toca nunca por aquí (P1). */
  app.patch('/api/tasks/:nodeId', { config: { permission: 'plan.editar' } }, async (request, reply) => {
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

  /** Congelar la ejecución como línea base. Le pone nombre a una foto del plan. */
  app.post('/api/runs/:runId/freeze', { config: { permission: 'lineabase.crear' } }, async (request) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params)
    const body = z
      .object({ name: z.string().min(1).max(120), note: z.string().max(500).optional() })
      .parse(request.body)
    return withTransaction(
      pool,
      (db) => freezeRun(db, runId, body.name, body.note),
      { comment: `línea base «${body.name}»` },
    )
  })

  /** Diff entre dos ejecuciones: es un JOIN entre dos run_id, nada más. */
  app.get('/api/runs/:baseRunId/diff/:targetRunId', { config: { permission: 'ejecuciones.ver' } }, async (request) => {
    const { baseRunId, targetRunId } = z
      .object({ baseRunId: z.string().uuid(), targetRunId: z.string().uuid() })
      .parse(request.params)
    return { baseRunId, targetRunId, tasks: await withDb((db) => readDiff(db, baseRunId, targetRunId)) }
  })

  /**
   * Importación de un plan desde un CSV plano, el que cualquiera ya tiene en
   * Excel. Cualquier error aborta la transacción entera: no hay importaciones a
   * medias que luego nadie sabe deshacer.
   */
  app.post('/api/import/plan', { config: { permission: 'importar' } }, async (request, reply) => {
    const text = typeof request.body === 'string' ? request.body : ''
    if (text.trim() === '') return reply.status(400).send({ error: 'El cuerpo debe ser el CSV en texto plano' })

    try {
      const summary = await withTransaction(pool, (db) => importPlanCsv(db, text), {
        comment: 'importación de plan desde CSV',
      })
      const scenarioId = await withDb((db) => defaultScenarioId(db))
      const run = await calculate(pool, scenarioId, 'importación de plan')
      return { ...summary, run }
    } catch (error) {
      if (error instanceof ImportError) {
        return reply.status(422).send({ error: error.message, rows: error.rows })
      }
      throw error
    }
  })

  /** Plantilla del CSV de importación, para no tener que adivinar las columnas. */
  app.get('/api/import/plantilla.csv', { config: { permission: 'importar' } }, async (_request, reply) => {
    const columns = [
      'proyecto', 'nombre_proyecto', 'fase', 'tarea', 'dias',
      'predecesoras', 'recurso', 'dedicacion', 'disciplina', 'deadline', 'no_antes_de',
    ]
    const example = [
      {
        proyecto: 'EJEMPLO-1', nombre_proyecto: 'Proyecto de ejemplo', fase: 'Análisis',
        tarea: 'Plan RAMS', dias: '5', predecesoras: '', recurso: 'Ana Müller',
        dedicacion: '100', disciplina: 'Plan', deadline: '', no_antes_de: '2026-03-02',
      },
      {
        proyecto: 'EJEMPLO-1', nombre_proyecto: 'Proyecto de ejemplo', fase: 'Análisis',
        tarea: 'Hazard Log', dias: '10', predecesoras: 'Plan RAMS', recurso: 'Ana Müller;Marc Iglesias',
        dedicacion: '50', disciplina: 'Hazard Log', deadline: '2026-05-29', no_antes_de: '',
      },
      {
        proyecto: 'EJEMPLO-1', nombre_proyecto: 'Proyecto de ejemplo', fase: 'Análisis',
        tarea: 'Revisión de concepto', dias: '0', predecesoras: 'Hazard Log', recurso: '',
        dedicacion: '', disciplina: '', deadline: '', no_antes_de: '',
      },
    ]
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="plantilla-plan.csv"')
      .send(toCsv(example, columns))
  })

  /** Exportación de la carga. El fichero lleva el runId: sigue siendo auditable fuera. */
  app.get('/api/runs/:runId/export.csv', { config: { permission: 'exportar' } }, async (request, reply) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params)
    const query = z.object({ bucket: bucketSchema }).parse(request.query)

    const [cells, resources, projects] = [
      await withDb((db) => readLoad(db, runId, query.bucket)),
      await withDb((db) => readResources(db)),
      await withDb((db) => readProjects(db)),
    ]
    const nameOfResource = new Map(resources.map((resource) => [resource.id, resource.displayName]))
    const codeOfProject = new Map(projects.map((project) => [project.id, project.code]))

    const columns = ['recurso', 'proyecto', 'periodo', 'horas', 'coste_eur', 'ejecucion']
    const rows = cells.map((cell) => ({
      recurso: nameOfResource.get(cell.resourceId) ?? cell.resourceId,
      proyecto: codeOfProject.get(cell.projectId) ?? cell.projectId,
      periodo: cell.period,
      horas: (cell.plannedMinutes / 60).toFixed(2).replace('.', ','),
      coste_eur: (cell.costCents / 100).toFixed(2).replace('.', ','),
      ejecucion: runId,
    }))

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="carga-${query.bucket}.csv"`)
      .send(toCsv(rows, columns))
  })

  /** Historial de cambios de una entidad: quién, cuándo y con qué comentario. */
  app.get('/api/history/:entityId', { config: { permission: 'historial.ver' } }, async (request) => {
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
