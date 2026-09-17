/**
 * El informe: un proyecto o varios, en el periodo que se elija.
 *
 * Una sola ruta y de sólo lectura. No recalcula: se sirve de una ejecución
 * concreta y la devuelve con su `runId`, para que dos personas que miran el
 * mismo informe estén mirando los mismos números (P3).
 *
 * Lo que quien pregunta no puede ver no llega: los proyectos se recortan a los
 * suyos, los importes se ponen a cero sin `costes.ver` y el reparto por persona
 * se omite sin `carga.ver`. En los dos últimos casos la respuesta lo dice, en
 * vez de devolver un cero que se leería como un hecho.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  latestRun,
  readCapacityInPeriod,
  readFindings,
  readLoadInPeriod,
  readProjects,
  readResources,
  readTasks,
  withTransaction,
  type Pool,
  type Queryable,
} from '@planner/persistence'
import { buildReport, type Report } from '@planner/report'
import { puede } from './auth-routes.js'
import { fallar } from './errors.js'
import { RECORTADO } from './permissions.js'
import { onlyVisible, visibleProjects } from './visibility.js'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe ser AAAA-MM-DD')

/**
 * Las fechas programadas llegan como instantes, porque el cronograma necesita
 * la hora. El informe habla de días: un `2026-12-31T08:00:00Z` comparado con un
 * `2026-12-31` dejaría fuera una tarea que empieza el último día del periodo.
 */
const dia = (valor: string | null): string | null => (valor === null ? null : valor.slice(0, 10))

const consulta = z.object({
  /** Uno o varios, separados por coma. Sin esto, todos los que se puedan ver. */
  projects: z.string().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Una ejecución concreta. Sin esto, la última. */
  runId: z.string().uuid().optional(),
})

/**
 * El periodo por defecto es **todo lo que hay**: el primer y el último día con
 * trabajo de la ejecución. Cualquier otro valor por defecto —«este trimestre»,
 * «los próximos seis meses»— sería una opinión metida de contrabando.
 */
async function spanOf(db: Queryable, runId: string): Promise<{ from: string; to: string } | null> {
  const { rows } = await db.query<{ desde: string | null; hasta: string | null }>(
    `SELECT MIN(work_date)::text AS desde, MAX(work_date)::text AS hasta
     FROM assignment_timephased WHERE run_id = $1`,
    [runId],
  )
  const desde = rows[0]?.desde
  const hasta = rows[0]?.hasta
  if (desde === undefined || desde === null || hasta === undefined || hasta === null) return null
  return { from: desde, to: hasta }
}

export function registerReportRoutes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/report', { config: { permission: 'informes.ver', project: RECORTADO } }, async (request, reply) => {
    const parametros = consulta.parse(request.query)
    const visibles = visibleProjects(request, 'informes.ver')
    const pedidos = parametros.projects
      ?.split(',')
      .map((id) => id.trim())
      .filter((id) => id !== '')

    return withTransaction(pool, async (db): Promise<Report | undefined> => {
      const run =
        parametros.runId === undefined
          ? await latestRun(db)
          : { id: parametros.runId }
      if (run === undefined) {
        return fallar(
          reply,
          409,
          'SIN_EJECUCION',
          'Todavía no hay ningún cálculo del que informar. Recalcula primero.',
        )
      }

      const span = (await spanOf(db, run.id)) ?? { from: parametros.from ?? '', to: parametros.to ?? '' }
      const from = parametros.from ?? span.from
      const to = parametros.to ?? span.to
      if (from === '' || to === '') {
        return fallar(
          reply,
          422,
          'SIN_PERIODO',
          'Esa ejecución no tiene trabajo repartido: dime el periodo a mano.',
        )
      }
      if (from > to) {
        return fallar(reply, 422, 'PERIODO_INVERTIDO', 'El periodo empieza después de terminar.')
      }

      // Primero lo que se puede ver, y sólo después lo que se ha pedido: al
      // revés, pedir un proyecto ajeno diría si existe.
      const todos = onlyVisible(visibles, await readProjects(db), (fila) => fila.id)
      const proyectos = todos
        .filter((proyecto) => !proyecto.isTemplate)
        .filter((proyecto) => pedidos === undefined || pedidos.includes(proyecto.id))

      const verCostes = puede(request, 'costes.ver')
      const verCarga = puede(request, 'carga.ver')

      const carga = (await readLoadInPeriod(db, run.id, from, to)).map((fila) => ({
        ...fila,
        costCents: verCostes ? fila.costCents : 0,
      }))

      return buildReport({
        runId: run.id,
        period: { from, to },
        // La fecha de hoy es del servidor a propósito: si viniera del cliente,
        // «lo que debería estar terminado» dependería del reloj del navegador.
        asOf: new Date().toISOString().slice(0, 10),
        projects: proyectos.map((proyecto) => ({
          id: proyecto.id,
          code: proyecto.code,
          name: proyecto.name,
          commitment: proyecto.commitment,
        })),
        tasks: (await readTasks(db, run.id)).map((tarea) => ({
          nodeId: tarea.nodeId,
          projectId: tarea.projectId,
          kind: tarea.kind,
          name: tarea.name,
          path: tarea.path,
          scheduledStart: dia(tarea.scheduledStart),
          scheduledFinish: dia(tarea.scheduledFinish),
          workMinutes: tarea.workMinutes,
          percentCompleteBp: tarea.percentCompleteBp,
          totalSlackMinutes: tarea.totalSlackMinutes,
          isCritical: tarea.isCritical,
          deadline: tarea.deadline,
          assignees: tarea.assignees,
        })),
        load: carga,
        capacity: verCarga ? await readCapacityInPeriod(db, run.id, from, to) : [],
        resources: verCarga
          ? (await readResources(db)).map((recurso) => ({
              id: recurso.id,
              code: recurso.code,
              displayName: recurso.displayName,
            }))
          : [],
        findings: (await readFindings(db, run.id)).map((hallazgo) => ({
          severity: hallazgo.severity,
          code: hallazgo.code,
          projectId: hallazgo.projectId,
          entityName: hallazgo.entityName,
          message: hallazgo.message,
          occursOn: hallazgo.occursOn,
          payload: hallazgo.payload,
        })),
        costsHidden: !verCostes,
        peopleHidden: !verCarga,
      })
    })
  })
}
