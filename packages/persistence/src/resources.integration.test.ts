/**
 * La ficha de recursos contra PostgreSQL de verdad.
 *
 * Aquí lo que importa no es que el SQL «funcione», sino que las invariantes del
 * esquema salten cuando tienen que saltar: una disponibilidad que se solapa con
 * otra tiene que ser imposible, no un dato raro que luego nadie sabe explicar.
 * Como en el resto de la integración, se salta sin `DATABASE_URL`.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { createPool, withTransaction } from './db.js'
import {
  addAbsence,
  addAvailability,
  addCostRate,
  createResource,
  deleteAvailability,
  readCalendars,
  readResourceDetails,
  softDeleteResource,
  updateResource,
} from './resources.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

afterAll(async () => {
  await pool?.end()
})

/** Un código distinto por prueba: así no se pisan entre ellas ni con la semilla. */
const uniqueCode = (prefix: string): string => `${prefix}.${String(Date.now())}.${String(Math.trunc(Math.random() * 1e6))}`

describe.skipIf(pool === null)('ficha de recursos', () => {
  it('crea una persona y la devuelve con su calendario, sus tramos y su tarifa', async () => {
    if (pool === null) return
    const code = uniqueCode('prueba')

    const detail = await withTransaction(pool, async (db) => {
      const calendars = await readCalendars(db)
      const calendarId = calendars[0]?.id ?? null
      const id = await createResource(db, { code, displayName: 'Persona de prueba', calendarId })

      await addAvailability(db, id, { from: '2026-01-01', to: '2026-06-30', unitsBp: 5_000, reason: 'media jornada' })
      await addAbsence(db, id, { kind: 'vacation', from: '2026-08-03', to: '2026-08-21', note: 'agosto' })
      await addCostRate(db, id, { from: '2026-01-01', to: '2026-12-31', standardCentsHour: 7_500 })

      const all = await readResourceDetails(db)
      return all.find((resource) => resource.code === code)
    })

    expect(detail).toBeDefined()
    expect(detail?.displayName).toBe('Persona de prueba')
    expect(detail?.calendarCode).not.toBeNull()
    // Los rangos salen inclusivos por los dos lados, igual que se escribieron.
    expect(detail?.availability).toHaveLength(1)
    const tramo = detail?.availability[0]
    expect({ from: tramo?.from, to: tramo?.to, unitsBp: tramo?.unitsBp, reason: tramo?.reason }).toEqual({
      from: '2026-01-01',
      to: '2026-06-30',
      unitsBp: 5_000,
      reason: 'media jornada',
    })
    expect(detail?.absences[0]?.to).toBe('2026-08-21')
    expect(detail?.costRates[0]?.standardCentsHour).toBe(7_500)
    // Y los céntimos son enteros: si esto fuese un float, el coste mentiría.
    expect(Number.isInteger(detail?.costRates[0]?.standardCentsHour)).toBe(true)
  })

  it('rechaza dos tramos de disponibilidad que se solapan (invariante R1)', async () => {
    if (pool === null) return
    const code = uniqueCode('solape')

    const id = await withTransaction(pool, async (db) => {
      const created = await createResource(db, { code, displayName: 'Solapes' })
      await addAvailability(db, created, { from: '2026-01-01', to: '2026-03-31', unitsBp: 10_000 })
      return created
    })

    await expect(
      withTransaction(pool, async (db) => {
        await addAvailability(db, id, { from: '2026-03-01', to: '2026-04-30', unitsBp: 5_000 })
      }),
    ).rejects.toMatchObject({ code: '23P01' })

    // Un tramo que empieza justo al día siguiente sí entra: los rangos son
    // cerrados por los dos lados y [ene,mar] y [abr,jun] no se tocan.
    await withTransaction(pool, async (db) => {
      await addAvailability(db, id, { from: '2026-04-01', to: '2026-06-30', unitsBp: 5_000 })
    })

    const tramos = await withTransaction(pool, async (db) => {
      const all = await readResourceDetails(db)
      return all.find((resource) => resource.id === id)?.availability ?? []
    })
    expect(tramos).toHaveLength(2)
  })

  it('borra un tramo sin tocar a los demás, y la baja es lógica', async () => {
    if (pool === null) return
    const code = uniqueCode('baja')

    const { id, firstId } = await withTransaction(pool, async (db) => {
      const created = await createResource(db, { code, displayName: 'De baja' })
      const first = await addAvailability(db, created, { from: '2026-01-01', to: '2026-01-31', unitsBp: 10_000 })
      await addAvailability(db, created, { from: '2026-02-01', to: '2026-02-28', unitsBp: 2_000 })
      return { id: created, firstId: first }
    })

    await withTransaction(pool, async (db) => { await deleteAvailability(db, firstId) })

    const afterDelete = await withTransaction(pool, async (db) => {
      const all = await readResourceDetails(db)
      return all.find((resource) => resource.id === id)
    })
    expect(afterDelete?.availability.map((period) => period.unitsBp)).toEqual([2_000])

    await withTransaction(pool, async (db) => { await softDeleteResource(db, id) })

    const afterSoftDelete = await withTransaction(pool, async (db) => {
      const all = await readResourceDetails(db)
      return all.find((resource) => resource.id === id)
    })
    // Ya no aparece en la ficha...
    expect(afterSoftDelete).toBeUndefined()
    // ...pero la fila sigue ahí, con su marca de baja: nada se ha perdido (P7).
    const { rows } = await pool.query<{ deleted_at: Date | null }>(
      'SELECT deleted_at FROM resource WHERE id = $1',
      [id],
    )
    expect(rows[0]?.deleted_at).not.toBeNull()
  })

  it('el cambio de calendario y de dedicación queda registrado en el historial', async () => {
    if (pool === null) return
    const code = uniqueCode('auditoria')

    const id = await withTransaction(
      pool,
      async (db) => createResource(db, { code, displayName: 'Auditada', maxUnitsBp: 10_000 }),
      { comment: 'alta de prueba' },
    )

    await withTransaction(pool, async (db) => { await updateResource(db, id, { maxUnitsBp: 8_000 }) }, {
      comment: 'pasa a 80 %',
    })

    const { rows } = await pool.query<{ operation: string; comment: string | null }>(
      `SELECT operation, comment FROM change_event
       WHERE entity_id = $1 ORDER BY occurred_at`,
      [id],
    )
    expect(rows.map((row) => row.operation)).toEqual(['insert', 'update'])
    expect(rows[1]?.comment).toBe('pasa a 80 %')
  })
})
