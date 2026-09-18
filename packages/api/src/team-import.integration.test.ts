/**
 * El equipo que entra por CSV, contra PostgreSQL de verdad.
 *
 * Lo que una prueba sin base no puede comprobar y aquí sí: que cargar dos veces
 * el mismo fichero deje el equipo igual que cargarlo una vez, que las
 * competencias que no vienen se quiten de verdad, y que una tarifa que pisa a
 * otra no reviente la importación entera sino que salga como aviso — el
 * `EXCLUDE` del esquema es lo único que impide dos tarifas solapadas, y qué
 * pasa cuando salta no se puede saber sin que salte.
 */

import { afterAll, describe, expect, it } from 'vitest'
import {
  createPool,
  readResourceDetails,
  readSkillMatrix,
  withTransaction,
} from '@planner/persistence'
import { importTeamCsv } from './import-team.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

const sufijo = `${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`
const cod = (n: string): string => `EQ-${n}-${sufijo}`

afterAll(async () => {
  if (pool !== null) {
    await withTransaction(pool, async (db) => {
      await db.query('DELETE FROM resource WHERE code LIKE $1', [`EQ-%-${sufijo}`])
      await db.query('DELETE FROM skill WHERE name LIKE $1', [`Competencia ${sufijo}%`])
    })
  }
  await pool?.end()
})

const describeSiHayBase = pool === null ? describe.skip : describe

const CABECERA =
  'codigo;nombre;calendario;jornada;indirecto;reserva;alta;baja;competencias;tarifa;tarifa_desde;tarifa_hasta'

const importa = async (...filas: readonly string[]): ReturnType<typeof importTeamCsv> => {
  if (pool === null) throw new Error('sin base')
  return withTransaction(pool, (db) => importTeamCsv(db, [CABECERA, ...filas].join('\n')))
}

const ficha = async (codigo: string): Promise<Awaited<ReturnType<typeof readResourceDetails>>[number]> => {
  if (pool === null) throw new Error('sin base')
  const equipo = await withTransaction(pool, (db) => readResourceDetails(db))
  const persona = equipo.find((r) => r.code === codigo)
  if (persona === undefined) throw new Error(`no está ${codigo}`)
  return persona
}

describeSiHayBase('el equipo que entra por CSV', () => {
  it('da de alta y, al repetir el fichero, actualiza en vez de duplicar', async () => {
    if (pool === null) return
    const codigo = cod('A')
    const fila = `${codigo};Persona inventada;;80;15;10;2026-01-01;;;;;`

    const primera = await importa(fila)
    expect(primera.created).toBe(1)
    expect(primera.updated).toBe(0)

    const segunda = await importa(fila)
    expect(segunda.created).toBe(0)
    expect(segunda.updated).toBe(1)

    const persona = await ficha(codigo)
    expect(persona.maxUnitsBp).toBe(8_000)
    expect(persona.indirectBp).toBe(1_500)
    expect(persona.activeFrom).toBe('2026-01-01')
  })

  it('crea las competencias que no existen y quita las que dejan de venir', async () => {
    if (pool === null) return
    const codigo = cod('B')
    const una = `Competencia ${sufijo} una`
    const otra = `Competencia ${sufijo} otra`

    const primera = await importa(`${codigo};Persona inventada;;;;;;;${una}:4|${otra}:2;;;`)
    expect(primera.skillsCreated).toBe(2)
    expect(primera.skillsSet).toBe(2)

    const nivelesDe = async (): Promise<readonly number[]> => {
      const persona = await ficha(codigo)
      const matriz = await withTransaction(pool, (db) => readSkillMatrix(db))
      return matriz.resourceSkills
        .filter((rs) => rs.resourceId === persona.id)
        .map((rs) => rs.level)
        .sort()
    }
    expect(await nivelesDe()).toEqual([2, 4])

    // La casilla es la lista COMPLETA: la que no viene se le quita.
    const segunda = await importa(`${codigo};Persona inventada;;;;;;;${una}:5;;;`)
    expect(segunda.skillsCreated).toBe(0)
    expect(await nivelesDe()).toEqual([5])

    // Y la casilla vacía dice «no sabe nada»: se le quitan todas.
    await importa(`${codigo};Persona inventada;;;;;;;;;;`)
    expect(await nivelesDe()).toEqual([])
  })

  it('la columna ausente no toca las competencias que ya tenía', async () => {
    if (pool === null) return
    const codigo = cod('C')
    const una = `Competencia ${sufijo} tres`
    await importa(`${codigo};Persona inventada;;;;;;;${una}:3;;;`)

    await withTransaction(pool, (db) =>
      importTeamCsv(db, ['codigo;nombre', `${codigo};Persona renombrada`].join('\n')),
    )

    const persona = await ficha(codigo)
    expect(persona.displayName).toBe('Persona renombrada')
    const matriz = await withTransaction(pool, (db) => readSkillMatrix(db))
    expect(matriz.resourceSkills.filter((rs) => rs.resourceId === persona.id)).toHaveLength(1)
  })

  it('una tarifa idéntica no se duplica y una que pisa sale como aviso', async () => {
    if (pool === null) return
    const codigo = cod('D')
    const conTarifa = `${codigo};Persona inventada;;;;;;;;78,50;2026-01-01;2026-12-31`

    const primera = await importa(conTarifa)
    expect(primera.rates).toBe(1)

    // El mismo tramo con el mismo importe: no hay nada que añadir.
    const segunda = await importa(conTarifa)
    expect(segunda.rates).toBe(0)
    expect(segunda.warnings).toEqual([])

    // Un tramo que se pisa con otro importe es una decisión que no toma esto.
    const tercera = await importa(`${codigo};Persona inventada;;;;;;;;90,00;2026-06-01;2027-06-01`)
    expect(tercera.rates).toBe(0)
    expect(tercera.warnings.join(' ')).toContain('se pisa')

    const persona = await ficha(codigo)
    expect(persona.costRates).toHaveLength(1)
    expect(persona.costRates[0]?.standardCentsHour).toBe(7_850)
  })

  it('un calendario que no existe se avisa, y la persona entra igual', async () => {
    if (pool === null) return
    const codigo = cod('E')
    const resultado = await importa(`${codigo};Persona inventada;Calendario que no existe;;;;;;;;;`)
    expect(resultado.created).toBe(1)
    expect(resultado.warnings.join(' ')).toContain('Calendario que no existe')
    expect((await ficha(codigo)).calendarId).toBeNull()
  })
})
