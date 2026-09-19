/**
 * La conciliación: qué horas reales han llegado a una tarea y cuáles no.
 *
 * Es el `Declaration_CHECK` del libro del equipo, y existe por una razón que se
 * ve a la primera semana de usarlo: las horas llegan del sistema de fichaje por
 * proyecto y mes, el reparto por tarea lo declara cada persona, y **las dos
 * cosas se descuadran constantemente**. Un mes sin declarar, una declaración
 * que suma 90 %, un proyecto que alguien confundió con otro.
 *
 * Sin esta pantalla eso no se ve: el informe enseña menos gasto del real y
 * nadie tiene por qué sospecharlo. Con ella, la pregunta «¿por qué el FMECA
 * dice 12 h si Ana lleva tres semanas?» tiene respuesta en un vistazo.
 *
 * De sólo lectura y sin recalcular nada: la conciliación es derivada y se
 * calcula cada vez que se pide.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  reconcileActuals,
  readProjects,
  readResources,
  withTransaction,
  type Pool,
} from '@planner/persistence'
import { puede } from './auth-routes.js'
import { fallar } from './errors.js'
import { RECORTADO } from './permissions.js'
import { onlyVisible, visibleProjects } from './visibility.js'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe ser AAAA-MM-DD')

const consulta = z.object({ from: isoDate, to: isoDate })

export function registerReconcileRoutes(app: FastifyInstance, pool: Pool): void {
  /**
   * La conciliación del periodo.
   *
   * Usa `reales.ver` y no un permiso propio porque enseña exactamente el mismo
   * dato que el informe —quién ha trabajado en qué— visto de otra manera. Un
   * permiso aparte dejaría que alguien sin ver las horas reales dedujera
   * cuántas son mirando los descuadres.
   */
  app.get(
    '/api/reconciliation',
    // `RECORTADO`: la respuesta se recorta sola a los proyectos que quien
    // pregunta puede ver, así que no hay un proyecto en la petición del que
    // hablar. Es el mismo caso que el informe.
    { config: { permission: 'reales.ver', project: RECORTADO } },
    async (request, reply) => {
    const query = consulta.parse(request.query)
    if (query.from > query.to) {
      return fallar(reply, 422, 'PERIODO_INVERTIDO', 'El periodo empieza después de terminar.')
    }

    return withTransaction(pool, async (db) => {
      const visibles = visibleProjects(request, 'reales.ver')
      const proyectos = onlyVisible(visibles, await readProjects(db), (fila) => fila.id)
      const puedeVer = new Set(proyectos.map((proyecto) => proyecto.id))

      const { reparto, matriz, meses } = await reconcileActuals(db, query.from, query.to)

      // El recorte va sobre los DESCUADRES y los meses, y la matriz se rehace
      // con lo que queda: devolver la matriz entera diría cuánto trabajó
      // alguien en un proyecto que quien pregunta no puede ver.
      const mios = meses.filter((mes) => puedeVer.has(mes.projectId))
      const descuadres = reparto.descuadres.filter((fila) => puedeVer.has(fila.projectId))
      const repartidas = reparto.allocated.filter((fila) => puedeVer.has(fila.projectId))

      const porCasilla = new Map<string, { minutes: number; allocated: number }>()
      for (const mes of mios) {
        const casilla = porCasilla.get(`${mes.resourceId}|${mes.period}`) ?? { minutes: 0, allocated: 0 }
        casilla.minutes += mes.minutes
        porCasilla.set(`${mes.resourceId}|${mes.period}`, casilla)
      }
      for (const fila of repartidas) {
        const casilla = porCasilla.get(`${fila.resourceId}|${fila.period}`) ?? { minutes: 0, allocated: 0 }
        casilla.allocated += fila.actualMinutes
        porCasilla.set(`${fila.resourceId}|${fila.period}`, casilla)
      }
      // Y una casilla por cada descuadre, aunque no tenga ni una hora detrás.
      // Es justo el caso de «declarado sin horas»: alguien ha repartido un mes
      // en el que no fichó nada —casi siempre el mes o el proyecto equivocado—,
      // y sin esta línea esa persona no sale en la matriz y el aviso existe
      // sólo para quien lea la lista de abajo. Que es nadie.
      for (const fila of descuadres) {
        const llave = `${fila.resourceId}|${fila.period}`
        if (!porCasilla.has(llave)) porCasilla.set(llave, { minutes: 0, allocated: 0 })
      }
      // `matrizDeConciliacion` ya trae una casilla por cada descuadre, incluidos
      // los que no tienen ni una hora detrás; aquí sólo se quitan las de
      // proyectos que quien pregunta no puede ver.
      const recortada = matriz
        .filter((casilla) => porCasilla.has(`${casilla.resourceId}|${casilla.period}`))
        .map((casilla) => {
          const cifras = porCasilla.get(`${casilla.resourceId}|${casilla.period}`)
          const suyos = descuadres.filter(
            (fila) => fila.resourceId === casilla.resourceId && fila.period === casilla.period,
          )
          return {
            ...casilla,
            minutes: cifras?.minutes ?? 0,
            allocated: cifras?.allocated ?? 0,
            motivo: suyos[0]?.motivo ?? null,
            proyectosConProblema: new Set(suyos.map((fila) => fila.projectId)).size,
          }
        })

      const nombreDe = new Map((await readResources(db)).map((fila) => [fila.id, fila.displayName]))
      const codigoDe = new Map(proyectos.map((fila) => [fila.id, fila.code]))

      return {
        period: query,
        // Los totales del periodo. `minutesIn - minutesAllocated` es lo que no
        // ha llegado a ninguna tarea, y es la cifra por la que se entra aquí.
        minutesIn: mios.reduce((total, mes) => total + mes.minutes, 0),
        minutesAllocated: repartidas.reduce((total, fila) => total + fila.actualMinutes, 0),
        matriz: recortada,
        descuadres: descuadres.map((fila) => ({
          ...fila,
          resourceName: nombreDe.get(fila.resourceId) ?? fila.resourceId,
          projectCode: codigoDe.get(fila.projectId) ?? fila.projectId,
        })),
        people: [...new Set(recortada.map((casilla) => casilla.resourceId))]
          .map((id) => ({ id, displayName: nombreDe.get(id) ?? id }))
          .sort((izq, der) => izq.displayName.localeCompare(der.displayName)),
        // Sin costes por ninguna parte: aquí no hay importes, y si algún día los
        // hubiera tendrían que pasar por `costes.ver`.
        costsHidden: !puede(request, 'costes.ver'),
      }
    })
    },
  )
}
