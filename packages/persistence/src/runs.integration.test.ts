/**
 * El borrado de ejecuciones, contra PostgreSQL de verdad.
 *
 * Es la pieza que impide que la base de las pruebas crezca sin límite, así que
 * lo que hay que comprobar es justo lo contrario de lo que suele probarse: que
 * borra lo que tiene que borrar **y que no borra lo demás**. Una limpieza que
 * se lleva por delante una línea base es peor que no limpiar.
 */

import { calendarDate, type CalendarDate } from '@planner/domain'
import type { PlanSnapshot } from '@planner/scheduler'
import type { CapacityCell } from '@planner/workload'
import { afterAll, describe, expect, it } from 'vitest'
import { createPool, withTransaction } from './db.js'
import { freezeRun } from './read.js'
import { createProject } from './plan-edit.js'
import { createResource } from './resources.js'
import { deleteRunsSince, saveRun } from './runs.js'

/**
 * La instantánea mínima que `saveRun` necesita para poder guardar.
 *
 * Vacía a propósito: lo que se prueba aquí es cómo se guarda la capacidad, y un
 * plan de verdad metería en la prueba un motor que no tiene nada que ver con
 * que el bloque se comparta o no.
 */
const SNAPSHOT: PlanSnapshot = {
  horizon: { from: calendarDate('2026-01-01'), to: calendarDate('2026-12-31') },
  defaultCalendarId: '00000000-0000-4000-8000-000000000000',
  calendars: [],
  resources: [],
  projects: [],
  nodes: [],
  tasks: [],
  dependencies: [],
  dependenciesOutOfPlan: [],
  assignments: [],
  skillRequirements: [],
  skillNames: {},
}

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

/** Una persona nueva, para que su capacidad no choque con la de nadie. */
async function personaNueva(): Promise<string> {
  if (pool === null) return ''
  return withTransaction(pool, (db) =>
    createResource(db, { code: unico('persona').slice(0, 30), displayName: 'Persona del bloque' }),
  )
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

// ---------------------------------------------------------------------------
// La capacidad se guarda una vez, no una vez por ejecución
// ---------------------------------------------------------------------------

/** Una celda de capacidad, para montar bloques a mano. */
function celda(resourceId: string, date: string, minutos: number): CapacityCell {
  return { resourceId, date: date as CalendarDate, capacityMinutes: minutos, grossMinutes: minutos }
}

/** Guarda una ejecución con esta capacidad y devuelve su id. */
async function ejecucionCon(scenarioId: string, celdas: readonly CapacityCell[]): Promise<string> {
  if (pool === null) return ''
  return withTransaction(pool, (db) =>
    saveRun(db, {
      scenarioId,
      snapshot: SNAPSHOT,
      schedule: { taskResults: [], findings: [], compiledCalendars: new Map(), completed: true },
      workload: {
        timephased: [],
        // El índice es para el motor, que aquí no corre: lo que `saveRun`
        // escribe son las celdas, y son las que la prueba controla.
        capacity: { cells: celdas, capacityOf: () => 0 },
        findings: [],
      },
      derivations: [],
      durationMs: 0,
      triggerReason: 'prueba del bloque de capacidad',
    }),
  )
}

/** La capacidad que ve una ejecución, tal y como la lee la herramienta. */
async function capacidadDe(runId: string): Promise<readonly string[]> {
  if (pool === null) return []
  return withTransaction(pool, async (db) => {
    const { rows } = await db.query<{ fila: string }>(
      `SELECT resource_id || '|' || work_date::text || '|' || capacity_minutes AS fila
       FROM resource_capacity_timephased WHERE run_id = $1
       ORDER BY resource_id, work_date`,
      [runId],
    )
    return rows.map((r) => r.fila)
  })
}

const contar = async (sql: string, params: readonly unknown[] = []): Promise<number> => {
  if (pool === null) return 0
  return withTransaction(pool, async (db) => {
    const { rows } = await db.query<{ n: string }>(sql, [...params])
    return Number(rows[0]?.n ?? 0)
  })
}

describe.skipIf(pool === null)('el bloque de capacidad se comparte', () => {
  it('dos ejecuciones con la misma capacidad comparten bloque y la segunda no cuesta ni una celda', async () => {
    if (pool === null) return
    const scenarioId = await escenarioNuevo()
    const persona = await personaNueva()
    const celdas = [celda(persona, '2026-03-02', 480), celda(persona, '2026-03-03', 480)]

    const antes = await contar('SELECT count(*) AS n FROM capacity_cell')
    const uno = await ejecucionCon(scenarioId, celdas)
    const medio = await contar('SELECT count(*) AS n FROM capacity_cell')
    const dos = await ejecucionCon(scenarioId, celdas)
    const despues = await contar('SELECT count(*) AS n FROM capacity_cell')

    expect(medio - antes).toBe(2)
    // La segunda ejecución no escribe nada: el bloque ya estaba.
    expect(despues - medio).toBe(0)

    const bloques = await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{ capacity_set_id: string }>(
        'SELECT capacity_set_id FROM calculation_run WHERE id = ANY($1::uuid[])',
        [[uno, dos]],
      )
      return rows.map((r) => r.capacity_set_id)
    })
    expect(bloques[0]).toBe(bloques[1])
    expect(bloques[0]).not.toBeNull()

    // Y las dos siguen viendo su capacidad entera, que es lo que importa.
    expect(await capacidadDe(uno)).toHaveLength(2)
    expect(await capacidadDe(dos)).toEqual(await capacidadDe(uno))
  })

  it('un calendario distinto nace como bloque nuevo, y el histórico no se mueve', async () => {
    if (pool === null) return
    const scenarioId = await escenarioNuevo()
    const persona = await personaNueva()

    const vieja = await ejecucionCon(scenarioId, [
      celda(persona, '2026-03-02', 480),
      celda(persona, '2026-03-03', 480),
    ])
    const antes = await capacidadDe(vieja)

    // Se va de vacaciones el día 3: la capacidad de ese día desaparece.
    const nueva = await ejecucionCon(scenarioId, [celda(persona, '2026-03-02', 480)])

    expect(await capacidadDe(nueva)).toHaveLength(1)
    // La ejecución vieja sigue viendo los dos días contra los que se calculó.
    expect(await capacidadDe(vieja)).toEqual(antes)
    expect(await capacidadDe(vieja)).toHaveLength(2)
  })

  it('borrar una ejecución no se lleva el bloque que comparte con otra', async () => {
    if (pool === null) return
    const scenarioId = await escenarioNuevo()
    const persona = await personaNueva()
    const celdas = [celda(persona, '2026-04-06', 480)]

    const corte = new Date()
    await new Promise((listo) => setTimeout(listo, 5))
    const quedarse = await ejecucionCon(scenarioId, celdas)
    // Se saca del rango de borrado retrasando su `started_at` a antes del corte.
    await withTransaction(pool, (db) =>
      db.query('UPDATE calculation_run SET started_at = $2 WHERE id = $1', [
        quedarse,
        new Date(corte.getTime() - 60_000),
      ]),
    )
    const irse = await ejecucionCon(scenarioId, celdas)

    await withTransaction(pool, (db) => deleteRunsSince(db, corte))

    expect(await contar('SELECT count(*) AS n FROM calculation_run WHERE id = $1', [irse])).toBe(0)
    // El bloque sigue en pie porque `quedarse` lo mira.
    expect(await capacidadDe(quedarse)).toHaveLength(1)
  })

  it('el bloque que ya no mira nadie se recoge: la basura no se queda', async () => {
    if (pool === null) return
    const scenarioId = await escenarioNuevo()
    const persona = await personaNueva()

    const corte = new Date()
    await new Promise((listo) => setTimeout(listo, 5))
    // Una capacidad que no tiene nadie más, para que el bloque sea suyo y de nadie.
    await ejecucionCon(scenarioId, [celda(persona, '2026-05-04', 7)])
    expect(await contar('SELECT count(*) AS n FROM capacity_cell WHERE capacity_minutes = 7')).toBe(1)

    await withTransaction(pool, (db) => deleteRunsSince(db, corte))
    expect(await contar('SELECT count(*) AS n FROM capacity_cell WHERE capacity_minutes = 7')).toBe(0)
  })

  it('una ejecución sin capacidad no apunta a ningún bloque, y no finge tenerla', async () => {
    if (pool === null) return
    const scenarioId = await escenarioNuevo()
    const vacia = await ejecucionCon(scenarioId, [])

    expect(await capacidadDe(vacia)).toEqual([])
    const sinBloque = await contar(
      'SELECT count(*) AS n FROM calculation_run WHERE id = $1 AND capacity_set_id IS NULL',
      [vacia],
    )
    expect(sinBloque).toBe(1)
  })
})
