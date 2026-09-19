/**
 * La Checkliste cargada desde CSV, contra PostgreSQL de verdad.
 *
 * Lo que una prueba en memoria no puede comprobar y aquí sí: que **volver a
 * cargar el mismo fichero deja el mismo cuestionario** —que es lo que decide si
 * se puede mantener desde una hoja de cálculo o no—, que quitar una fila quita
 * de verdad esa puerta, y que un entregable que la hoja nombra y el catálogo no
 * tiene avisa en vez de tumbar las otras doscientas filas.
 */

import { afterAll, describe, expect, it } from 'vitest'
import {
  createPool,
  readGateQueries,
  withTransaction,
} from '@planner/persistence'
import { importChecklistCsv } from './import-checklist.js'
import { ImportError } from './import-plan.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

const unico = (prefijo: string): string =>
  `${prefijo}-${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`

/**
 * Una disciplina por prueba.
 *
 * No es manía de aislamiento: `sort_key` se asigna por importación, así que dos
 * ficheros cargados en la MISMA disciplina interleavan sus órdenes. Eso es
 * correcto —una Checkliste es una hoja y se carga entera— pero convierte una
 * prueba que comprueba el orden en una que depende de las anteriores.
 */
const disciplinas: string[] = []
const nuevaDisciplina = (): string => {
  const nombre = unico('prueba')
  disciplinas.push(nombre)
  return nombre
}
const codigoDoc = unico('CHK')

afterAll(async () => {
  if (pool !== null) {
    await withTransaction(pool, async (db) => {
      await db.query('DELETE FROM gate_query WHERE discipline = ANY($1::text[])', [disciplinas])
      await db.query('DELETE FROM document_type WHERE code = $1', [codigoDoc])
    })
  }
  await pool?.end()
})

const describeSiHayBase = pool === null ? describe.skip : describe

const csv = (filas: readonly string[]): string =>
  ['disciplina;codigo;capitulo;capitulo_nombre;pregunta;puerta;nivel;prueba;entregables', ...filas].join(
    '\n',
  )

async function catalogo(): Promise<void> {
  if (pool === null) return
  await withTransaction(pool, async (db) => {
    await db.query(
      `INSERT INTO document_type (code, name, gate) VALUES ($1, 'FMECA de prueba', 'CGR')
       ON CONFLICT DO NOTHING`,
      [codigoDoc],
    )
  })
}

async function importa(filas: readonly string[]): ReturnType<typeof importChecklistCsv> {
  if (pool === null) throw new Error('sin base')
  return withTransaction(pool, (db) => importChecklistCsv(db, csv(filas)))
}

const consultas = async (
  disciplina: string,
): Promise<Awaited<ReturnType<typeof readGateQueries>>> => {
  if (pool === null) return []
  return withTransaction(pool, (db) => readGateQueries(db, disciplina))
}

describeSiHayBase('la Checkliste desde CSV', () => {
  it('una consulta en dos puertas se carga como UNA consulta con dos puertas', async () => {
    if (pool === null) return
    await catalogo()
    const disciplina = nuevaDisciplina()
    const resumen = await importa([
      `${disciplina};3.5;3;Demostración;¿Está emitido el FMECA?;IGR;R;Versión inicial.;${codigoDoc}@preliminar`,
      `${disciplina};3.5;3;Demostración;;CGR;M;Versión final.;${codigoDoc}`,
    ])
    expect(resumen.queries).toBe(1)
    expect(resumen.gates).toBe(2)
    // Dos entregables: el preliminar y el final son dos casillas distintas.
    expect(resumen.links).toBe(2)
    expect(resumen.gateNames).toEqual(['CGR', 'IGR'])

    const leidas = await consultas(disciplina)
    expect(leidas).toHaveLength(1)
    expect(leidas[0]?.question).toBe('¿Está emitido el FMECA?')
    expect(leidas[0]?.gates.map((g) => `${g.gate}:${g.level}`).sort()).toEqual(['CGR:M', 'IGR:R'])
  })

  it('volver a cargar el mismo fichero deja el mismo cuestionario, no el doble', async () => {
    if (pool === null) return
    await catalogo()
    const disciplina = nuevaDisciplina()
    const filas = [
      `${disciplina};1.7;1;Requisitos;¿El Hazard Log está al día?;CGR;M;;`,
      `${disciplina};3.5;3;Demostración;¿Está emitido el FMECA?;CGR;M;;${codigoDoc}`,
    ]
    await importa(filas)
    const segunda = await importa(filas)
    expect(segunda.created).toBe(0)
    expect(segunda.updated).toBe(2)
    expect((await consultas(disciplina)).length).toBe(2)
  })

  it('quitar una fila quita esa puerta: la lista es completa, no una añadidura', async () => {
    if (pool === null) return
    await catalogo()
    const disciplina = nuevaDisciplina()
    await importa([
      `${disciplina};9.1;9;Prueba;¿Pregunta de prueba?;IGR;R;;`,
      `${disciplina};9.1;9;Prueba;;CGR;M;;`,
    ])
    await importa([`${disciplina};9.1;9;Prueba;¿Pregunta de prueba?;CGR;M;;`])
    const leidas = await consultas(disciplina)
    const nueve = leidas.find((consulta) => consulta.code === '9.1')
    expect(nueve?.gates.map((g) => g.gate)).toEqual(['CGR'])
  })

  it('una consulta sin entregables es la que contesta una persona, y se cuenta', async () => {
    if (pool === null) return
    await catalogo()
    const disciplina = nuevaDisciplina()
    const resumen = await importa([
      `${disciplina};0.2;0;Progreso;¿La carga va con el presupuesto?;CGR;HR;;`,
      `${disciplina};3.5;3;Demostración;¿Está emitido el FMECA?;CGR;M;;${codigoDoc}`,
    ])
    expect(resumen.humanOnly).toBe(1)
  })

  it('un entregable que no está en el catálogo avisa y no tumba el fichero', async () => {
    if (pool === null) return
    await catalogo()
    const disciplina = nuevaDisciplina()
    const resumen = await importa([
      `${disciplina};4.4;4;Proveedores;¿Están los requisitos en la TPS?;CGR;M;;NO-EXISTE-ESTE`,
      `${disciplina};3.5;3;Demostración;¿Está emitido el FMECA?;CGR;M;;${codigoDoc}`,
    ])
    expect(resumen.queries).toBe(2)
    expect(resumen.warnings.some((aviso) => aviso.includes('NO-EXISTE-ESTE'))).toBe(true)
    // La otra consulta sí queda enlazada: un nombre malo no contamina el resto.
    expect(resumen.links).toBe(1)
  })

  it('un nivel que no existe rechaza el fichero, con la fila', async () => {
    if (pool === null) return
    const disciplina = nuevaDisciplina()
    await expect(
      importa([`${disciplina};5.1;5;V&V;¿Hay pruebas de tipo?;CGR;OBLIGATORIO;;`]),
    ).rejects.toThrow(ImportError)
  })

  it('las consultas salen en el orden del fichero, que es el del cuestionario', async () => {
    if (pool === null) return
    await catalogo()
    const disciplina = nuevaDisciplina()
    await importa([
      `${disciplina};0.1;0;Progreso;¿Están cerradas las acciones?;CGR;M;;`,
      `${disciplina};3.5;3;Demostración;¿Está emitido el FMECA?;CGR;M;;${codigoDoc}`,
      `${disciplina};1.7;1;Requisitos;¿El Hazard Log está al día?;CGR;M;;`,
    ])
    const leidas = await consultas(disciplina)
    expect(leidas.map((consulta) => consulta.code)).toEqual(['0.1', '3.5', '1.7'])
  })

  it('dos preguntas distintas para el mismo código avisan, y manda la primera', async () => {
    if (pool === null) return
    await catalogo()
    const disciplina = nuevaDisciplina()
    const resumen = await importa([
      `${disciplina};7.1;7;QCD;¿Hay problemas de calidad?;IGR;R;;`,
      `${disciplina};7.1;7;QCD;¿Hay problemas de coste?;CGR;R;;`,
    ])
    expect(resumen.warnings.some((aviso) => aviso.includes('7.1'))).toBe(true)
    const siete = (await consultas(disciplina)).find((consulta) => consulta.code === '7.1')
    expect(siete?.question).toBe('¿Hay problemas de calidad?')
  })
})
