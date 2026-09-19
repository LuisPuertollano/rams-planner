/**
 * Las puertas de certificación de un proyecto, y los objetivos que salen de
 * ellas — la parte que sí escribe.
 *
 * La decisión de qué objetivo le toca a cada tarea vive en `planGateDeadlines`,
 * que es pura y no toca nada. Aquí sólo se lee lo que esa función necesita, se
 * declaran las fechas de las puertas, y se aplica lo que devuelve.
 */

import type { GatePlanResult } from '@planner/scheduler'
import type { Queryable } from './db.js'

/** Una puerta del proyecto, con su fecha y para qué es. */
export interface ProjectGateRow {
  readonly gate: string
  readonly date: string
  readonly notes: string | null
}

/** Las puertas declaradas de un proyecto, por orden de fecha. */
export async function readProjectGates(
  db: Queryable,
  projectId: string,
): Promise<readonly ProjectGateRow[]> {
  const { rows } = await db.query<{ gate: string; gate_date: string; notes: string | null }>(
    `SELECT gate, gate_date::text AS gate_date, notes
     FROM project_gate WHERE project_id = $1
     ORDER BY gate_date, gate`,
    [projectId],
  )
  return rows.map((row) => ({ gate: row.gate, date: row.gate_date, notes: row.notes }))
}

/**
 * Deja las puertas del proyecto exactamente como se las declara.
 *
 * Borra sólo lo que ya no viene, en vez de vaciar y volver a insertar: vaciar
 * es lo que rompió los enlaces de las firmas en ADR-0037, y la lección se paga
 * una vez.
 */
export async function setProjectGates(
  db: Queryable,
  projectId: string,
  gates: readonly { gate: string; date: string; notes: string | null }[],
): Promise<void> {
  const nombres = gates.map((puerta) => puerta.gate.trim())
  await db.query(
    `DELETE FROM project_gate
     WHERE project_id = $1 AND upper(btrim(gate)) <> ALL ($2::text[])`,
    [projectId, nombres.map((nombre) => nombre.toUpperCase())],
  )
  for (const [i, puerta] of gates.entries()) {
    await db.query(
      `INSERT INTO project_gate (project_id, gate, gate_date, notes)
       VALUES ($1, $2, $3::date, $4)
       ON CONFLICT (project_id, gate)
       DO UPDATE SET gate_date = EXCLUDED.gate_date, notes = EXCLUDED.notes`,
      [projectId, nombres[i] ?? '', puerta.date, puerta.notes],
    )
  }
}

/** Lo que hace falta leer para poder proponer objetivos. */
export interface GateInputs {
  readonly tasks: readonly {
    nodeId: string
    name: string
    path: string
    kind: 'phase' | 'work_package' | 'task' | 'milestone'
    deadline: string | null
    ownGate?: { gate: string; weeksBeforeGate: number | null } | undefined
  }[]
  readonly deliveries: readonly { nodeId: string; documentTypeId: string }[]
  readonly documents: readonly {
    documentTypeId: string
    code: string
    name: string
    gate: string | null
    weeksBeforeGate: number | null
  }[]
  readonly gates: readonly { gate: string; date: string }[]
  readonly projectStart: string
}

/** Todo lo del proyecto que decide la propuesta, en una consulta por cosa. */
export async function readGateInputs(db: Queryable, projectId: string): Promise<GateInputs> {
  const proyecto = await db.query<{ status_start: string }>(
    'SELECT status_start::text AS status_start FROM project WHERE id = $1 AND deleted_at IS NULL',
    [projectId],
  )
  const arranque = proyecto.rows[0]?.status_start
  if (arranque === undefined) throw new Error('El proyecto no existe')

  const nodos = await db.query<{
    id: string
    name: string
    path: string
    node_kind: 'phase' | 'work_package' | 'task' | 'milestone'
    deadline: string | null
    own_gate: string | null
    own_weeks: number | null
  }>(
    // La puerta propia sale de `node_delivery` cuando la tarea es una entrega
    // concreta: el borrador va a una puerta anterior a la del entregable.
    `SELECT n.id, n.name, n.path, n.node_kind, t.deadline::text AS deadline,
            v.gate AS own_gate, v.weeks_before_gate AS own_weeks
     FROM wbs_node n
     LEFT JOIN task t ON t.node_id = n.id
     LEFT JOIN node_delivery v ON v.node_id = n.id
     WHERE n.project_id = $1 AND n.deleted_at IS NULL
     ORDER BY n.path, n.id`,
    [projectId],
  )

  // Qué documento entrega cada tarea, por las DOS vías. `node_document` es la
  // declarada a mano y se muda a la entrega final al partir; `node_delivery`
  // dice que la tarea es una versión concreta de un documento, y sin ella un
  // borrador se quedaba fuera por «sin entregable» — que es justo la tarea a la
  // que esto tiene que ponerle su fecha. El DISTINCT está porque la entrega
  // final aparece por las dos y contarla dos veces la descartaría por
  // «varios entregables».
  const entregas = await db.query<{ node_id: string; document_type_id: string }>(
    `SELECT DISTINCT node_id, document_type_id FROM (
       SELECT nd.node_id, nd.document_type_id
       FROM node_document nd
       JOIN wbs_node n ON n.id = nd.node_id AND n.project_id = $1 AND n.deleted_at IS NULL
       JOIN document_type d ON d.id = nd.document_type_id AND d.deleted_at IS NULL
       UNION ALL
       SELECT v.node_id, v.document_type_id
       FROM node_delivery v
       JOIN wbs_node n ON n.id = v.node_id AND n.project_id = $1 AND n.deleted_at IS NULL
       JOIN document_type d ON d.id = v.document_type_id AND d.deleted_at IS NULL
     ) AS todas
     ORDER BY node_id, document_type_id`,
    [projectId],
  )

  const documentos = await db.query<{
    id: string
    code: string
    name: string
    gate: string | null
    weeks_before_gate: number | null
  }>(
    `SELECT id, code, name, gate, weeks_before_gate
     FROM document_type WHERE deleted_at IS NULL ORDER BY code`,
  )

  return {
    tasks: nodos.rows.map((row) => ({
      nodeId: row.id,
      name: row.name,
      path: row.path,
      kind: row.node_kind,
      deadline: row.deadline,
      ...(row.own_gate === null
        ? {}
        : { ownGate: { gate: row.own_gate, weeksBeforeGate: row.own_weeks } }),
    })),
    deliveries: entregas.rows.map((row) => ({
      nodeId: row.node_id,
      documentTypeId: row.document_type_id,
    })),
    documents: documentos.rows.map((row) => ({
      documentTypeId: row.id,
      code: row.code,
      name: row.name,
      gate: row.gate,
      weeksBeforeGate: row.weeks_before_gate,
    })),
    gates: (await readProjectGates(db, projectId)).map((puerta) => ({
      gate: puerta.gate,
      date: puerta.date,
    })),
    projectStart: arranque,
  }
}

export interface GatesApplied {
  readonly deadlinesSet: number
  readonly deadlinesChanged: number
}

/**
 * Pone los objetivos que se le den. **Sólo esos**: la pantalla manda los nodos
 * que el usuario dejó marcados, no «todos los que salieron».
 *
 * Escribe `task.deadline` y nada más. El objetivo es blando —no mueve la tarea,
 * genera `DEADLINE_MISSED` cuando el plan no llega—, así que esto no reordena
 * ningún plan: le pone a cada tarea el día en que su puerta la espera.
 */
export async function applyGateDeadlines(
  db: Queryable,
  propuesta: GatePlanResult,
  nodeIds: readonly string[],
): Promise<GatesApplied> {
  const elegidos = new Set(nodeIds)
  const aplicar = propuesta.set.filter((objetivo) => elegidos.has(objetivo.nodeId))
  let nuevos = 0
  let cambiados = 0

  for (const objetivo of aplicar) {
    const { rowCount } = await db.query(
      `UPDATE task SET deadline = $2::date WHERE node_id = $1`,
      [objetivo.nodeId, objetivo.deadline],
    )
    // Un hito y una tarea tienen fila en `task`; si no la hay, el nodo se ha
    // ido entre mirar y aceptar y no se inventa una.
    if (rowCount === 0) continue
    if (objetivo.previous === null) nuevos += 1
    else cambiados += 1
  }
  return { deadlinesSet: nuevos, deadlinesChanged: cambiados }
}
