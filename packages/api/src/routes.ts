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
  readEntityHistory,
  readFieldValues,
  readFindings,
  readLoad,
  readProjects,
  readRecentChanges,
  readResources,
  readTasks,
  readUtilization,
  withTransaction,
  type Pool,
} from '@planner/persistence'
import { frasesSinPermiso, puede } from './auth-routes.js'
import { fallar } from './errors.js'
import { EN_TODA_LA_HERRAMIENTA, PERMISSION_BY_CODE, RECORTADO, desde, porNodo } from './permissions.js'
import { onlyVisible, visibleProjects } from './visibility.js'
import { toCsv } from './csv.js'
import { calculate, defaultScenarioId } from './engine.js'
import { ACTUALS_SPEC, PLAN_SPEC, plantillaCsv, type ImportSpec } from './import-specs.js'
import { ImportError, importPlanCsv } from './import-plan.js'
import { importActualsCsv } from './import-actuals.js'

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
  app.get('/api/state', { config: { permission: 'plan.ver', project: RECORTADO } }, async (request) =>
    withDb(async (db) => {
      const run = await latestRun(db)
      const visibles = visibleProjects(request, 'plan.ver')
      const projects = onlyVisible(visibles, await readProjects(db), (project) => project.id)
      const resources = await readResources(db)
      const baselines = await readBaselines(db)
      const fields = await readFieldValues(db)
      return { run: run ?? null, projects, resources, baselines, fields }
    }),
  )

  app.post('/api/calculate', { config: { permission: 'calcular' } }, async (request, reply) => {
    const body = z
      .object({ reason: z.string().max(200).optional(), level: z.boolean().default(false) })
      .parse(request.body ?? {})
    // Recalcular y nivelar son la misma ruta con distinta bandera, pero no la
    // misma decisión: nivelar mueve fechas, así que pide su propio permiso.
    if (body.level && !puede(request, 'nivelar')) {
      const etiqueta = PERMISSION_BY_CODE.get('nivelar')?.label ?? 'nivelar'
      return fallar(reply, 403, 'SIN_PERMISO', frasesSinPermiso['sin-mas'](etiqueta), {
        permiso: 'nivelar',
        etiqueta,
        donde: 'sin-mas',
      })
    }
    const scenarioId = await withDb((db) => defaultScenarioId(db))
    return calculate(pool, scenarioId, body.reason ?? (body.level ? 'nivelación de recursos' : 'recálculo manual'), {
      level: body.level,
    })
  })

  /** Las últimas ejecuciones, para poder compararlas entre sí. */
  app.get('/api/runs', { config: { permission: 'ejecuciones.ver' } }, async () => ({ runs: await withDb((db) => recentRuns(db)) }))

  app.get('/api/runs/:runId/tasks', { config: { permission: 'plan.ver', project: RECORTADO } }, async (request) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params)
    const tasks = await withDb((db) => readTasks(db, runId))
    return {
      runId,
      tasks: onlyVisible(visibleProjects(request, 'plan.ver'), tasks, (task) => task.projectId),
    }
  })

  app.get('/api/runs/:runId/load', { config: { permission: 'carga.ver', project: RECORTADO } }, async (request) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params)
    const query = z.object({ bucket: bucketSchema, byNode: z.coerce.boolean().default(false) }).parse(request.query)
    const todas = await withDb((db) => readLoad(db, runId, query.bucket, { byNode: query.byNode }))
    const cells = onlyVisible(visibleProjects(request, 'carga.ver'), todas, (cell) => cell.projectId)
    // Sin `costes.ver` los importes no se ocultan en pantalla: no se envían. Lo
    // que no sale del servidor no se recupera mirando la respuesta en el
    // inspector del navegador.
    //
    // Y se mira proyecto a proyecto, no de una vez: `costes.ver` se concede por
    // proyecto, así que tenerlo en uno no enseña los importes de los demás.
    const conCostes = visibleProjects(request, 'costes.ver')
    return {
      runId,
      bucket: query.bucket,
      costsHidden: conCostes !== 'all' && conCostes.size === 0,
      cells:
        conCostes === 'all'
          ? cells
          : cells.map((cell) => (conCostes.has(cell.projectId) ? cell : { ...cell, costCents: 0 })),
    }
  })

  app.get('/api/runs/:runId/utilization', { config: { permission: 'carga.ver', project: EN_TODA_LA_HERRAMIENTA } }, async (request) => {
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

  app.get('/api/runs/:runId/findings', { config: { permission: 'plan.ver', project: RECORTADO } }, async (request) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params)
    const todos = await withDb((db) => readFindings(db, runId))
    // Un hallazgo sobre una persona —«Ana se pasa en marzo»— no es de ningún
    // proyecto, así que sólo lo ve quien ve el plan entero. Servirlo a quien
    // tiene un trozo delataría carga de proyectos que no puede mirar.
    return {
      runId,
      findings: onlyVisible(visibleProjects(request, 'plan.ver'), todos, (finding) => finding.projectId),
    }
  })

  /** El panel «¿por qué?»: la traza de derivación de una entidad. */
  app.get('/api/runs/:runId/explain/:targetId', { config: { permission: 'plan.ver', project: desde(porNodo('targetId')) } }, async (request) => {
    const { runId, targetId } = z
      .object({ runId: z.string().uuid(), targetId: z.string().uuid() })
      .parse(request.params)
    return { runId, targetId, derivations: await withDb((db) => readDerivations(db, runId, targetId)) }
  })

  /** Edición de datos DECLARADOS. Lo derivado no se toca nunca por aquí (P1). */
  app.patch('/api/tasks/:nodeId', { config: { permission: 'plan.editar', project: desde(porNodo()) } }, async (request, reply) => {
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
      return fallar(reply, 400, 'NADA_QUE_CAMBIAR', 'No hay nada que cambiar.')
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
    if (text.trim() === '') return fallar(reply, 400, 'CSV_VACIO', 'El cuerpo debe ser el CSV en texto plano.')

    try {
      const summary = await withTransaction(pool, (db) => importPlanCsv(db, text), {
        comment: 'importación de plan desde CSV',
      })
      const scenarioId = await withDb((db) => defaultScenarioId(db))
      const run = await calculate(pool, scenarioId, 'importación de plan')
      return { ...summary, run }
    } catch (error) {
      if (error instanceof ImportError) {
        // El detalle es del fichero de quien importa —«falta la columna X en
        // la fila 4»—, así que es dato, no frase: va dentro de una que sí se
        // traduce.
        return fallar(reply, 422, 'CSV_INVALIDO', error.message, {
          detalle: error.message,
          rows: error.rows,
        })
      }
      throw error
    }
  })

  /**
   * El parte de horas. Lo que pasó de verdad, frente a lo que se planificó.
   *
   * **No recalcula**, y es la decisión que lo define: el motor dice cuándo
   * *puede* pasar el trabajo, y lo que ya pasó no cambia esa respuesta.
   * Recalcular el plan entero por una hora fichada cambiaría el hash de
   * entrada sin que ninguna fecha se moviera. El cruce se hace en el informe,
   * que es donde alguien lo mira.
   */
  app.post('/api/import/actuals', { config: { permission: 'reales.registrar' } }, async (request, reply) => {
    const text = typeof request.body === 'string' ? request.body : ''
    if (text.trim() === '') return fallar(reply, 400, 'CSV_VACIO', 'El cuerpo debe ser el CSV en texto plano.')

    try {
      return await withTransaction(pool, (db) => importActualsCsv(db, text), {
        comment: 'importación de horas reales desde CSV',
      })
    } catch (error) {
      if (error instanceof ImportError) {
        return fallar(reply, 422, 'CSV_INVALIDO', error.message, {
          detalle: error.message,
          rows: error.rows,
        })
      }
      throw error
    }
  })


  /**
   * Qué fichero espera cada importación: la plantilla y, aparte, el contrato
   * en JSON para que la pantalla pueda enseñarlo sin llevar su propia copia.
   *
   * Dos rutas por importación y no una, porque son dos preguntas distintas:
   * «dame el fichero para rellenar» y «dime qué esperas». La segunda es la que
   * hace que la tabla de columnas de la pantalla no pueda quedarse vieja.
   */
  const servirFormato = (spec: ImportSpec, permiso: string): void => {
    app.get(`/api/import/${spec.tipo}/formato`, { config: { permission: permiso } }, () => spec)
    app.get(`/api/import/${spec.tipo}/plantilla.csv`, { config: { permission: permiso } }, async (_request, reply) =>
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="plantilla-${spec.tipo}.csv"`)
        .send(plantillaCsv(spec)),
    )
  }
  servirFormato(PLAN_SPEC, 'importar')
  servirFormato(ACTUALS_SPEC, 'reales.registrar')

  /** Exportación de la carga. El fichero lleva el runId: sigue siendo auditable fuera. */
  app.get('/api/runs/:runId/export.csv', { config: { permission: 'exportar' } }, async (request, reply) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params)
    const query = z.object({ bucket: bucketSchema }).parse(request.query)

    const [todas, resources, projects] = [
      await withDb((db) => readLoad(db, runId, query.bucket)),
      await withDb((db) => readResources(db)),
      await withDb((db) => readProjects(db)),
    ]
    // Poder exportar no amplía lo que se puede ver: el fichero lleva las mismas
    // filas que la pantalla.
    const cells = onlyVisible(visibleProjects(request, 'carga.ver'), todas, (cell) => cell.projectId)
    const costesVisibles = visibleProjects(request, 'costes.ver')
    const nameOfResource = new Map(resources.map((resource) => [resource.id, resource.displayName]))
    const codeOfProject = new Map(projects.map((project) => [project.id, project.code]))

    // El fichero sale sin la columna de coste, no con la columna a cero: un
    // cero en un CSV se lee como «costó cero», que es peor que no decirlo.
    // Sólo se incluye si los costes se ven en **todos** los proyectos que salen
    // en el fichero: una columna de coste con huecos miente igual.
    const conCostes =
      costesVisibles === 'all' || cells.every((cell) => costesVisibles.has(cell.projectId))
    const columns = conCostes
      ? ['recurso', 'proyecto', 'periodo', 'horas', 'coste_eur', 'ejecucion']
      : ['recurso', 'proyecto', 'periodo', 'horas', 'ejecucion']
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
    return { entityId, events: await withDb((db) => readEntityHistory(db, entityId)) }
  })

  /**
   * Lo último que ha pasado en toda la herramienta.
   *
   * El registro es de la herramienta entera y no se corta por proyecto: un
   * cambio no siempre cuelga de uno —dar de alta a alguien, retirar una
   * competencia— y una lista a medias contaría una historia falsa. Por eso
   * `historial.ver` es de los permisos que sólo valen concedidos en toda la
   * herramienta.
   */
  app.get('/api/history', { config: { permission: 'historial.ver' } }, async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(request.query)
    return { events: await withDb((db) => readRecentChanges(db, query.limit)) }
  })
}
