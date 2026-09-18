/**
 * Persistencia de una ejecución de cálculo (P3).
 *
 * Nada derivado se guarda suelto: todo cuelga de una fila de `calculation_run`
 * con su versión de motor y el hash de sus entradas. Dos ejecuciones se pueden
 * comparar campo a campo, y una línea base no es más que una congelada.
 */

import { createHash } from 'node:crypto'
import { canonicalize, type CalendarDate, type Finding, type JsonValue } from '@planner/domain'
import type { PlanInstant } from '@planner/calendar'
import type { Derivation } from '@planner/explain'
import type { PlanSnapshot, ScheduleOutput } from '@planner/scheduler'
import type { WorkloadOutput } from '@planner/workload'
import type { Queryable } from './db.js'

export const ENGINE_VERSION = '1.0.0'

export interface SaveRunInput {
  readonly scenarioId: string
  readonly snapshot: PlanSnapshot
  readonly schedule: ScheduleOutput
  readonly workload: WorkloadOutput
  readonly derivations: readonly Derivation[]
  readonly triggerReason?: string
  readonly durationMs: number
  /** Marca la ejecución como nivelada, con el número de retrasos aplicados. */
  readonly leveling?: { readonly delayedTasks: number; readonly converged: boolean }
}

/**
 * sha256 de la serialización canónica: dos snapshots equivalentes dan el mismo
 * hash aunque se hayan construido en distinto orden. Es lo que permite saltarse
 * un recálculo idéntico y detectar que un informe salió de datos que ya cambiaron.
 */
export function hashSnapshot(snapshot: PlanSnapshot): string {
  const plain = JSON.parse(JSON.stringify(snapshot)) as JsonValue
  return createHash('sha256').update(canonicalize(plain)).digest('hex')
}

export async function saveRun(db: Queryable, input: SaveRunInput): Promise<string> {
  const { snapshot, schedule, workload } = input
  const inputHash = hashSnapshot(snapshot)

  const run = await db.query<{ id: string }>(
    `INSERT INTO calculation_run
       (scenario_id, engine_version, input_hash, horizon_from, horizon_to, status,
        trigger_reason, finished_at, duration_ms, stats)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9)
     RETURNING id`,
    [
      input.scenarioId,
      ENGINE_VERSION,
      inputHash,
      snapshot.horizon.from,
      snapshot.horizon.to,
      schedule.completed ? 'succeeded' : 'failed',
      input.triggerReason ?? null,
      input.durationMs,
      JSON.stringify({
        tasks: schedule.taskResults.length,
        timephasedCells: workload.timephased.length,
        findings: schedule.findings.length + workload.findings.length,
        ...(input.leveling === undefined
          ? {}
          : { leveled: 1, delayedTasks: input.leveling.delayedTasks, converged: input.leveling.converged ? 1 : 0 }),
      }),
    ],
  )
  const runId = run.rows[0]?.id
  if (runId === undefined) throw new Error('No se pudo crear la ejecución de cálculo')

  await insertTaskResults(db, runId, schedule)
  await insertTimephased(db, runId, workload)
  await insertCapacity(db, runId, workload)
  await insertFindings(db, runId, [...schedule.findings, ...workload.findings])
  await insertDerivations(db, runId, input.derivations)

  return runId
}

/**
 * Los instantes se guardan como la hora de pared del calendario interpretada
 * como UTC. La ida y vuelta es exacta y no depende de la zona del servidor.
 */
function toTimestamp(instant: PlanInstant): string {
  const hours = String(Math.floor(instant.minuteOfDay / 60)).padStart(2, '0')
  const minutes = String(instant.minuteOfDay % 60).padStart(2, '0')
  return `${instant.date}T${hours}:${minutes}:00Z`
}

export function fromTimestamp(value: Date): PlanInstant {
  const iso = value.toISOString()
  return {
    date: iso.slice(0, 10) as CalendarDate,
    minuteOfDay: value.getUTCHours() * 60 + value.getUTCMinutes(),
  }
}

async function insertTaskResults(db: Queryable, runId: string, schedule: ScheduleOutput): Promise<void> {
  await bulkInsert(
    db,
    'task_result',
    [
      'run_id', 'node_id', 'early_start', 'early_finish', 'late_start', 'late_finish',
      'scheduled_start', 'scheduled_finish', 'duration_minutes', 'work_minutes',
      'total_slack_minutes', 'free_slack_minutes', 'is_critical', 'cost_cents',
      'calendar_used_id', 'percent_complete_bp', 'leveling_delay_min',
    ],
    schedule.taskResults.map((result) => [
      runId,
      result.nodeId,
      toTimestamp(result.earlyStart),
      toTimestamp(result.earlyFinish),
      toTimestamp(result.lateStart),
      toTimestamp(result.lateFinish),
      toTimestamp(result.scheduledStart),
      toTimestamp(result.scheduledFinish),
      result.durationMinutes,
      result.workMinutes,
      result.totalSlackMinutes,
      result.freeSlackMinutes,
      result.isCritical,
      0,
      result.calendarUsedId,
      result.percentCompleteBp,
      result.levelingDelayMinutes,
    ]),
  )
}

async function insertTimephased(db: Queryable, runId: string, workload: WorkloadOutput): Promise<void> {
  await bulkInsert(
    db,
    'assignment_timephased',
    ['run_id', 'assignment_id', 'work_date', 'planned_minutes', 'leveled_minutes', 'cost_cents'],
    workload.timephased.map((cell) => [
      runId,
      cell.assignmentId,
      cell.date,
      cell.plannedMinutes,
      cell.plannedMinutes,
      cell.costCents,
    ]),
  )
}

/**
 * La huella de un bloque de capacidad, calculada **en la base**.
 *
 * En SQL y no en TypeScript a propósito: la migración que mudó los bloques
 * viejos usa esta misma expresión, y dos definiciones de «la misma capacidad»
 * es la forma segura de que una ejecución vieja y una nueva idénticas acaben
 * con dos bloques en vez de compartir uno.
 */
const HUELLA = `md5(string_agg(
       resource_id::text || '|' || work_date::text || '|' ||
       capacity_minutes::text || '|' || COALESCE(gross_minutes::text, ''),
       E'\n' ORDER BY resource_id, work_date))`

/**
 * Guarda la capacidad de una ejecución **sin repetirla**.
 *
 * La capacidad no depende del plan: sale del calendario de la persona, de sus
 * ausencias y de sus factores. Recalcular sin tocar un calendario producía
 * hasta ahora una copia byte a byte de lo que ya estaba guardado —medido: tres
 * cálculos seguidos, tres veces la misma huella y 3 MB—.
 *
 * Así que el bloque se guarda por su contenido. Si ya existe uno con esa
 * huella, la ejecución apunta al que hay y no se escribe ni una celda; si no,
 * nace uno. Se sigue guardando todo y se sigue pudiendo reproducir cualquier
 * ejecución entera: lo que desaparece es la copia, no el dato.
 */
async function insertCapacity(db: Queryable, runId: string, workload: WorkloadOutput): Promise<void> {
  const cells = workload.capacity.cells
  // Sin celdas no hay bloque, y la ejecución se queda con el `capacity_set_id`
  // nulo. Un bloque vacío compartido por todas las ejecuciones sin capacidad
  // sería más «uniforme» y diría que tienen capacidad: no la tienen.
  if (cells.length === 0) return

  const resourceIds = cells.map((cell) => cell.resourceId)
  const dates = cells.map((cell) => cell.date)
  const capacities = cells.map((cell) => cell.capacityMinutes)
  const gross = cells.map((cell) => cell.grossMinutes)

  // La huella sale de las mismas matrices que se van a insertar, así que no
  // puede describir algo distinto de lo que se guarda.
  const huella = await db.query<{ content_hash: string }>(
    `SELECT ${HUELLA} AS content_hash
     FROM unnest($1::uuid[], $2::date[], $3::int[], $4::int[])
          AS t(resource_id, work_date, capacity_minutes, gross_minutes)`,
    [resourceIds, dates, capacities, gross],
  )
  const contentHash = huella.rows[0]?.content_hash
  if (contentHash === undefined) throw new Error('No se pudo calcular la huella de la capacidad')

  // `DO NOTHING` + `SELECT` y no `DO UPDATE`: si el bloque ya existe no hay
  // nada que actualizar, y tocarlo movería el `created_at` de algo que no ha
  // cambiado.
  const creado = await db.query<{ id: string }>(
    `INSERT INTO capacity_set (content_hash, cell_count) VALUES ($1, $2)
     ON CONFLICT (content_hash) DO NOTHING RETURNING id`,
    [contentHash, cells.length],
  )
  const nuevo = creado.rows[0]?.id
  const setId =
    nuevo ??
    (
      await db.query<{ id: string }>('SELECT id FROM capacity_set WHERE content_hash = $1', [
        contentHash,
      ])
    ).rows[0]?.id
  if (setId === undefined) throw new Error('No se pudo resolver el bloque de capacidad')

  // Sólo se escriben las celdas del bloque que acaba de nacer. Si el bloque ya
  // estaba, esta ejecución no cuesta ni una fila.
  if (nuevo !== undefined) {
    await bulkInsert(
      db,
      'capacity_cell',
      ['capacity_set_id', 'resource_id', 'work_date', 'capacity_minutes', 'gross_minutes'],
      cells.map((cell) => [setId, cell.resourceId, cell.date, cell.capacityMinutes, cell.grossMinutes]),
    )
  }

  await db.query('UPDATE calculation_run SET capacity_set_id = $2 WHERE id = $1', [runId, setId])
}

async function insertFindings(db: Queryable, runId: string, findings: readonly Finding[]): Promise<void> {
  await bulkInsert(
    db,
    'finding',
    ['run_id', 'severity', 'code', 'entity_type', 'entity_id', 'occurs_on', 'message', 'payload'],
    findings.map((finding) => [
      runId,
      finding.severity,
      finding.code,
      finding.entityType,
      finding.entityId,
      finding.occursOn ?? null,
      finding.message,
      JSON.stringify(finding.payload ?? {}),
    ]),
  )
}

async function insertDerivations(db: Queryable, runId: string, derivations: readonly Derivation[]): Promise<void> {
  await bulkInsert(
    db,
    'derivation',
    ['run_id', 'target_type', 'target_id', 'rule_code', 'inputs', 'output_value'],
    derivations.map((derivation) => [
      runId,
      derivation.targetType,
      derivation.targetId,
      derivation.rule,
      JSON.stringify(derivation.inputs),
      JSON.stringify(derivation.output),
    ]),
  )
}

/**
 * Inserción masiva por lotes. PostgreSQL admite 65535 parámetros por sentencia,
 * así que el tamaño del lote se calcula a partir del número de columnas en vez
 * de fijarlo a ojo.
 */
async function bulkInsert(
  db: Queryable,
  table: string,
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
): Promise<void> {
  if (rows.length === 0) return
  const rowsPerChunk = Math.max(1, Math.floor(60_000 / columns.length))

  for (let offset = 0; offset < rows.length; offset += rowsPerChunk) {
    const chunk = rows.slice(offset, offset + rowsPerChunk)
    const values: unknown[] = []
    const tuples = chunk.map((row) => {
      const placeholders = row.map((value) => {
        values.push(value)
        return `$${String(values.length)}`
      })
      return `(${placeholders.join(', ')})`
    })
    await db.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`, values)
  }
}

/**
 * Borra las ejecuciones que nacieron a partir de un instante, con todo lo que
 * cuelga de ellas. Devuelve cuántas se fueron.
 *
 * Existe por las pruebas de integración, y conviene decir por qué en vez de
 * dejarlo como una utilidad suelta. Los ficheros de integración comparten UNA
 * base de datos y cada cálculo deja unas once mil filas en
 * `resource_capacity_timephased`. Nadie las borraba, así que una base de
 * desarrollo de unas semanas llega al millón de filas y las pruebas que
 * recalculan se vuelven lentas hasta agotar el plazo de vitest. El síntoma
 * parece un fallo de la prueba y es basura acumulada.
 *
 * **Una ejecución congelada en una línea base NO se borra.** La `baseline`
 * apunta a su ejecución con `ON DELETE NO ACTION` a propósito: una línea base
 * es la foto contra la que se compara, y borrarla sería perder la referencia,
 * no limpiar. Por eso se excluyen aquí en vez de dejar que la base grite.
 *
 * En producción no la llama nadie: una ejecución es historial, y decidir
 * cuánto historial se guarda no es una tarea de mantenimiento, es una decisión
 * de quien usa la herramienta.
 */
export async function deleteRunsSince(db: Queryable, since: Date): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM calculation_run r
      WHERE r.started_at >= $1
        AND NOT EXISTS (SELECT 1 FROM baseline b WHERE b.calculation_run_id = r.id)`,
    [since],
  )
  await deleteOrphanCapacitySets(db)
  return rowCount ?? 0
}

/**
 * Los bloques de capacidad que ya no usa ninguna ejecución.
 *
 * Hace falta porque el bloque es **compartido**: no puede colgar de una
 * ejecución con borrado en cascada, o borrar una se llevaría por delante la
 * capacidad de las otras cinco que la comparten. Así que se recogen después,
 * y sólo los que no mira nadie.
 */
export async function deleteOrphanCapacitySets(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM capacity_set s
      WHERE NOT EXISTS (SELECT 1 FROM calculation_run r WHERE r.capacity_set_id = s.id)`,
  )
  return rowCount ?? 0
}
