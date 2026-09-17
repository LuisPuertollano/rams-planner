/**
 * Importación del parte de horas desde un CSV plano.
 *
 *   proyecto;tarea;persona;fecha;horas[;origen;referencia]
 *
 * Reglas deliberadas, y cada una es una decisión:
 *
 *   - **Nada se crea.** El proyecto, la tarea y la persona tienen que existir.
 *     Al contrario que la importación del plan, que sí crea personas: ahí se
 *     está declarando el plan y crear es el trabajo; aquí se está contando lo
 *     que pasó, y una persona inventada desde un parte de horas aparecería con
 *     horas, sin calendario y sin tarifa, y nadie sabría de dónde salió.
 *
 *   - **No se inventa plan.** Es la diferencia con PlaTo, que ante horas sin
 *     línea de plan se crea una sola con el entregable «Unplanned with
 *     Actuals». Escribir plan en nombre de nadie rompe P1: los datos
 *     declarados los declara una persona. Aquí esas horas se cargan contra la
 *     tarea que traen, y el informe **cuenta y dice** cuántas cayeron donde
 *     nadie había planificado nada.
 *
 *   - **Cualquier error aborta el fichero entero,** igual que el plan. Un parte
 *     a medias es peor que ninguno: los totales del mes salen mal y nadie sabe
 *     que faltan filas.
 *
 * El parseo y la validación son puros y están separados de la resolución contra
 * la base: lo que se puede comprobar sin base de datos se comprueba sin ella.
 */

import { saveActuals, type ActualEntryInput, type ActualSource, type Queryable } from '@planner/persistence'
import { parseCsv, parseNumber } from './csv.js'
import { ImportError } from './import-plan.js'

const MINUTOS_POR_HORA = 60
const MINUTOS_DE_UN_DIA = 24 * 60

/** Las columnas que hacen falta. Las demás sobran y se ignoran. */
const OBLIGATORIAS = ['proyecto', 'tarea', 'persona', 'fecha', 'horas'] as const

/**
 * Los orígenes, con su nombre castellano al lado.
 *
 * El del esquema es el que manda, pero un fichero escrito por alguien que usa
 * la herramienta en castellano va a decir «parte», no «timesheet», y rechazarlo
 * por eso sería una tontería.
 */
const ORIGENES: Readonly<Record<string, ActualSource>> = {
  timesheet: 'timesheet',
  parte: 'timesheet',
  import: 'import',
  importado: 'import',
  manual: 'manual',
  estimate: 'estimate',
  estimado: 'estimate',
}

/** Una fila ya leída y validada, todavía sin resolver contra la base. */
export interface ActualsCsvRow {
  readonly line: number
  readonly projectCode: string
  readonly taskName: string
  readonly personName: string
  readonly workDate: string
  readonly minutes: number
  readonly source: ActualSource
  readonly externalRef: string | null
}

export interface ActualsSummary {
  /** Filas leídas del fichero. */
  readonly rows: number
  /** Filas que llegaron a la tabla: menos que `rows` si el fichero repetía día y tarea. */
  readonly saved: number
  readonly minutes: number
  readonly projects: number
  readonly people: number
  readonly from: string
  readonly to: string
  readonly warnings: readonly string[]
}

/**
 * Lee y valida el fichero. No toca la base.
 *
 * Los errores salen **todos de golpe y con su número de fila**: corregir un
 * parte de trescientas líneas de error en error es inaceptable.
 */
export function parseActualsCsv(text: string): readonly ActualsCsvRow[] {
  const filas = parseCsv(text)
  if (filas.length === 0) throw new ImportError('El fichero no tiene ninguna fila de datos')

  const columnas = new Set(Object.keys(filas[0] ?? {}))
  const faltan = OBLIGATORIAS.filter((columna) => !columnas.has(columna))
  if (faltan.length > 0) {
    throw new ImportError(
      'Al fichero le faltan columnas',
      faltan.map((columna) => `Falta la columna «${columna}»`),
    )
  }

  const problemas: string[] = []
  const leidas: ActualsCsvRow[] = []

  for (const [indice, fila] of filas.entries()) {
    // +2: la cabecera es la fila 1 y quien mira el fichero cuenta desde ahí.
    const line = indice + 2
    const projectCode = fila['proyecto'] ?? ''
    const taskName = fila['tarea'] ?? ''
    const personName = fila['persona'] ?? ''
    const workDate = fila['fecha'] ?? ''
    const origen = (fila['origen'] ?? '').toLowerCase()
    const horas = parseNumber(fila['horas'] ?? '')

    if (projectCode === '') problemas.push(`Fila ${String(line)}: falta el proyecto`)
    if (taskName === '') problemas.push(`Fila ${String(line)}: falta la tarea`)
    if (personName === '') problemas.push(`Fila ${String(line)}: falta la persona`)
    if (!esUnDia(workDate)) {
      problemas.push(`Fila ${String(line)}: «${workDate}» no es una fecha (AAAA-MM-DD)`)
    }
    if (horas === null) problemas.push(`Fila ${String(line)}: «horas» no es un número`)
    else if (horas < 0) problemas.push(`Fila ${String(line)}: las horas no pueden ser negativas`)

    const source = origen === '' ? 'timesheet' : ORIGENES[origen]
    if (source === undefined) {
      problemas.push(
        `Fila ${String(line)}: «${origen}» no es un origen. Los que hay: ${Object.keys(ORIGENES).join(', ')}`,
      )
    }

    // Entero desde el principio (P5): el minuto es la unidad y «7,5» son 450.
    const minutes = horas === null ? 0 : Math.round(horas * MINUTOS_POR_HORA)
    if (minutes > MINUTOS_DE_UN_DIA) {
      // Una persona, una tarea, un día. Más de veinticuatro horas no es un dato
      // discutible: es la columna equivocada, casi siempre minutos en el hueco
      // de las horas.
      problemas.push(
        `Fila ${String(line)}: ${String(horas ?? 0)} h en un solo día. Revisa si la columna son horas o minutos`,
      )
    }

    if (source === undefined || horas === null) continue
    const referencia = fila['referencia'] ?? ''
    leidas.push({
      line,
      projectCode,
      taskName,
      personName,
      workDate,
      minutes,
      source,
      externalRef: referencia === '' ? null : referencia,
    })
  }

  if (problemas.length > 0) throw new ImportError('El fichero tiene filas que no se pueden leer', problemas)
  return leidas
}

/**
 * Resuelve las filas contra la base y las guarda.
 *
 * Los tres «no existe» se juntan antes de fallar: si el fichero usa otro código
 * de proyecto y otro nombre de persona, quien lo cargó quiere enterarse de las
 * dos cosas a la vez.
 */
export async function importActualsCsv(db: Queryable, text: string): Promise<ActualsSummary> {
  const filas = parseActualsCsv(text)

  const codigos = [...new Set(filas.map((fila) => fila.projectCode))]
  const proyectos = await db.query<{ id: string; code: string }>(
    'SELECT id, code FROM project WHERE code = ANY($1) AND deleted_at IS NULL',
    [codigos],
  )
  const idPorCodigo = new Map(proyectos.rows.map((fila) => [fila.code.toLowerCase(), fila.id]))

  const personas = await db.query<{ id: string; display_name: string; code: string }>(
    'SELECT id, display_name, code FROM resource WHERE deleted_at IS NULL',
  )
  const idPorPersona = new Map<string, string>()
  for (const persona of personas.rows) {
    idPorPersona.set(persona.display_name.toLowerCase(), persona.id)
    idPorPersona.set(persona.code.toLowerCase(), persona.id)
  }

  // Sólo tareas e hitos: una fase es un resumen de sus hijas, y horas colgadas
  // de un resumen no se pueden repartir entre ellas.
  const nodos = await db.query<{ id: string; project_id: string; name: string }>(
    `SELECT n.id, n.project_id, n.name
     FROM wbs_node n
     JOIN project p ON p.id = n.project_id AND p.deleted_at IS NULL
     WHERE p.id = ANY($1) AND n.deleted_at IS NULL AND n.node_kind IN ('task', 'milestone')`,
    [[...idPorCodigo.values()]],
  )
  const idPorTarea = new Map<string, string>()
  const repetidas = new Set<string>()
  for (const nodo of nodos.rows) {
    const clave = `${nodo.project_id}|${nodo.name.toLowerCase()}`
    if (idPorTarea.has(clave)) repetidas.add(clave)
    idPorTarea.set(clave, nodo.id)
  }

  const problemas: string[] = []
  const entradas: ActualEntryInput[] = []
  const proyectosVistos = new Set<string>()
  const personasVistas = new Set<string>()

  for (const fila of filas) {
    const projectId = idPorCodigo.get(fila.projectCode.toLowerCase())
    const resourceId = idPorPersona.get(fila.personName.toLowerCase())
    if (projectId === undefined) {
      problemas.push(`Fila ${String(fila.line)}: el proyecto «${fila.projectCode}» no existe`)
    }
    if (resourceId === undefined) {
      problemas.push(
        `Fila ${String(fila.line)}: «${fila.personName}» no está en el equipo. ` +
          'Dala de alta primero: un parte de horas no crea personas',
      )
    }
    if (projectId === undefined || resourceId === undefined) continue

    const clave = `${projectId}|${fila.taskName.toLowerCase()}`
    const nodeId = idPorTarea.get(clave)
    if (nodeId === undefined) {
      problemas.push(
        `Fila ${String(fila.line)}: «${fila.taskName}» no es una tarea de ${fila.projectCode}. ` +
          'Créala en el plan si el trabajo existe: las horas no inventan plan',
      )
      continue
    }
    if (repetidas.has(clave)) {
      // Dos tareas con el mismo nombre en un proyecto: elegir una sería elegir
      // al azar, y las horas acabarían en la que no era.
      problemas.push(
        `Fila ${String(fila.line)}: ${fila.projectCode} tiene más de una tarea llamada «${fila.taskName}»`,
      )
      continue
    }

    proyectosVistos.add(projectId)
    personasVistas.add(resourceId)
    entradas.push({
      nodeId,
      resourceId,
      workDate: fila.workDate,
      minutes: fila.minutes,
      source: fila.source,
      externalRef: fila.externalRef,
    })
  }

  if (problemas.length > 0) {
    throw new ImportError('El fichero apunta a cosas que no existen', problemas)
  }

  const { guardadas } = await saveActuals(db, entradas)
  const fechas = filas.map((fila) => fila.workDate).sort()

  return {
    rows: filas.length,
    saved: guardadas,
    minutes: entradas.reduce((total, entrada) => total + entrada.minutes, 0),
    projects: proyectosVistos.size,
    people: personasVistas.size,
    from: fechas[0] ?? '',
    to: fechas[fechas.length - 1] ?? '',
    warnings: avisos(filas),
  }
}

/**
 * Lo que no impide cargar el fichero pero merece leerse.
 *
 * Un día de más de veinticuatro horas **sumando tareas** no es imposible como
 * lo es en una sola fila —puede ser un apunte duplicado en dos tareas— así que
 * se avisa y se carga, en vez de rechazar un parte entero por una sospecha.
 */
function avisos(filas: readonly ActualsCsvRow[]): readonly string[] {
  const porPersonaYDia = new Map<string, number>()
  for (const fila of filas) {
    const clave = `${fila.personName}|${fila.workDate}`
    porPersonaYDia.set(clave, (porPersonaYDia.get(clave) ?? 0) + fila.minutes)
  }
  const avisados: string[] = []
  for (const [clave, minutos] of porPersonaYDia) {
    if (minutos <= MINUTOS_DE_UN_DIA) continue
    const [persona, dia] = clave.split('|')
    avisados.push(
      `${persona ?? ''} suma ${(minutos / MINUTOS_POR_HORA).toFixed(1)} h el ${dia ?? ''}, ` +
        'repartidas en varias tareas. Se ha cargado igual: compruébalo',
    )
  }
  return avisados.sort()
}

/** Una fecha que además existe: `2026-02-30` cumple el patrón y no es un día. */
function esUnDia(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false
  const fecha = new Date(`${valor}T00:00:00Z`)
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor
}
