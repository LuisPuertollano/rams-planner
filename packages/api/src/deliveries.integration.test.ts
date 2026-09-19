/**
 * Las entregas previas del catálogo, contra PostgreSQL de verdad.
 *
 * Lo que sólo se ve con la base delante: que la Checkliste sobrevive a la ida y
 * vuelta por el CSV —se exporta como se importa—, que declararla otra vez la
 * reemplaza entera, y que los dos frenos que puso el esquema saltan de verdad:
 * una entrega previa que se lleva el entregable entero, y dos entregas del
 * mismo documento a la misma puerta.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { createPool, readDeliveries, readDocumentTypes, withTransaction } from '@planner/persistence'
import { importDocumentsCsv } from './import-documents.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

const sufijo = `${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`
const COD = `ENT-${sufijo}`

afterAll(async () => {
  if (pool !== null) {
    await withTransaction(pool, (db) => db.query('DELETE FROM document_type WHERE code LIKE $1', [`ENT-%`]))
  }
  await pool?.end()
})

const describeSiHayBase = pool === null ? describe.skip : describe

const CABECERA = 'codigo;nombre;puerta;horas;entregas_previas'
const importa = async (...filas: readonly string[]): ReturnType<typeof importDocumentsCsv> => {
  if (pool === null) throw new Error('sin base')
  return withTransaction(pool, (db) => importDocumentsCsv(db, [CABECERA, ...filas].join('\n')))
}
const entregasDe = async (
  codigo: string,
): Promise<readonly Awaited<ReturnType<typeof readDeliveries>>[number][]> => {
  if (pool === null) throw new Error('sin base')
  const { tipos, entregas } = await withTransaction(pool, async (db) => ({
    tipos: await readDocumentTypes(db),
    entregas: await readDeliveries(db),
  }))
  const id = tipos.find((t) => t.code === codigo)?.id
  return entregas.filter((e) => e.documentTypeId === id)
}

describeSiHayBase('las entregas previas del catálogo', () => {
  it('entran con su puerta, su madurez y su parte del esfuerzo', async () => {
    if (pool === null) return
    const resultado = await importa(`${COD};FMECA;CGR;100;PGR:preliminar:30:4|IGR:as designed:20:6`)
    expect(resultado.deliveries).toBe(2)

    const entregas = await entregasDe(COD)
    expect(entregas).toHaveLength(2)
    expect(entregas[0]).toMatchObject({
      position: 1, gate: 'PGR', maturity: 'preliminar', weeksBeforeGate: 4, shareBp: 3_000,
    })
    expect(entregas[1]).toMatchObject({
      position: 2, gate: 'IGR', maturity: 'as designed', weeksBeforeGate: 6, shareBp: 2_000,
    })
  })

  it('volver a declararlas las reemplaza enteras', async () => {
    if (pool === null) return
    // Igual que los predecesores y el ciclo de firma: lo que no venga, se va.
    await importa(`${COD};FMECA;CGR;100;PGR:preliminar:40`)
    const entregas = await entregasDe(COD)
    expect(entregas).toHaveLength(1)
    expect(entregas[0]).toMatchObject({ gate: 'PGR', shareBp: 4_000 })
  })

  it('la columna vacía dice que ya no hay ninguna', async () => {
    if (pool === null) return
    await importa(`${COD};FMECA;CGR;100;`)
    expect(await entregasDe(COD)).toEqual([])
  })

  it('una entrega previa no puede llevarse el entregable entero', async () => {
    if (pool === null) return
    // El esquema lo impide: share_bp < 10000. Sin eso, la entrega final saldría
    // gratis, que es otra forma de decir que el reparto está mal.
    await expect(importa(`${COD}-X;Otro;CGR;100;PGR:preliminar:99`)).resolves.toBeDefined()
    await expect(
      withTransaction(pool, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          'SELECT id FROM document_type WHERE code = $1',
          [`${COD}-X`],
        )
        await db.query(
          `INSERT INTO document_gate (document_type_id, position, gate, maturity, share_bp)
           VALUES ($1, 9, 'TTG', 'entera', 10000)`,
          [rows[0]?.id ?? ''],
        )
      }),
    ).rejects.toThrow()
  })

  it('dos entregas del mismo documento no pueden ir a la misma puerta', async () => {
    if (pool === null) return
    // Sería pedir el mismo borrador dos veces en el mismo sitio.
    await expect(
      withTransaction(pool, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          'SELECT id FROM document_type WHERE code = $1',
          [`${COD}-X`],
        )
        const id = rows[0]?.id ?? ''
        await db.query(
          `INSERT INTO document_gate (document_type_id, position, gate, maturity, share_bp)
           VALUES ($1, 7, 'pgr', 'otra', 1000)`,
          [id],
        )
      }),
    ).rejects.toThrow()
  })
})
