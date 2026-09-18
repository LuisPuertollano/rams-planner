/**
 * Documentos del equipo y el orden en que se pueden hacer.
 *
 * Son dos cosas separadas y conviene no mezclarlas:
 *
 *   - El **catálogo**: qué entregables existen. Es del equipo, no de un
 *     proyecto, y cambia muy poco.
 *   - La **matriz**: qué documento es condición necesaria de cuál. Se declara
 *     una vez y vale para todos los proyectos.
 *
 * Lo que conecta esto con un plan concreto es `node_document`: qué tarea
 * entrega qué documento. De ahí salen las dependencias sin teclearlas.
 */

import type { Queryable } from './db.js'

/**
 * Un catálogo de verdad mezcla tres cosas que se comportan distinto, y
 * llamarlas a todas «documento» obliga a adivinar mirando el nombre.
 */
export const DOCUMENT_KINDS = ['documento', 'hito', 'fase'] as const

export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

export interface DocumentType {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly kind: DocumentKind
  /** Safety, RAM, ILS… Texto libre: cada equipo tiene las suyas. */
  readonly discipline: string | null
  /** La puerta de certificación a la que va (TTG, IGR, IQA…). */
  readonly gate: string | null
  /** Semanas antes de esa puerta. Dato declarado; el motor todavía no lo usa. */
  readonly weeksBeforeGate: number | null
  /** El esfuerzo típico, en minutos (P5). Siembra la tarea que lo entrega. */
  readonly standardMinutes: number | null
  /** El código con el que se ficha en el sistema de partes de horas. */
  readonly taskCode: string | null
  readonly sortKey: number
  /** En cuántas tareas se entrega. Para no borrar algo que se está usando. */
  readonly usedInTasks: number
}

/** Los campos que se pueden escribir. El id, el orden y el uso no se tocan aquí. */
export interface DocumentTypeFields {
  readonly code: string
  readonly name: string
  readonly description?: string | null | undefined
  readonly kind?: DocumentKind | undefined
  readonly discipline?: string | null | undefined
  readonly gate?: string | null | undefined
  readonly weeksBeforeGate?: number | null | undefined
  readonly standardMinutes?: number | null | undefined
  readonly taskCode?: string | null | undefined
  readonly sortKey?: number | undefined
}

/**
 * Lo mismo, pero todo opcional: en una edición sólo llega lo que cambia.
 *
 * Escrito a mano y no con `Partial<DocumentTypeFields>` porque con
 * `exactOptionalPropertyTypes` no son lo mismo: `Partial` deja `code?: string`,
 * que rechaza un `undefined` explícito, y lo que llega del cuerpo de una
 * petición es exactamente eso.
 */
export interface DocumentTypeChanges {
  readonly code?: string | undefined
  readonly name?: string | undefined
  readonly description?: string | null | undefined
  readonly kind?: DocumentKind | undefined
  readonly discipline?: string | null | undefined
  readonly gate?: string | null | undefined
  readonly weeksBeforeGate?: number | null | undefined
  readonly standardMinutes?: number | null | undefined
  readonly taskCode?: string | null | undefined
  readonly sortKey?: number | undefined
}

/** La fila es condición necesaria de la columna. */
export interface DocumentPrecedence {
  readonly predecessorId: string
  readonly successorId: string
  readonly note: string | null
}

export async function readDocumentTypes(db: Queryable): Promise<readonly DocumentType[]> {
  const { rows } = await db.query<{
    id: string
    code: string
    name: string
    description: string | null
    kind: DocumentKind
    discipline: string | null
    gate: string | null
    weeks_before_gate: number | null
    standard_minutes: number | null
    task_code: string | null
    sort_key: number
    used_in_tasks: number
  }>(
    `SELECT d.id, d.code, d.name, d.description, d.kind, d.discipline, d.gate,
            d.weeks_before_gate, d.standard_minutes, d.task_code, d.sort_key,
            (SELECT count(*) FROM node_document nd
              JOIN wbs_node n ON n.id = nd.node_id AND n.deleted_at IS NULL
             WHERE nd.document_type_id = d.id)::int AS used_in_tasks
     FROM document_type d
     WHERE d.deleted_at IS NULL
     ORDER BY d.sort_key, d.name, d.id`,
  )
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    kind: row.kind,
    discipline: row.discipline,
    gate: row.gate,
    weeksBeforeGate: row.weeks_before_gate,
    standardMinutes: row.standard_minutes,
    taskCode: row.task_code,
    sortKey: row.sort_key,
    usedInTasks: row.used_in_tasks,
  }))
}

export async function readPrecedences(db: Queryable): Promise<readonly DocumentPrecedence[]> {
  const { rows } = await db.query<{ predecessor_id: string; successor_id: string; note: string | null }>(
    `SELECT p.predecessor_id, p.successor_id, p.note
     FROM document_precedence p
     JOIN document_type a ON a.id = p.predecessor_id AND a.deleted_at IS NULL
     JOIN document_type b ON b.id = p.successor_id   AND b.deleted_at IS NULL
     ORDER BY p.predecessor_id, p.successor_id`,
  )
  return rows.map((row) => ({
    predecessorId: row.predecessor_id,
    successorId: row.successor_id,
    note: row.note,
  }))
}

export async function createDocumentType(db: Queryable, input: DocumentTypeFields): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO document_type (code, name, description, kind, discipline, gate,
                                weeks_before_gate, standard_minutes, task_code, sort_key)
     VALUES ($1, $2, $3, COALESCE($4::document_kind, 'documento'), $5, $6, $7, $8, $9,
             COALESCE($10, (SELECT COALESCE(MAX(sort_key), 0) + 10 FROM document_type)))
     RETURNING id`,
    [
      input.code,
      input.name,
      input.description ?? null,
      input.kind ?? null,
      input.discipline ?? null,
      input.gate ?? null,
      input.weeksBeforeGate ?? null,
      input.standardMinutes ?? null,
      input.taskCode ?? null,
      input.sortKey ?? null,
    ],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('No se pudo crear el documento')
  return id
}

export async function updateDocumentType(
  db: Queryable,
  id: string,
  changes: DocumentTypeChanges,
): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = [id]
  const set = (columna: string, valor: unknown, molde = ''): void => {
    values.push(valor)
    sets.push(`${columna} = $${String(values.length)}${molde}`)
  }
  if (changes.code !== undefined) set('code', changes.code)
  if (changes.name !== undefined) set('name', changes.name)
  if (changes.description !== undefined) set('description', changes.description)
  if (changes.kind !== undefined) set('kind', changes.kind, '::document_kind')
  if (changes.discipline !== undefined) set('discipline', changes.discipline)
  if (changes.gate !== undefined) set('gate', changes.gate)
  if (changes.weeksBeforeGate !== undefined) set('weeks_before_gate', changes.weeksBeforeGate)
  if (changes.standardMinutes !== undefined) set('standard_minutes', changes.standardMinutes)
  if (changes.taskCode !== undefined) set('task_code', changes.taskCode)
  if (changes.sortKey !== undefined) set('sort_key', changes.sortKey)
  if (sets.length === 0) return
  await db.query(`UPDATE document_type SET ${sets.join(', ')} WHERE id = $1`, values)
}

/**
 * Los predecesores de un documento, de golpe.
 *
 * Es la operación que hace falta para editar la matriz por filas en vez de
 * casilla a casilla: con ochenta entregables, marcar seis cruces en una rejilla
 * de 6.400 es una tarea de puntería, y esto es «este espera a estos seis».
 *
 * **Sustituye la lista entera**: lo que no venga se borra. Es lo que permite
 * que volver a importar un fichero corregido corrija de verdad, en vez de
 * acumular los enlaces viejos con los nuevos.
 */
export async function setPredecessors(
  db: Queryable,
  successorId: string,
  predecessorIds: readonly string[],
): Promise<void> {
  const limpios = [...new Set(predecessorIds)].filter((id) => id !== successorId)
  await db.query(
    'DELETE FROM document_precedence WHERE successor_id = $1 AND NOT (predecessor_id = ANY($2::uuid[]))',
    [successorId, limpios],
  )
  if (limpios.length === 0) return
  await db.query(
    `INSERT INTO document_precedence (predecessor_id, successor_id)
     SELECT unnest($2::uuid[]), $1 ON CONFLICT DO NOTHING`,
    [successorId, limpios],
  )
}

/**
 * Baja lógica, como todo lo demás. Un documento retirado desaparece de la
 * matriz y de las fichas, pero las tareas que ya lo entregaron siguen
 * apuntando a él: el plan de hace dos años tiene que seguir explicándose.
 */
export async function softDeleteDocumentType(db: Queryable, id: string): Promise<void> {
  await db.query('UPDATE document_type SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [id])
}

/** Marcar o desmarcar una casilla de la matriz. */
export async function setPrecedence(
  db: Queryable,
  predecessorId: string,
  successorId: string,
  required: boolean,
): Promise<void> {
  if (!required) {
    await db.query('DELETE FROM document_precedence WHERE predecessor_id = $1 AND successor_id = $2', [
      predecessorId,
      successorId,
    ])
    return
  }
  await db.query(
    `INSERT INTO document_precedence (predecessor_id, successor_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [predecessorId, successorId],
  )
}

/** Qué documentos entrega cada tarea de un proyecto. */
export async function readNodeDocuments(
  db: Queryable,
  projectId?: string,
): Promise<readonly { readonly nodeId: string; readonly documentTypeId: string }[]> {
  const { rows } = await db.query<{ node_id: string; document_type_id: string }>(
    `SELECT nd.node_id, nd.document_type_id
     FROM node_document nd
     JOIN wbs_node n ON n.id = nd.node_id AND n.deleted_at IS NULL
     WHERE $1::uuid IS NULL OR n.project_id = $1
     ORDER BY nd.node_id, nd.document_type_id`,
    [projectId ?? null],
  )
  return rows.map((row) => ({ nodeId: row.node_id, documentTypeId: row.document_type_id }))
}

/**
 * Lo mismo pero con el proyecto de cada tarea, para poder recortar por
 * permisos sin volver a preguntar a la base de datos por cada fila.
 */
export async function readNodeDocumentsWithProject(
  db: Queryable,
): Promise<readonly { readonly nodeId: string; readonly documentTypeId: string; readonly projectId: string }[]> {
  const { rows } = await db.query<{ node_id: string; document_type_id: string; project_id: string }>(
    `SELECT nd.node_id, nd.document_type_id, n.project_id
     FROM node_document nd
     JOIN wbs_node n ON n.id = nd.node_id AND n.deleted_at IS NULL
     ORDER BY nd.node_id, nd.document_type_id`,
  )
  return rows.map((row) => ({
    nodeId: row.node_id,
    documentTypeId: row.document_type_id,
    projectId: row.project_id,
  }))
}

export async function setNodeDocument(
  db: Queryable,
  nodeId: string,
  documentTypeId: string,
  delivers: boolean,
): Promise<void> {
  if (!delivers) {
    await db.query('DELETE FROM node_document WHERE node_id = $1 AND document_type_id = $2', [
      nodeId,
      documentTypeId,
    ])
    return
  }
  await db.query(
    'INSERT INTO node_document (node_id, document_type_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [nodeId, documentTypeId],
  )
}

/**
 * Los nodos de un proyecto, con lo justo para enseñar una propuesta: nombre y
 * ruta. No lleva fechas porque aplicar la matriz no necesita ninguna ejecución
 * de cálculo previa; lo que se aplica es la estructura, no el calendario.
 */
export interface ProjectNode {
  readonly nodeId: string
  readonly name: string
  readonly path: string
  readonly kind: string
}

export async function readProjectNodes(db: Queryable, projectId: string): Promise<readonly ProjectNode[]> {
  const { rows } = await db.query<{ id: string; name: string; path: string; node_kind: string }>(
    `SELECT id, name, path, node_kind
     FROM wbs_node
     WHERE project_id = $1 AND deleted_at IS NULL
     ORDER BY path, id`,
    [projectId],
  )
  return rows.map((row) => ({ nodeId: row.id, name: row.name, path: row.path, kind: row.node_kind }))
}
