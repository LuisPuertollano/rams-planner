/**
 * Cómo llega el proyecto a sus puertas, contra PostgreSQL de verdad.
 *
 * Lo que una prueba en memoria no puede comprobar y aquí sí es justo lo que
 * tiene riesgo en esta entrega, que es **SQL**, no aritmética:
 *
 * - que la expectativa se une bien de los dos sitios donde ya está dicha
 *   —`document_gate` para las previas y `document_type.gate` para la final—;
 * - que una tarea SIN partir se lee como la entrega final y no se cuela
 *   dos veces cuando sí está partida (el `NOT EXISTS`);
 * - que el fin llega como DÍA y no como instante, que es lo que decidiría mal
 *   una entrega que termina la tarde del día de la puerta.
 *
 * El cruce en sí ya lo prueba `gate-readiness.test.ts`, sin base.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { assessGateReadiness } from '@planner/scheduler'
import { createPool } from './db.js'
import { readGateReadinessInputs } from './gates.js'
import { withTransaction } from './db.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

const unico = (prefijo: string): string =>
  `${prefijo}-${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`

const proyectos: string[] = []
const documentos: string[] = []
const ejecuciones: string[] = []

afterAll(async () => {
  if (pool !== null) {
    await withTransaction(pool, async (db) => {
      if (ejecuciones.length > 0) {
        await db.query('DELETE FROM calculation_run WHERE id = ANY($1::uuid[])', [ejecuciones])
      }
      if (proyectos.length > 0) {
        await db.query('DELETE FROM project WHERE id = ANY($1::uuid[])', [proyectos])
      }
      if (documentos.length > 0) {
        await db.query('DELETE FROM document_type WHERE id = ANY($1::uuid[])', [documentos])
      }
    })
  }
  await pool?.end()
})

const describeSiHayBase = pool === null ? describe.skip : describe

interface Montaje {
  readonly projectId: string
  readonly documentTypeId: string
  readonly runId: string
  readonly finalNodeId: string
}

/**
 * Un proyecto con un documento que la Checkliste pide dos veces: preliminar en
 * PGR y final en CGR. `partido` decide si el plan tiene las dos entregas o sólo
 * la tarea entera sin partir.
 */
async function monta(opciones: {
  partido: boolean
  finPreliminar?: string
  finFinal?: string
}): Promise<Montaje> {
  if (pool === null) throw new Error('sin base')
  return withTransaction(pool, async (db) => {
    const proyecto = await db.query<{ id: string }>(
      `INSERT INTO project (code, name, status_start)
       VALUES ($1, 'Proyecto con Checkliste', '2026-01-01') RETURNING id`,
      [unico('PREP')],
    )
    const projectId = proyecto.rows[0]?.id ?? ''
    proyectos.push(projectId)

    await db.query(
      `INSERT INTO project_gate (project_id, gate, gate_date) VALUES ($1, 'PGR', '2026-05-15'),
                                                                     ($1, 'CGR', '2026-09-30')`,
      [projectId],
    )

    const documento = await db.query<{ id: string }>(
      `INSERT INTO document_type (code, name, gate, weeks_before_gate)
       VALUES ($1, 'Análisis de modos de fallo', 'CGR', 0) RETURNING id`,
      [unico('PREP-DOC')],
    )
    const documentTypeId = documento.rows[0]?.id ?? ''
    documentos.push(documentTypeId)

    // La entrega previa que pide la Checkliste: preliminar en PGR.
    await db.query(
      `INSERT INTO document_gate (document_type_id, position, gate, maturity, weeks_before_gate, share_bp)
       VALUES ($1, 1, 'PGR', 'preliminar', 0, 4000)`,
      [documentTypeId],
    )

    const nodo = async (codigo: string, nombre: string): Promise<string> => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO wbs_node (project_id, parent_id, node_kind, code, path, sort_key, name)
         VALUES ($1, NULL, 'task', $2, $2, 1, $3) RETURNING id`,
        [projectId, codigo, nombre],
      )
      const id = rows[0]?.id ?? ''
      await db.query(
        `INSERT INTO task (node_id, task_type, is_effort_driven, duration_minutes,
                           work_declared_minutes, constraint_kind, percent_complete_bp, is_milestone)
         VALUES ($1, 'fixed_duration', TRUE, 480, 0, 'asap', 0, FALSE)`,
        [id],
      )
      return id
    }

    const finalNodeId = await nodo('002', 'Análisis · final')
    await db.query('INSERT INTO node_document (node_id, document_type_id) VALUES ($1, $2)', [
      finalNodeId,
      documentTypeId,
    ])

    let preliminarNodeId: string | null = null
    if (opciones.partido) {
      preliminarNodeId = await nodo('001', 'Análisis · preliminar')
      await db.query(
        `INSERT INTO node_delivery (node_id, document_type_id, position, gate, weeks_before_gate,
                                    maturity, is_final, expanded_from)
         VALUES ($1, $2, 0, 'PGR', 0, 'preliminar', FALSE, $3),
                ($3, $2, 1, 'CGR', 0, NULL, TRUE, $3)`,
        [preliminarNodeId, documentTypeId, finalNodeId],
      )
    }

    const escenario = await db.query<{ id: string }>('SELECT id FROM scenario LIMIT 1')
    const ejecucion = await db.query<{ id: string }>(
      `INSERT INTO calculation_run (scenario_id, engine_version, input_hash, horizon_from,
                                    horizon_to, status)
       VALUES ($1, 'prueba', $2, '2026-01-01', '2027-12-31', 'succeeded') RETURNING id`,
      [escenario.rows[0]?.id ?? '', unico('hash')],
    )
    const runId = ejecucion.rows[0]?.id ?? ''
    ejecuciones.push(runId)

    const resultado = async (nodeId: string, fin: string): Promise<void> => {
      await db.query(
        `INSERT INTO task_result (run_id, node_id, early_start, early_finish, late_start,
                                  late_finish, scheduled_start, scheduled_finish,
                                  duration_minutes, work_minutes, total_slack_minutes,
                                  free_slack_minutes, is_critical, percent_complete_bp)
         VALUES ($1, $2, $3::timestamptz, $3::timestamptz, $3::timestamptz, $3::timestamptz,
                 $3::timestamptz, $3::timestamptz, 480, 480, 0, 0, FALSE, 2500)`,
        [runId, nodeId, fin],
      )
    }
    // A propósito por la TARDE: si el fin viajara como instante en vez de como
    // día, una entrega que acaba el día de la puerta saldría tarde.
    if (preliminarNodeId !== null) {
      await resultado(preliminarNodeId, `${opciones.finPreliminar ?? '2026-05-15'}T17:00:00Z`)
    }
    await resultado(finalNodeId, `${opciones.finFinal ?? '2026-09-01'}T17:00:00Z`)

    return { projectId, documentTypeId, runId, finalNodeId }
  })
}

describeSiHayBase('la preparación de la puerta, contra la base', () => {
  it('une la expectativa de los dos sitios: la previa y la final', async () => {
    if (pool === null) return
    const { projectId, runId } = await monta({ partido: true })
    const entrada = await withTransaction(pool, (db) =>
      readGateReadinessInputs(db, projectId, runId),
    )
    const resultado = assessGateReadiness(entrada)

    expect(resultado.gates.map((puerta) => puerta.gate)).toEqual(['PGR', 'CGR'])
    const pgr = resultado.gates[0]
    expect(pgr?.evidence).toHaveLength(1)
    expect(pgr?.evidence[0]?.maturity).toBe('preliminar')
    // El fin llegó como día: termina EL día de la puerta y eso es a tiempo.
    expect(pgr?.evidence[0]?.finish).toBe('2026-05-15')
    expect(pgr?.evidence[0]?.state).toBe('a-tiempo')

    const cgr = resultado.gates[1]
    expect(cgr?.evidence[0]?.maturity).toBeNull()
    expect(cgr?.evidence[0]?.state).toBe('a-tiempo')
    expect(resultado.findings).toEqual([])
  })

  it('una tarea sin partir se lee como la final, y la previa sale sin partir', async () => {
    if (pool === null) return
    const { projectId, runId } = await monta({ partido: false })
    const resultado = assessGateReadiness(
      await withTransaction(pool, (db) => readGateReadinessInputs(db, projectId, runId)),
    )
    const pgr = resultado.gates.find((puerta) => puerta.gate === 'PGR')
    expect(pgr?.evidence[0]?.state).toBe('sin-partir')
    const cgr = resultado.gates.find((puerta) => puerta.gate === 'CGR')
    expect(cgr?.evidence[0]?.state).toBe('a-tiempo')
    expect(resultado.findings.map((f) => f.code)).toEqual(['GATE_EVIDENCE_MISSING'])
  })

  it('una tarea partida no cuenta dos veces su entrega final', async () => {
    if (pool === null) return
    const { projectId, runId } = await monta({ partido: true })
    const entrada = await withTransaction(pool, (db) =>
      readGateReadinessInputs(db, projectId, runId),
    )
    // La final tiene fila en `node_delivery` Y en `node_document`; sin el
    // `NOT EXISTS` aparecería dos veces y el conteo mentiría.
    const finales = entrada.planned.filter((entrega) => entrega.maturity === null)
    expect(finales).toHaveLength(1)
  })

  it('la entrega que termina después de su puerta sale tarde, con los días', async () => {
    if (pool === null) return
    const { projectId, runId } = await monta({ partido: true, finPreliminar: '2026-06-02' })
    const resultado = assessGateReadiness(
      await withTransaction(pool, (db) => readGateReadinessInputs(db, projectId, runId)),
    )
    const pgr = resultado.gates.find((puerta) => puerta.gate === 'PGR')
    expect(pgr?.evidence[0]?.state).toBe('tarde')
    expect(pgr?.evidence[0]?.daysLate).toBe(18)
    expect(resultado.findings.map((f) => f.code)).toEqual(['GATE_EVIDENCE_LATE'])
  })

  it('no opina de los documentos que este proyecto no entrega', async () => {
    if (pool === null) return
    const { projectId, runId, documentTypeId } = await monta({ partido: true })
    const entrada = await withTransaction(pool, (db) =>
      readGateReadinessInputs(db, projectId, runId),
    )
    // El catálogo es del departamento entero y trae muchos más documentos.
    expect(entrada.documents.length).toBeGreaterThan(entrada.documentsInPlan.length)
    expect(entrada.documentsInPlan).toEqual([documentTypeId])
    const resultado = assessGateReadiness(entrada)
    const codigos = new Set(
      resultado.gates.flatMap((puerta) => puerta.evidence.map((fila) => fila.documentTypeId)),
    )
    expect([...codigos]).toEqual([documentTypeId])
  })
})
