/**
 * Las horas reales contra PostgreSQL de verdad.
 *
 * Lo que importa aquí no es que el SQL «funcione», sino las dos promesas que
 * hace `saveActuals` y que sólo la base puede desmentir:
 *
 *   1. Cargar dos veces el mismo fichero deja la tabla igual que cargarlo una
 *      vez. Es lo que alguien espera cuando repite una importación porque no
 *      sabe si la primera fue, y con `DO NOTHING` o con un `INSERT` a secas
 *      saldría el doble de horas.
 *   2. Un fichero con dos apuntes del mismo día no revienta. Es el caso en el
 *      que `ON CONFLICT ... DO UPDATE` aborta con «command cannot affect row a
 *      second time», y sólo se ve contra la base.
 *
 * Como el resto de la integración, se salta sin `DATABASE_URL`.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { lastActualDate, readActualsInPeriod, saveActuals } from './actuals.js'
import { createPool, withTransaction } from './db.js'
import { createNode, createProject } from './plan-edit.js'
import { createResource } from './resources.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

afterAll(async () => {
  await pool?.end()
})

const unico = (prefijo: string): string =>
  `${prefijo}.${String(Date.now())}.${String(Math.trunc(Math.random() * 1e6))}`

describe.skipIf(pool === null)('horas reales', () => {
  it('se guardan, se leen por mes, y volver a cargarlas corrige en vez de duplicar', async () => {
    if (pool === null) return
    const codigo = unico('REAL')

    const leido = await withTransaction(pool, async (db) => {
      const projectId = await createProject(db, {
        code: codigo,
        name: 'Proyecto de horas reales',
        statusStart: '2026-03-01',
      })
      const nodeId = await createNode(db, { projectId, kind: 'task', name: 'Tarea con horas', durationMinutes: 480 })
      const resourceId = await createResource(db, { code: unico('persona'), displayName: 'Persona de horas' })

      // Dos apuntes del mismo día: es el caso que abortaba el INSERT entero.
      const primera = await saveActuals(db, [
        { nodeId, resourceId, workDate: '2026-03-02', minutes: 180, source: 'timesheet' },
        { nodeId, resourceId, workDate: '2026-03-02', minutes: 120, source: 'timesheet' },
        { nodeId, resourceId, workDate: '2026-04-06', minutes: 240, source: 'timesheet' },
      ])
      expect(primera.guardadas).toBe(2)

      const deUnaVez = await readActualsInPeriod(db, '2026-01-01', '2026-12-31')

      // El mismo fichero otra vez. No suma: corrige.
      await saveActuals(db, [
        { nodeId, resourceId, workDate: '2026-03-02', minutes: 180, source: 'timesheet' },
        { nodeId, resourceId, workDate: '2026-03-02', minutes: 120, source: 'timesheet' },
        { nodeId, resourceId, workDate: '2026-04-06', minutes: 240, source: 'timesheet' },
      ])
      const deDosVeces = await readActualsInPeriod(db, '2026-01-01', '2026-12-31')

      // Y una hora estimada del mismo día no pisa la fichada: no es el mismo dato.
      await saveActuals(db, [
        { nodeId, resourceId, workDate: '2026-03-02', minutes: 60, source: 'estimate' },
      ])
      const conEstimada = await readActualsInPeriod(db, '2026-01-01', '2026-12-31')

      return {
        projectId,
        deUnaVez: deUnaVez.filter((fila) => fila.projectId === projectId),
        deDosVeces: deDosVeces.filter((fila) => fila.projectId === projectId),
        conEstimada: conEstimada.filter((fila) => fila.projectId === projectId),
        // El periodo recorta de verdad: abril queda fuera.
        soloMarzo: (await readActualsInPeriod(db, '2026-03-01', '2026-03-31')).filter(
          (fila) => fila.projectId === projectId,
        ),
        ultimo: await lastActualDate(db),
      }
    })

    expect(leido.deUnaVez.map((fila) => ({ period: fila.period, actualMinutes: fila.actualMinutes }))).toEqual([
      { period: '2026-03', actualMinutes: 300 },
      { period: '2026-04', actualMinutes: 240 },
    ])
    expect(leido.deDosVeces).toEqual(leido.deUnaVez)
    // La estimada se suma en la lectura del mes porque el informe cruza horas,
    // no orígenes: 300 fichadas + 60 estimadas.
    expect(leido.conEstimada[0]?.actualMinutes).toBe(360)
    expect(leido.soloMarzo).toHaveLength(1)
    expect(leido.ultimo).not.toBeNull()
  })

  it('un lote vacío no escribe nada y no falla', async () => {
    if (pool === null) return
    const resultado = await withTransaction(pool, (db) => saveActuals(db, []))
    expect(resultado).toEqual({ guardadas: 0 })
  })
})
