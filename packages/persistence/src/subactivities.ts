/**
 * Partir las tareas de un proyecto en la cadena de subactividades de su
 * entregable — la parte que sí escribe.
 *
 * La decisión de qué se parte y cómo vive en `planSubactivities`, que es pura y
 * no toca nada. Aquí sólo se lee lo que esa función necesita y se aplica lo que
 * devuelve, **en una transacción y sin inventar nada por el camino**.
 *
 * ## Por qué esto es cirugía y no un `INSERT`
 *
 * La invariante W2 dice que un `task` no puede tener hijos. Partir una tarea es
 * por tanto: convertirla en `work_package`, quitarle su fila `task` —un
 * contenedor no se estima, agrega—, y crear sus hijos. Por el camino hay que
 * mudar lo que colgaba de ella: las asignaciones, el entregable que declaraba y
 * las dependencias que la ataban a otras tareas.
 *
 * Lo que **no** se mueve, porque no se puede: las horas fichadas. Por eso una
 * tarea con reales se descarta antes de llegar aquí.
 */

import type { ProposedSplit, SubactivityPlanResult } from '@planner/scheduler'
import type { Queryable } from './db.js'

/** Lo que hace falta leer para poder proponer. */
export interface SubactivityInputs {
  readonly tasks: readonly {
    nodeId: string
    name: string
    path: string
    kind: 'phase' | 'work_package' | 'task' | 'milestone'
    workDeclaredMinutes: number
    durationMinutes: number
    hasActuals: boolean
    alreadyExpanded: boolean
    isSubactivity: boolean
  }[]
  readonly deliveries: readonly { nodeId: string; documentTypeId: string }[]
  readonly assignments: readonly { nodeId: string; resourceId: string }[]
  readonly links: readonly { id: string; predecessorNodeId: string; successorNodeId: string }[]
}

/**
 * Todo lo del proyecto que decide la propuesta, en una consulta por cosa.
 *
 * `hasActuals` y `alreadyExpanded` se resuelven en la base y no contando filas
 * en TypeScript: son dos `EXISTS` y la alternativa es traerse las horas reales
 * enteras para preguntar si hay alguna.
 */
export async function readSubactivityInputs(
  db: Queryable,
  projectId: string,
): Promise<SubactivityInputs> {
  const nodos = await db.query<{
    id: string
    name: string
    path: string
    node_kind: 'phase' | 'work_package' | 'task' | 'milestone'
    work_declared_minutes: number | null
    duration_minutes: number | null
    tiene_reales: boolean
    ya_partida: boolean
    es_subactividad: boolean
  }>(
    `SELECT n.id, n.name, n.path, n.node_kind,
            t.work_declared_minutes, t.duration_minutes,
            EXISTS (SELECT 1 FROM actual_entry a WHERE a.node_id = n.id)      AS tiene_reales,
            EXISTS (SELECT 1 FROM node_activity v WHERE v.expanded_from = n.id) AS ya_partida,
            EXISTS (SELECT 1 FROM node_activity v WHERE v.node_id = n.id)        AS es_subactividad
     FROM wbs_node n
     LEFT JOIN task t ON t.node_id = n.id
     WHERE n.project_id = $1 AND n.deleted_at IS NULL
     ORDER BY n.path, n.id`,
    [projectId],
  )

  const entregas = await db.query<{ node_id: string; document_type_id: string }>(
    `SELECT nd.node_id, nd.document_type_id
     FROM node_document nd
     JOIN wbs_node n ON n.id = nd.node_id AND n.project_id = $1 AND n.deleted_at IS NULL
     JOIN document_type d ON d.id = nd.document_type_id AND d.deleted_at IS NULL
     ORDER BY nd.node_id, nd.document_type_id`,
    [projectId],
  )

  const asignaciones = await db.query<{ node_id: string; resource_id: string }>(
    `SELECT a.node_id, a.resource_id
     FROM assignment a
     JOIN wbs_node n ON n.id = a.node_id AND n.project_id = $1 AND n.deleted_at IS NULL
     WHERE a.deleted_at IS NULL
     ORDER BY a.node_id, a.resource_id`,
    [projectId],
  )

  // Las dependencias que tocan al proyecto por cualquiera de sus dos extremos:
  // una que cruza desde fuera también hay que re-engancharla.
  const enlaces = await db.query<{ id: string; predecessor_node_id: string; successor_node_id: string }>(
    `SELECT d.id, d.predecessor_node_id, d.successor_node_id
     FROM dependency d
     WHERE d.predecessor_node_id IN (SELECT id FROM wbs_node WHERE project_id = $1 AND deleted_at IS NULL)
        OR d.successor_node_id   IN (SELECT id FROM wbs_node WHERE project_id = $1 AND deleted_at IS NULL)
     ORDER BY d.id`,
    [projectId],
  )

  return {
    tasks: nodos.rows.map((row) => ({
      nodeId: row.id,
      name: row.name,
      path: row.path,
      kind: row.node_kind,
      workDeclaredMinutes: row.work_declared_minutes ?? 0,
      durationMinutes: row.duration_minutes ?? 0,
      hasActuals: row.tiene_reales,
      alreadyExpanded: row.ya_partida,
      isSubactivity: row.es_subactividad,
    })),
    deliveries: entregas.rows.map((row) => ({
      nodeId: row.node_id,
      documentTypeId: row.document_type_id,
    })),
    assignments: asignaciones.rows.map((row) => ({
      nodeId: row.node_id,
      resourceId: row.resource_id,
    })),
    links: enlaces.rows.map((row) => ({
      id: row.id,
      predecessorNodeId: row.predecessor_node_id,
      successorNodeId: row.successor_node_id,
    })),
  }
}

/** Cómo se llama cada paso en el nombre del nodo. Castellano: es el tipo fuente. */
const NOMBRE_DEL_PASO: Readonly<Record<string, string>> = {
  create: 'Crear',
  review_1: 'Revisar 1',
  review_2: 'Revisar 2',
  review_3: 'Revisar 3',
  support: 'Soportar',
}

export interface SplitApplied {
  readonly tasksSplit: number
  readonly childrenCreated: number
  readonly chainLinks: number
  readonly relinked: number
  readonly assignmentsMoved: number
}

/**
 * Aplica las particiones que se le den. **Sólo esas**: la pantalla manda los
 * nodos que el usuario dejó marcados, no «todas las que salieron».
 *
 * Todo dentro de la transacción que abre quien llama. Si algo revienta a la
 * mitad, no queda medio plan partido.
 */
export async function applySubactivitySplit(
  db: Queryable,
  propuesta: SubactivityPlanResult,
  nodeIds: readonly string[],
): Promise<SplitApplied> {
  const elegidos = new Set(nodeIds)
  const aplicar = propuesta.split.filter((p) => elegidos.has(p.nodeId))
  const resumen = { tasksSplit: 0, childrenCreated: 0, chainLinks: 0, relinked: 0, assignmentsMoved: 0 }

  for (const parte of aplicar) {
    const hijos = await partirUna(db, parte)
    resumen.tasksSplit += 1
    resumen.childrenCreated += hijos.length
    resumen.chainLinks += parte.chain.length
    resumen.relinked += parte.relinked.length
    resumen.assignmentsMoved += parte.movedResourceIds.length
  }
  return resumen
}

async function partirUna(db: Queryable, parte: ProposedSplit): Promise<readonly string[]> {
  const padre = await db.query<{ project_id: string; path: string }>(
    'SELECT project_id, path FROM wbs_node WHERE id = $1 AND deleted_at IS NULL',
    [parte.nodeId],
  )
  const datos = padre.rows[0]
  if (datos === undefined) throw new Error('La tarea que se iba a partir ya no está')

  // El calendario y el tipo de tarea de la madre pasan a los hijos: partir una
  // tarea no puede cambiar en qué calendario se cuenta su trabajo.
  const madre = await db.query<{ calendar_id: string | null; constraint_kind: string }>(
    'SELECT calendar_id, constraint_kind FROM task WHERE node_id = $1',
    [parte.nodeId],
  )
  const calendarId = madre.rows[0]?.calendar_id ?? null

  // 1. La tarea pasa a ser contenedor. Un contenedor no se estima: su fila de
  //    tarea se va y sus fechas y su trabajo pasan a ser la agregación de los
  //    hijos, que es lo que el motor ya sabe hacer.
  await db.query("UPDATE wbs_node SET node_kind = 'work_package' WHERE id = $1", [parte.nodeId])
  await db.query('DELETE FROM task WHERE node_id = $1', [parte.nodeId])

  // 2. Los hijos, en el orden de la cadena.
  const ids: string[] = []
  for (const hijo of parte.children) {
    const nombre = `${NOMBRE_DEL_PASO[hijo.step] ?? hijo.step} · ${hijo.role}`
    const path = `${datos.path}.${String(hijo.order + 1).padStart(2, '0')}`
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO wbs_node (project_id, parent_id, node_kind, code, path, sort_key, name)
       VALUES ($1, $2, 'task', $3, $4, $5, $6) RETURNING id`,
      [datos.project_id, parte.nodeId, String(hijo.order + 1), path, hijo.order, nombre],
    )
    const id = rows[0]?.id
    if (id === undefined) throw new Error('No se pudo crear la subactividad')
    ids.push(id)

    // El hijo lleva su trozo en la MISMA magnitud que su madre: si la tarea
    // declaraba trabajo, el hijo declara trabajo; si declaraba duración —lo
    // normal en este modelo—, el hijo declara duración. Meter el trozo en la
    // otra casilla dejaría la tarea en cero y el plan en nada.
    const esTrabajo = parte.magnitude === 'trabajo'
    await db.query(
      `INSERT INTO task (node_id, task_type, is_effort_driven, duration_minutes,
                         work_declared_minutes, calendar_id, constraint_kind, percent_complete_bp, is_milestone)
       VALUES ($1, $2::task_type, TRUE, $3, $4, $5, 'asap', 0, FALSE)`,
      [
        id,
        esTrabajo ? 'fixed_work' : 'fixed_duration',
        esTrabajo ? 0 : hijo.minutes,
        esTrabajo ? hijo.minutes : 0,
        calendarId,
      ],
    )
    await db.query(
      `INSERT INTO node_activity (node_id, document_type_id, step, position, expanded_from)
       VALUES ($1, $2, $3::activity_step, $4, $5)`,
      [id, parte.documentTypeId, hijo.step, hijo.position, parte.nodeId],
    )
  }

  // 3. La cadena interna, fin-comienzo y sin desfase: el catálogo dice el
  //    orden, no cuánto se espera. Misma decisión que la matriz de documentos.
  for (const [de, a] of parte.chain) {
    const antes = ids[de]
    const despues = ids[a]
    if (antes === undefined || despues === undefined) continue
    await db.query(
      `INSERT INTO dependency (predecessor_node_id, successor_node_id, dependency_kind, lag_minutes)
       VALUES ($1, $2, 'FS', 0) ON CONFLICT DO NOTHING`,
      [antes, despues],
    )
  }

  // 4. Las asignaciones se mudan a la puerta de entrada: quien estaba asignado
  //    a la tarea estaba haciéndola. A los demás pasos no se les inventa nadie.
  const entrada = parte.children.find((hijo) => hijo.takesAssignments)
  const destino = entrada === undefined ? undefined : ids[entrada.order]
  if (destino !== undefined) {
    await db.query(
      'UPDATE assignment SET node_id = $2 WHERE node_id = $1 AND deleted_at IS NULL',
      [parte.nodeId, destino],
    )
  }

  // 5. El entregable lo entrega la puerta que CIERRA: es a lo que espera el
  //    siguiente documento, y es lo que hace que la matriz siga funcionando
  //    después de partir.
  const cierra = parte.children.find((hijo) => hijo.isGate)
  const entregador = cierra === undefined ? undefined : ids[cierra.order]
  if (entregador !== undefined) {
    await db.query('UPDATE node_document SET node_id = $2 WHERE node_id = $1', [
      parte.nodeId,
      entregador,
    ])
  }

  // 6. Las dependencias que ataban la tarea pasan a atar sus puertas: lo que
  //    esperaba a la tarea espera ahora a su creación, y lo que esperaba por
  //    ella espera a su última revisión. Un enlace que quedara colgando del
  //    contenedor movería fechas sin decirlo.
  for (const enlace of parte.relinked) {
    const destinoId = ids[enlace.toOrder]
    if (destinoId === undefined) continue
    const columna = enlace.side === 'entrada' ? 'successor_node_id' : 'predecessor_node_id'
    await db.query(`UPDATE dependency SET ${columna} = $2 WHERE id = $1`, [
      enlace.dependencyId,
      destinoId,
    ])
  }

  return ids
}
