/**
 * Las horas reales: lo que se fichó de verdad.
 *
 * Es dato **declarado** (P1) y no derivado, aunque venga de un fichero: lo
 * escribió alguien, en su parte de horas, y la herramienta no lo calcula ni lo
 * corrige. Por eso vive en su tabla y no en una ejecución.
 *
 * Y por eso **no entra en el motor**. El trabajo del planificador es decir
 * cuándo *puede* pasar el trabajo; lo que ya pasó no cambia esa respuesta.
 * Meterlo en la instantánea obligaría a recalcular el plan entero para ver una
 * hora fichada y cambiaría el hash de entrada sin que ninguna fecha se mueva.
 * El cruce entre plan y realidad se hace donde alguien lo mira: en el informe.
 *
 * La granularidad es la del parte de horas —persona, tarea, día— porque es la
 * que llega y porque agregar se puede después; inventar el detalle que no vino,
 * no.
 */

import type { Queryable } from './db.js'

/** De dónde salió una hora: el enum `actual_source` del esquema. */
export type ActualSource = 'timesheet' | 'import' | 'manual' | 'estimate'

export interface ActualEntryInput {
  readonly nodeId: string
  readonly resourceId: string
  readonly workDate: string
  readonly minutes: number
  readonly source: ActualSource
  /** El identificador que traía el fichero, para poder rastrear una fila. */
  readonly externalRef?: string | null | undefined
}

/**
 * La clave única de la tabla, como texto: (tarea, persona, día, origen).
 *
 * Aparte porque se usa dos veces y porque, escrita dos veces, son dos sitios
 * donde olvidarse de un campo.
 */
const clave = (entrada: ActualEntryInput): string =>
  `${entrada.nodeId}|${entrada.resourceId}|${entrada.workDate}|${entrada.source}`

/**
 * Suma las entradas que caen en la misma clave.
 *
 * Hace falta y no es una comodidad: `ON CONFLICT ... DO UPDATE` **falla** si un
 * mismo `INSERT` trae dos filas que chocan entre sí —«command cannot affect row
 * a second time»—, y un parte de horas trae eso constantemente: dos apuntes del
 * mismo día en la misma tarea, porque alguien paró a comer.
 *
 * Y la regla es sumar, no quedarse con la última: dos apuntes del mismo día son
 * dos ratos de trabajo, no una corrección. La corrección es volver a cargar el
 * fichero, y de eso se encarga el `DO UPDATE`.
 */
export function mergeActuals(entradas: readonly ActualEntryInput[]): readonly ActualEntryInput[] {
  const porClave = new Map<string, ActualEntryInput>()
  for (const entrada of entradas) {
    const anterior = porClave.get(clave(entrada))
    porClave.set(
      clave(entrada),
      anterior === undefined
        ? entrada
        : { ...anterior, minutes: anterior.minutes + entrada.minutes, externalRef: entrada.externalRef ?? anterior.externalRef ?? null },
    )
  }
  return [...porClave.values()]
}

/**
 * Guarda un lote de horas.
 *
 * `ON CONFLICT ... DO UPDATE` y no `DO NOTHING`, y la diferencia importa: la
 * clave única es (tarea, persona, día, origen), así que un parte que se vuelve
 * a cargar **corrige** las horas de ese día en vez de duplicarlas o de
 * quedarse con las viejas. Cargar dos veces el mismo fichero deja la base
 * exactamente igual que cargarlo una vez, que es lo que alguien espera cuando
 * repite una importación porque no sabe si la primera fue.
 *
 * El `origen` es parte de la clave a propósito: una hora estimada y una hora
 * fichada del mismo día no se pisan, porque no son el mismo dato.
 *
 * Devuelve las filas que llegaron a la tabla, que pueden ser menos que las que
 * entraron: ver `mergeActuals`.
 */
export async function saveActuals(
  db: Queryable,
  todas: readonly ActualEntryInput[],
): Promise<{ guardadas: number }> {
  const entradas = mergeActuals(todas)
  if (entradas.length === 0) return { guardadas: 0 }

  const valores: unknown[] = []
  const filas = entradas.map((entrada, indice) => {
    const base = indice * 6
    valores.push(
      entrada.nodeId,
      entrada.resourceId,
      entrada.workDate,
      entrada.minutes,
      entrada.source,
      entrada.externalRef ?? null,
    )
    return `($${String(base + 1)}, $${String(base + 2)}, $${String(base + 3)}::date, ` +
      `$${String(base + 4)}, $${String(base + 5)}::actual_source, $${String(base + 6)})`
  })

  await db.query(
    `INSERT INTO actual_entry (node_id, resource_id, work_date, minutes, source, external_ref)
     VALUES ${filas.join(', ')}
     ON CONFLICT (node_id, resource_id, work_date, source)
     DO UPDATE SET minutes = EXCLUDED.minutes, external_ref = EXCLUDED.external_ref`,
    valores,
  )
  return { guardadas: entradas.length }
}

export interface ActualRow {
  readonly resourceId: string
  readonly projectId: string
  readonly nodeId: string
  readonly period: string
  readonly actualMinutes: number
}

/**
 * Las horas reales del periodo, por persona, proyecto, tarea y mes.
 *
 * Misma forma que `readLoadInPeriod` a propósito: el informe cruza las dos y
 * cruzar dos listas con la misma forma es una suma, no un trabajo.
 */
export async function readActualsInPeriod(
  db: Queryable,
  from: string,
  to: string,
): Promise<readonly ActualRow[]> {
  const { rows } = await db.query<{
    resource_id: string
    project_id: string
    node_id: string
    period: string
    actual_minutes: string
  }>(
    `SELECT a.resource_id, n.project_id, a.node_id,
            to_char(a.work_date, 'YYYY-MM') AS period,
            SUM(a.minutes) AS actual_minutes
     FROM actual_entry a
     JOIN wbs_node n ON n.id = a.node_id AND n.deleted_at IS NULL
     JOIN project  p ON p.id = n.project_id AND p.deleted_at IS NULL
     WHERE a.work_date BETWEEN $1::date AND $2::date
     GROUP BY 1, 2, 3, 4
     ORDER BY 1, 2, 3, 4`,
    [from, to],
  )
  return rows.map((row) => ({
    resourceId: row.resource_id,
    projectId: row.project_id,
    nodeId: row.node_id,
    period: row.period,
    actualMinutes: Number(row.actual_minutes),
  }))
}

/** Lo último que se sabe: hasta qué día hay horas cargadas. */
export async function lastActualDate(db: Queryable): Promise<string | null> {
  const { rows } = await db.query<{ ultimo: string | null }>(
    'SELECT MAX(work_date)::text AS ultimo FROM actual_entry',
  )
  return rows[0]?.ultimo ?? null
}
