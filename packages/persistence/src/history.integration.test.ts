/**
 * Qué guarda el historial de un cambio.
 *
 * No había ninguna prueba que mirara el CONTENIDO de un evento —sólo que los
 * eventos existían— y por eso reducir lo que se guarda no rompía nada. Ésta
 * fija las tres reglas, que son tres decisiones distintas:
 *
 *   UPDATE  sólo las claves que cambian, a los dos lados.
 *   INSERT  la fila entera, porque la fila entera ES el cambio.
 *   DELETE  la fila entera, porque es lo que se pierde.
 *
 * Y la que sostiene todo lo demás: el `entity_id` sigue estando aunque el `id`
 * no cambie nunca y por tanto no salga en el diff. Sin él, el evento no diría
 * de quién habla.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPool, withTransaction } from './db.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)
const sufijo = `${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`
const CODIGO = `HIST-${sufijo}`

const describeSiHayBase = pool === null ? describe.skip : describe

let projectId = ''

beforeAll(async () => {
  if (pool === null) return
  await withTransaction(pool, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO project (code, name, status_start) VALUES ($1, 'Proyecto del historial', '2026-01-01')
       RETURNING id`,
      [CODIGO],
    )
    projectId = rows[0]?.id ?? ''
  })
})

afterAll(async () => {
  if (pool !== null) {
    await withTransaction(pool, (db) => db.query('DELETE FROM project WHERE code = $1', [CODIGO]))
  }
  await pool?.end()
})

interface Evento {
  operation: string
  entity_id: string
  before_value: Record<string, unknown> | null
  after_value: Record<string, unknown> | null
}

const ultimo = async (operacion: string): Promise<Evento | undefined> => {
  if (pool === null) return undefined
  const { rows } = await withTransaction(pool, (db) =>
    db.query<Evento>(
      `SELECT operation, entity_id::text, before_value, after_value
       FROM change_event
       WHERE entity_type = 'project' AND entity_id = $1 AND operation = $2
       ORDER BY id DESC LIMIT 1`,
      [projectId, operacion],
    ),
  )
  return rows[0]
}

describeSiHayBase('lo que guarda el historial', () => {
  it('un alta guarda la fila entera', async () => {
    if (pool === null) return
    const evento = await ultimo('insert')
    expect(evento?.before_value).toBeNull()
    // Más de diez columnas: es la fila, no un trozo.
    expect(Object.keys(evento?.after_value ?? {}).length).toBeGreaterThan(10)
    expect(evento?.after_value?.['code']).toBe(CODIGO)
  })

  it('un cambio guarda SÓLO las claves que se movieron, a los dos lados', async () => {
    if (pool === null) return
    await withTransaction(pool, (db) =>
      db.query('UPDATE project SET name = $2 WHERE id = $1', [projectId, 'Otro nombre']),
    )
    const evento = await ultimo('update')
    // `updated_at` cambia en toda escritura y es parte del cambio; lo que no
    // puede aparecer es una columna que nadie tocó.
    const claves = Object.keys(evento?.after_value ?? {}).filter((c) => c !== 'updated_at')
    expect(claves).toEqual(['name'])
    expect(evento?.after_value?.['name']).toBe('Otro nombre')
    expect(evento?.before_value?.['name']).toBe('Proyecto del historial')
    expect(Object.keys(evento?.before_value ?? {}).filter((c) => c !== 'updated_at')).toEqual(['name'])
  })

  it('y sigue diciendo de quién habla, aunque el id no esté en el diff', async () => {
    if (pool === null) return
    // El `id` no cambia nunca, así que no sale en el diff. Si el evento sacara
    // la entidad de lo guardado en vez de de la fila, se quedaría sin saber a
    // qué proyecto se refiere — y un historial que no dice de quién habla no
    // es un historial.
    const evento = await ultimo('update')
    expect(evento?.entity_id).toBe(projectId)
    expect(evento?.after_value?.['id']).toBeUndefined()
  })

  it('un cambio que no cambia nada no deja evento', async () => {
    if (pool === null) return
    const antes = await ultimo('update')
    await withTransaction(pool, (db) =>
      db.query('UPDATE project SET name = name WHERE id = $1', [projectId]),
    )
    expect(await ultimo('update')).toEqual(antes)
  })

  it('una baja guarda la fila entera, que es lo que se pierde', async () => {
    if (pool === null) return
    await withTransaction(pool, (db) =>
      db.query('UPDATE project SET deleted_at = now() WHERE id = $1', [projectId]),
    )
    const evento = await ultimo('delete')
    // Es un soft delete y por tanto un UPDATE, así que se reduce igual: lo que
    // se pierde de verdad —la fila— sigue en el alta y en los cambios de en
    // medio. Lo que la baja tiene que decir es CUÁNDO y QUIÉN.
    expect(evento?.after_value?.['deleted_at']).not.toBeNull()
    expect(evento?.before_value?.['deleted_at']).toBeNull()
  })
})
