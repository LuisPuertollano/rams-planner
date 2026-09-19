/**
 * Las dos mitades de una hora real que viene por mes.
 *
 *   horas        proyecto;persona;mes;horas[;referencia]
 *   declaración  proyecto;persona;mes;tarea;porcentaje[;nota]
 *
 * Son dos ficheros y no uno con dos formas a propósito: los escribe gente
 * distinta en momentos distintos. El de horas sale del sistema de fichaje y lo
 * carga quien administra; el de la declaración lo escribe cada persona sobre su
 * propio mes. Meterlos en el mismo fichero obligaría a que uno esperase al otro.
 *
 * Reglas, las mismas que el parte diario y por las mismas razones:
 *
 *   - **Nada se crea.** El proyecto, la persona y la tarea tienen que existir.
 *   - **Cualquier error aborta el fichero entero,** con todos los errores de
 *     golpe y su número de fila.
 *
 * Y una propia, que es la que hace que esto sirva de algo: **la declaración se
 * reemplaza, no se suma**. Volver a cargar abril deja abril como diga el
 * fichero. Si alguien repartía 60/40 y lo cambia a 100 % en una sola tarea, la
 * fila del 40 % tiene que desaparecer, o la suma dará 140 % y el mes entero se
 * quedará sin repartir.
 */

import {
  writeMonthlyActuals,
  writeSplits,
  type ActualSplitInput,
  type MonthlyActualInput,
  type Queryable,
} from '@planner/persistence'
import { parseCsv, parseNumber } from './csv.js'
import { ImportError } from './import-plan.js'

const MINUTOS_POR_HORA = 60
/** Horas de un mes a jornada completa, con margen: por encima es otra columna. */
const MINUTOS_DE_UN_MES = 400 * MINUTOS_POR_HORA

const ES_UN_MES = /^\d{4}-\d{2}$/

export interface MonthlySummary {
  readonly rows: number
  readonly saved: number
  readonly minutes: number
  readonly projects: number
  readonly people: number
  readonly from: string
  readonly to: string
}

export interface SplitsSummary {
  readonly rows: number
  readonly saved: number
  /** Meses (persona, proyecto, mes) que el fichero deja declarados. */
  readonly months: number
  /** Los que NO suman 100 %: se guardan igual, y la conciliación los nombra. */
  readonly notHundred: readonly string[]
}

/** Lo que las dos importaciones necesitan saber de la base. */
interface Indices {
  readonly proyectoPorCodigo: ReadonlyMap<string, string>
  readonly personaPorNombre: ReadonlyMap<string, string>
}

async function cargarIndices(db: Queryable): Promise<Indices> {
  const proyectos = await db.query<{ id: string; code: string }>(
    'SELECT id, code FROM project WHERE deleted_at IS NULL',
  )
  const personas = await db.query<{ id: string; display_name: string; code: string }>(
    'SELECT id, display_name, code FROM resource WHERE deleted_at IS NULL',
  )
  const personaPorNombre = new Map<string, string>()
  for (const persona of personas.rows) {
    personaPorNombre.set(persona.display_name.toLowerCase(), persona.id)
    personaPorNombre.set(persona.code.toLowerCase(), persona.id)
  }
  return {
    proyectoPorCodigo: new Map(proyectos.rows.map((fila) => [fila.code.toLowerCase(), fila.id])),
    personaPorNombre,
  }
}

/** Comprueba que están las columnas y devuelve las filas, o falla diciendo cuáles faltan. */
function conColumnas(text: string, obligatorias: readonly string[]): ReturnType<typeof parseCsv> {
  const filas = parseCsv(text)
  if (filas.length === 0) throw new ImportError('El fichero no tiene ninguna fila de datos')
  const columnas = new Set(Object.keys(filas[0] ?? {}))
  const faltan = obligatorias.filter((columna) => !columnas.has(columna))
  if (faltan.length > 0) {
    throw new ImportError('Al fichero le faltan columnas', faltan.map((c) => `Falta la columna «${c}»`))
  }
  return filas
}

/** Las horas del mes, tal y como las da el sistema de fichaje. */
export async function importMonthlyActualsCsv(db: Queryable, text: string): Promise<MonthlySummary> {
  const filas = conColumnas(text, ['proyecto', 'persona', 'mes', 'horas'])
  const { proyectoPorCodigo, personaPorNombre } = await cargarIndices(db)

  const problemas: string[] = []
  const entradas: MonthlyActualInput[] = []
  const meses: string[] = []

  for (const [indice, fila] of filas.entries()) {
    const line = indice + 2
    const codigo = fila['proyecto'] ?? ''
    const persona = fila['persona'] ?? ''
    const mes = (fila['mes'] ?? '').trim()
    const horas = parseNumber(fila['horas'] ?? '')

    const projectId = proyectoPorCodigo.get(codigo.toLowerCase())
    const resourceId = personaPorNombre.get(persona.toLowerCase())
    if (projectId === undefined) problemas.push(`Fila ${String(line)}: el proyecto «${codigo}» no existe`)
    if (resourceId === undefined) {
      problemas.push(
        `Fila ${String(line)}: «${persona}» no está en el equipo. ` +
          'Dala de alta primero: un parte de horas no crea personas',
      )
    }
    if (!ES_UN_MES.test(mes)) problemas.push(`Fila ${String(line)}: «${mes}» no es un mes (AAAA-MM)`)
    if (horas === null) problemas.push(`Fila ${String(line)}: «horas» no es un número`)
    else if (horas < 0) problemas.push(`Fila ${String(line)}: las horas no pueden ser negativas`)

    const minutes = horas === null ? 0 : Math.round(horas * MINUTOS_POR_HORA)
    if (minutes > MINUTOS_DE_UN_MES) {
      problemas.push(
        `Fila ${String(line)}: ${String(horas ?? 0)} h en un solo mes. ` +
          'Revisa si la columna son horas o minutos',
      )
    }
    if (projectId === undefined || resourceId === undefined || horas === null || !ES_UN_MES.test(mes)) continue

    const referencia = (fila['referencia'] ?? '').trim()
    entradas.push({
      projectId,
      resourceId,
      period: mes,
      minutes,
      externalRef: referencia === '' ? null : referencia,
    })
    meses.push(mes)
  }

  if (problemas.length > 0) throw new ImportError('El fichero tiene filas que no se pueden leer', problemas)

  const saved = await writeMonthlyActuals(db, entradas)
  const ordenados = [...meses].sort()
  return {
    rows: filas.length,
    saved,
    minutes: entradas.reduce((total, fila) => total + fila.minutes, 0),
    projects: new Set(entradas.map((fila) => fila.projectId)).size,
    people: new Set(entradas.map((fila) => fila.resourceId)).size,
    from: ordenados[0] ?? '',
    to: ordenados[ordenados.length - 1] ?? '',
  }
}

/** La declaración: de mis horas de ese mes, qué parte fue a cada tarea. */
export async function importSplitsCsv(db: Queryable, text: string): Promise<SplitsSummary> {
  const filas = conColumnas(text, ['proyecto', 'persona', 'mes', 'tarea', 'porcentaje'])
  const { proyectoPorCodigo, personaPorNombre } = await cargarIndices(db)

  // Sólo tareas e hitos: una fase es el resumen de sus hijas, y declarar horas
  // contra un resumen no dice en qué se fueron.
  const nodos = await db.query<{ id: string; project_id: string; name: string }>(
    `SELECT n.id, n.project_id, n.name
     FROM wbs_node n JOIN project p ON p.id = n.project_id AND p.deleted_at IS NULL
     WHERE n.deleted_at IS NULL AND n.node_kind IN ('task', 'milestone')`,
  )
  const tareaPorNombre = new Map<string, string>()
  const repetidas = new Set<string>()
  for (const nodo of nodos.rows) {
    const clave = `${nodo.project_id}|${nodo.name.toLowerCase()}`
    if (tareaPorNombre.has(clave)) repetidas.add(clave)
    tareaPorNombre.set(clave, nodo.id)
  }

  const problemas: string[] = []
  const entradas: ActualSplitInput[] = []

  for (const [indice, fila] of filas.entries()) {
    const line = indice + 2
    const codigo = fila['proyecto'] ?? ''
    const persona = fila['persona'] ?? ''
    const mes = (fila['mes'] ?? '').trim()
    const tarea = fila['tarea'] ?? ''
    const porcentaje = parseNumber(fila['porcentaje'] ?? '')

    const projectId = proyectoPorCodigo.get(codigo.toLowerCase())
    const resourceId = personaPorNombre.get(persona.toLowerCase())
    if (projectId === undefined) problemas.push(`Fila ${String(line)}: el proyecto «${codigo}» no existe`)
    if (resourceId === undefined) problemas.push(`Fila ${String(line)}: «${persona}» no está en el equipo`)
    if (!ES_UN_MES.test(mes)) problemas.push(`Fila ${String(line)}: «${mes}» no es un mes (AAAA-MM)`)
    if (porcentaje === null) problemas.push(`Fila ${String(line)}: «porcentaje» no es un número`)
    else if (porcentaje <= 0 || porcentaje > 100) {
      problemas.push(`Fila ${String(line)}: un porcentaje va entre 0 (excluido) y 100, y llega ${String(porcentaje)}`)
    }

    if (projectId === undefined || resourceId === undefined || porcentaje === null) continue
    const clave = `${projectId}|${tarea.toLowerCase()}`
    const nodeId = tareaPorNombre.get(clave)
    if (nodeId === undefined) {
      problemas.push(`Fila ${String(line)}: en «${codigo}» no hay ninguna tarea «${tarea}»`)
      continue
    }
    if (repetidas.has(clave)) {
      problemas.push(
        `Fila ${String(line)}: en «${codigo}» hay más de una tarea llamada «${tarea}». ` +
          'Cambia el nombre de una: el fichero no puede decir a cuál van las horas',
      )
      continue
    }

    const nota = (fila['nota'] ?? '').trim()
    entradas.push({
      projectId,
      resourceId,
      period: mes,
      nodeId,
      // Puntos básicos desde el principio (P5): «12,5 %» son 1250.
      shareBp: Math.round(porcentaje * 100),
      note: nota === '' ? null : nota,
    })
  }

  if (problemas.length > 0) throw new ImportError('El fichero tiene filas que no se pueden leer', problemas)

  const saved = await writeSplits(db, entradas)

  // Los meses que no suman 100 % **no se rechazan**: el fichero puede traer sólo
  // una parte del mes, y el resto llegar en la siguiente carga. Lo que no puede
  // es pasar desapercibido, así que se devuelven y la conciliación los nombra.
  const suma = new Map<string, number>()
  for (const fila of entradas) {
    const llave = `${fila.resourceId}|${fila.projectId}|${fila.period}`
    suma.set(llave, (suma.get(llave) ?? 0) + fila.shareBp)
  }
  const notHundred = [...suma.entries()]
    .filter(([, total]) => total !== 10_000)
    .map(([llave]) => llave)
    .sort()

  return { rows: filas.length, saved, months: suma.size, notHundred }
}
