/**
 * Las dos mitades de una hora real que viene por mes, de punta a punta.
 *
 * Lo que demuestra, y es la cadena entera que alguien recorre el primer día:
 *
 *   1. Se carga el export del fichaje. Las horas están, y no están en ninguna
 *      tarea: la conciliación dice «sin declarar».
 *   2. Se carga la declaración. Las horas caen en sus tareas y cuadra.
 *   3. Un reparto que no suma 100 % **no se aplica a medias**, y se dice.
 *   4. Un fichero mal escrito se rechaza entero, con la fila y el porqué.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPool, withTransaction, reconcileActuals, type Queryable } from '@planner/persistence'
import { importPlanCsv, ImportError } from './import-plan.js'
import { importMonthlyActualsCsv, importSplitsCsv } from './import-monthly.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)
const sufijo = `${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`
const PROY = `CAT-${sufijo}`
const QUIEN = `Persona ${sufijo}`

afterAll(async () => {
  if (pool !== null) {
    await withTransaction(pool, async (db) => {
      await db.query('DELETE FROM project WHERE code LIKE $1', ['CAT-%'])
      // Por el nombre exacto y no por un patrón: esta base la comparten varias
      // pruebas, y un LIKE «Persona %» se llevaría por delante a la de otra.
      await db.query('DELETE FROM resource WHERE display_name = $1', [QUIEN])
    })
  }
  await pool?.end()
})

const describeSiHayBase = pool === null ? describe.skip : describe

/**
 * Las filas que el importador rechaza, o un fallo si no rechazó ninguna.
 *
 * `ImportError.message` sólo dice «el fichero tiene filas que no se pueden
 * leer»; el porqué de cada una está en `rows`, que es lo que se le enseña a
 * quien cargó el fichero.
 */
async function problemasDe(accion: (db: Queryable) => Promise<unknown>): Promise<readonly string[]> {
  if (pool === null) return []
  try {
    await withTransaction(pool, accion)
  } catch (error) {
    if (error instanceof ImportError) return error.rows
    throw error
  }
  throw new Error('La importación no falló, y tenía que fallar')
}


let projectId = ''

beforeAll(async () => {
  if (pool === null) return
  await withTransaction(pool, async (db) => {
    await importPlanCsv(
      db,
      [
        'proyecto;nombre_proyecto;tarea;dias;recurso;no_antes_de',
        `${PROY};Proyecto del fichaje;Analizar;10;${QUIEN};2026-04-01`,
        `${PROY};;Documentar;10;${QUIEN};`,
      ].join('\n'),
    )
    const { rows } = await db.query<{ id: string }>('SELECT id FROM project WHERE code = $1', [PROY])
    projectId = rows[0]?.id ?? ''
  })
})

/**
 * Lo repartido de ESTE proyecto, y nada más.
 *
 * La conciliación mira la base entera, y la base de CI trae además los datos de
 * demostración —que desde ADR-0052 tienen horas de abril a propósito—. Sin este
 * filtro la prueba sumaba las de la demostración y fallaba sólo en CI, que es
 * la peor clase de prueba: la que pasa en tu máquina.
 */
const mias = <T extends { projectId: string; period: string }>(filas: readonly T[]): readonly T[] =>
  filas.filter((fila) => fila.projectId === projectId && fila.period === '2026-04')

describeSiHayBase('las horas del mes y su reparto', () => {
  it('sin declaración, las horas están y no están en ninguna tarea', async () => {
    if (pool === null) return
    const resumen = await withTransaction(pool, (db) =>
      importMonthlyActualsCsv(
        db,
        ['proyecto;persona;mes;horas', `${PROY};${QUIEN};2026-04;40`].join('\n'),
      ),
    )
    expect(resumen.saved).toBe(1)
    expect(resumen.minutes).toBe(2400)

    const { reparto } = await withTransaction(pool, (db) =>
      reconcileActuals(db, '2026-04-01', '2026-04-30'),
    )
    const mios = mias(reparto.descuadres)
    expect(mios[0]?.motivo).toBe('sin-declarar')
    expect(mios[0]?.minutes).toBe(2400)
  })

  it('con la declaración, las horas caen en sus tareas y cuadra', async () => {
    if (pool === null) return
    const resumen = await withTransaction(pool, (db) =>
      importSplitsCsv(
        db,
        [
          'proyecto;persona;mes;tarea;porcentaje',
          `${PROY};${QUIEN};2026-04;Analizar;60`,
          `${PROY};${QUIEN};2026-04;Documentar;40`,
        ].join('\n'),
      ),
    )
    expect(resumen.saved).toBe(2)
    expect(resumen.months).toBe(1)
    expect(resumen.notHundred).toEqual([])

    const { reparto } = await withTransaction(pool, (db) =>
      reconcileActuals(db, '2026-04-01', '2026-04-30'),
    )
    const repartidas = mias(reparto.allocated)
    const total = repartidas.reduce((suma, f) => suma + f.actualMinutes, 0)
    expect(total).toBe(2400)
    expect(repartidas.map((f) => f.actualMinutes).sort((a, b) => a - b)).toEqual([960, 1440])
  })

  it('un reparto que no suma 100 % se guarda, se avisa y NO se aplica', async () => {
    if (pool === null) return
    const resumen = await withTransaction(pool, (db) =>
      importSplitsCsv(
        db,
        ['proyecto;persona;mes;tarea;porcentaje', `${PROY};${QUIEN};2026-04;Analizar;60`].join('\n'),
      ),
    )
    // Se guarda: el fichero puede traer sólo una parte y el resto llegar luego.
    expect(resumen.saved).toBe(1)
    expect(resumen.notHundred).toHaveLength(1)

    const { reparto } = await withTransaction(pool, (db) =>
      reconcileActuals(db, '2026-04-01', '2026-04-30'),
    )
    // Y no se aplica a medias: las 40 h enteras se quedan fuera, con su motivo.
    expect(mias(reparto.allocated)).toEqual([])
    const mio = mias(reparto.descuadres)[0]
    expect(mio?.motivo).toBe('no-suma-cien')
    expect(mio?.minutes).toBe(2400)
    expect(mio?.declaredBp).toBe(6000)
  })

  it('un mes mal escrito se rechaza entero, con la fila y el porqué', async () => {
    if (pool === null) return
    await expect(
      withTransaction(pool, (db) =>
        importMonthlyActualsCsv(
          db,
          ['proyecto;persona;mes;horas', `${PROY};${QUIEN};abril;40`].join('\n'),
        ),
      ),
    ).rejects.toThrow(ImportError)
  })

  it('una persona que no está en el equipo no se crea desde un parte de horas', async () => {
    if (pool === null) return
    // El porqué va en `rows`, con su número de fila: es lo que ve quien cargó
    // el fichero, y es donde tiene que decir qué arreglar.
    const filas = await problemasDe((db) =>
      importMonthlyActualsCsv(
        db,
        ['proyecto;persona;mes;horas', `${PROY};Nadie de verdad;2026-04;40`].join('\n'),
      ),
    )
    expect(filas.join('\n')).toMatch(/Fila 2: «Nadie de verdad» no está en el equipo/)
  })

  it('una tarea que no existe en ese proyecto se dice por su nombre', async () => {
    if (pool === null) return
    const filas = await problemasDe((db) =>
      importSplitsCsv(
        db,
        ['proyecto;persona;mes;tarea;porcentaje', `${PROY};${QUIEN};2026-04;Inventada;100`].join('\n'),
      ),
    )
    expect(filas.join('\n')).toMatch(/no hay ninguna tarea «Inventada»/)
  })
})
