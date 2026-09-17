/**
 * El registro de cambios: quién tocó qué, cuándo y con qué comentario.
 *
 * La tabla `change_event` la escribe un trigger, no la aplicación, así que aquí
 * sólo se lee. Y se lee poniéndole nombre a las cosas: un `entity_id` en crudo
 * no le dice nada a nadie tres meses después, que es justamente cuando se
 * consulta un historial.
 */

import type { Queryable } from './db.js'

export interface ChangeEvent {
  readonly id: string
  readonly occurredAt: string
  /** Quién. `null` cuando el cambio es anterior al login o viene de la CLI. */
  readonly actorId: string | null
  readonly actorName: string | null
  /** Agrupa todos los cambios de una misma operación. */
  readonly requestId: string | null
  readonly operation: string
  readonly entityType: string
  readonly entityId: string
  /** El nombre de lo que cambió, si todavía se puede averiguar. */
  readonly entityName: string | null
  /** El proyecto al que pertenece, cuando lo tiene. */
  readonly projectId: string | null
  readonly before: unknown
  readonly after: unknown
  readonly comment: string | null
}

interface Row {
  id: string
  occurred_at: Date
  actor_id: string | null
  actor_name: string | null
  request_id: string | null
  operation: string
  entity_type: string
  entity_id: string
  entity_name: string | null
  project_id: string | null
  before_value: unknown
  after_value: unknown
  comment: string | null
}

/**
 * Los `LEFT JOIN` cubren las entidades que tienen nombre propio. Lo que no
 * aparezca en ninguno sale con `entityName` nulo, que es honesto: la fila del
 * historial sigue valiendo aunque ya no se pueda decir cómo se llamaba.
 */
const SELECT = `
  SELECT c.id::text, c.occurred_at, c.actor_id, u.display_name AS actor_name,
         c.request_id::text, c.operation, c.entity_type, c.entity_id::text,
         COALESCE(
           n.name, p.name, r.display_name, s.name,
           -- Una asignación y una dependencia no tienen nombre propio, pero sí
           -- una forma de decirse: quién en qué, y qué espera a qué.
           ar.display_name || ' en ' || an.name,
           dp.name || ' → ' || ds.name
         ) AS entity_name,
         COALESCE(n.project_id, p.id, an.project_id, ds.project_id)::text AS project_id,
         c.before_value, c.after_value, c.comment
  FROM change_event c
  LEFT JOIN app_user   u  ON u.id  = c.actor_id
  LEFT JOIN wbs_node   n  ON n.id  = c.entity_id
  LEFT JOIN project    p  ON p.id  = c.entity_id
  LEFT JOIN resource   r  ON r.id  = c.entity_id
  LEFT JOIN skill      s  ON s.id  = c.entity_id
  LEFT JOIN assignment a  ON a.id  = c.entity_id
  LEFT JOIN wbs_node   an ON an.id = a.node_id
  LEFT JOIN resource   ar ON ar.id = a.resource_id
  LEFT JOIN dependency d  ON d.id  = c.entity_id
  LEFT JOIN wbs_node   dp ON dp.id = d.predecessor_node_id
  LEFT JOIN wbs_node   ds ON ds.id = d.successor_node_id
`

function toEvent(row: Row): ChangeEvent {
  return {
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    actorId: row.actor_id,
    actorName: row.actor_name,
    requestId: row.request_id,
    operation: row.operation,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityName: row.entity_name,
    projectId: row.project_id,
    before: row.before_value,
    after: row.after_value,
    comment: row.comment,
  }
}

/** El historial de una entidad concreta: lo que se mira desde su ficha. */
export async function readEntityHistory(
  db: Queryable,
  entityId: string,
  limit = 100,
): Promise<readonly ChangeEvent[]> {
  const { rows } = await db.query<Row>(
    `${SELECT} WHERE c.entity_id = $1 ORDER BY c.occurred_at DESC, c.id DESC LIMIT $2`,
    [entityId, limit],
  )
  return rows.map(toEvent)
}

/** Lo último que ha pasado en toda la herramienta. */
export async function readRecentChanges(db: Queryable, limit = 200): Promise<readonly ChangeEvent[]> {
  const { rows } = await db.query<Row>(
    `${SELECT} ORDER BY c.occurred_at DESC, c.id DESC LIMIT $1`,
    [limit],
  )
  return rows.map(toEvent)
}
