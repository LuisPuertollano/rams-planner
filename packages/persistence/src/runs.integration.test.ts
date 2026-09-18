/**
 * El borrado de ejecuciones, contra PostgreSQL de verdad.
 *
 * Es la pieza que impide que la base de las pruebas crezca sin límite, así que
 * lo que hay que comprobar es justo lo contrario de lo que suele probarse: que
 * borra lo que tiene que borrar **y que no borra lo demás**. Una limpieza que
 * se lleva por delante una línea base es peor que no limpiar.
 */

import { calendarDate } from '@planner/domain'
import { afterAll, describe, expect, it } from 'vitest'
import { createPool, withTransaction } from './db.js'
import { freezeRun } from './read.js'
import { createProject } from './plan-edit.js'
import { deleteRunsSince } from './runs.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

afterAll(async () => {
  await pool?.end()
})

const unico = (prefijo: string): string =>
  `${prefijo}-${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`

/**
 * Una ejecución vacía, escrita directamente.
 *
 * Con SQL y no con `saveRun` a propósito: lo que se prueba es un `DELETE`, y
 * montar un snapshot entero para poder borrarlo mete en la prueba un motor que
 * no tiene nada que ver con lo que falla si el borrado está mal.
 */
async function ejecucionDe(scenarioId: string): Promise<string> {
  if (pool === null) return ''
  return withTransaction(pool, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO calculation_run
         (scenario_id, engine_version, input_hash, horizon_from, horizon_to,
          status, trigger_reason, finished_at, duration_ms, stats)
       VALUES ($1, '1.0.0', $2, $3, $4, 'succeeded', $5, now(), 0, '{}'::jsonb)
       RETURNING id`,
      [
        scenarioId,
        unico('hash').slice(0, 64),
        calendarDate('2026-01-01'),
        calendarDate('2026-12-31'),
        'prueba del borrado de ejecuciones',
      ],
    )
    return rows[0]?.id ?? ''
  })
}

/** El escenario base de un proyecto nuevo, que es donde viven sus ejecuciones. */
async function escenarioNuevo(): Promise<string> {
  if (pool === null) return ''
  return withTransaction(pool, async (db) => {
    await createProject(db, {
      code: unico('LIMPIEZA').slice(0, 30),
      name: 'Proyecto de la limpieza',
      statusStart: calendarDate('2026-03-02'),
    })
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM scenario ORDER BY created_at DESC LIMIT 1',
    )
    return rows[0]?.id ?? ''
  })
}

describe.skipIf(pool === null)('borrar ejecuciones a partir de un instante', () => {
  it('se lleva las de después y deja en paz las de antes', async () => {
    if (pool === null) return
    const scenarioId = await escenarioNuevo()
    const vieja = await ejecucionDe(scenarioId)

    // El corte va entre las dos. Un milisegundo de margen porque `started_at`
    // lo pone la base con `now()` y las dos llamadas caben en el mismo.
    await new Promise((listo) => setTimeout(listo, 5))
    const corte = new Date()
    await new Promise((listo) => setTimeout(listo, 5))

    const nueva = await ejecucionDe(scenarioId)
    const borradas = await withTransaction(pool, (db) => deleteRunsSince(db, corte))
    expect(borradas).toBeGreaterThanOrEqual(1)

    const quedan = await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        'SELECT id FROM calculation_run WHERE id = ANY($1::uuid[])',
        [[vieja, nueva]],
      )
      return rows.map((fila) => fila.id)
    })
    expect(quedan).toEqual([vieja])
  })

  it('no borra una ejecución congelada: una línea base es la foto de referencia', async () => {
    if (pool === null) return
    const scenarioId = await escenarioNuevo()
    const corte = new Date()
    await new Promise((listo) => setTimeout(listo, 5))

    const congelada = await ejecucionDe(scenarioId)
    const suelta = await ejecucionDe(scenarioId)
    await withTransaction(pool, (db) => freezeRun(db, congelada, unico('Línea base')))

    await withTransaction(pool, (db) => deleteRunsSince(db, corte))

    const quedan = await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        'SELECT id FROM calculation_run WHERE id = ANY($1::uuid[])',
        [[congelada, suelta]],
      )
      return rows.map((fila) => fila.id)
    })
    expect(quedan).toEqual([congelada])
  })

  it('sin nada que borrar devuelve cero, no falla', async () => {
    if (pool === null) return
    const dentroDeUnRato = new Date(Date.now() + 60_000)
    expect(await withTransaction(pool, (db) => deleteRunsSince(db, dentroDeUnRato))).toBe(0)
  })
})
