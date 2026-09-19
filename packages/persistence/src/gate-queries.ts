/**
 * El cuestionario de la Checkliste: leerlo y dejarlo como se lo declara.
 *
 * Tres tablas y ninguna cuenta. El cruce con el plan lo hace
 * `answerGateChecklist`, que es puro; aquí sólo vive el SQL.
 */

import type { GateQuery, NivelDeConsulta } from '@planner/scheduler'
import type { Queryable } from './db.js'

/** Lo que hace falta para declarar una consulta entera. */
export interface GateQueryInput {
  readonly discipline: string
  readonly chapter: string
  readonly chapterName: string | null
  readonly code: string
  readonly question: string
  readonly sortKey: number
  readonly gates: readonly {
    gate: string
    level: NivelDeConsulta
    proofRequest: string | null
  }[]
  readonly documents: readonly { documentTypeId: string; maturity: string | null }[]
}

/**
 * Las consultas declaradas, con sus puertas y sus entregables.
 *
 * Tres consultas y no una con dos `JOIN`: unir las puertas y los entregables en
 * la misma fila multiplica una consulta de cinco puertas por sus dos
 * entregables y devuelve diez filas que hay que volver a plegar. Con
 * cincuenta y una consultas da igual el número de viajes; lo que no da igual es
 * que el resultado se lea.
 */
export async function readGateQueries(
  db: Queryable,
  discipline?: string,
): Promise<readonly GateQuery[]> {
  const consultas = await db.query<{
    id: string
    discipline: string
    chapter: string
    chapter_name: string | null
    code: string
    question: string
    sort_key: number
  }>(
    `SELECT id, discipline, chapter, chapter_name, code, question, sort_key
       FROM gate_query
      WHERE ($1::text IS NULL OR lower(btrim(discipline)) = lower(btrim($1)))
      ORDER BY discipline, sort_key, code, id`,
    [discipline ?? null],
  )
  if (consultas.rows.length === 0) return []

  const ids = consultas.rows.map((row) => row.id)

  const puertas = await db.query<{
    query_id: string
    gate: string
    level: NivelDeConsulta
    proof_request: string | null
  }>(
    `SELECT query_id, gate, level, proof_request
       FROM gate_query_gate WHERE query_id = ANY($1::uuid[])
      ORDER BY query_id, gate`,
    [ids],
  )

  const entregables = await db.query<{
    query_id: string
    document_type_id: string
    maturity: string | null
  }>(
    `SELECT d.query_id, d.document_type_id, d.maturity
       FROM gate_query_document d
       JOIN document_type t ON t.id = d.document_type_id AND t.deleted_at IS NULL
      WHERE d.query_id = ANY($1::uuid[])
      ORDER BY d.query_id, d.document_type_id, d.maturity NULLS LAST`,
    [ids],
  )

  const porConsulta = new Map<string, GateQuery['gates'][number][]>()
  for (const fila of puertas.rows) {
    const ya = porConsulta.get(fila.query_id) ?? []
    ya.push({ gate: fila.gate, level: fila.level, proofRequest: fila.proof_request })
    porConsulta.set(fila.query_id, ya)
  }

  const docsDe = new Map<string, GateQuery['documents'][number][]>()
  for (const fila of entregables.rows) {
    const ya = docsDe.get(fila.query_id) ?? []
    ya.push({ documentTypeId: fila.document_type_id, maturity: fila.maturity })
    docsDe.set(fila.query_id, ya)
  }

  return consultas.rows.map((row) => ({
    id: row.id,
    discipline: row.discipline,
    chapter: row.chapter,
    chapterName: row.chapter_name,
    code: row.code,
    question: row.question,
    sortKey: row.sort_key,
    gates: porConsulta.get(row.id) ?? [],
    documents: docsDe.get(row.id) ?? [],
  }))
}

export interface ConsultasEscritas {
  readonly creadas: number
  readonly actualizadas: number
  readonly puertas: number
  readonly enlaces: number
}

/**
 * Deja cada consulta exactamente como se la declara.
 *
 * El código manda dentro de su disciplina: una consulta cuyo código ya existe
 * se **actualiza**, así que cargar dos veces la misma hoja deja cincuenta y una
 * consultas y no ciento dos.
 *
 * Y sus puertas y sus entregables son **la lista completa**, no una añadidura:
 * lo que no venga se borra. Es lo que hace que volver a cargar una hoja
 * corregida corrija de verdad —quitar una puerta de una consulta es un cambio
 * normal en una revisión— y sólo afecta a las consultas que el fichero nombra.
 */
export async function setGateQueries(
  db: Queryable,
  consultas: readonly GateQueryInput[],
): Promise<ConsultasEscritas> {
  let creadas = 0
  let actualizadas = 0
  let puertas = 0
  let enlaces = 0

  for (const consulta of consultas) {
    const existente = await db.query<{ id: string }>(
      `SELECT id FROM gate_query
        WHERE lower(btrim(discipline)) = lower(btrim($1))
          AND upper(btrim(code)) = upper(btrim($2))`,
      [consulta.discipline, consulta.code],
    )

    let id = existente.rows[0]?.id
    if (id === undefined) {
      const creada = await db.query<{ id: string }>(
        `INSERT INTO gate_query (discipline, chapter, chapter_name, code, question, sort_key)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          consulta.discipline,
          consulta.chapter,
          consulta.chapterName,
          consulta.code,
          consulta.question,
          consulta.sortKey,
        ],
      )
      id = creada.rows[0]?.id ?? ''
      creadas += 1
    } else {
      await db.query(
        `UPDATE gate_query
            SET chapter = $2, chapter_name = $3, question = $4, sort_key = $5
          WHERE id = $1`,
        [id, consulta.chapter, consulta.chapterName, consulta.question, consulta.sortKey],
      )
      actualizadas += 1
    }

    await db.query('DELETE FROM gate_query_gate WHERE query_id = $1', [id])
    for (const enPuerta of consulta.gates) {
      await db.query(
        `INSERT INTO gate_query_gate (query_id, gate, level, proof_request)
         VALUES ($1, $2, $3, $4)`,
        [id, enPuerta.gate.trim(), enPuerta.level, enPuerta.proofRequest],
      )
      puertas += 1
    }

    await db.query('DELETE FROM gate_query_document WHERE query_id = $1', [id])
    for (const nombrado of consulta.documents) {
      await db.query(
        `INSERT INTO gate_query_document (query_id, document_type_id, maturity)
         VALUES ($1, $2, $3)`,
        [id, nombrado.documentTypeId, nombrado.maturity],
      )
      enlaces += 1
    }
  }

  return { creadas, actualizadas, puertas, enlaces }
}

/** Qué disciplinas hay declaradas, con cuántas consultas cada una. */
export async function readGateQueryDisciplines(
  db: Queryable,
): Promise<readonly { discipline: string; queries: number }[]> {
  const { rows } = await db.query<{ discipline: string; n: number }>(
    `SELECT discipline, count(*)::int AS n FROM gate_query GROUP BY discipline ORDER BY discipline`,
  )
  return rows.map((row) => ({ discipline: row.discipline, queries: row.n }))
}
