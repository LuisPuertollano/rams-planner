/**
 * Aplicar la matriz de documentos a un proyecto.
 *
 * Son dos rutas y la primera es la importante: enseña lo que haría la segunda
 * sin tocar nada. Una herramienta que crea veinte dependencias de golpe y te
 * las cuenta después no se puede usar con un plan de verdad.
 *
 * La propuesta se vuelve a calcular en el momento de aplicar, no se cree la
 * que trajo el navegador: entre que se mira y se acepta, otro ha podido mover
 * el plan. Lo que sí se respeta del cliente es lo que haya descartado a mano.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  addDependency,
  readDependencies,
  readDocumentTypes,
  readNodeDocuments,
  readPrecedences,
  readProjectNodes,
  withTransaction,
  type Pool,
} from '@planner/persistence'
import { planDocumentDependencies, type DocumentPlanResult } from '@planner/scheduler'
import { desde, enProyecto } from './permissions.js'
import { calculate, defaultScenarioId } from './engine.js'

const parejaExcluida = z.object({
  predecessorNodeId: z.string().uuid(),
  successorNodeId: z.string().uuid(),
})

/** Lo que se calcula, más los nombres para poder enseñarlo sin otra vuelta. */
interface MatrixPreview extends DocumentPlanResult {
  readonly tasks: readonly { readonly nodeId: string; readonly name: string; readonly path: string }[]
}

async function previewFor(
  db: Parameters<Parameters<typeof withTransaction<MatrixPreview>>[1]>[0],
  projectId: string,
): Promise<MatrixPreview> {
  const nodes = await readProjectNodes(db, projectId)
  const plan = planDocumentDependencies({
    tasks: nodes.map((node) => ({ nodeId: node.nodeId, name: node.name, path: node.path })),
    deliveries: await readNodeDocuments(db, projectId),
    precedences: await readPrecedences(db),
    existing: await readDependencies(db),
  })
  return {
    ...plan,
    tasks: nodes.map((node) => ({ nodeId: node.nodeId, name: node.name, path: node.path })),
  }
}

export function registerMatrixRoutes(app: FastifyInstance, pool: Pool): void {
  /** Lo que se crearía, lo que no y por qué. No escribe nada. */
  app.get(
    '/api/projects/:projectId/documents/plan',
    { config: { permission: 'plan.ver', project: desde(enProyecto()) } },
    async (request) => {
      const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params)
      return withTransaction(pool, async (db) => ({
        ...(await previewFor(db, projectId)),
        // El catálogo viaja con la propuesta: sin él, «falta el documento
        // 9f3c…» no le dice nada a nadie.
        documents: await readDocumentTypes(db),
      }))
    },
  )

  /** Crea las dependencias que la matriz exige y recalcula, como toda edición. */
  app.post(
    '/api/projects/:projectId/documents/apply',
    { config: { permission: 'dependencias.editar', project: desde(enProyecto()) } },
    async (request) => {
      const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params)
      const body = z.object({ exclude: z.array(parejaExcluida).max(5000).optional() }).parse(request.body ?? {})
      const excluidas = new Set(
        (body.exclude ?? []).map((par) => `${par.predecessorNodeId}>${par.successorNodeId}`),
      )

      const applied = await withTransaction(
        pool,
        async (db) => {
          const plan = await previewFor(db, projectId)
          const crear = plan.create.filter(
            (dep) => !excluidas.has(`${dep.predecessorNodeId}>${dep.successorNodeId}`),
          )
          for (const dep of crear) {
            // FS sin desfase: la matriz dice el orden, no cuánto se espera.
            // Poner un margen que nadie ha declarado sería inventarse el plan.
            await addDependency(db, dep.predecessorNodeId, dep.successorNodeId, 'FS', 0)
          }
          return { created: crear, skipped: plan.skipped, missingDocuments: plan.missingDocuments }
        },
        { comment: 'aplicación de la matriz de documentos' },
      )

      const scenarioId = await withTransaction(pool, (db) => defaultScenarioId(db))
      return {
        result: applied,
        run: await calculate(pool, scenarioId, 'aplicación de la matriz de documentos'),
      }
    },
  )
}
