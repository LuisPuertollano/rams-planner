/**
 * Importación del catálogo de entregables y de su matriz, desde un CSV plano.
 *
 *   codigo;nombre;tipo;disciplina;puerta;semanas_antes;horas;codigo_tarea;descripcion;espera_a
 *
 * Existe por una razón concreta: la matriz se edita bien con nueve documentos y
 * no se edita con ochenta. Un catálogo EN 50126 real son unas ochenta filas y
 * unas ciento treinta flechas; marcarlas a mano en una rejilla de seis mil
 * casillas no es trabajo, es puntería.
 *
 * Tres reglas que conviene tener claras:
 *
 *   - **El código manda.** Una fila cuyo código ya existe *actualiza* ese
 *     entregable en vez de crear otro. Cargar dos veces el mismo fichero deja
 *     el catálogo igual que cargarlo una vez.
 *
 *   - **`espera_a` es la lista completa de lo que espera esa fila**, no una
 *     añadidura. Los predecesores que no vengan en la casilla se borran. Es lo
 *     que hace que volver a cargar un fichero corregido corrija de verdad; y
 *     sólo afecta a las filas que el fichero nombra, así que un fichero parcial
 *     no toca el resto del catálogo.
 *
 *   - **El orden del fichero es el orden del ciclo de vida.** La fila 2 del CSV
 *     sale antes que la 3 en la matriz y en la pantalla. Un catálogo RAMS viene
 *     ya ordenado por puertas, y perder ese orden obliga a reconstruirlo a ojo.
 *
 * Un ciclo no aborta la importación: se avisa. Es la misma decisión que tomó
 * ADR-0016 para la pantalla, y por el mismo motivo —a veces se descubre el
 * ciclo justo al cerrar el último enlace— pero aquí se dice en el resumen,
 * porque nadie va a repasar ochenta filas buscando la casilla roja.
 */

import {
  createDocumentType,
  readDocumentTypes,
  setPredecessors,
  updateDocumentType,
  type DocumentKind,
  type DocumentTypeFields,
  type Queryable,
} from '@planner/persistence'
import { parseCsv, parseNumber } from './csv.js'
import { ImportError } from './import-plan.js'

const MINUTOS_POR_HORA = 60

/** Las columnas sin las que no se puede leer una fila. Las demás son opcionales. */
const OBLIGATORIAS = ['codigo', 'nombre'] as const

const TIPOS: Readonly<Record<string, DocumentKind>> = {
  documento: 'documento',
  document: 'documento',
  doc: 'documento',
  hito: 'hito',
  milestone: 'hito',
  mst: 'hito',
  fase: 'fase',
  phase: 'fase',
}

interface FilaLeida extends DocumentTypeFields {
  readonly line: number
  /** Códigos, no identificadores: el fichero no conoce los uuid. */
  readonly esperaA: readonly string[] | null
}

export interface DocumentsSummary {
  readonly rows: number
  readonly created: number
  readonly updated: number
  readonly links: number
  readonly warnings: readonly string[]
}

/** Lee y valida el fichero. No toca la base. */
export function parseDocumentsCsv(text: string): readonly FilaLeida[] {
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
  const leidas: FilaLeida[] = []
  const vistos = new Map<string, number>()

  for (const [indice, fila] of filas.entries()) {
    const line = indice + 2
    const code = (fila['codigo'] ?? '').trim()
    const name = (fila['nombre'] ?? '').trim()
    if (code === '') problemas.push(`Fila ${String(line)}: falta el código`)
    if (name === '') problemas.push(`Fila ${String(line)}: falta el nombre`)

    const repetida = vistos.get(code.toLowerCase())
    if (code !== '' && repetida !== undefined) {
      // Dos filas con el mismo código: la segunda pisaría a la primera en
      // silencio y nadie sabría cuál quedó.
      problemas.push(`Fila ${String(line)}: el código «${code}» ya está en la fila ${String(repetida)}`)
    } else if (code !== '') vistos.set(code.toLowerCase(), line)

    const tipoTexto = (fila['tipo'] ?? '').trim().toLowerCase()
    const kind = tipoTexto === '' ? 'documento' : TIPOS[tipoTexto]
    if (kind === undefined) {
      problemas.push(
        `Fila ${String(line)}: «${tipoTexto}» no es un tipo. Los que hay: documento, hito, fase`,
      )
    }

    const semanas = leerEntero(fila['semanas_antes'], 'semanas_antes', line, problemas)
    const horas = leerNumero(fila['horas'], 'horas', line, problemas)
    // Un hito con horas no es un error: una puerta de revisión cuesta las horas
    // de su propia reunión. Lo dijo el primer catálogo real que pasó por aquí,
    // donde las nueve puertas traían 16 h cada una.
    const minutos = horas === null ? null : Math.round(horas * MINUTOS_POR_HORA)

    if (kind === undefined || code === '' || name === '') continue
    const esperaTexto = fila['espera_a']
    leidas.push({
      line,
      code,
      name,
      description: vacioANulo(fila['descripcion']),
      kind,
      discipline: vacioANulo(fila['disciplina']),
      gate: vacioANulo(fila['puerta']),
      weeksBeforeGate: semanas,
      standardMinutes: minutos,
      taskCode: vacioANulo(fila['codigo_tarea']),
      sortKey: (indice + 1) * 10,
      // Sin columna, la fila no dice nada de sus predecesores y no se tocan.
      // Con la columna vacía, dice que no espera a nadie y se borran.
      esperaA: esperaTexto === undefined ? null : listaDeCodigos(esperaTexto),
    })
  }

  if (problemas.length > 0) throw new ImportError('El fichero tiene filas que no se pueden leer', problemas)
  return leidas
}

/** Resuelve los códigos contra el catálogo, escribe y devuelve el resumen. */
export async function importDocumentsCsv(db: Queryable, text: string): Promise<DocumentsSummary> {
  const filas = parseDocumentsCsv(text)

  const existentes = await readDocumentTypes(db)
  const idPorCodigo = new Map(existentes.map((tipo) => [tipo.code.toLowerCase(), tipo.id]))

  let created = 0
  let updated = 0
  for (const fila of filas) {
    // `line` y `esperaA` son del fichero, no de la ficha: la primera es para
    // los mensajes de error y la segunda se resuelve más abajo, cuando ya
    // existen todos los códigos.
    const campos: DocumentTypeFields = {
      code: fila.code,
      name: fila.name,
      description: fila.description,
      kind: fila.kind,
      discipline: fila.discipline,
      gate: fila.gate,
      weeksBeforeGate: fila.weeksBeforeGate,
      standardMinutes: fila.standardMinutes,
      taskCode: fila.taskCode,
      sortKey: fila.sortKey,
    }
    const conocido = idPorCodigo.get(fila.code.toLowerCase())
    if (conocido === undefined) {
      idPorCodigo.set(fila.code.toLowerCase(), await createDocumentType(db, campos))
      created += 1
    } else {
      await updateDocumentType(db, conocido, campos)
      updated += 1
    }
  }

  // Los enlaces, después de crearlo todo: una fila puede esperar a otra que
  // aparece más abajo en el fichero. Se resuelven TODOS antes de escribir
  // ninguno, para que los errores salgan juntos y con su número de fila.
  const problemas: string[] = []
  const aristas: { readonly de: string; readonly a: string }[] = []
  const porEscribir: { readonly successorId: string; readonly predecesores: string[] }[] = []

  for (const fila of filas) {
    if (fila.esperaA === null) continue
    const successorId = idPorCodigo.get(fila.code.toLowerCase())
    if (successorId === undefined) continue
    const predecesores: string[] = []
    for (const codigo of fila.esperaA) {
      const id = idPorCodigo.get(codigo.toLowerCase())
      if (id === undefined) {
        problemas.push(`Fila ${String(fila.line)}: «${fila.code}» espera a «${codigo}», que no existe`)
        continue
      }
      if (id === successorId) {
        problemas.push(`Fila ${String(fila.line)}: «${fila.code}» no puede esperarse a sí mismo`)
        continue
      }
      predecesores.push(id)
      aristas.push({ de: codigo.toLowerCase(), a: fila.code.toLowerCase() })
    }
    porEscribir.push({ successorId, predecesores })
  }

  if (problemas.length > 0) {
    throw new ImportError('El fichero apunta a códigos que no existen', problemas)
  }

  let links = 0
  for (const { successorId, predecesores } of porEscribir) {
    await setPredecessors(db, successorId, predecesores)
    links += predecesores.length
  }

  return {
    rows: filas.length,
    created,
    updated,
    links,
    warnings: avisos(filas, aristas),
  }
}

/**
 * Lo que no impide cargar el fichero pero merece leerse: los ciclos.
 *
 * No se rechazan, por lo mismo que la pantalla deja marcar la casilla que
 * cierra uno: a veces se descubre justo entonces. Pero se dicen, porque nadie
 * va a repasar ochenta filas buscando la casilla roja.
 */
function avisos(
  filas: readonly FilaLeida[],
  aristas: readonly { readonly de: string; readonly a: string }[],
): readonly string[] {
  const salidas = new Map<string, string[]>()
  for (const arista of aristas) {
    const lista = salidas.get(arista.de) ?? []
    lista.push(arista.a)
    salidas.set(arista.de, lista)
  }
  const nombrePorCodigo = new Map(filas.map((fila) => [fila.code.toLowerCase(), fila.code]))

  const GRIS = 1
  const NEGRO = 2
  const estado = new Map<string, number>()
  const ciclos: string[] = []
  const pila: string[] = []

  const visitar = (nodo: string): void => {
    estado.set(nodo, GRIS)
    pila.push(nodo)
    for (const siguiente of salidas.get(nodo) ?? []) {
      const suyo = estado.get(siguiente)
      if (suyo === GRIS) {
        const desde = pila.indexOf(siguiente)
        const ruta = pila.slice(desde === -1 ? 0 : desde).map((c) => nombrePorCodigo.get(c) ?? c)
        ciclos.push([...ruta, nombrePorCodigo.get(siguiente) ?? siguiente].join(' → '))
      } else if (suyo === undefined) visitar(siguiente)
    }
    pila.pop()
    estado.set(nodo, NEGRO)
  }

  for (const codigo of nombrePorCodigo.keys()) {
    if (estado.get(codigo) === undefined) visitar(codigo)
  }

  // Un mismo ciclo aparece una vez por cada nodo desde el que se entra.
  return [...new Set(ciclos)]
    .slice(0, 10)
    .map((ruta) => `Ciclo: ${ruta}. Ningún plan que salga de aquí se puede calcular.`)
}

function vacioANulo(valor: string | undefined): string | null {
  const limpio = (valor ?? '').trim()
  return limpio === '' ? null : limpio
}

function listaDeCodigos(valor: string): readonly string[] {
  return valor
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

function leerNumero(
  valor: string | undefined,
  columna: string,
  line: number,
  problemas: string[],
): number | null {
  const texto = (valor ?? '').trim()
  if (texto === '') return null
  const numero = parseNumber(texto)
  if (numero === null) {
    problemas.push(`Fila ${String(line)}: «${columna}» no es un número («${texto}»)`)
    return null
  }
  if (numero < 0) {
    problemas.push(`Fila ${String(line)}: «${columna}» no puede ser negativo`)
    return null
  }
  return numero
}

function leerEntero(
  valor: string | undefined,
  columna: string,
  line: number,
  problemas: string[],
): number | null {
  const numero = leerNumero(valor, columna, line, problemas)
  return numero === null ? null : Math.round(numero)
}
