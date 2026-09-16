/**
 * Copiar un proyecto entero: su árbol, sus tareas y sus dependencias.
 *
 * Es la única operación de la que salen las plantillas, y de ahí viene su
 * forma. Las tres cosas que se piden en la práctica son la misma operación con
 * distinto destino:
 *
 *   - «guardar este proyecto como plantilla»  → copiar a una plantilla
 *   - «proyecto nuevo a partir de esta plantilla» → copiar a un proyecto
 *   - «duplicar este proyecto»                → copiar a un proyecto
 *
 * Lo que NO se copia nunca son las personas: una plantilla describe el trabajo,
 * no quién lo hace, y un proyecto nuevo tampoco hereda el equipo del viejo
 * (eso siempre se decide mirando quién tiene hueco, no copiando). La base de
 * datos lo hace cumplir con un trigger sobre `assignment`.
 */

import type { Queryable } from './db.js'

export interface DuplicateOptions {
  /** Código del proyecto nuevo. Único, como el de cualquier proyecto. */
  readonly code: string
  readonly name: string
  /** Fecha de referencia del proyecto nuevo. Las restricciones se desplazan con ella. */
  readonly statusStart: string
  /** `true` para que el resultado sea una plantilla en vez de un proyecto. */
  readonly asTemplate?: boolean | undefined
}

export interface DuplicateResult {
  readonly projectId: string
  readonly nodes: number
  readonly dependencies: number
  /** Restricciones y fechas objetivo desplazadas junto con la fecha de referencia. */
  readonly shiftedDates: number
}

/**
 * Copia `sourceProjectId` en un proyecto nuevo.
 *
 * Sobre las fechas: en el origen hay restricciones («no empezar antes del…») y
 * fechas objetivo que son absolutas. Copiarlas tal cual pondría el proyecto
 * nuevo a trabajar con las fechas del viejo; borrarlas perdería información que
 * alguien declaró. Se desplazan por la diferencia en días naturales entre las
 * dos fechas de referencia, que es predecible y se puede explicar en una frase.
 * El resultado dice cuántas se han movido para que no sea una sorpresa.
 */
export async function duplicateProject(
  db: Queryable,
  sourceProjectId: string,
  options: DuplicateOptions,
): Promise<DuplicateResult> {
  const source = await db.query<{
    calendar_id: string | null
    status_start: string
    priority: number
    currency: string
  }>(
    `SELECT calendar_id, status_start::text, priority, currency
     FROM project WHERE id = $1 AND deleted_at IS NULL`,
    [sourceProjectId],
  )
  const origin = source.rows[0]
  if (origin === undefined) throw new Error('El proyecto de origen no existe')

  const shiftDays = daysBetween(origin.status_start, options.statusStart)

  const created = await db.query<{ id: string }>(
    `INSERT INTO project (code, name, calendar_id, status_start, priority, currency, is_template)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      options.code,
      options.name,
      origin.calendar_id,
      options.statusStart,
      origin.priority,
      origin.currency,
      options.asTemplate ?? false,
    ],
  )
  const projectId = created.rows[0]?.id
  if (projectId === undefined) throw new Error('No se pudo crear el proyecto')

  // El árbol se copia en orden de `path`, así que un padre siempre se crea
  // antes que sus hijos y su identificador nuevo ya está en el mapa.
  const nodes = await db.query<{
    id: string
    parent_id: string | null
    node_kind: string
    code: string | null
    path: string
    sort_key: number
    name: string
    notes: string | null
  }>(
    `SELECT id, parent_id, node_kind, code, path, sort_key, name, notes
     FROM wbs_node WHERE project_id = $1 AND deleted_at IS NULL ORDER BY path`,
    [sourceProjectId],
  )

  const newIdOf = new Map<string, string>()
  for (const node of nodes.rows) {
    const parentId = node.parent_id === null ? null : (newIdOf.get(node.parent_id) ?? null)
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO wbs_node (project_id, parent_id, node_kind, code, path, sort_key, name, notes)
       VALUES ($1, $2, $3::node_kind, $4, $5, $6, $7, $8) RETURNING id`,
      [projectId, parentId, node.node_kind, node.code, node.path, node.sort_key, node.name, node.notes],
    )
    const newId = inserted.rows[0]?.id
    if (newId === undefined) throw new Error('No se pudo copiar el árbol')
    newIdOf.set(node.id, newId)
  }

  const tasks = await db.query<{
    node_id: string
    task_type: string
    is_effort_driven: boolean
    duration_minutes: number
    work_declared_minutes: number
    calendar_id: string | null
    constraint_kind: string
    constraint_date: string | null
    deadline: string | null
    standard_effort_minutes: number | null
    is_milestone: boolean
  }>(
    `SELECT t.node_id, t.task_type, t.is_effort_driven, t.duration_minutes, t.work_declared_minutes,
            t.calendar_id, t.constraint_kind, t.constraint_date::text, t.deadline::text,
            t.standard_effort_minutes, t.is_milestone
     FROM task t JOIN wbs_node n ON n.id = t.node_id
     WHERE n.project_id = $1 AND n.deleted_at IS NULL`,
    [sourceProjectId],
  )

  let shiftedDates = 0
  for (const task of tasks.rows) {
    const nodeId = newIdOf.get(task.node_id)
    if (nodeId === undefined) continue
    const constraintDate = shiftDate(task.constraint_date, shiftDays)
    const deadline = shiftDate(task.deadline, shiftDays)
    if (shiftDays !== 0) {
      if (task.constraint_date !== null) shiftedDates += 1
      if (task.deadline !== null) shiftedDates += 1
    }
    // El avance no se copia: un proyecto nuevo empieza a cero, y una plantilla
    // con un 60 % hecho no significaría nada.
    await db.query(
      `INSERT INTO task (node_id, task_type, is_effort_driven, duration_minutes, work_declared_minutes,
                         calendar_id, constraint_kind, constraint_date, deadline,
                         percent_complete_bp, standard_effort_minutes, is_milestone)
       VALUES ($1, $2::task_type, $3, $4, $5, $6, $7::constraint_kind, $8, $9, 0, $10, $11)`,
      [
        nodeId,
        task.task_type,
        task.is_effort_driven,
        task.duration_minutes,
        task.work_declared_minutes,
        task.calendar_id,
        task.constraint_kind,
        constraintDate,
        deadline,
        task.standard_effort_minutes,
        task.is_milestone,
      ],
    )
  }

  // Sólo las dependencias internas al proyecto. Una que apuntase fuera ataría
  // el proyecto nuevo al plan del viejo, que es justo lo que nadie quiere al
  // partir de una plantilla.
  const dependencies = await db.query<{
    predecessor_node_id: string
    successor_node_id: string
    dependency_kind: string
    lag_minutes: number
  }>(
    `SELECT d.predecessor_node_id, d.successor_node_id, d.dependency_kind, d.lag_minutes
     FROM dependency d
     JOIN wbs_node s ON s.id = d.successor_node_id
     JOIN wbs_node q ON q.id = d.predecessor_node_id
     WHERE s.project_id = $1 AND q.project_id = $1
       AND s.deleted_at IS NULL AND q.deleted_at IS NULL`,
    [sourceProjectId],
  )

  let copiedDependencies = 0
  for (const dependency of dependencies.rows) {
    const predecessor = newIdOf.get(dependency.predecessor_node_id)
    const successor = newIdOf.get(dependency.successor_node_id)
    if (predecessor === undefined || successor === undefined) continue
    await db.query(
      `INSERT INTO dependency (predecessor_node_id, successor_node_id, dependency_kind, lag_minutes)
       VALUES ($1, $2, $3::dependency_kind, $4)`,
      [predecessor, successor, dependency.dependency_kind, dependency.lag_minutes],
    )
    copiedDependencies += 1
  }

  // Los requisitos de competencia viajan con la tarea por la misma razón que
  // la duración: dicen qué trabajo es, no quién lo hizo la última vez.
  for (const [oldId, newId] of newIdOf) {
    await db.query(
      `INSERT INTO node_skill_requirement (node_id, skill_id, min_level)
       SELECT $2, skill_id, min_level FROM node_skill_requirement WHERE node_id = $1
       ON CONFLICT (node_id, skill_id) DO NOTHING`,
      [oldId, newId],
    )
  }

  // Los campos del dominio (la disciplina RAMS, por ejemplo) viajan con la
  // tarea: son parte de lo que describe el trabajo, no de su ejecución.
  for (const [oldId, newId] of newIdOf) {
    await db.query(
      `INSERT INTO field_value (field_id, entity_id, value_text, value_number, value_integer,
                                value_date, value_boolean, value_json)
       SELECT field_id, $2, value_text, value_number, value_integer, value_date, value_boolean, value_json
       FROM field_value WHERE entity_id = $1`,
      [oldId, newId],
    )
  }

  return { projectId, nodes: newIdOf.size, dependencies: copiedDependencies, shiftedDates }
}

/**
 * Días naturales entre dos fechas de calendario.
 *
 * Aritmética sobre el día juliano, sin `Date`: el dominio prohíbe `Date` porque
 * reinterpreta los años de dos cifras y arrastra zonas horarias que una fecha
 * de calendario no tiene.
 */
function daysBetween(from: string, to: string): number {
  return toDayNumber(to) - toDayNumber(from)
}

function shiftDate(date: string | null, days: number): string | null {
  if (date === null) return null
  if (days === 0) return date
  return fromDayNumber(toDayNumber(date) + days)
}

/** Algoritmo de Howard Hinnant: días desde una época fija, sin librerías. */
function toDayNumber(iso: string): number {
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  const day = Number(iso.slice(8, 10))
  const y = year - (month <= 2 ? 1 : 0)
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146_097 + doe
}

function fromDayNumber(days: number): string {
  const era = Math.floor(days / 146_097)
  const doe = days - era * 146_097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365)
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp + (mp < 10 ? 3 : -9)
  const year = y + (month <= 2 ? 1 : 0)
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
