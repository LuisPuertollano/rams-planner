/**
 * Las horas reales que vienen por mes, y su conciliación.
 *
 * `actual_entry` supone algo que el sistema de fichaje no sabe: contra qué
 * **tarea** se ficharon las horas. SAP CATS —y cualquier otro— sabe «Ana imputó
 * 40 h al proyecto CBTC en abril», y ahí se acaba el dato.
 *
 * Así que hay dos caminos por los que una hora real llega a una tarea, y los
 * dos son legítimos:
 *
 *   el parte diario   `actual_entry`: persona, TAREA, día. Llega ya puesto.
 *   el mensual        `actual_month` × `actual_split`: persona, proyecto, mes,
 *                     por lo que declara la persona. Se reparte aquí.
 *
 * Lo que no vale es usar los dos para el mismo mes del mismo proyecto: eso
 * contaría el trabajo dos veces, y por eso `repartirReales` recibe las claves
 * que ya tienen parte diario y las deja fuera con su motivo.
 *
 * El reparto en sí es puro y vive en `@planner/report`. Aquí sólo se lee, se
 * escribe y se le da de comer.
 */

import {
  matrizDeConciliacion,
  repartirReales,
  type ActualSplit,
  type CasillaConciliacion,
  type MonthlyActual,
  type Reparto,
} from '@planner/report'
import { readActualsInPeriod } from './actuals.js'
import type { Queryable } from './db.js'

/** Un mes de horas tal y como entra: el mes se declara como `YYYY-MM`. */
export interface MonthlyActualInput {
  readonly resourceId: string
  readonly projectId: string
  readonly period: string
  readonly minutes: number
  readonly externalRef?: string | null | undefined
}

export interface ActualSplitInput {
  readonly resourceId: string
  readonly projectId: string
  readonly period: string
  readonly nodeId: string
  readonly shareBp: number
  readonly note?: string | null | undefined
}

/** El día 1 del mes, que es como se guarda. */
const primeroDe = (period: string): string => `${period}-01`

/**
 * Mete o actualiza los meses de horas.
 *
 * Reemplaza en vez de sumar, al revés que `writeActuals`: una fila de
 * `actual_month` **es el total del mes**, no un apunte. Volver a cargar el
 * export de marzo tiene que dejar marzo como diga el export, no el doble.
 */
export async function writeMonthlyActuals(
  db: Queryable,
  filas: readonly MonthlyActualInput[],
): Promise<number> {
  if (filas.length === 0) return 0
  // Una misma clave dos veces en el mismo INSERT revienta el ON CONFLICT
  // («command cannot affect row a second time»), y un export las trae.
  const porClave = new Map<string, MonthlyActualInput>()
  for (const fila of filas) {
    porClave.set(`${fila.resourceId}|${fila.projectId}|${fila.period}`, fila)
  }
  const unicas = [...porClave.values()]
  await db.query(
    `INSERT INTO actual_month (resource_id, project_id, period, minutes, external_ref)
     SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::date[], $4::int[], $5::text[])
     ON CONFLICT (resource_id, project_id, period)
     DO UPDATE SET minutes = EXCLUDED.minutes, external_ref = EXCLUDED.external_ref`,
    [
      unicas.map((f) => f.resourceId),
      unicas.map((f) => f.projectId),
      unicas.map((f) => primeroDe(f.period)),
      unicas.map((f) => f.minutes),
      unicas.map((f) => f.externalRef ?? null),
    ],
  )
  return unicas.length
}

/**
 * Deja la declaración de un mes exactamente como se la declara.
 *
 * Borra lo que ya no viene para ese (persona, proyecto, mes) en vez de dejar
 * filas viejas sumando: si alguien reparte 60/40 y luego lo cambia a 100 % en
 * una sola tarea, la fila del 40 % tiene que desaparecer o la suma dará 140 %.
 */
export async function writeSplits(db: Queryable, filas: readonly ActualSplitInput[]): Promise<number> {
  if (filas.length === 0) return 0
  const porClave = new Map<string, ActualSplitInput>()
  for (const fila of filas) {
    porClave.set(`${fila.resourceId}|${fila.projectId}|${fila.period}|${fila.nodeId}`, fila)
  }
  const unicas = [...porClave.values()]
  const meses = [...new Set(unicas.map((f) => `${f.resourceId}|${f.projectId}|${f.period}`))]
  await db.query(
    `DELETE FROM actual_split
     WHERE resource_id || '|' || project_id || '|' || to_char(period, 'YYYY-MM') = ANY($1::text[])`,
    [meses],
  )
  await db.query(
    `INSERT INTO actual_split (resource_id, project_id, period, node_id, share_bp, note)
     SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::date[], $4::uuid[], $5::int[], $6::text[])`,
    [
      unicas.map((f) => f.resourceId),
      unicas.map((f) => f.projectId),
      unicas.map((f) => primeroDe(f.period)),
      unicas.map((f) => f.nodeId),
      unicas.map((f) => f.shareBp),
      unicas.map((f) => f.note ?? null),
    ],
  )
  return unicas.length
}

/** Los meses de horas del periodo, en la forma que come `repartirReales`. */
export async function readMonthlyActuals(
  db: Queryable,
  from: string,
  to: string,
): Promise<readonly MonthlyActual[]> {
  const { rows } = await db.query<{
    resource_id: string; project_id: string; period: string; minutes: number
  }>(
    `SELECT m.resource_id, m.project_id, to_char(m.period, 'YYYY-MM') AS period, m.minutes
     FROM actual_month m
     JOIN project p ON p.id = m.project_id AND p.deleted_at IS NULL
     WHERE m.period BETWEEN date_trunc('month', $1::date) AND $2::date
     ORDER BY 1, 2, 3`,
    [from, to],
  )
  return rows.map((row) => ({
    resourceId: row.resource_id,
    projectId: row.project_id,
    period: row.period,
    minutes: row.minutes,
  }))
}

/** Las declaraciones del periodo. Las de tareas borradas no cuentan. */
export async function readSplits(db: Queryable, from: string, to: string): Promise<readonly ActualSplit[]> {
  const { rows } = await db.query<{
    resource_id: string; project_id: string; period: string; node_id: string; share_bp: number
  }>(
    `SELECT s.resource_id, s.project_id, to_char(s.period, 'YYYY-MM') AS period, s.node_id, s.share_bp
     FROM actual_split s
     JOIN wbs_node n ON n.id = s.node_id AND n.deleted_at IS NULL
     JOIN project  p ON p.id = s.project_id AND p.deleted_at IS NULL
     WHERE s.period BETWEEN date_trunc('month', $1::date) AND $2::date
     ORDER BY 1, 2, 3, 4`,
    [from, to],
  )
  return rows.map((row) => ({
    resourceId: row.resource_id,
    projectId: row.project_id,
    period: row.period,
    nodeId: row.node_id,
    shareBp: row.share_bp,
  }))
}

/**
 * Las claves (persona, proyecto, mes) que ya tienen parte diario por tarea.
 *
 * Son las que el reparto mensual **no** puede tocar: sus horas ya están
 * contadas, con más detalle, por el otro camino.
 */
export async function keysWithDailyEntries(
  db: Queryable,
  from: string,
  to: string,
): Promise<ReadonlySet<string>> {
  const { rows } = await db.query<{ clave: string }>(
    `SELECT DISTINCT a.resource_id || '|' || n.project_id || '|' || to_char(a.work_date, 'YYYY-MM') AS clave
     FROM actual_entry a
     JOIN wbs_node n ON n.id = a.node_id AND n.deleted_at IS NULL
     WHERE a.work_date BETWEEN $1::date AND $2::date`,
    [from, to],
  )
  return new Set(rows.map((row) => row.clave))
}

export interface Conciliacion {
  readonly reparto: Reparto
  readonly matriz: readonly CasillaConciliacion[]
  readonly meses: readonly MonthlyActual[]
}

/** Lee lo que hace falta y reparte. Todo el criterio está en la función pura. */
export async function reconcileActuals(db: Queryable, from: string, to: string): Promise<Conciliacion> {
  // En serie y no con `Promise.all`: `db` es UN cliente dentro de una
  // transacción, y lanzarle tres consultas a la vez es exactamente lo que `pg`
  // avisa que va a dejar de funcionar. Son tres lecturas de índice; el paralelo
  // no compraba nada.
  const meses = await readMonthlyActuals(db, from, to)
  const repartos = await readSplits(db, from, to)
  const conParteDiario = await keysWithDailyEntries(db, from, to)
  const reparto = repartirReales(meses, repartos, { conParteDiario })
  return { reparto, matriz: matrizDeConciliacion(reparto, meses), meses }
}

/**
 * Todas las horas reales del periodo, vengan por donde vengan.
 *
 * Es lo que el informe tiene que mirar, y por eso existe con nombre propio en
 * vez de que cada pantalla haga su unión: las horas de un proyecto pueden
 * llegar por el parte diario y las del de al lado por el export mensual, y una
 * pantalla que sólo mire una de las dos vías enseña menos gasto del real sin
 * decir que le falta la mitad.
 *
 * Lo que se queda fuera —un mes sin declarar, una declaración que no suma—
 * **no se cuela aquí en silencio**: sale en la conciliación con su motivo.
 */
export async function readAllActualsInPeriod(
  db: Queryable,
  from: string,
  to: string,
): Promise<readonly { resourceId: string; projectId: string; nodeId: string; period: string; actualMinutes: number }[]> {
  const diario = await readActualsInPeriod(db, from, to)
  const { reparto } = await reconcileActuals(db, from, to)
  // El reparto ya deja fuera los meses que tienen parte diario, así que no hay
  // nada que sumar dos veces: las dos listas son disjuntas por construcción.
  return [...diario, ...reparto.allocated].sort(
    (izq, der) =>
      izq.resourceId.localeCompare(der.resourceId) ||
      izq.projectId.localeCompare(der.projectId) ||
      izq.nodeId.localeCompare(der.nodeId) ||
      izq.period.localeCompare(der.period),
  )
}
