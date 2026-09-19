/**
 * La copia de seguridad, contra PostgreSQL de verdad.
 *
 * Esto no se puede probar con dobles. Lo que hay que demostrar es que una base
 * entera sale y vuelve a entrar **exactamente igual**, y eso depende de las
 * claves ajenas reales, de los disparadores reales y de los tipos reales. Una
 * prueba con datos inventados en memoria diría que sí y la base diría que no.
 *
 * La comprobación que manda es la última: **la huella de entrada del cálculo
 * antes y después de la vuelta tiene que ser la misma**. Si una sola fila se
 * perdió o cambió, la huella cambia. Es el principio P2 puesto a trabajar.
 */

import { afterAll, describe, expect, it } from 'vitest'
import {
  createPool, withTransaction, tablasEnOrden, volcarTabla, columnasDe, SE_RECALCULAN,
} from '@planner/persistence'
import { abrirCopia, CopiaInvalida, exportarCopia, importarCopia } from './backup.js'
import { leerZip, crearZip } from './zip.js'
import { seedDemoData } from './demo-data.js'
import { calculate, defaultScenarioId } from './engine.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)
const INSTANTE = new Date('2026-09-20T12:00:00Z')
// Los códigos llevan sufijo: estas pruebas corren contra una base que no se
// vacía entre veces, y un código fijo choca consigo mismo a la segunda.
const SUFIJO = `${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`

afterAll(async () => { await pool?.end() })

const describeSiHayBase = pool === null ? describe.skip : describe

/** La huella de entrada de una ejecución: lo que prueba que la vuelta fue fiel. */
async function huellaDe(runId: string): Promise<string> {
  if (pool === null) throw new Error('sin base')
  const { rows } = await pool.query<{ input_hash: string }>(
    'SELECT input_hash FROM calculation_run WHERE id = $1', [runId],
  )
  return rows[0]?.input_hash ?? ''
}

/** Una foto de la base entera, para comparar antes y después. */
async function foto(): Promise<Map<string, unknown[]>> {
  if (pool === null) throw new Error('sin base')
  return withTransaction(pool, async (db) => {
    const instantanea = new Map<string, unknown[]>()
    for (const tabla of await tablasEnOrden(db)) {
      // El historial crece con la propia restauración, así que compararlo sería
      // comparar el termómetro con la fiebre. Y la zona derivada está vacía
      // hasta que se recalcula: lo que demuestra que volvió bien no es que sus
      // filas coincidan, es que la huella del cálculo coincida.
      if (tabla === 'change_event' || SE_RECALCULAN.has(tabla)) continue
      instantanea.set(tabla, [...(await volcarTabla(db, tabla, await columnasDe(db, tabla)))])
    }
    return instantanea
  })
}

describeSiHayBase('la copia de seguridad', () => {
  it('da la vuelta entera: la base sale, entra y queda igual', async () => {
    if (pool === null) return
    await withTransaction(pool, (db) => seedDemoData(db))
    const escenario = await withTransaction(pool, (db) => defaultScenarioId(db))
    const antesDelCalculo = await huellaDe(
      (await calculate(pool, escenario, 'antes de la copia')).runId,
    )
    const antes = await foto()

    const copia = await withTransaction(pool, (db) => exportarCopia(db, { instante: INSTANTE }))
    expect(copia.zip.length).toBeGreaterThan(0)

    const resultado = await withTransaction(
      pool, (db) => importarCopia(db, copia.zip, 'prueba de ida y vuelta'),
    )
    expect(resultado.filas).toBeGreaterThan(0)
    // `change_event` se salta a propósito: el historial no se reescribe.
    expect(resultado.saltadas.map((s) => s.tabla)).toContain('change_event')

    const despues = await foto()
    expect([...despues.keys()].sort()).toEqual([...antes.keys()].sort())
    for (const [tabla, filas] of antes) {
      expect(despues.get(tabla), tabla).toEqual(filas)
    }

    // Y la prueba de fuego: recalcular tiene que dar la MISMA huella.
    const despuesDelCalculo = await huellaDe(
      (await calculate(pool, escenario, 'después de restaurar')).runId,
    )
    expect(despuesDelCalculo).toBe(antesDelCalculo)
    expect(despuesDelCalculo).not.toBe('')
  })

  it('un texto con espacios, almohadilla o comillas vuelve tal cual', async () => {
    if (pool === null) return
    // Esta prueba existe por un defecto medido: el parser de CSV recortaba los
    // espacios de todo valor. Al importar está bien; al restaurar es corromper
    // el dato en silencio, porque nada falla — el nombre vuelve distinto y ya.
    const RAROS = [
      '  Proyecto con espacios  ',
      '#3 Revisión de concepto',
      'Con "comillas" y ; punto y coma',
      'Acentos áéíóú ñ «» —',
    ]
    const ids = await withTransaction(pool, async (db) => {
      const puestos: string[] = []
      for (const [indice, nombre] of RAROS.entries()) {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO project (code, name, status, status_start)
           VALUES ($1, $2, 'activo', DATE '2026-01-01') RETURNING id`,
          [`RARO-${SUFIJO}-${String(indice)}`, nombre],
        )
        puestos.push(rows[0]?.id ?? '')
      }
      return puestos
    })

    const copia = await withTransaction(pool, (db) => exportarCopia(db, { instante: INSTANTE }))
    await withTransaction(pool, (db) => importarCopia(db, copia.zip, 'prueba de textos raros'))

    const vueltos = await withTransaction(pool, (db) =>
      db.query<{ id: string; name: string }>(
        'SELECT id, name FROM project WHERE id = ANY($1) ORDER BY code', [ids],
      ),
    )
    expect(vueltos.rows.map((f) => f.name)).toEqual(RAROS)
  })

  it('el zip se puede leer entero sin la herramienta', async () => {
    if (pool === null) return
    const copia = await withTransaction(pool, (db) => exportarCopia(db, { instante: INSTANTE }))
    const dentro = leerZip(copia.zip)

    // Lo primero que se ve al abrirlo tiene que explicar qué es.
    const leeme = dentro.get('LEEME.txt')?.toString('utf8') ?? ''
    expect(leeme).toContain('COPIA DE SEGURIDAD')
    expect(leeme).toContain('Huella de entrada')
    expect(leeme).toContain('Restaurar BORRA todo')

    // Y cada CSV tiene que abrirse en Excel: BOM, punto y coma, CRLF.
    const calendarios = dentro.get('tablas/calendar.csv')?.toString('utf8') ?? ''
    expect(calendarios.charCodeAt(0)).toBe(0xfeff)
    expect(calendarios.split('\r\n')[0]).toContain(';')

    // Las sumas declaradas tienen que cuadrar de verdad, una por una.
    const { createHash } = await import('node:crypto')
    const sumas = dentro.get('sha256sums.txt')?.toString('utf8') ?? ''
    let comprobadas = 0
    for (const linea of sumas.split('\n').filter((l) => l.trim() !== '')) {
      const [declarada, ruta] = [linea.slice(0, 64), linea.slice(66).trim()]
      const contenido = dentro.get(ruta)
      expect(contenido, ruta).toBeDefined()
      expect(createHash('sha256').update(contenido as Buffer).digest('hex'), ruta).toBe(declarada)
      comprobadas += 1
    }
    expect(comprobadas).toBeGreaterThan(10)
  })

  it('no se lleva las contraseñas', async () => {
    if (pool === null) return
    const copia = await withTransaction(pool, (db) => exportarCopia(db, { instante: INSTANTE }))
    const usuarios = leerZip(copia.zip).get('tablas/app_user.csv')?.toString('utf8') ?? ''
    expect(usuarios).not.toContain('password_hash')
    // Y las sesiones no salen en absoluto: una sesión abierta es una llave.
    expect(leerZip(copia.zip).has('tablas/user_session.csv')).toBe(false)
  })

  it('una copia tocada por dentro no se restaura', async () => {
    if (pool === null) return
    const copia = await withTransaction(pool, (db) => exportarCopia(db, { instante: INSTANTE }))
    const dentro = new Map(leerZip(copia.zip))
    // Se cambia un CSV y se deja la suma vieja, que es justo lo que pasaría si
    // alguien editara la copia a mano para colar algo.
    dentro.set('tablas/project.csv', Buffer.from('﻿id;code\r\n', 'utf8'))
    const manipulada = crearZip(
      [...dentro].map(([path, data]) => ({ path, data })), INSTANTE,
    )
    await expect(
      withTransaction(pool, (db) => abrirCopia(db, manipulada)),
    ).rejects.toThrow(CopiaInvalida)
  })

  it('una copia a la que le falta una tabla no se restaura', async () => {
    if (pool === null) return
    const copia = await withTransaction(pool, (db) => exportarCopia(db, { instante: INSTANTE }))
    const dentro = [...leerZip(copia.zip)].filter(([ruta]) => ruta !== 'tablas/project.csv')
    const coja = crearZip(dentro.map(([path, data]) => ({ path, data })), INSTANTE)
    await expect(
      withTransaction(pool, (db) => abrirCopia(db, coja)),
    ).rejects.toThrow(/nombra|faltan/)
  })

  it('un fichero colado sin suma declarada no entra', async () => {
    if (pool === null) return
    // El hueco que esto tapa: bastaba añadir un CSV al zip y nombrarlo en el
    // manifiesto sin ponerle suma para que entrase sin comprobar. Una copia
    // existe para poder demostrar que nadie la tocó; media comprobación no
    // demuestra nada.
    const copia = await withTransaction(pool, (db) => exportarCopia(db, { instante: INSTANTE }))
    const dentro = new Map(leerZip(copia.zip))
    dentro.set('tablas/colado.csv', Buffer.from('\uFEFFid\r\n', 'utf8'))
    const colada = crearZip([...dentro].map(([path, data]) => ({ path, data })), INSTANTE)
    await expect(
      withTransaction(pool, (db) => abrirCopia(db, colada)),
    ).rejects.toThrow(/suma declarada/)
  })

  it('una copia sin LEEME no entra, porque ahí va la versión del esquema', async () => {
    if (pool === null) return
    // Sin esto, un zip con manifiesto y sin LEEME se saltaba la comprobación de
    // versión entera: una copia de otro esquema entraba sin decir nada y dejaba
    // la base mal de una forma que no se ve.
    const copia = await withTransaction(pool, (db) => exportarCopia(db, { instante: INSTANTE }))
    const dentro = [...leerZip(copia.zip)].filter(([ruta]) => ruta !== 'LEEME.txt')
    const muda = crearZip(dentro.map(([path, data]) => ({ path, data })), INSTANTE)
    await expect(
      withTransaction(pool, (db) => abrirCopia(db, muda)),
    ).rejects.toThrow(/LEEME/)
  })

  it('lo que no es una copia se rechaza sin tocar nada', async () => {
    if (pool === null) return
    const antes = await foto()
    await expect(
      withTransaction(pool, (db) => importarCopia(db, Buffer.from('hola'), 'prueba')),
    ).rejects.toThrow(CopiaInvalida)
    expect(await foto()).toEqual(antes)
  })
})
