/**
 * El horizonte del cálculo, contra PostgreSQL de verdad.
 *
 * Existe por una avería concreta que sólo apareció al meter planes reales
 * (ADR-0040): el horizonte era de cuatro años fijos contados desde el proyecto
 * más temprano, y **16 de 34 proyectos de verdad no cabían** — el motor los
 * rechazaba con `OUT_OF_HORIZON` y no se podía calcular nada.
 *
 * Lo que se comprueba aquí es lo que una prueba en memoria no puede: que el
 * horizonte sale de los datos, que el suelo de cuatro años sigue ahí para que
 * nada se encoja, y que las particiones anuales de `assignment_timephased`
 * existen antes de que nadie escriba en ellas.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createPool, deleteRunsSince, withTransaction } from '@planner/persistence'
import { buildServer } from './build-server.js'
import { resolveHorizonFor } from './engine.js'

const ARRANQUE_DEL_FICHERO = new Date()

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

const unico = (prefijo: string): string =>
  `${prefijo}-${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`

let app: FastifyInstance | null = null

beforeAll(async () => {
  if (pool === null) return
  app = await buildServer(pool, { logLevel: 'silent' })
}, 60_000)

afterAll(async () => {
  if (pool !== null) await withTransaction(pool, (db) => deleteRunsSince(db, ARRANQUE_DEL_FICHERO))
  await app?.close()
  await pool?.end()
})

const describeSiHayBase = pool === null ? describe.skip : describe

/** Años naturales que abarca un horizonte, con un decimal. */
const años = (desde: string, hasta: string): number =>
  Math.round(((Date.parse(hasta) - Date.parse(desde)) / 86_400_000 / 365) * 10) / 10

describeSiHayBase('el horizonte del cálculo', () => {
  it('empieza un mes antes del proyecto más temprano', async () => {
    if (pool === null) return
    const horizonte = await withTransaction(pool, (db) => resolveHorizonFor(db))
    const primero = await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{ earliest: string | null }>(
        'SELECT MIN(status_start)::text AS earliest FROM project WHERE deleted_at IS NULL',
      )
      return rows[0]?.earliest ?? null
    })
    if (primero === null) return
    expect(años(horizonte.from, primero)).toBeGreaterThanOrEqual(0)
    // Un mes justo: 31 días.
    expect(Math.round((Date.parse(primero) - Date.parse(horizonte.from)) / 86_400_000)).toBe(31)
  })

  it('nunca baja de cuatro años, aunque el plan sea de una semana', async () => {
    if (pool === null) return
    // El suelo está para que ampliar el horizonte no encoja nada de lo que ya
    // funcionaba. Sea cual sea el contenido de la base, cuatro años como mínimo.
    const horizonte = await withTransaction(pool, (db) => resolveHorizonFor(db))
    expect(años(horizonte.from, horizonte.to)).toBeGreaterThanOrEqual(4)
  })

  it('crece cuando una tarea ata una fecha lejana, en vez de rechazarla', async () => {
    if (pool === null) return
    const antes = await withTransaction(pool, (db) => resolveHorizonFor(db))

    const proyectoId = await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO project (code, name, status_start) VALUES ($1, 'Proyecto largo', '2026-01-01')
         RETURNING id`,
        [unico('HOR')],
      )
      const id = rows[0]?.id ?? ''
      const nodo = await db.query<{ id: string }>(
        `INSERT INTO wbs_node (project_id, parent_id, node_kind, code, path, sort_key, name)
         VALUES ($1, NULL, 'task', '1', '900', 900, 'Tarea muy lejana') RETURNING id`,
        [id],
      )
      // Una fecha límite a dieciocho años vista: más que el horizonte viejo.
      await db.query(
        `INSERT INTO task (node_id, task_type, is_effort_driven, duration_minutes,
                           work_declared_minutes, constraint_kind, deadline, percent_complete_bp, is_milestone)
         VALUES ($1, 'fixed_duration', TRUE, 480, 0, 'asap', '2044-06-01', 0, FALSE)`,
        [nodo.rows[0]?.id ?? ''],
      )
      return id
    })

    const despues = await withTransaction(pool, (db) => resolveHorizonFor(db))
    expect(años(despues.from, despues.to)).toBeGreaterThan(años(antes.from, antes.to))
    // Y con su margen por detrás: la fecha atada no puede quedar en el borde.
    expect(Date.parse(despues.to)).toBeGreaterThan(Date.parse('2044-06-01'))

    await withTransaction(pool, async (db) => {
      await db.query('DELETE FROM project WHERE id = $1', [proyectoId])
    })
  })

  it('no se pasa del techo por muy lejos que alguien ponga una fecha', async () => {
    if (pool === null) return
    // Un fichero con una fecha de 2199 no puede llevarse la base por delante:
    // el horizonte multiplica la tabla de capacidad.
    const proyectoId = await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO project (code, name, status_start) VALUES ($1, 'Proyecto absurdo', '2026-01-01')
         RETURNING id`,
        [unico('HOR')],
      )
      const id = rows[0]?.id ?? ''
      const nodo = await db.query<{ id: string }>(
        `INSERT INTO wbs_node (project_id, parent_id, node_kind, code, path, sort_key, name)
         VALUES ($1, NULL, 'task', '1', '901', 901, 'Tarea del siglo que viene') RETURNING id`,
        [id],
      )
      await db.query(
        `INSERT INTO task (node_id, task_type, is_effort_driven, duration_minutes,
                           work_declared_minutes, constraint_kind, deadline, percent_complete_bp, is_milestone)
         VALUES ($1, 'fixed_duration', TRUE, 480, 0, 'asap', '2199-01-01', 0, FALSE)`,
        [nodo.rows[0]?.id ?? ''],
      )
      return id
    })

    const horizonte = await withTransaction(pool, (db) => resolveHorizonFor(db))
    expect(años(horizonte.from, horizonte.to)).toBeLessThanOrEqual(25.1)

    await withTransaction(pool, async (db) => {
      await db.query('DELETE FROM project WHERE id = $1', [proyectoId])
    })
  })

  it('un ciclo de dependencias no cuelga el cálculo del horizonte', async () => {
    if (pool === null) return
    // El esquema NO impide un ciclo —se avisa, no se prohíbe—, y el recorrido
    // que mide la cadena más larga se colgaría sin su tope de saltos.
    const proyectoId = await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO project (code, name, status_start) VALUES ($1, 'Proyecto con ciclo', '2026-01-01')
         RETURNING id`,
        [unico('HOR')],
      )
      const id = rows[0]?.id ?? ''
      const nodos: string[] = []
      for (const [i, nombre] of ['Una', 'Otra'].entries()) {
        const nodo = await db.query<{ id: string }>(
          `INSERT INTO wbs_node (project_id, parent_id, node_kind, code, path, sort_key, name)
           VALUES ($1, NULL, 'task', $2, $3, $4, $5) RETURNING id`,
          [id, String(i + 1), `91${String(i)}`, 910 + i, nombre],
        )
        const nodeId = nodo.rows[0]?.id ?? ''
        nodos.push(nodeId)
        await db.query(
          `INSERT INTO task (node_id, task_type, is_effort_driven, duration_minutes,
                             work_declared_minutes, constraint_kind, percent_complete_bp, is_milestone)
           VALUES ($1, 'fixed_duration', TRUE, 480, 0, 'asap', 0, FALSE)`,
          [nodeId],
        )
      }
      // Y el ciclo: cada una espera a la otra.
      const [una, otra] = nodos
      for (const [antes, despues] of [[una, otra], [otra, una]]) {
        if (antes === undefined || despues === undefined) continue
        await db.query(
          `INSERT INTO dependency (predecessor_node_id, successor_node_id, dependency_kind, lag_minutes)
           VALUES ($1, $2, 'FS', 0)`,
          [antes, despues],
        )
      }
      return id
    })

    // Si esto termina, el tope de saltos hace su trabajo.
    const horizonte = await withTransaction(pool, (db) => resolveHorizonFor(db))
    expect(años(horizonte.from, horizonte.to)).toBeGreaterThanOrEqual(4)

    await withTransaction(pool, async (db) => {
      await db.query('DELETE FROM project WHERE id = $1', [proyectoId])
    })
  }, 30_000)

  it('las particiones anuales cubren el horizonte entero', async () => {
    if (pool === null) return
    // Es la avería que destapó ampliar el horizonte: `assignment_timephased`
    // está particionada por año, la siembra iba de 2024 a 2035, y en cuanto el
    // horizonte alcanzó 2023 la escritura reventó con «no partition found».
    const horizonte = await withTransaction(pool, (db) => resolveHorizonFor(db))
    const respuesta = await app?.inject({ method: 'GET', url: '/api/health' })
    expect(respuesta?.statusCode).toBe(200)

    const faltan = await withTransaction(pool, async (db) => {
      const desde = Number(horizonte.from.slice(0, 4))
      const hasta = Number(horizonte.to.slice(0, 4))
      const sinParticion: number[] = []
      for (let año = desde; año <= hasta; año += 1) {
        // La función es idempotente: si ya está, no hace nada.
        await db.query('SELECT ensure_assignment_timephased_partition($1)', [año])
        const { rows } = await db.query<{ existe: boolean }>(
          `SELECT to_regclass($1) IS NOT NULL AS existe`,
          [`assignment_timephased_${String(año)}`],
        )
        if (rows[0]?.existe !== true) sinParticion.push(año)
      }
      return sinParticion
    })
    expect(faltan).toEqual([])
  }, 30_000)
})
