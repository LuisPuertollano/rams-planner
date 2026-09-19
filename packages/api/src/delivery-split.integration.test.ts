/**
 * Partir la tarea en sus entregas, contra PostgreSQL de verdad.
 *
 * Lo que sólo se ve con la base delante: que la cirugía deja el plan coherente
 * —la tarea pasa a paquete, nacen sus entregas, el entregable se muda a la
 * final y las asignaciones a la primera—, que partir dos veces no parte los
 * trozos, y lo que es el punto de todo esto: que **el borrador recibe la fecha
 * de SU puerta**, no la del entregable.
 */

import { afterAll, describe, expect, it } from 'vitest'
import {
  applyDeliverySplit,
  createPool,
  readDeliveryInputs,
  readDocumentTypes,
  readGateInputs,
  setProjectGates,
  withTransaction,
} from '@planner/persistence'
import { planDeliveries, planGateDeadlines } from '@planner/scheduler'
import { importDocumentsCsv } from './import-documents.js'
import { importPlanCsv } from './import-plan.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)
const sufijo = `${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`
const DOC = `DVY-${sufijo}`
const PROY = `DVY-P-${sufijo}`

afterAll(async () => {
  if (pool !== null) {
    await withTransaction(pool, async (db) => {
      await db.query('DELETE FROM project WHERE code LIKE $1', [`DVY-P-%`])
      await db.query('DELETE FROM document_type WHERE code LIKE $1', [`DVY-%`])
    })
  }
  await pool?.end()
})

const describeSiHayBase = pool === null ? describe.skip : describe

async function monta(): Promise<string> {
  if (pool === null) throw new Error('sin base')
  return withTransaction(pool, async (db) => {
    await importDocumentsCsv(
      db,
      ['codigo;nombre;puerta;semanas_antes;horas;entregas_previas',
       `${DOC};Análisis inventado;CGR;2;100;PGR:preliminar:30:4`].join('\n'),
    )
    await importPlanCsv(
      db,
      ['proyecto;nombre_proyecto;tarea;dias;predecesoras;entregable',
       `${PROY};Proyecto de prueba;Antes;2;;`,
       `${PROY};;Redactar el análisis;10;Antes;${DOC}`,
       `${PROY};;Después;2;Redactar el análisis;`].join('\n'),
    )
    const { rows } = await db.query<{ id: string }>('SELECT id FROM project WHERE code = $1', [PROY])
    return rows[0]?.id ?? ''
  })
}

describeSiHayBase('partir la tarea en sus entregas', () => {
  it('deja el plan coherente: paquete, entregas, entregable y enlaces', async () => {
    if (pool === null) return
    const projectId = await monta()

    const resumen = await withTransaction(pool, async (db) => {
      const plan = planDeliveries({
        ...(await readDeliveryInputs(db, projectId)),
        documents: (await readDocumentTypes(db)).map((d) => ({
          documentTypeId: d.id, code: d.code, name: d.name, gate: d.gate, weeksBeforeGate: d.weeksBeforeGate,
        })),
        checkliste: (await db.query<{
          document_type_id: string; position: number; gate: string; maturity: string
          weeks_before_gate: number | null; share_bp: number
        }>('SELECT * FROM document_gate')).rows.map((r) => ({
          documentTypeId: r.document_type_id, position: r.position, gate: r.gate,
          maturity: r.maturity, weeksBeforeGate: r.weeks_before_gate, shareBp: r.share_bp,
        })),
      })
      expect(plan.split).toHaveLength(1)
      // El tamaño no se mueve: 10 días repartidos 30/70.
      expect(plan.totals.minutesAfter).toBe(plan.totals.minutesBefore)
      return applyDeliverySplit(db, plan, plan.split.map((p) => p.nodeId))
    })
    expect(resumen.tasksSplit).toBe(1)
    expect(resumen.deliveriesCreated).toBe(2)
    expect(resumen.relinked).toBe(2)

    const estado = await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{
        name: string; node_kind: string; dias: string | null; gate: string | null; is_final: boolean | null
      }>(
        `SELECT n.name, n.node_kind, (t.duration_minutes / 480.0)::text AS dias, v.gate, v.is_final
         FROM wbs_node n
         LEFT JOIN task t ON t.node_id = n.id
         LEFT JOIN node_delivery v ON v.node_id = n.id
         WHERE n.project_id = $1 AND n.deleted_at IS NULL
         ORDER BY n.path`,
        [projectId],
      )
      return rows
    })
    const paquete = estado.find((r) => r.name === 'Redactar el análisis')
    expect(paquete?.node_kind).toBe('work_package')
    const entregas = estado.filter((r) => r.is_final !== null)
    expect(entregas).toHaveLength(2)
    expect(entregas.find((e) => !e.is_final)?.gate).toBe('PGR')
    expect(entregas.find((e) => e.is_final)?.gate).toBe('CGR')
    // 30 % de 10 días son 3; el resto, 7.
    expect(Number(entregas.find((e) => !e.is_final)?.dias)).toBeCloseTo(3, 1)
    expect(Number(entregas.find((e) => e.is_final)?.dias)).toBeCloseTo(7, 1)
  })

  it('el borrador recibe la fecha de SU puerta, no la del entregable', async () => {
    if (pool === null) return
    // Es el punto de todo esto. El análisis va a CGR y su preliminar a PGR.
    const { rows } = await withTransaction(pool, (db) =>
      db.query<{ id: string }>('SELECT id FROM project WHERE code = $1', [PROY]),
    )
    const projectId = rows[0]?.id ?? ''

    const objetivos = await withTransaction(pool, async (db) => {
      await setProjectGates(db, projectId, [
        { gate: 'PGR', date: '2027-03-19', notes: null },
        { gate: 'CGR', date: '2028-05-14', notes: null },
      ])
      return planGateDeadlines(await readGateInputs(db, projectId))
    })
    const puertas = objetivos.set.map((o) => `${o.gate}:${o.deadline}`).sort()
    // PGR menos 4 semanas, y CGR menos 2.
    expect(puertas).toEqual(['CGR:2028-04-30', 'PGR:2027-02-19'])
  })

  it('partir dos veces no parte los trozos', async () => {
    if (pool === null) return
    const { rows } = await withTransaction(pool, (db) =>
      db.query<{ id: string }>('SELECT id FROM project WHERE code = $1', [PROY]),
    )
    const projectId = rows[0]?.id ?? ''
    const plan = await withTransaction(pool, async (db) =>
      planDeliveries({
        ...(await readDeliveryInputs(db, projectId)),
        documents: (await readDocumentTypes(db)).map((d) => ({
          documentTypeId: d.id, code: d.code, name: d.name, gate: d.gate, weeksBeforeGate: d.weeksBeforeGate,
        })),
        checkliste: [],
      }),
    )
    expect(plan.split).toHaveLength(0)
    expect(plan.skipped.some((s) => s.reason === 'ya-partida' || s.reason === 'es-un-trozo')).toBe(true)
  })
  it('la persona asignada sigue en todas sus entregas, y el trabajo no se pierde', async () => {
    if (pool === null) return
    // Esta prueba existe por una avería medida: mudar la asignación a la
    // primera entrega —que es lo que hace partir en subactividades, y allí con
    // razón— dejaba sin cubrir todo lo que venía después. Y como una
    // asignación sin trabajo declarado saca su trabajo de la duración de la
    // tarea, esas horas no quedaban pendientes de asignar: desaparecían del
    // reparto. En los datos de demostración eran el 47 %, y nada fallaba.
    //
    // La diferencia con las subactividades es de fondo: allí los otros pasos
    // son otros papeles y no inventarles a nadie es lo correcto; aquí el
    // borrador y la versión final son el mismo trabajo de la misma persona.
    const DOC2 = `${DOC}-A`
    const PROY2 = `${PROY}-A`
    const { projectId, resourceId } = await withTransaction(pool, async (db) => {
      await importDocumentsCsv(
        db,
        ['codigo;nombre;puerta;semanas_antes;horas;entregas_previas',
         `${DOC2};Otro análisis;CGR;2;100;PGR:preliminar:30:4`].join('\n'),
      )
      await importPlanCsv(
        db,
        ['proyecto;nombre_proyecto;tarea;dias;predecesoras;entregable',
         `${PROY2};Proyecto con gente;Redactar;10;;${DOC2}`].join('\n'),
      )
      const proyecto = await db.query<{ id: string }>('SELECT id FROM project WHERE code = $1', [PROY2])
      const nodo = await db.query<{ id: string }>(
        'SELECT id FROM wbs_node WHERE project_id = $1 AND name = $2',
        [proyecto.rows[0]?.id ?? '', 'Redactar'],
      )
      const recurso = await db.query<{ id: string }>('SELECT id FROM resource LIMIT 1')
      await db.query(
        'INSERT INTO assignment (node_id, resource_id, units_bp) VALUES ($1, $2, 10000)',
        [nodo.rows[0]?.id ?? '', recurso.rows[0]?.id ?? ''],
      )
      return { projectId: proyecto.rows[0]?.id ?? '', resourceId: recurso.rows[0]?.id ?? '' }
    })

    await withTransaction(pool, async (db) => {
      const plan = planDeliveries({
        ...(await readDeliveryInputs(db, projectId)),
        documents: (await readDocumentTypes(db)).map((d) => ({
          documentTypeId: d.id, code: d.code, name: d.name, gate: d.gate, weeksBeforeGate: d.weeksBeforeGate,
        })),
        checkliste: (await db.query<{
          document_type_id: string; position: number; gate: string; maturity: string
          weeks_before_gate: number | null; share_bp: number
        }>('SELECT * FROM document_gate')).rows.map((row) => ({
          documentTypeId: row.document_type_id, position: row.position, gate: row.gate,
          maturity: row.maturity, weeksBeforeGate: row.weeks_before_gate, shareBp: row.share_bp,
        })),
      })
      expect(plan.split).toHaveLength(1)
      await applyDeliverySplit(db, plan, plan.split.map((p) => p.nodeId))
    })

    const vivas = await withTransaction(pool, async (db) =>
      db.query<{ name: string; dias: string }>(
        `SELECT n.name, (t.duration_minutes / 480.0)::text AS dias
         FROM assignment a
         JOIN wbs_node n ON n.id = a.node_id
         JOIN task t ON t.node_id = n.id
         WHERE a.deleted_at IS NULL AND a.resource_id = $1 AND n.project_id = $2
         ORDER BY n.path`,
        [resourceId, projectId],
      ),
    )
    // Las dos, no una: el borrador y la final.
    expect(vivas.rows.map((f) => f.name)).toEqual([`${DOC2} · preliminar`, DOC2])
    // Y entre las dos suman los 10 días que tenía la tarea antes de partirse.
    const dias = vivas.rows.reduce((suma, fila) => suma + Number(fila.dias), 0)
    expect(dias).toBeCloseTo(10, 1)
  })
})

