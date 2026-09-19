/**
 * Planificar hacia atrás, de punta a punta y contra PostgreSQL.
 *
 * La prueba de unidad demuestra que el motor ancla donde debe. Ésta demuestra
 * lo que le importa a quien planifica: que **la cadena entera** —importar el
 * catálogo, poner las fechas de las puertas, calcular la fecha objetivo de cada
 * tarea y cambiar el modo del proyecto— produce un plan colocado desde la
 * certificación hacia atrás.
 *
 * Es la unión de todo lo que se construyó antes: ADR-0042 puso las puertas,
 * ADR-0047 partió las tareas en entregas, y hasta hoy esas fechas sólo servían
 * para avisar. Aquí colocan el plan.
 */

import { afterAll, describe, expect, it } from 'vitest'
import {
  createPool, withTransaction, readGateInputs, setProjectGates, updateProject, loadSnapshot,
} from '@planner/persistence'
import { planGateDeadlines, schedulePlan } from '@planner/scheduler'
import { importDocumentsCsv } from './import-documents.js'
import { importPlanCsv } from './import-plan.js'
import { resolveHorizonFor } from './engine.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)
const sufijo = `${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`
const DOC = `ATR-${sufijo}`
const PROY = `ATR-P-${sufijo}`

afterAll(async () => {
  if (pool !== null) {
    await withTransaction(pool, async (db) => {
      await db.query('DELETE FROM project WHERE code LIKE $1', ['ATR-P-%'])
      await db.query('DELETE FROM document_type WHERE code LIKE $1', ['ATR-%'])
    })
  }
  await pool?.end()
})

const describeSiHayBase = pool === null ? describe.skip : describe

/** El día de una fecha programada. */
const dia = (instante: { date: string }): string => instante.date

describeSiHayBase('planificar hacia atrás, de punta a punta', () => {
  it('la cadena entera se coloca desde la puerta, y el margen es el real', async () => {
    if (pool === null) return

    const projectId = await withTransaction(pool, async (db) => {
      await importDocumentsCsv(
        db,
        ['codigo;nombre;puerta;semanas_antes;horas',
         `${DOC};Informe inventado;CGR;4;80`].join('\n'),
      )
      // Tres tareas encadenadas; la última entrega el documento, así que es la
      // que recibirá la fecha objetivo de la puerta.
      await importPlanCsv(
        db,
        ['proyecto;nombre_proyecto;tarea;dias;predecesoras;entregable',
         `${PROY};Proyecto hacia atrás;Recoger datos;10;;`,
         `${PROY};;Analizar;15;Recoger datos;`,
         `${PROY};;Redactar el informe;10;Analizar;${DOC}`].join('\n'),
      )
      const { rows } = await db.query<{ id: string }>('SELECT id FROM project WHERE code = $1', [PROY])
      return rows[0]?.id ?? ''
    })

    // La puerta cae muy lejos: hay margen de sobra, y eso es lo que el modo
    // tiene que enseñar — no que se llegue, sino CUÁNTO margen queda.
    const objetivos = await withTransaction(pool, async (db) => {
      await setProjectGates(db, projectId, [{ gate: 'CGR', date: '2028-06-30', notes: null }])
      const propuesta = planGateDeadlines(await readGateInputs(db, projectId))
      for (const puesta of propuesta.set) {
        await db.query('UPDATE task SET deadline = $2 WHERE node_id = $1', [puesta.nodeId, puesta.deadline])
      }
      return propuesta.set
    })
    // CGR menos cuatro semanas.
    expect(objetivos.map((o) => o.deadline)).toEqual(['2028-06-02'])

    const antes = await withTransaction(pool, async (db) =>
      schedulePlan(await loadSnapshot(db, { horizon: await resolveHorizonFor(db) })),
    )
    const despues = await withTransaction(pool, async (db) => {
      await updateProject(db, projectId, { scheduleMode: 'atras' })
      return schedulePlan(await loadSnapshot(db, { horizon: await resolveHorizonFor(db) }))
    })

    const deEste = (r: typeof antes): Map<string, (typeof antes)['taskResults'][number]> =>
      new Map(r.taskResults.filter((t) => t.projectId === projectId).map((t) => [t.nodeId, t]))
    const conNombre = new Map(
      (await withTransaction(pool, (db) =>
        db.query<{ id: string; name: string }>(
          'SELECT id, name FROM wbs_node WHERE project_id = $1 AND deleted_at IS NULL', [projectId],
        ),
      )).rows.map((f) => [f.name, f.id]),
    )
    const redactar = conNombre.get('Redactar el informe') ?? ''
    const recoger = conNombre.get('Recoger datos') ?? ''

    // Hacia delante, el plan empieza cuando empieza el proyecto.
    const aAntes = deEste(antes).get(redactar)
    const rAntes = deEste(antes).get(recoger)
    expect(aAntes).toBeDefined()
    expect(dia(rAntes?.scheduledStart ?? { date: '' })).not.toBe('')

    // Hacia atrás, la que entrega el documento termina EN su fecha objetivo.
    const aDespues = deEste(despues).get(redactar)
    const rDespues = deEste(despues).get(recoger)
    expect(dia(aDespues?.scheduledFinish ?? { date: '' })).toBe('2028-06-02')

    // Y la primera de la cadena se arrastra detrás: empieza mucho más tarde que
    // hacia delante, porque ya no hay razón para empezar cuanto antes.
    expect(dia(rDespues?.scheduledStart ?? { date: '' }) > dia(rAntes?.scheduledStart ?? { date: '' })).toBe(true)

    // El margen deja de ser «cuánto puedo retrasar sin retrasar el proyecto» y
    // pasa a ser «cuánto puedo retrasar sin perder la certificación».
    expect(aAntes?.totalSlackMinutes).toBe(0)
    expect(aDespues?.totalSlackMinutes ?? 0).toBeGreaterThan(0)

    // Con margen de sobra, ninguna puerta es inalcanzable.
    expect(despues.findings.some((f) => f.code === 'GATE_UNREACHABLE')).toBe(false)
  })

  it('cuando la puerta está encima, lo dice con los días que faltan', async () => {
    if (pool === null) return
    const { rows } = await withTransaction(pool, (db) =>
      db.query<{ id: string }>('SELECT id FROM project WHERE code = $1', [PROY]),
    )
    const projectId = rows[0]?.id ?? ''

    // La puerta se mueve a seis semanas después del arranque. La cuenta:
    //
    //   fecha objetivo = puerta − 4 semanas = arranque + 14 días naturales
    //   trabajo por delante = 10 + 15 + 10 = 35 días laborables
    //
    // O sea que la fecha objetivo SÍ se pone —cae después del arranque, que es
    // lo que `planGateDeadlines` exige— y aun así no da tiempo. Ése es el caso
    // que el modo tiene que cazar.
    //
    // Y no vale acercar más la puerta: si la fecha objetivo cayera antes del
    // arranque, `planGateDeadlines` la descartaría por «antes-del-arranque» y
    // no habría ancla que poner. Eso fue el primer intento y no cazaba nada.
    //
    // La fecha se calcula del arranque real y no se escribe a mano: escrita a
    // mano, el día que cambie el arranque de la importación la prueba pasaría
    // por casualidad y dejaría de comprobar nada.
    const { rows: arranque } = await withTransaction(pool, (db) =>
      db.query<{ status_start: string }>(
        'SELECT status_start::text FROM project WHERE id = $1', [projectId],
      ),
    )
    const inicio = new Date(`${arranque[0]?.status_start ?? '2026-01-01'}T00:00:00Z`)
    inicio.setUTCDate(inicio.getUTCDate() + 42)
    const puertaEncima = inicio.toISOString().slice(0, 10)

    const hallazgos = await withTransaction(pool, async (db) => {
      await setProjectGates(db, projectId, [{ gate: 'CGR', date: puertaEncima, notes: null }])
      const propuesta = planGateDeadlines(await readGateInputs(db, projectId))
      for (const puesta of propuesta.set) {
        await db.query('UPDATE task SET deadline = $2 WHERE node_id = $1', [puesta.nodeId, puesta.deadline])
      }
      const resultado = schedulePlan(await loadSnapshot(db, { horizon: await resolveHorizonFor(db) }))
      return resultado.findings.filter((f) => f.code === 'GATE_UNREACHABLE')
    })

    expect(hallazgos.length, 'no hubo ninguna puerta inalcanzable').toBeGreaterThan(0)
    const primero = hallazgos[0]
    expect(primero?.payload?.['diasQueFaltan']).toBeGreaterThan(0)
    // Las dos fechas que hacen el aviso accionable.
    expect(primero?.payload?.['necesario']).toBeDefined()
    expect(primero?.payload?.['posible']).toBeDefined()
  })
})
