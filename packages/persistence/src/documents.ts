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

import type {
  ActivityStep,
  DocumentActivity,
  PreviousDelivery,
  Signature,
  SignatureStep,
} from '@planner/domain'
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

// ---------------------------------------------------------------------------
// El ciclo de firma
// ---------------------------------------------------------------------------

/**
 * Una firma declarada de un entregable. **Por rol, nunca por persona**: aquí no
 * hay ni va a haber un `resource_id`. Quién ocupa hoy el puesto de «Jefe RAMS»
 * es un dato de personas que cambia; el catálogo dice que hace falta uno.
 */
export interface DocumentSignature extends Signature {
  readonly documentTypeId: string
}

/**
 * Todas las firmas del catálogo, de una vez.
 *
 * De una vez y no por entregable a propósito: la pantalla las quiere todas y
 * ochenta consultas para pintar una tabla es la forma más fácil de convertir
 * una pantalla rápida en una lenta.
 *
 * El orden es estable (P2): por entregable, por paso en el orden del ciclo
 * —autor, verificador, aprobador, revisor— y por posición.
 */
export async function readSignatures(db: Queryable): Promise<readonly DocumentSignature[]> {
  const { rows } = await db.query<{
    document_type_id: string
    step: SignatureStep
    position: number
    role: string
    standard_minutes: number | null
  }>(
    `SELECT s.document_type_id, s.step, s.position, s.role, s.standard_minutes
     FROM document_signature s
     JOIN document_type d ON d.id = s.document_type_id AND d.deleted_at IS NULL
     ORDER BY s.document_type_id,
              array_position(ARRAY['author','verifier','approver','reviewer']::signature_step[], s.step),
              s.position`,
  )
  return rows.map((row) => ({
    documentTypeId: row.document_type_id,
    step: row.step,
    position: row.position,
    role: row.role,
    standardMinutes: row.standard_minutes,
  }))
}

/**
 * El ciclo de firma de un entregable, de golpe.
 *
 * **Sustituye el ciclo entero**: lo que no venga se borra. Misma decisión que
 * `setPredecessors`, y por lo mismo — volver a importar un fichero corregido
 * tiene que corregir, no acumular la tabla vieja con la nueva.
 *
 * Los roles en blanco se descartan aquí y no en la base: una casilla vacía del
 * CSV no es un error del fichero, es una casilla vacía.
 *
 * **Se borra lo que sobra, no todo.** Antes esto era un `DELETE` entero seguido
 * de un `INSERT`, que daba el mismo resultado y era más corto. Dejó de valer
 * cuando `document_activity` empezó a apuntar a estas filas: borrar una firma
 * que va a volver a existir un milisegundo después deja a la subactividad que
 * la descargaba apuntando a nada, en silencio. Guardar el ciclo sin tocarlo no
 * puede desenganchar nada.
 */
export async function setSignatures(
  db: Queryable,
  documentTypeId: string,
  firmas: readonly Signature[],
): Promise<void> {
  const limpias = firmas.filter((firma) => firma.role.trim() !== '')
  await db.query(
    `DELETE FROM document_signature s
      WHERE s.document_type_id = $1
        AND NOT EXISTS (
              SELECT 1 FROM unnest($2::text[], $3::smallint[]) AS q(step, position)
               WHERE q.step::signature_step = s.step AND q.position = s.position)`,
    [documentTypeId, limpias.map((firma) => firma.step), limpias.map((firma) => firma.position)],
  )
  if (limpias.length === 0) return
  await db.query(
    `INSERT INTO document_signature (document_type_id, step, position, role, standard_minutes)
     SELECT $1, step::signature_step, position, role, standard_minutes
     FROM unnest($2::text[], $3::smallint[], $4::text[], $5::integer[])
          AS t(step, position, role, standard_minutes)
     ON CONFLICT (document_type_id, step, position) DO UPDATE
       SET role = EXCLUDED.role, standard_minutes = EXCLUDED.standard_minutes`,
    [
      documentTypeId,
      limpias.map((firma) => firma.step),
      limpias.map((firma) => firma.position),
      limpias.map((firma) => firma.role.trim()),
      limpias.map((firma) => firma.standardMinutes),
    ],
  )
}

// ---------------------------------------------------------------------------
// Las subactividades
// ---------------------------------------------------------------------------

/**
 * Una subactividad declarada de un entregable: crear, revisar en tres niveles,
 * soportar. **Por rol, nunca por persona**, igual que la firma y por lo mismo.
 */
export interface DocumentActivityRow extends DocumentActivity {
  readonly documentTypeId: string
}

/**
 * Todas las subactividades del catálogo, de una vez. Misma razón que
 * `readSignatures`: la pantalla las quiere todas.
 *
 * El orden es estable (P2): por entregable, por paso en el orden de la cadena
 * —crear, tres niveles de revisión, soporte— y por posición.
 */
export async function readActivities(db: Queryable): Promise<readonly DocumentActivityRow[]> {
  const { rows } = await db.query<{
    document_type_id: string
    step: ActivityStep
    position: number
    role: string
    standard_minutes: number | null
    signature_step: SignatureStep | null
    signature_position: number | null
  }>(
    `SELECT a.document_type_id, a.step, a.position, a.role, a.standard_minutes,
            a.signature_step, a.signature_position
     FROM document_activity a
     JOIN document_type d ON d.id = a.document_type_id AND d.deleted_at IS NULL
     ORDER BY a.document_type_id,
              array_position(
                ARRAY['create','review_1','review_2','review_3','support']::activity_step[], a.step),
              a.position`,
  )
  return rows.map((row) => ({
    documentTypeId: row.document_type_id,
    step: row.step,
    position: row.position,
    role: row.role,
    standardMinutes: row.standard_minutes,
    signature:
      row.signature_step === null || row.signature_position === null
        ? null
        : { step: row.signature_step, position: row.signature_position },
  }))
}

/**
 * Las subactividades de un entregable, de golpe. Sustituye la lista entera:
 * misma decisión que `setSignatures`, y por lo mismo.
 *
 * Una subactividad que dice descargar una firma que no existe se guarda **sin
 * la firma**, no se rechaza. El catálogo se llena en dos pantallas y en
 * cualquier orden; negarse a guardar el trabajo porque la firma todavía no está
 * declarada obligaría a rellenarlas en un orden concreto que nadie ha pedido.
 * La regla de dominio lo dirá cuando toque mirarlo.
 */
export async function setActivities(
  db: Queryable,
  documentTypeId: string,
  actividades: readonly DocumentActivity[],
): Promise<void> {
  const limpias = actividades.filter((actividad) => actividad.role.trim() !== '')
  await db.query('DELETE FROM document_activity WHERE document_type_id = $1', [documentTypeId])
  if (limpias.length === 0) return
  await db.query(
    `INSERT INTO document_activity
        (document_type_id, step, position, role, standard_minutes, signature_step, signature_position)
     SELECT $1, t.step::activity_step, t.position, t.role, t.standard_minutes,
            f.step, f.position
     FROM unnest($2::text[], $3::smallint[], $4::text[], $5::integer[], $6::text[], $7::smallint[])
          AS t(step, position, role, standard_minutes, signature_step, signature_position)
     LEFT JOIN document_signature f
            ON f.document_type_id = $1
           AND f.step = t.signature_step::signature_step
           AND f.position = t.signature_position
     ON CONFLICT (document_type_id, step, position) DO UPDATE
       SET role = EXCLUDED.role,
           standard_minutes = EXCLUDED.standard_minutes,
           signature_step = EXCLUDED.signature_step,
           signature_position = EXCLUDED.signature_position`,
    [
      documentTypeId,
      limpias.map((actividad) => actividad.step),
      limpias.map((actividad) => actividad.position),
      limpias.map((actividad) => actividad.role.trim()),
      limpias.map((actividad) => actividad.standardMinutes),
      limpias.map((actividad) => actividad.signature?.step ?? null),
      limpias.map((actividad) => actividad.signature?.position ?? null),
    ],
  )
}

/** Una entrega previa, con el entregable al que pertenece. */
export interface DocumentGateRow extends PreviousDelivery {
  readonly documentTypeId: string
}

/**
 * Las entregas previas del catálogo entero, en una consulta.
 *
 * Se leen todas de golpe por lo mismo que las firmas y las subactividades: la
 * pantalla las enseña juntas y una consulta por fila sería ochenta viajes.
 */
export async function readDeliveries(db: Queryable): Promise<readonly DocumentGateRow[]> {
  const { rows } = await db.query<{
    document_type_id: string
    position: number
    gate: string
    maturity: string
    weeks_before_gate: number | null
    share_bp: number
  }>(
    `SELECT g.document_type_id, g.position, g.gate, g.maturity, g.weeks_before_gate, g.share_bp
     FROM document_gate g
     JOIN document_type d ON d.id = g.document_type_id AND d.deleted_at IS NULL
     ORDER BY g.document_type_id, g.position`,
  )
  return rows.map((row) => ({
    documentTypeId: row.document_type_id,
    position: row.position,
    gate: row.gate,
    maturity: row.maturity,
    weeksBeforeGate: row.weeks_before_gate,
    shareBp: row.share_bp,
  }))
}

/**
 * Deja las entregas previas de un entregable exactamente como se declaran.
 *
 * Reemplaza la lista entera, igual que los predecesores y el ciclo de firma:
 * es lo que hace que volver a cargar un fichero corregido corrija de verdad.
 * Aquí se puede borrar y reinsertar sin miedo —a diferencia de las firmas, de
 * las que cuelgan las subactividades— porque nada apunta a estas filas.
 */
export async function setDeliveries(
  db: Queryable,
  documentTypeId: string,
  entregas: readonly PreviousDelivery[],
): Promise<void> {
  await db.query('DELETE FROM document_gate WHERE document_type_id = $1', [documentTypeId])
  for (const entrega of entregas) {
    await db.query(
      `INSERT INTO document_gate
         (document_type_id, position, gate, maturity, weeks_before_gate, share_bp)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        documentTypeId,
        entrega.position,
        entrega.gate.trim(),
        entrega.maturity.trim(),
        entrega.weeksBeforeGate,
        entrega.shareBp,
      ],
    )
  }
}
