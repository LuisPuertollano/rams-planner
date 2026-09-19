/**
 * Partir la tarea en las entregas que pide la Checkliste — la parte que escribe.
 *
 * La decisión de qué se parte y en qué trozos vive en `planDeliveries`, que es
 * pura. Aquí sólo se lee lo que necesita y se aplica lo que devuelve, en la
 * transacción que abre quien llama.
 *
 * La cirugía es la misma que la de las subactividades (ADR-0039) y por la misma
 * invariante: un `task` no puede tener hijos (W2), así que partir es convertir
 * la tarea en `work_package`, quitarle su fila `task` y crear las entregas,
 * mudando por el camino lo que colgaba de ella.
 */

import type { DeliveryPlanResult, ProposedDeliverySplit } from '@planner/scheduler'
import type { Queryable } from './db.js'

/** El 100 % en puntos básicos, que es como viaja el reparto de la Checkliste. */
const TOTAL_BP = 10_000

/** Lo que hace falta leer para poder proponer. */
export interface DeliveryInputs {
  readonly tasks: readonly {
    nodeId: string
    name: string
    path: string
    kind: 'phase' | 'work_package' | 'task' | 'milestone'
    workDeclaredMinutes: number
    durationMinutes: number
    hasActuals: boolean
    alreadySplit: boolean
    isPiece: boolean
  }[]
  readonly deliveries: readonly { nodeId: string; documentTypeId: string }[]
  readonly assignments: readonly { nodeId: string; resourceId: string }[]
  readonly links: readonly { id: string; predecessorNodeId: string; successorNodeId: string }[]
}

/**
 * Todo lo del proyecto que decide la propuesta, en una consulta por cosa.
 *
 * `alreadySplit` mira las DOS particiones —por entregas y por subactividades—
 * porque las entregas van antes: una tarea ya partida en su cadena llega tarde
 * a esto, y proponerlo sería proponer algo que no significa nada.
 */
export async function readDeliveryInputs(
  db: Queryable,
  projectId: string,
): Promise<DeliveryInputs> {
  const nodos = await db.query<{
    id: string
    name: string
    path: string
    node_kind: 'phase' | 'work_package' | 'task' | 'milestone'
    work_declared_minutes: number | null
    duration_minutes: number | null
    tiene_reales: boolean
    ya_partida: boolean
    es_trozo: boolean
  }>(
    `SELECT n.id, n.name, n.path, n.node_kind,
            t.work_declared_minutes, t.duration_minutes,
            EXISTS (SELECT 1 FROM actual_entry a WHERE a.node_id = n.id)          AS tiene_reales,
            EXISTS (SELECT 1 FROM node_delivery v WHERE v.expanded_from = n.id)
              OR EXISTS (SELECT 1 FROM node_activity v WHERE v.expanded_from = n.id) AS ya_partida,
            EXISTS (SELECT 1 FROM node_delivery v WHERE v.node_id = n.id)
              OR EXISTS (SELECT 1 FROM node_activity v WHERE v.node_id = n.id)       AS es_trozo
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

  const enlaces = await db.query<{ id: string; predecessor_node_id: string; successor_node_id: string }>(
    `SELECT d.id, d.predecessor_node_id, d.successor_node_id
     FROM dependency d
     JOIN wbs_node n ON n.id IN (d.predecessor_node_id, d.successor_node_id)
     WHERE n.project_id = $1 AND n.deleted_at IS NULL
     GROUP BY d.id, d.predecessor_node_id, d.successor_node_id
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
      alreadySplit: row.ya_partida,
      isPiece: row.es_trozo,
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

export interface DeliverySplitApplied {
  readonly tasksSplit: number
  readonly deliveriesCreated: number
  readonly chainLinks: number
  readonly relinked: number
  readonly assignmentsCopied: number
}

/** Aplica las particiones que se le den. **Sólo esas**. */
export async function applyDeliverySplit(
  db: Queryable,
  propuesta: DeliveryPlanResult,
  nodeIds: readonly string[],
): Promise<DeliverySplitApplied> {
  const elegidos = new Set(nodeIds)
  const aplicar = propuesta.split.filter((p) => elegidos.has(p.nodeId))
  const resumen = {
    tasksSplit: 0, deliveriesCreated: 0, chainLinks: 0, relinked: 0, assignmentsCopied: 0,
  }
  for (const parte of aplicar) {
    const hijos = await partirUna(db, parte)
    resumen.tasksSplit += 1
    resumen.deliveriesCreated += hijos.length
    resumen.chainLinks += parte.chain.length
    resumen.relinked += parte.relinked.length
    resumen.assignmentsCopied += parte.copiedResourceIds.length
  }
  return resumen
}

async function partirUna(db: Queryable, parte: ProposedDeliverySplit): Promise<readonly string[]> {
  const padre = await db.query<{ project_id: string; path: string }>(
    'SELECT project_id, path FROM wbs_node WHERE id = $1 AND deleted_at IS NULL',
    [parte.nodeId],
  )
  const datos = padre.rows[0]
  if (datos === undefined) throw new Error('La tarea que se iba a partir ya no está')

  const madre = await db.query<{ calendar_id: string | null }>(
    'SELECT calendar_id FROM task WHERE node_id = $1',
    [parte.nodeId],
  )
  const calendarId = madre.rows[0]?.calendar_id ?? null

  // 1. La tarea pasa a ser contenedor: un contenedor no se estima, agrega.
  await db.query("UPDATE wbs_node SET node_kind = 'work_package' WHERE id = $1", [parte.nodeId])
  await db.query('DELETE FROM task WHERE node_id = $1', [parte.nodeId])

  // 2. Una tarea por entrega, en el orden de la Checkliste.
  const ids: string[] = []
  for (const entrega of parte.deliveries) {
    const nombre = entrega.isFinal
      ? parte.documentCode
      : `${parte.documentCode} · ${entrega.maturity ?? 'preliminar'}`
    const path = `${datos.path}.${String(entrega.order + 1).padStart(2, '0')}`
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO wbs_node (project_id, parent_id, node_kind, code, path, sort_key, name)
       VALUES ($1, $2, 'task', $3, $4, $5, $6) RETURNING id`,
      [datos.project_id, parte.nodeId, String(entrega.order + 1), path, entrega.order, nombre],
    )
    const id = rows[0]?.id
    if (id === undefined) throw new Error('No se pudo crear la entrega')
    ids.push(id)

    // El trozo va en la MISMA magnitud que traía la madre: meterlo en la otra
    // casilla dejaría la tarea en cero y el plan en nada (ADR-0039).
    const esTrabajo = parte.magnitude === 'trabajo'
    await db.query(
      `INSERT INTO task (node_id, task_type, is_effort_driven, duration_minutes,
                         work_declared_minutes, calendar_id, constraint_kind, percent_complete_bp, is_milestone)
       VALUES ($1, $2::task_type, TRUE, $3, $4, $5, 'asap', 0, FALSE)`,
      [
        id,
        esTrabajo ? 'fixed_work' : 'fixed_duration',
        esTrabajo ? 0 : entrega.minutes,
        esTrabajo ? entrega.minutes : 0,
        calendarId,
      ],
    )
    await db.query(
      `INSERT INTO node_delivery
         (node_id, document_type_id, position, gate, weeks_before_gate, maturity, is_final, expanded_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        parte.documentTypeId,
        entrega.order,
        entrega.gate === '' ? null : entrega.gate,
        entrega.weeksBeforeGate,
        entrega.maturity,
        entrega.isFinal,
        parte.nodeId,
      ],
    )
  }

  // 3. La cadena: cada entrega espera a la anterior, fin-comienzo y sin desfase.
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

  // 4. Las asignaciones se COPIAN a todas las entregas, y aquí está la
  //    diferencia con partir en subactividades.
  //
  //    Allí los otros pasos son otros papeles —quien crea no es quien revisa—
  //    y la herramienta no inventa a nadie: la asignación se muda a la entrada
  //    y los demás pasos quedan sin cubrir a propósito. Aquí no: el borrador y
  //    la versión final del FMECA son el MISMO trabajo de la MISMA persona en
  //    dos momentos. Mudar a la primera dejaría sin cubrir todo lo que viene
  //    después, y como una asignación sin trabajo declarado saca su trabajo de
  //    la duración de la tarea, esas horas no quedarían pendientes de asignar:
  //    desaparecerían del reparto sin que nadie lo notase.
  //
  //    El trabajo declarado, si lo hay, se parte en la misma proporción que la
  //    tarea. La ventana no se copia: una ventana que acotaba la tarea entera
  //    no dice nada de un trozo suyo, y arrastrarla dejaría fuera a las
  //    entregas tardías.
  const asignaciones = await db.query<{
    resource_id: string
    units_bp: number
    work_declared_minutes: number | null
    contour_kind: string
  }>(
    `SELECT resource_id, units_bp, work_declared_minutes, contour_kind
     FROM assignment WHERE node_id = $1 AND deleted_at IS NULL`,
    [parte.nodeId],
  )
  for (const [indice, entrega] of parte.deliveries.entries()) {
    const destino = ids[indice]
    if (destino === undefined) continue
    for (const asignacion of asignaciones.rows) {
      const declarado =
        asignacion.work_declared_minutes === null
          ? null
          : Math.round((asignacion.work_declared_minutes * entrega.shareBp) / TOTAL_BP)
      await db.query(
        `INSERT INTO assignment (node_id, resource_id, units_bp, work_declared_minutes, contour_kind)
         VALUES ($1, $2, $3, $4, $5::contour_kind)`,
        [destino, asignacion.resource_id, asignacion.units_bp, declarado, asignacion.contour_kind],
      )
    }
  }
  await db.query(
    'UPDATE assignment SET deleted_at = now() WHERE node_id = $1 AND deleted_at IS NULL',
    [parte.nodeId],
  )

  // 5. El entregable lo entrega la entrega FINAL: es a lo que espera el
  //    documento siguiente, y es lo que hace que la matriz siga funcionando.
  const final = parte.deliveries.find((entrega) => entrega.isFinal)
  const entregador = final === undefined ? undefined : ids[final.order]
  if (entregador !== undefined) {
    await db.query('UPDATE node_document SET node_id = $2 WHERE node_id = $1', [
      parte.nodeId,
      entregador,
    ])
  }

  // 6. Y las dependencias que ataban la tarea pasan a atar sus entregas.
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
