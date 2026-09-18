/**
 * Orquestación del cálculo: cargar el snapshot, pasarlo por el motor puro y
 * guardar el resultado como una ejecución identificada.
 *
 * El recálculo es **explícito** (`POST /api/calculate`): nada se recalcula por
 * arte de magia al leer una pantalla, porque entonces no se sabría de qué
 * ejecución vienen los números.
 */

import { addDays, calendarDate } from '@planner/domain'
import { createDerivationCollector } from '@planner/explain'
import { schedulePlan } from '@planner/scheduler'
import { computeWorkload, levelPlan } from '@planner/workload'
import {
  loadSnapshot,
  saveRun,
  withTransaction,
  type Pool,
  type Queryable,
} from '@planner/persistence'
import type { CalendarDate } from '@planner/domain'
import type { Horizon } from '@planner/calendar'

export interface CalculationSummary {
  readonly runId: string
  readonly durationMs: number
  readonly tasks: number
  readonly timephasedCells: number
  readonly findings: number
  readonly completed: boolean
  /** Sólo en ejecuciones niveladas. */
  readonly leveledTasks?: number
  readonly converged?: boolean
}

/**
 * El horizonte del cálculo, sacado de los datos y no de un número fijo.
 *
 * Antes eran cuatro años contados desde el proyecto más temprano, y eso se
 * rompió en cuanto entraron planes de verdad (ADR-0040): el horizonte es
 * **global** —uno para toda la instalación— y tiene que llegar desde el
 * proyecto más antiguo hasta el final del más largo. Con una cartera que va de
 * 2017 a 2031 eso son catorce años, no cuatro, y **16 de 34 proyectos reales no
 * cabían**: el motor los rechazaba con `OUT_OF_HORIZON` y no había forma de
 * calcular nada.
 *
 * Así que se calcula. Lo que se mira, todo declarado y disponible **antes** de
 * programar —que es la pega, porque el calendario se compila sobre el horizonte
 * y por tanto el horizonte no puede depender del resultado—:
 *
 *   - la fecha de arranque de cada proyecto,
 *   - las fechas atadas a mano: restricciones y fechas límite,
 *   - y **la cadena más larga de duraciones declaradas**, que es una cota
 *     superior de lo que el motor va a necesitar y se saca del grafo de
 *     dependencias con un recorrido, sin programar nada.
 *
 * Sobre eso, un margen de un año, un suelo de cuatro y un techo.
 */

/** Lo que duraba antes. Se queda como SUELO para que nada se encoja. */
const SUELO_DIAS = 365 * 4

/**
 * El techo, y por qué existe.
 *
 * El horizonte multiplica la tabla de capacidad: son las personas por los días
 * laborables del tramo. Con veinticinco personas, un año son unas 6.500 filas.
 * Veinticinco años, 163.000 — que hoy es **un solo bloque** compartido por
 * todas las ejecuciones (ADR-0035) y por tanto barato, pero un fichero mal
 * importado con una fecha de 2199 no puede llevarse la base por delante.
 *
 * Si el techo llega a apretar, el motor dirá `OUT_OF_HORIZON` como siempre. Es
 * mejor un error que dice qué pasa que una tabla de diez gigas que nadie pidió.
 */
const TECHO_DIAS = 365 * 25

/** El margen por detrás de lo declarado: el motor casi siempre estira algo. */
const MARGEN_DIAS = 365

const MINUTOS_POR_DIA_LABORABLE = 480
/** Días naturales por día laborable. Siete entre cinco, redondeado hacia arriba. */
const NATURALES_POR_LABORABLE = 1.5

export async function resolveHorizonFor(db: Queryable): Promise<Horizon> {
  const { rows } = await db.query<{
    earliest: string | null
    latest: string | null
    longest_minutes: string | null
  }>(
    `WITH RECURSIVE hoja AS (
       SELECT n.id, COALESCE(t.duration_minutes, 0) AS dur
       FROM wbs_node n
       JOIN task t ON t.node_id = n.id
       WHERE n.deleted_at IS NULL
     ),
     -- La cadena más larga de duraciones declaradas. Es una cota superior de
     -- lo que el motor va a pedir: en el peor caso todo va en fila.
     camino AS (
       SELECT h.id, h.dur AS largo, 1 AS saltos
       FROM hoja h
       WHERE NOT EXISTS (SELECT 1 FROM dependency d WHERE d.successor_node_id = h.id)
       UNION ALL
       SELECT h.id, c.largo + h.dur, c.saltos + 1
       FROM camino c
       JOIN dependency d ON d.predecessor_node_id = c.id
       JOIN hoja h ON h.id = d.successor_node_id
       -- El tope de saltos no es prudencia: el esquema NO impide un ciclo de
       -- dependencias —se avisa, no se prohíbe (ADR-0016)— y sin él este
       -- recorrido no terminaría nunca. Mil eslabones es más profundo que
       -- cualquier plan de verdad; si alguna vez aprieta, la cota sale corta y
       -- el motor lo dice con OUT_OF_HORIZON, que es un fallo que se entiende.
       WHERE c.saltos < 1000
     )
     SELECT (SELECT MIN(status_start)::text FROM project WHERE deleted_at IS NULL) AS earliest,
            (SELECT MAX(cuando)::text FROM (
               SELECT MAX(status_start) AS cuando FROM project WHERE deleted_at IS NULL
               UNION ALL
               SELECT MAX(t.constraint_date) FROM task t
                 JOIN wbs_node n ON n.id = t.node_id AND n.deleted_at IS NULL
               UNION ALL
               SELECT MAX(t.deadline) FROM task t
                 JOIN wbs_node n ON n.id = t.node_id AND n.deleted_at IS NULL
             ) AS fechas) AS latest,
            (SELECT MAX(largo)::text FROM camino) AS longest_minutes`,
  )
  const fila = rows[0]
  const from = addDays(calendarDate(fila?.earliest ?? '2026-01-01'), -31)

  // Lo que hace falta por lo que alguien ha atado a una fecha.
  const hastaLaUltimaFecha =
    fila?.latest == null ? 0 : diasEntre(from, calendarDate(fila.latest))
  // Lo que hace falta por la cadena más larga, pasado a días naturales.
  const cadenaMinutos = Number(fila?.longest_minutes ?? 0)
  const hastaLaCadena = Number.isFinite(cadenaMinutos)
    ? Math.ceil((cadenaMinutos / MINUTOS_POR_DIA_LABORABLE) * NATURALES_POR_LABORABLE)
    : 0

  const pedido = Math.max(hastaLaUltimaFecha, hastaLaCadena) + MARGEN_DIAS
  const dias = Math.min(TECHO_DIAS, Math.max(SUELO_DIAS, pedido))
  return { from, to: addDays(from, dias) }
}

/**
 * Crea las particiones anuales que el horizonte vaya a necesitar.
 *
 * `assignment_timephased` está particionada por año, y el esquema inicial dejó
 * sembrados 2024–2035 y una función para crear las que falten cuyo comentario
 * dice, literalmente, «la llama el worker al ampliar el horizonte». **No la
 * llamaba nadie.** Mientras el horizonte fueron cuatro años fijos desde 2026 la
 * siembra bastaba y el agujero no se veía; en cuanto el horizonte salió de los
 * datos y alcanzó 2023 —hay proyectos que arrancaron entonces—, la escritura
 * reventó con «no partition of relation found for row».
 *
 * Es idempotente y barato: una consulta por año del tramo, y la función no hace
 * nada si la partición ya está.
 */
async function asegurarParticiones(db: Queryable, horizon: Horizon): Promise<void> {
  const desde = Number(horizon.from.slice(0, 4))
  const hasta = Number(horizon.to.slice(0, 4))
  if (!Number.isFinite(desde) || !Number.isFinite(hasta)) return
  for (let año = desde; año <= hasta; año += 1) {
    await db.query('SELECT ensure_assignment_timephased_partition($1)', [año])
  }
}

/** Días naturales entre dos fechas, nunca negativo. */
function diasEntre(desde: CalendarDate, hasta: CalendarDate): number {
  const uno = Date.parse(`${desde}T00:00:00Z`)
  const otro = Date.parse(`${hasta}T00:00:00Z`)
  if (!Number.isFinite(uno) || !Number.isFinite(otro)) return 0
  return Math.max(0, Math.round((otro - uno) / 86_400_000))
}

export async function calculate(
  pool: Pool,
  scenarioId: string,
  reason: string,
  options: { readonly level?: boolean } = {},
): Promise<CalculationSummary> {
  const started = Date.now()
  const collector = createDerivationCollector()

  return withTransaction(pool, async (db) => {
    const horizon = await resolveHorizonFor(db)
    await asegurarParticiones(db, horizon)
    const snapshot = await loadSnapshot(db, { horizon })

    // Nivelar produce su **propia ejecución**, no una columna más: así se
    // compara con la vista que ya existe y se ve qué ha costado que quepa.
    const leveled = options.level === true ? levelPlan(snapshot) : null
    const schedule =
      leveled?.schedule ??
      schedulePlan(snapshot, { derivations: collector.sink })
    const workload =
      leveled?.workload ??
      computeWorkload(snapshot, schedule, { derivations: collector.sink })
    const durationMs = Date.now() - started

    const runId = await saveRun(db, {
      scenarioId,
      snapshot,
      schedule: leveled === null ? schedule : { ...schedule, findings: [...schedule.findings, ...leveled.findings] },
      workload,
      derivations: collector.derivations,
      triggerReason: reason,
      durationMs,
      ...(leveled === null
        ? {}
        : { leveling: { delayedTasks: leveled.delays.size, converged: leveled.converged } }),
    })

    return {
      runId,
      durationMs,
      tasks: schedule.taskResults.length,
      timephasedCells: workload.timephased.length,
      findings: schedule.findings.length + workload.findings.length + (leveled?.findings.length ?? 0),
      completed: schedule.completed,
      ...(leveled === null ? {} : { leveledTasks: leveled.delays.size, converged: leveled.converged }),
    }
  })
}

export async function defaultScenarioId(db: Queryable): Promise<string> {
  const existing = await db.query<{ id: string }>(
    "SELECT id FROM scenario WHERE scenario_kind = 'working' ORDER BY created_at LIMIT 1",
  )
  const found = existing.rows[0]?.id
  if (found !== undefined) return found
  const created = await db.query<{ id: string }>(
    "INSERT INTO scenario (name, scenario_kind, description) VALUES ('Plan vivo', 'working', 'Escenario de trabajo por defecto') RETURNING id",
  )
  const id = created.rows[0]?.id
  if (id === undefined) throw new Error('No se pudo crear el escenario por defecto')
  return id
}
