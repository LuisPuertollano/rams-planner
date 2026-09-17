/**
 * Alta, baja y modificación de la estructura del plan.
 *
 * Es el otro lado de la importación de CSV: lo mismo que hace el fichero, pero
 * de uno en uno y desde la pantalla. Todo lo de aquí es dato DECLARADO (P1) y
 * ninguna función toca una tabla derivada.
 *
 * El `path` del árbol WBS se mantiene aquí, no en un trigger: es la clave de
 * ordenación de todas las lecturas, y cuando se mueve o se borra un nodo hay
 * que recalcularlo para todo el subárbol. Hacerlo en un sitio y bien es más
 * barato que repartirlo.
 */

import type { Queryable } from './db.js'

const SEGMENT_WIDTH = 3

const segment = (index: number): string => String(index).padStart(SEGMENT_WIDTH, '0')

export interface ProjectInput {
  readonly code: string
  readonly name: string
  readonly statusStart: string
  readonly calendarCode?: string | undefined
  /** `true` crea una plantilla: un molde que no se calcula ni genera carga. */
  readonly asTemplate?: boolean | undefined
}

export async function createProject(db: Queryable, input: ProjectInput): Promise<string> {
  const calendar = await db.query<{ id: string }>(
    `SELECT id FROM calendar WHERE deleted_at IS NULL AND ($1::text IS NULL OR code = $1)
     ORDER BY (code = $1) DESC, code LIMIT 1`,
    [input.calendarCode ?? null],
  )
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO project (code, name, calendar_id, status_start, priority, currency, is_template)
     VALUES ($1, $2, $3, $4, 500, 'EUR', $5) RETURNING id`,
    [input.code, input.name, calendar.rows[0]?.id ?? null, input.statusStart, input.asTemplate ?? false],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('No se pudo crear el proyecto')
  return id
}

export interface ProjectChanges {
  readonly code?: string | undefined
  readonly name?: string | undefined
  readonly statusStart?: string | undefined
  readonly priority?: number | undefined
  readonly isTemplate?: boolean | undefined
}

/**
 * La fecha de referencia de un proyecto es lo que ancla todas sus tareas sin
 * predecesora ni restricción. Cambiarla mueve el proyecto entero, y por eso es
 * un dato declarado que se edita, no una constante escondida en el alta.
 */
export async function updateProject(db: Queryable, projectId: string, changes: ProjectChanges): Promise<void> {
  const columns: string[] = []
  const values: unknown[] = [projectId]
  const set = (column: string, value: unknown): void => {
    values.push(value)
    columns.push(`${column} = $${String(values.length)}`)
  }
  if (changes.code !== undefined) set('code', changes.code)
  if (changes.name !== undefined) set('name', changes.name)
  if (changes.statusStart !== undefined) set('status_start', changes.statusStart)
  if (changes.priority !== undefined) set('priority', changes.priority)
  if (changes.isTemplate !== undefined) set('is_template', changes.isTemplate)
  if (columns.length === 0) throw new Error('No hay nada que cambiar')
  await db.query(`UPDATE project SET ${columns.join(', ')} WHERE id = $1`, values)
}

export async function softDeleteProject(db: Queryable, projectId: string): Promise<void> {
  await db.query('UPDATE project SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [projectId])
  await db.query(
    `UPDATE assignment SET deleted_at = now()
     WHERE deleted_at IS NULL
       AND node_id IN (SELECT id FROM wbs_node WHERE project_id = $1)`,
    [projectId],
  )
  await db.query('UPDATE wbs_node SET deleted_at = now() WHERE project_id = $1 AND deleted_at IS NULL', [projectId])
}

export type NodeKind = 'phase' | 'work_package' | 'task' | 'milestone'

export interface NodeInput {
  readonly projectId: string
  readonly parentId?: string | null | undefined
  readonly kind: NodeKind
  readonly name: string
  /** Sólo para hojas. Un hito ignora la duración: por definición dura cero. */
  readonly durationMinutes?: number | undefined
}

/**
 * Crea un nodo al final de sus hermanos.
 *
 * El padre tiene que ser un contenedor y estar en el mismo proyecto: meter una
 * tarea debajo de otra tarea rompería la invariante W3 (sólo las hojas tienen
 * datos de planificación) de una forma que luego no se ve.
 */
export async function createNode(db: Queryable, input: NodeInput): Promise<string> {
  const parentId = input.parentId ?? null

  let parentPath = ''
  if (parentId !== null) {
    const parent = await db.query<{ path: string; node_kind: string; project_id: string }>(
      'SELECT path, node_kind, project_id FROM wbs_node WHERE id = $1 AND deleted_at IS NULL',
      [parentId],
    )
    const row = parent.rows[0]
    if (row === undefined) throw new Error('El nodo padre no existe')
    if (row.project_id !== input.projectId) throw new Error('El nodo padre es de otro proyecto')
    if (row.node_kind !== 'phase' && row.node_kind !== 'work_package') {
      throw new Error('Sólo se puede colgar trabajo de una fase o de un paquete de trabajo')
    }
    parentPath = row.path
  }

  const siblings = await db.query<{ next: number }>(
    `SELECT COALESCE(MAX(sort_key), -1) + 1 AS next FROM wbs_node
     WHERE project_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND deleted_at IS NULL`,
    [input.projectId, parentId],
  )
  const sortKey = siblings.rows[0]?.next ?? 0
  const path = parentPath === '' ? segment(sortKey + 1) : `${parentPath}.${segment(sortKey + 1)}`

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO wbs_node (project_id, parent_id, node_kind, code, path, sort_key, name)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.projectId, parentId, input.kind, String(sortKey + 1), path, sortKey, input.name],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('No se pudo crear el nodo')

  if (input.kind === 'task' || input.kind === 'milestone') {
    const isMilestone = input.kind === 'milestone'
    await db.query(
      `INSERT INTO task (node_id, task_type, is_effort_driven, duration_minutes, work_declared_minutes,
                         constraint_kind, percent_complete_bp, is_milestone)
       VALUES ($1, 'fixed_duration', TRUE, $2, 0, 'asap', 0, $3)`,
      [id, isMilestone ? 0 : (input.durationMinutes ?? 480), isMilestone],
    )
  }
  return id
}

export async function renameNode(db: Queryable, nodeId: string, name: string): Promise<void> {
  await db.query('UPDATE wbs_node SET name = $2 WHERE id = $1', [nodeId, name])
}

/**
 * Baja lógica del nodo y de todo lo que cuelga de él (P7).
 *
 * El subárbol se resuelve por `path`, que es para lo que está materializado. Se
 * usa el prefijo `path || '.'` para no llevarse por delante a un hermano cuyo
 * path empiece igual: '001.01' no es hijo de '001.0'.
 */
export async function softDeleteNode(db: Queryable, nodeId: string): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE wbs_node SET deleted_at = now()
     WHERE deleted_at IS NULL
       AND project_id = (SELECT project_id FROM wbs_node WHERE id = $1)
       AND (id = $1 OR path LIKE (SELECT path FROM wbs_node WHERE id = $1) || '.%')`,
    [nodeId],
  )
  // Y las asignaciones de esa rama, por la misma razón que en la baja de una
  // persona: que la carga desaparezca sin dejar rastro sería peor que borrarla.
  await db.query(
    `UPDATE assignment SET deleted_at = now()
     WHERE deleted_at IS NULL
       AND node_id IN (SELECT id FROM wbs_node WHERE deleted_at IS NOT NULL)`,
  )
  return rowCount ?? 0
}

// ---------------------------------------------------------------------------
// Asignaciones
// ---------------------------------------------------------------------------

/**
 * Asigna a alguien a una tarea, o le cambia la dedicación si ya estaba.
 *
 * El `ON CONFLICT` no es comodidad: la invariante A1 dice que una persona
 * aparece una sola vez en una tarea, y reasignar a quien ya está es lo que el
 * usuario quiere decir cuando lo intenta dos veces. Si la asignación estaba de
 * baja, esto la revive.
 */
export async function upsertAssignment(
  db: Queryable,
  nodeId: string,
  resourceId: string,
  unitsBp: number,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO assignment (node_id, resource_id, units_bp, contour_kind)
     VALUES ($1, $2, $3, 'flat')
     ON CONFLICT (node_id, resource_id)
     DO UPDATE SET units_bp = EXCLUDED.units_bp, deleted_at = NULL
     RETURNING id`,
    [nodeId, resourceId, unitsBp],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('No se pudo guardar la asignación')
  return id
}

export async function softDeleteAssignment(db: Queryable, assignmentId: string): Promise<void> {
  await db.query('UPDATE assignment SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [assignmentId])
}

export interface AssignmentRow {
  readonly id: string
  readonly nodeId: string
  /** El proyecto de la tarea. Viaja para poder recortar por permisos. */
  readonly projectId: string
  readonly resourceId: string
  readonly unitsBp: number
}

export async function readAssignments(db: Queryable): Promise<readonly AssignmentRow[]> {
  const { rows } = await db.query<{
    id: string
    node_id: string
    project_id: string
    resource_id: string
    units_bp: number
  }>(
    `SELECT a.id, a.node_id, n.project_id, a.resource_id, a.units_bp
     FROM assignment a JOIN wbs_node n ON n.id = a.node_id
     WHERE a.deleted_at IS NULL AND n.deleted_at IS NULL
     ORDER BY n.path`,
  )
  return rows.map((row) => ({
    id: row.id,
    nodeId: row.node_id,
    projectId: row.project_id,
    resourceId: row.resource_id,
    unitsBp: row.units_bp,
  }))
}

// ---------------------------------------------------------------------------
// Dependencias
// ---------------------------------------------------------------------------

export type DependencyKind = 'FS' | 'SS' | 'FF' | 'SF'

export async function addDependency(
  db: Queryable,
  predecessorNodeId: string,
  successorNodeId: string,
  kind: DependencyKind,
  lagMinutes: number,
): Promise<string> {
  if (predecessorNodeId === successorNodeId) throw new Error('Una tarea no puede depender de sí misma')
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO dependency (predecessor_node_id, successor_node_id, dependency_kind, lag_minutes)
     VALUES ($1, $2, $3::dependency_kind, $4)
     ON CONFLICT (predecessor_node_id, successor_node_id)
     DO UPDATE SET dependency_kind = EXCLUDED.dependency_kind, lag_minutes = EXCLUDED.lag_minutes
     RETURNING id`,
    [predecessorNodeId, successorNodeId, kind, lagMinutes],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('No se pudo guardar la dependencia')
  return id
}

export async function deleteDependency(db: Queryable, id: string): Promise<void> {
  await db.query('DELETE FROM dependency WHERE id = $1', [id])
}

export interface DependencyRow {
  readonly id: string
  readonly predecessorNodeId: string
  readonly successorNodeId: string
  /** Los proyectos de los dos extremos. Una dependencia puede cruzarlos. */
  readonly predecessorProjectId: string
  readonly successorProjectId: string
  readonly kind: string
  readonly lagMinutes: number
}

export async function readDependencies(db: Queryable): Promise<readonly DependencyRow[]> {
  const { rows } = await db.query<{
    id: string
    predecessor_node_id: string
    successor_node_id: string
    predecessor_project_id: string
    successor_project_id: string
    dependency_kind: string
    lag_minutes: number
  }>(
    `SELECT d.id, d.predecessor_node_id, d.successor_node_id,
            p.project_id AS predecessor_project_id,
            s.project_id AS successor_project_id,
            d.dependency_kind, d.lag_minutes
     FROM dependency d
     JOIN wbs_node p ON p.id = d.predecessor_node_id AND p.deleted_at IS NULL
     JOIN wbs_node s ON s.id = d.successor_node_id   AND s.deleted_at IS NULL`,
  )
  return rows.map((row) => ({
    id: row.id,
    predecessorNodeId: row.predecessor_node_id,
    successorNodeId: row.successor_node_id,
    predecessorProjectId: row.predecessor_project_id,
    successorProjectId: row.successor_project_id,
    kind: row.dependency_kind,
    lagMinutes: row.lag_minutes,
  }))
}
