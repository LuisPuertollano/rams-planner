/**
 * Las puertas de certificación del proyecto, y los objetivos que salen de ellas.
 *
 * Cuatro rutas y dos mitades. La primera mitad declara **cuándo cae cada
 * puerta** en este proyecto, que es el dato que le faltaba al catálogo. La
 * segunda propone y aplica los objetivos, con el mismo trato que las
 * subactividades: se enseña lo que se haría antes de tocar nada, y la propuesta
 * se vuelve a calcular al aplicar en vez de creerse la que trajo el navegador.
 *
 * No hay permiso nuevo. `plan.editar` ya dice literalmente «fechas objetivo de
 * una tarea que ya existe», que es todo lo que esto escribe.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  applyGateDeadlines,
  latestRun,
  readDocumentTypes,
  readGateInputs,
  readGateQueries,
  readGateQueryDisciplines,
  readGateReadinessInputs,
  readProjectGates,
  setProjectGates,
  withTransaction,
  type Pool,
} from '@planner/persistence'
import {
  answerGateChecklist,
  assessGateReadiness,
  planGateDeadlines,
  type GatePlanResult,
} from '@planner/scheduler'
import { importChecklistCsv } from './import-checklist.js'
import { ImportError } from './import-plan.js'
import { fallar } from './errors.js'
import { desde, enProyecto } from './permissions.js'
import { calculate, defaultScenarioId } from './engine.js'

type Db = Parameters<Parameters<typeof withTransaction<unknown>>[1]>[0]

const puertaSchema = z.object({
  gate: z.string().trim().min(1).max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  notes: z.string().max(500).nullable().optional(),
})

async function previewFor(db: Db, projectId: string): Promise<GatePlanResult> {
  return planGateDeadlines(await readGateInputs(db, projectId))
}

export function registerGateRoutes(app: FastifyInstance, pool: Pool): void {
  /** Las puertas declaradas del proyecto, por fecha. */
  app.get(
    '/api/projects/:projectId/gates',
    { config: { permission: 'plan.ver', project: desde(enProyecto()) } },
    async (request) => {
      const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params)
      return withTransaction(pool, async (db) => ({ gates: await readProjectGates(db, projectId) }))
    },
  )

  /**
   * Declara las puertas del proyecto. Es un reemplazo completo: lo que no viene
   * en el cuerpo se borra, porque la pantalla manda la lista entera y una
   * puerta que alguien quitó tiene que irse.
   */
  app.put(
    '/api/projects/:projectId/gates',
    { config: { permission: 'plan.editar', project: desde(enProyecto()) } },
    async (request) => {
      const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params)
      const body = z.object({ gates: z.array(puertaSchema).max(200) }).parse(request.body ?? {})
      return withTransaction(
        pool,
        async (db) => {
          await setProjectGates(
            db,
            projectId,
            body.gates.map((puerta) => ({
              gate: puerta.gate,
              date: puerta.date,
              notes: puerta.notes ?? null,
            })),
          )
          return { gates: await readProjectGates(db, projectId) }
        },
        { comment: 'declarar las puertas del proyecto' },
      )
    },
  )

  /** Qué objetivo le tocaría a cada tarea, y qué se descarta y por qué. No escribe. */
  app.get(
    '/api/projects/:projectId/gates/plan',
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
   * Cómo llega el proyecto a cada una de sus puertas (ADR-0056).
   *
   * De sólo lectura y sin recalcular: se sirve de una ejecución concreta —la
   * última, salvo que se pida otra— y la devuelve con su `runId`, para que dos
   * personas que miran la misma puerta miren los mismos días.
   *
   * Sin ninguna ejecución todavía no se responde con una puerta vacía, que se
   * leería como «no falta nada»: se dice que no hay cálculo.
   */
  app.get(
    '/api/projects/:projectId/gates/readiness',
    { config: { permission: 'plan.ver', project: desde(enProyecto()) } },
    async (request) => {
      const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params)
      const { runId } = z
        .object({ runId: z.string().uuid().optional() })
        .parse(request.query ?? {})

      return withTransaction(pool, async (db) => {
        const ejecucion = runId ?? (await latestRun(db))?.id
        if (ejecucion === undefined) return { runId: null, gates: [], findings: [], totals: null }
        const entrada = await readGateReadinessInputs(db, projectId, ejecucion)
        return { runId: ejecucion, ...assessGateReadiness(entrada) }
      })
    },
  )


  /**
   * La Checkliste de la puerta, contestada con lo que el plan ya sabe (ADR-0058).
   *
   * Se apoya en la misma ejecución que la preparación de la puerta: primero se
   * resuelve qué entrega llega y cuál no, y sobre eso se contestan las
   * consultas que nombran un entregable. Las que no lo nombran salen marcadas
   * como lo que son —las que contesta una persona—, que es la mitad de la hoja
   * y es la información que convierte una lista de 51 en una de 24.
   */
  app.get(
    '/api/projects/:projectId/gates/checklist',
    { config: { permission: 'plan.ver', project: desde(enProyecto()) } },
    async (request) => {
      const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params)
      const { runId, discipline } = z
        .object({
          runId: z.string().uuid().optional(),
          discipline: z.string().trim().min(1).max(60).optional(),
        })
        .parse(request.query ?? {})

      return withTransaction(pool, async (db) => {
        const ejecucion = runId ?? (await latestRun(db))?.id
        const disciplinas = await readGateQueryDisciplines(db)
        if (ejecucion === undefined) {
          return { runId: null, gates: [], findings: [], totals: null, disciplines: disciplinas }
        }
        const readiness = assessGateReadiness(
          await readGateReadinessInputs(db, projectId, ejecucion),
        )
        const resuelto = answerGateChecklist({
          queries: await readGateQueries(db, discipline),
          readiness: readiness.gates,
          gates: await readProjectGates(db, projectId),
        })
        return { runId: ejecucion, ...resuelto, disciplines: disciplinas }
      })
    },
  )

  /**
   * Cargar la Checkliste desde un CSV.
   *
   * Es catálogo del departamento, como el de entregables, así que va con el
   * mismo permiso y no con el de un proyecto: la hoja es la misma para todos.
   */
  app.post(
    '/api/gates/checklist/import',
    { config: { permission: 'documentos.gestionar' } },
    async (request, reply) => {
      const text = typeof request.body === 'string' ? request.body : ''
      if (text.trim() === '') {
        return fallar(reply, 400, 'CSV_VACIO', 'El cuerpo debe ser el CSV en texto plano.')
      }
      try {
        return await withTransaction(pool, (db) => importChecklistCsv(db, text), {
          comment: 'importación de la Checkliste de revisión desde CSV',
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
    },
  )

  /** Pone los objetivos que queden marcados y recalcula, como toda edición. */
  app.post(
    '/api/projects/:projectId/gates/apply',
    { config: { permission: 'plan.editar', project: desde(enProyecto()) } },
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
          const poner = plan.set
            .map((objetivo) => objetivo.nodeId)
            .filter((nodeId) => !excluidas.has(nodeId))
          const resumen = await applyGateDeadlines(db, plan, poner)
          return { ...resumen, skipped: plan.skipped, totals: plan.totals }
        },
        { comment: 'poner las fechas objetivo de las puertas' },
      )

      const scenarioId = await withTransaction(pool, (db) => defaultScenarioId(db))
      return {
        result: applied,
        run: await calculate(pool, scenarioId, 'poner las fechas objetivo de las puertas'),
      }
    },
  )
}
