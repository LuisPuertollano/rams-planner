/**
 * Importación de un plan desde un CSV plano.
 *
 * Una sola tabla, la que cualquiera ya tiene en Excel:
 *
 *   proyecto;fase;tarea;dias;predecesoras;recurso;dedicacion;disciplina;deadline;no_antes_de
 *
 * Y tres columnas más, opcionales, para el trabajo que no es un entregable:
 *
 *   horas         el trabajo declarado. Con ella la tarea pasa a `fixed_work`:
 *                 manda el trabajo y la duración sale de él, no al revés.
 *   desde;hasta   las dos anclas de una tarea continua (ADR-0051): «arranque» o
 *                 el nombre de una puerta. Con las dos puestas, la tarea ocupa
 *                 la fase entera y `dias` sólo vale de reserva por si una de
 *                 las dos puertas todavía no tiene fecha.
 *
 * Reglas deliberadas:
 *   - Los recursos que no existen se crean, para que probar con datos propios
 *     no exija preparar nada antes.
 *   - Un proyecto que ya existe **no** se pisa: se rechaza la importación entera
 *     con un mensaje claro. Sobrescribir un plan en silencio es imperdonable.
 *   - Cualquier error aborta la transacción completa: no hay importaciones a
 *     medias que luego nadie sabe deshacer.
 */

import type { Queryable } from '@planner/persistence'
import { parseCsv, parseNumber, type CsvRow } from './csv.js'

const DAY_MINUTES = 480
const CAL_BW = '00000000-0000-4000-8000-000000000002'

export interface ImportSummary {
  readonly projects: number
  readonly phases: number
  readonly tasks: number
  readonly dependencies: number
  readonly assignments: number
  /** Tareas enlazadas con un entregable del catálogo. */
  readonly deliverables: number
  readonly resourcesCreated: readonly string[]
  readonly warnings: readonly string[]
}

export class ImportError extends Error {
  readonly rows: readonly string[]
  constructor(message: string, rows: readonly string[] = []) {
    super(message)
    this.name = 'ImportError'
    this.rows = rows
  }
}

export async function importPlanCsv(db: Queryable, text: string): Promise<ImportSummary> {
  const rows = parseCsv(text)
  if (rows.length === 0) throw new ImportError('El fichero no tiene ninguna fila de datos')

  const problems: string[] = []
  const warnings: string[] = []
  for (const [index, row] of rows.entries()) {
    const line = index + 2
    if ((row['proyecto'] ?? '') === '') problems.push(`Fila ${String(line)}: falta el proyecto`)
    if ((row['tarea'] ?? '') === '') problems.push(`Fila ${String(line)}: falta el nombre de la tarea`)
    if (parseNumber(row['dias'] ?? '') === null) problems.push(`Fila ${String(line)}: «dias» no es un número`)
    if ((row['horas'] ?? '') !== '' && parseNumber(row['horas'] ?? '') === null) {
      problems.push(`Fila ${String(line)}: «horas» no es un número`)
    }
    // Media ventana no es una ventana: con una sola ancla no hay nada que
    // resolver, y dejarlo pasar en silencio daría una tarea normal donde
    // alguien creía haber declarado una continua.
    const desde = (row['desde'] ?? '').trim()
    const hasta = (row['hasta'] ?? '').trim()
    if ((desde === '') !== (hasta === '')) {
      problems.push(
        `Fila ${String(line)}: «desde» y «hasta» van juntas o no van ` +
          `(está ${desde === '' ? '«hasta»' : '«desde»'} sola)`,
      )
    }
  }
  if (problems.length > 0) throw new ImportError('El fichero tiene filas que no se pueden leer', problems)

  const projectCodes = [...new Set(rows.map((row) => row['proyecto'] ?? ''))]
  const existing = await db.query<{ code: string }>(
    'SELECT code FROM project WHERE code = ANY($1) AND deleted_at IS NULL',
    [projectCodes],
  )
  if (existing.rows.length > 0) {
    throw new ImportError(
      'Estos proyectos ya existen y la importación no los sobrescribe',
      existing.rows.map((row) => row.code),
    )
  }

  const created: string[] = []
  const resources = await ensureResources(db, rows, warnings, created)
  const ramsFieldId = await ensureRamsField(db)

  const documentos = await leerCatalogo(db)
  const sinCatalogo = new Set<string>()

  let phases = 0
  let tasks = 0
  let dependencies = 0
  let assignments = 0
  let deliverables = 0

  for (const code of projectCodes) {
    const projectRows = rows.filter((row) => row['proyecto'] === code)
    const start = earliestDate(projectRows) ?? todayIso()
    // La plantilla es del proyecto, no de la fila: basta declararla en una y
    // vale para todas sus filas. Escribirla en unas sí y en otras no sería una
    // contradicción dentro del mismo fichero, y por eso se toma la respuesta
    // afirmativa de cualquiera de ellas en vez de la de la primera a secas.
    const esPlantilla = projectRows.some((row) => esQueSi(row['plantilla'] ?? ''))
    const project = await db.query<{ id: string }>(
      `INSERT INTO project (code, name, calendar_id, status_start, priority, currency, is_template)
       VALUES ($1, $2, $3, $4, 500, 'EUR', $5) RETURNING id`,
      [code, projectRows[0]?.['nombre_proyecto'] ?? code, CAL_BW, start, esPlantilla],
    )
    const projectId = project.rows[0]?.id ?? ''

    // Una plantilla describe el trabajo, no quién lo hace, y la base lo impone
    // con un disparador. Si el fichero trae personas, se dicen y se dejan
    // fuera: reventar la importación entera por una columna que sobra sería
    // castigar a quien exporta su plan y lo marca como molde.
    if (esPlantilla) {
      const conGente = projectRows.filter((row) => splitList(row['recurso'] ?? '').length > 0).length
      if (conGente > 0) {
        warnings.push(
          `«${code}» entra como plantilla, así que sus ${String(conGente)} asignación(es) se quedan fuera: ` +
            'una plantilla describe el trabajo, no quién lo hace.',
        )
      }
    }

    const phaseIds = new Map<string, string>()
    const taskIds = new Map<string, string>()

    for (const [index, row] of projectRows.entries()) {
      const phaseName = row['fase'] ?? ''
      let parentId: string | null = null
      if (phaseName !== '') {
        const known = phaseIds.get(phaseName)
        if (known === undefined) {
          const created = await db.query<{ id: string }>(
            `INSERT INTO wbs_node (project_id, node_kind, code, path, sort_key, name)
             VALUES ($1, 'phase', $2, $3, $4, $5) RETURNING id`,
            [projectId, String(phaseIds.size + 1), pad(phaseIds.size + 1), phaseIds.size, phaseName],
          )
          parentId = created.rows[0]?.id ?? null
          phaseIds.set(phaseName, parentId ?? '')
          phases += 1
        } else parentId = known
      }

      const durationDays = parseNumber(row['dias'] ?? '') ?? 0
      const isMilestone = durationDays === 0
      const name = row['tarea'] ?? ''
      const node = await db.query<{ id: string }>(
        `INSERT INTO wbs_node (project_id, parent_id, node_kind, code, path, sort_key, name)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          projectId,
          parentId,
          isMilestone ? 'milestone' : 'task',
          String(index + 1),
          `${pad(phaseIds.size)}.${pad(index + 1)}`,
          index,
          name,
        ],
      )
      const nodeId = node.rows[0]?.id ?? ''
      taskIds.set(name, nodeId)
      tasks += 1

      const noEarlier = row['no_antes_de'] ?? ''
      const horas = parseNumber(row['horas'] ?? '') ?? 0
      const desde = (row['desde'] ?? '').trim()
      const hasta = (row['hasta'] ?? '').trim()
      await db.query(
        `INSERT INTO task (node_id, task_type, is_effort_driven, duration_minutes, work_declared_minutes,
                           constraint_kind, constraint_date, deadline, percent_complete_bp, is_milestone,
                           span_from, span_to)
         VALUES ($1, $7, TRUE, $2, $8, $3, $4, $5, 0, $6, $9, $10)`,
        [
          nodeId,
          Math.round(durationDays * DAY_MINUTES),
          noEarlier === '' ? 'asap' : 'start_no_earlier_than',
          noEarlier === '' ? null : noEarlier,
          (row['deadline'] ?? '') === '' ? null : row['deadline'],
          isMilestone,
          horas > 0 ? 'fixed_work' : 'fixed_duration',
          Math.round(horas * 60),
          desde === '' ? null : desde,
          hasta === '' ? null : hasta,
        ],
      )

      // Qué entregable produce esta tarea. Es lo que conecta el plan importado
      // con el catálogo, y sin ello las dos cosas que cuelgan de esa conexión
      // —partir en subactividades y la fecha objetivo de la puerta— no llegan
      // nunca a un plan que haya entrado por aquí.
      const codigoEntregable = row['entregable'] ?? ''
      if (codigoEntregable !== '') {
        const documentTypeId = documentos.get(codigoEntregable.trim().toLowerCase())
        if (documentTypeId === undefined) sinCatalogo.add(codigoEntregable.trim())
        else {
          await db.query(
            'INSERT INTO node_document (node_id, document_type_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [nodeId, documentTypeId],
          )
          deliverables += 1
        }
      }

      const discipline = row['disciplina'] ?? ''
      if (discipline !== '') {
        await db.query('INSERT INTO field_value (field_id, entity_id, value_text) VALUES ($1, $2, $3)', [
          ramsFieldId,
          nodeId,
          discipline,
        ])
      }

      for (const person of esPlantilla ? [] : splitList(row['recurso'] ?? '')) {
        const resourceId = resources.get(person.toLowerCase())
        if (resourceId === undefined) continue
        const units = parseNumber(row['dedicacion'] ?? '') ?? 100
        await db.query(
          `INSERT INTO assignment (node_id, resource_id, units_bp, contour_kind) VALUES ($1, $2, $3, 'flat')`,
          [nodeId, resourceId, Math.round(units * 100)],
        )
        assignments += 1
      }
    }

    // Las dependencias se resuelven al final: una tarea puede citar a otra que
    // aparece más abajo en el fichero.
    for (const row of projectRows) {
      const successor = taskIds.get(row['tarea'] ?? '')
      if (successor === undefined) continue
      for (const predecessorName of splitList(row['predecesoras'] ?? '')) {
        const predecessor = taskIds.get(predecessorName)
        if (predecessor === undefined) {
          warnings.push(`«${row['tarea'] ?? ''}» cita una predecesora que no existe: «${predecessorName}»`)
          continue
        }
        await db.query(
          `INSERT INTO dependency (predecessor_node_id, successor_node_id, dependency_kind, lag_minutes)
           VALUES ($1, $2, 'FS', 0) ON CONFLICT DO NOTHING`,
          [predecessor, successor],
        )
        dependencies += 1
      }
    }
  }

  if (sinCatalogo.size > 0) {
    warnings.push(
      `Estos códigos de «entregable» no están en el catálogo y no se han enlazado: ${[...sinCatalogo].sort().join(', ')}. ` +
        'Carga primero el catálogo de documentos y vuelve a importar.',
    )
  }

  return {
    projects: projectCodes.length,
    phases,
    tasks,
    dependencies,
    assignments,
    deliverables,
    resourcesCreated: created,
    warnings,
  }
}

/** El catálogo por código, en minúsculas: el fichero no conoce los uuid. */
async function leerCatalogo(db: Queryable): Promise<ReadonlyMap<string, string>> {
  const { rows } = await db.query<{ id: string; code: string }>(
    'SELECT id, code FROM document_type WHERE deleted_at IS NULL',
  )
  return new Map(rows.map((row) => [row.code.trim().toLowerCase(), row.id]))
}

/**
 * Una casilla que dice que sí.
 *
 * Cuatro idiomas y una hoja de cálculo: quien marca una columna escribe «sí»,
 * «yes», «ja», «oui», «x», «1» o «true». Rechazar todo lo que no sea una de
 * ellas convertiría un fichero correcto en un error por una tilde.
 */
function esQueSi(valor: string): boolean {
  return ['si', 'sí', 'yes', 'ja', 'oui', 'x', '1', 'true', 'verdadero', 'wahr', 'vrai'].includes(
    valor.trim().toLowerCase(),
  )
}

async function ensureResources(
  db: Queryable,
  rows: readonly CsvRow[],
  warnings: string[],
  createdNames: string[],
): Promise<ReadonlyMap<string, string>> {
  const names = new Set<string>()
  for (const row of rows) for (const person of splitList(row['recurso'] ?? '')) names.add(person)

  const found = new Map<string, string>()
  const existing = await db.query<{ id: string; display_name: string; code: string }>(
    'SELECT id, display_name, code FROM resource WHERE deleted_at IS NULL',
  )
  for (const resource of existing.rows) {
    found.set(resource.display_name.toLowerCase(), resource.id)
    found.set(resource.code.toLowerCase(), resource.id)
  }

  for (const name of names) {
    if (found.has(name.toLowerCase())) continue
    const code = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_')
    const created = await db.query<{ id: string }>(
      `INSERT INTO resource (code, display_name, resource_kind, calendar_id, max_units_bp)
       VALUES ($1, $2, 'person', $3, 10000) RETURNING id`,
      [code, name, CAL_BW],
    )
    const id = created.rows[0]?.id ?? ''
    await db.query(
      `INSERT INTO resource_availability (resource_id, valid_period, units_bp)
       VALUES ($1, daterange('2020-01-01', '2040-01-01', '[)'), 10000)`,
      [id],
    )
    found.set(name.toLowerCase(), id)
    createdNames.push(name)
    warnings.push(`Recurso creado: «${name}». Revisa su calendario, disponibilidad y tarifa.`)
  }
  return found
}

async function ensureRamsField(db: Queryable): Promise<string> {
  const existing = await db.query<{ id: string }>(
    "SELECT id FROM field_definition WHERE entity_type = 'wbs_node' AND field_key = 'rams_tag'",
  )
  const found = existing.rows[0]?.id
  if (found !== undefined) return found
  const created = await db.query<{ id: string }>(
    `INSERT INTO field_definition (entity_type, field_key, label, data_type, display_order)
     VALUES ('wbs_node', 'rams_tag', 'Disciplina RAMS', 'text', 1) RETURNING id`,
  )
  return created.rows[0]?.id ?? ''
}

function splitList(value: string): readonly string[] {
  return value
    .split(/[;|]/)
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

function earliestDate(rows: readonly CsvRow[]): string | null {
  const dates = rows.map((row) => row['no_antes_de'] ?? '').filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
  return dates.length === 0 ? null : dates.sort()[0] ?? null
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function pad(value: number): string {
  return String(value).padStart(3, '0')
}
