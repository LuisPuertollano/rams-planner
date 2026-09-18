/**
 * Las subactividades contra PostgreSQL de verdad.
 *
 * Lo que se comprueba aquí es lo que una prueba en memoria no puede: que el
 * orden que devuelve la base sea el de la cadena y no el de inserción, que el
 * enganche con la firma aguante guardar el ciclo otra vez, y que una
 * subactividad que apunta a una firma que no existe se guarde sin ella en vez
 * de reventar la transacción entera.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { createPool, withTransaction } from './db.js'
import {
  createDocumentType,
  readActivities,
  setActivities,
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

const CICLO = [
  { step: 'author', position: 1, role: 'Ing. RAMS', standardMinutes: 2400 },
  { step: 'verifier', position: 1, role: 'Ing. Sistemas', standardMinutes: 600 },
  { step: 'approver', position: 1, role: 'PrEM', standardMinutes: 180 },
] as const

describe.skipIf(pool === null)('subactividades', () => {
  it('se escriben, se leen en el orden de la cadena y no en el de inserción', async () => {
    if (pool === null) return
    const id = await withTransaction(pool, async (db) => {
      const nuevo = await createDocumentType(db, { code: unique('SUB'), name: 'Con cadena' })
      // A propósito al revés: el soporte primero, la creación al final.
      await setActivities(db, nuevo, [
        { step: 'support', position: 1, role: 'TL RAMS', standardMinutes: 6000, signature: null },
        { step: 'review_2', position: 1, role: 'SYS', standardMinutes: 240, signature: null },
        { step: 'review_1', position: 1, role: 'TL RAMS', standardMinutes: 600, signature: null },
        { step: 'create', position: 1, role: 'S-Eng', standardMinutes: 2400, signature: null },
      ])
      return nuevo
    })

    const todas = await withTransaction(pool, (db) => readActivities(db))
    const mias = todas.filter((actividad) => actividad.documentTypeId === id)
    expect(mias.map((actividad) => actividad.step)).toEqual([
      'create',
      'review_1',
      'review_2',
      'support',
    ])
    expect(mias[0]?.role).toBe('S-Eng')
    expect(mias[0]?.standardMinutes).toBe(2400)
  })

  it('volver a guardar sustituye la lista entera, no la acumula', async () => {
    if (pool === null) return
    const id = await withTransaction(pool, async (db) => {
      const nuevo = await createDocumentType(db, { code: unique('SUB'), name: 'Que cambia' })
      await setActivities(db, nuevo, [
        { step: 'create', position: 1, role: 'S-Eng', standardMinutes: 2400, signature: null },
        { step: 'review_1', position: 1, role: 'TL RAMS', standardMinutes: 600, signature: null },
      ])
      // Se corrige el fichero y se vuelve a cargar: la revisión desaparece.
      await setActivities(db, nuevo, [
        { step: 'create', position: 1, role: 'R-Eng', standardMinutes: 3000, signature: null },
      ])
      return nuevo
    })

    const mias = (await withTransaction(pool, (db) => readActivities(db))).filter(
      (actividad) => actividad.documentTypeId === id,
    )
    expect(mias).toHaveLength(1)
    expect(mias[0]?.role).toBe('R-Eng')
    expect(mias[0]?.standardMinutes).toBe(3000)
  })

  it('la firma que descarga se guarda y se lee entera', async () => {
    if (pool === null) return
    const id = await withTransaction(pool, async (db) => {
      const nuevo = await createDocumentType(db, { code: unique('SUB'), name: 'Que firma' })
      await setSignatures(db, nuevo, CICLO)
      await setActivities(db, nuevo, [
        {
          step: 'create',
          position: 1,
          role: 'Ing. RAMS',
          standardMinutes: 2400,
          signature: { step: 'author', position: 1 },
        },
        {
          step: 'review_1',
          position: 1,
          role: 'Ing. Sistemas',
          standardMinutes: 600,
          signature: { step: 'verifier', position: 1 },
        },
      ])
      return nuevo
    })

    const mias = (await withTransaction(pool, (db) => readActivities(db))).filter(
      (actividad) => actividad.documentTypeId === id,
    )
    expect(mias.map((actividad) => actividad.signature)).toEqual([
      { step: 'author', position: 1 },
      { step: 'verifier', position: 1 },
    ])
  })

  it('guardar el ciclo otra vez NO desengancha las subactividades', async () => {
    if (pool === null) return
    // Esta es la prueba por la que `setSignatures` dejó de ser un DELETE
    // entero seguido de un INSERT: borrar una firma que va a volver a existir
    // un milisegundo después dejaba a la subactividad apuntando a nada, en
    // silencio, y guardar el ciclo sin tocarlo no puede desenganchar nada.
    const id = await withTransaction(pool, async (db) => {
      const nuevo = await createDocumentType(db, { code: unique('SUB'), name: 'Que aguanta' })
      await setSignatures(db, nuevo, CICLO)
      await setActivities(db, nuevo, [
        {
          step: 'review_1',
          position: 1,
          role: 'Ing. Sistemas',
          standardMinutes: 600,
          signature: { step: 'verifier', position: 1 },
        },
      ])
      // Se vuelve a guardar el ciclo cambiando sólo los minutos del aprobador.
      await setSignatures(db, nuevo, [
        ...CICLO.slice(0, 2),
        { step: 'approver', position: 1, role: 'PrEM', standardMinutes: 240 },
      ])
      return nuevo
    })

    const mias = (await withTransaction(pool, (db) => readActivities(db))).filter(
      (actividad) => actividad.documentTypeId === id,
    )
    expect(mias[0]?.signature).toEqual({ step: 'verifier', position: 1 })
  })

  it('una firma que se quita de verdad sí desengancha, y no borra la subactividad', async () => {
    if (pool === null) return
    const id = await withTransaction(pool, async (db) => {
      const nuevo = await createDocumentType(db, { code: unique('SUB'), name: 'Que pierde firma' })
      await setSignatures(db, nuevo, CICLO)
      await setActivities(db, nuevo, [
        {
          step: 'review_1',
          position: 1,
          role: 'Ing. Sistemas',
          standardMinutes: 600,
          signature: { step: 'verifier', position: 1 },
        },
      ])
      // El verificador desaparece del ciclo. El trabajo de revisar sigue
      // existiendo —600 minutos de alguien— y lo que se pierde es la firma.
      await setSignatures(db, nuevo, [CICLO[0], CICLO[2]])
      return nuevo
    })

    const mias = (await withTransaction(pool, (db) => readActivities(db))).filter(
      (actividad) => actividad.documentTypeId === id,
    )
    expect(mias).toHaveLength(1)
    expect(mias[0]?.standardMinutes).toBe(600)
    expect(mias[0]?.signature).toBeNull()
  })

  it('apuntar a una firma que no existe guarda la subactividad sin firma', async () => {
    if (pool === null) return
    // El catálogo se llena en dos pantallas y en cualquier orden. Negarse a
    // guardar el trabajo porque la firma todavía no está declarada obligaría a
    // rellenarlas en un orden que nadie ha pedido.
    const id = await withTransaction(pool, async (db) => {
      const nuevo = await createDocumentType(db, { code: unique('SUB'), name: 'Sin ciclo aún' })
      await setActivities(db, nuevo, [
        {
          step: 'create',
          position: 1,
          role: 'S-Eng',
          standardMinutes: 2400,
          signature: { step: 'author', position: 1 },
        },
      ])
      return nuevo
    })

    const mias = (await withTransaction(pool, (db) => readActivities(db))).filter(
      (actividad) => actividad.documentTypeId === id,
    )
    expect(mias).toHaveLength(1)
    expect(mias[0]?.signature).toBeNull()
  })

  it('retirar el entregable se lleva sus subactividades por delante', async () => {
    if (pool === null) return
    const id = await withTransaction(pool, async (db) => {
      const nuevo = await createDocumentType(db, { code: unique('SUB'), name: 'Que se retira' })
      await setActivities(db, nuevo, [
        { step: 'create', position: 1, role: 'S-Eng', standardMinutes: 2400, signature: null },
      ])
      await softDeleteDocumentType(db, nuevo)
      return nuevo
    })

    const todas = await withTransaction(pool, (db) => readActivities(db))
    expect(todas.filter((actividad) => actividad.documentTypeId === id)).toEqual([])
  })

  it('un rol en blanco no es una subactividad y no se guarda', async () => {
    if (pool === null) return
    const id = await withTransaction(pool, async (db) => {
      const nuevo = await createDocumentType(db, { code: unique('SUB'), name: 'Con hueco' })
      await setActivities(db, nuevo, [
        { step: 'create', position: 1, role: 'S-Eng', standardMinutes: 2400, signature: null },
        { step: 'review_1', position: 1, role: '   ', standardMinutes: 600, signature: null },
      ])
      return nuevo
    })

    const mias = (await withTransaction(pool, (db) => readActivities(db))).filter(
      (actividad) => actividad.documentTypeId === id,
    )
    expect(mias.map((actividad) => actividad.step)).toEqual(['create'])
  })
})
