/**
 * El ciclo de firma contra PostgreSQL de verdad.
 *
 * Lo que se comprueba aquí es lo que una prueba en memoria no puede: que la
 * sustitución del ciclo entero sea de verdad una sustitución, que el orden que
 * devuelve la base sea el del ciclo y no el de inserción, y que retirar un
 * entregable se lleve sus firmas por delante.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { createPool, withTransaction } from './db.js'
import {
  createDocumentType,
  readSignatures,
  setSignatures,
  softDeleteDocumentType,
} from './documents.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

afterAll(async () => {
  await pool?.end()
})

const unique = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`

describe.skipIf(pool === null)('ciclo de firma', () => {
  it('se escribe, se lee en el orden del ciclo y no en el de inserción', async () => {
    if (pool === null) return
    const id = await withTransaction(pool, async (db) => {
      const nuevo = await createDocumentType(db, { code: unique('FIRMA'), name: 'Con ciclo' })
      // A propósito al revés: aprobador primero, autor al final.
      await setSignatures(db, nuevo, [
        { step: 'approver', position: 1, role: 'PrEM', standardMinutes: 60 },
        { step: 'reviewer', position: 1, role: 'Calidad', standardMinutes: null },
        { step: 'verifier', position: 2, role: 'Jefe RAMS', standardMinutes: 90 },
        { step: 'verifier', position: 1, role: 'Ing. Sistemas', standardMinutes: 120 },
        { step: 'author', position: 1, role: 'Ing. RAMS', standardMinutes: 480 },
      ])
      return nuevo
    })

    const todas = await withTransaction(pool, (db) => readSignatures(db))
    const mias = todas.filter((firma) => firma.documentTypeId === id)
    expect(mias.map((firma) => `${firma.step}${String(firma.position)}`)).toEqual([
      'author1',
      'verifier1',
      'verifier2',
      'approver1',
      'reviewer1',
    ])
    expect(mias[1]?.role).toBe('Ing. Sistemas')
    expect(mias[0]?.standardMinutes).toBe(480)
    expect(mias[4]?.standardMinutes).toBeNull()
  })

  it('volver a escribir sustituye el ciclo entero: lo que no viene, se borra', async () => {
    if (pool === null) return
    const id = await withTransaction(pool, async (db) => {
      const nuevo = await createDocumentType(db, { code: unique('FIRMA'), name: 'Se corrige' })
      await setSignatures(db, nuevo, [
        { step: 'author', position: 1, role: 'Ing. RAMS', standardMinutes: null },
        { step: 'verifier', position: 1, role: 'Quien no era', standardMinutes: null },
        { step: 'verifier', position: 2, role: 'Tampoco', standardMinutes: null },
        { step: 'approver', position: 1, role: 'PrEM', standardMinutes: null },
      ])
      await setSignatures(db, nuevo, [
        { step: 'author', position: 1, role: 'Ing. RAMS', standardMinutes: null },
        { step: 'verifier', position: 1, role: 'Ing. Sistemas', standardMinutes: null },
        { step: 'approver', position: 1, role: 'PrEM', standardMinutes: null },
      ])
      return nuevo
    })

    const mias = (await withTransaction(pool, (db) => readSignatures(db))).filter(
      (firma) => firma.documentTypeId === id,
    )
    expect(mias).toHaveLength(3)
    expect(mias.map((firma) => firma.role)).toEqual(['Ing. RAMS', 'Ing. Sistemas', 'PrEM'])
  })

  it('un ciclo vacío deja el entregable sin firmas, no lo deja como estaba', async () => {
    if (pool === null) return
    const id = await withTransaction(pool, async (db) => {
      const nuevo = await createDocumentType(db, { code: unique('FIRMA'), name: 'Se vacía' })
      await setSignatures(db, nuevo, [
        { step: 'author', position: 1, role: 'Ing. RAMS', standardMinutes: null },
      ])
      await setSignatures(db, nuevo, [])
      return nuevo
    })

    const mias = (await withTransaction(pool, (db) => readSignatures(db))).filter(
      (firma) => firma.documentTypeId === id,
    )
    expect(mias).toEqual([])
  })

  it('un rol en blanco se descarta en vez de romper la escritura', async () => {
    if (pool === null) return
    const id = await withTransaction(pool, async (db) => {
      const nuevo = await createDocumentType(db, { code: unique('FIRMA'), name: 'Con hueco' })
      await setSignatures(db, nuevo, [
        { step: 'author', position: 1, role: '  Ing. RAMS  ', standardMinutes: null },
        { step: 'verifier', position: 1, role: '   ', standardMinutes: null },
        { step: 'approver', position: 1, role: 'PrEM', standardMinutes: null },
      ])
      return nuevo
    })

    const mias = (await withTransaction(pool, (db) => readSignatures(db))).filter(
      (firma) => firma.documentTypeId === id,
    )
    expect(mias.map((firma) => firma.role)).toEqual(['Ing. RAMS', 'PrEM'])
  })

  it('un entregable retirado se lleva sus firmas: no quedan huérfanas en la lista', async () => {
    if (pool === null) return
    const id = await withTransaction(pool, async (db) => {
      const nuevo = await createDocumentType(db, { code: unique('FIRMA'), name: 'Se retira' })
      await setSignatures(db, nuevo, [
        { step: 'author', position: 1, role: 'Ing. RAMS', standardMinutes: null },
      ])
      await softDeleteDocumentType(db, nuevo)
      return nuevo
    })

    const mias = (await withTransaction(pool, (db) => readSignatures(db))).filter(
      (firma) => firma.documentTypeId === id,
    )
    expect(mias).toEqual([])
  })
})
