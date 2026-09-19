/**
 * Importación de la Checkliste de revisión, desde un CSV plano.
 *
 *   disciplina;codigo;capitulo;capitulo_nombre;pregunta;puerta;nivel;prueba;entregables
 *
 * ## Una fila por (consulta, puerta), y no una columna por puerta
 *
 * La hoja de origen es una rejilla: las consultas en filas, las puertas en
 * columnas, y el nivel en la casilla. Copiarla así obligaría a que el juego de
 * puertas estuviera en la cabecera del fichero, y entonces añadir una puerta
 * sería cambiar el formato. Aquí va en largo: **una fila por casilla**. Añadir
 * una puerta es añadir filas.
 *
 * Es además la forma que sale de despivotar la hoja, que es lo que hay que
 * hacer para exportarla de todos modos.
 *
 * ## Tres reglas
 *
 *   - **El código manda dentro de su disciplina.** Las filas del mismo código
 *     son la misma consulta: la pregunta se escribe una vez y las demás filas
 *     sólo añaden su puerta. Cargar dos veces el fichero deja cincuenta y una
 *     consultas, no ciento dos.
 *
 *   - **Lo que no viene, se va.** Las puertas y los entregables de una consulta
 *     son la lista completa. Quitar una puerta de una consulta es un cambio
 *     normal entre dos revisiones de la hoja, y tiene que poder hacerse
 *     borrando una fila.
 *
 *   - **El orden del fichero es el orden del cuestionario.** Un cuestionario
 *     leído fuera de orden no se contesta: la fila 2 sale antes que la 3.
 *
 * Los entregables van en una casilla, separados por comas, como `CODIGO` o
 * `CODIGO@madurez`. Vacía significa que esa consulta la contesta una persona,
 * que es aproximadamente la mitad de ellas y no es un defecto del fichero.
 */

import { readDocumentTypes, setGateQueries, type GateQueryInput, type Queryable } from '@planner/persistence'
import { NIVELES, type NivelDeConsulta } from '@planner/scheduler'
import { parseCsv } from './csv.js'
import { ImportError } from './import-plan.js'

/** Las columnas sin las que no se puede leer una fila. */
const OBLIGATORIAS = ['codigo', 'puerta', 'nivel'] as const

export interface ChecklistSummary {
  readonly queries: number
  readonly created: number
  readonly updated: number
  readonly gates: number
  readonly links: number
  /** Las puertas que el fichero nombra, para poder cotejarlas con las del proyecto. */
  readonly gateNames: readonly string[]
  /** Cuántas consultas las contesta una persona porque no nombran entregable. */
  readonly humanOnly: number
  /**
   * Lo que se leyó y no cuadra, sin abortar: un entregable que no existe en el
   * catálogo, o dos filas del mismo código con preguntas distintas. Se dice en
   * el resumen porque nadie va a repasar doscientas filas buscando la mala.
   */
  readonly warnings: readonly string[]
}

const esNivel = (valor: string): valor is NivelDeConsulta =>
  (NIVELES as readonly string[]).includes(valor)

/** `S-FMECA@preliminar, S-HAZLOG` → dos entregables, uno con madurez. */
function leeEntregables(casilla: string): readonly { code: string; maturity: string | null }[] {
  return casilla
    .split(',')
    .map((trozo) => trozo.trim())
    .filter((trozo) => trozo !== '')
    .map((trozo) => {
      const corte = trozo.indexOf('@')
      if (corte < 0) return { code: trozo, maturity: null }
      return {
        code: trozo.slice(0, corte).trim(),
        maturity: trozo.slice(corte + 1).trim() || null,
      }
    })
}

export async function importChecklistCsv(
  db: Queryable,
  text: string,
): Promise<ChecklistSummary> {
  const filas = parseCsv(text)
  if (filas.length === 0) throw new ImportError('El fichero no tiene ninguna fila de datos')

  const problemas: string[] = []
  for (const [indice, fila] of filas.entries()) {
    for (const columna of OBLIGATORIAS) {
      if ((fila[columna] ?? '').trim() === '') {
        problemas.push(`Fila ${String(indice + 2)}: falta «${columna}»`)
      }
    }
    const nivel = (fila['nivel'] ?? '').trim().toUpperCase()
    if (nivel !== '' && !esNivel(nivel)) {
      problemas.push(
        `Fila ${String(indice + 2)}: el nivel «${nivel}» no es ninguno de ${NIVELES.join(', ')}`,
      )
    }
  }
  if (problemas.length > 0) {
    throw new ImportError('El fichero tiene filas que no se pueden leer', problemas)
  }

  // El catálogo, por código, para resolver los entregables que nombra la hoja.
  const catalogo = new Map<string, string>()
  for (const documento of await readDocumentTypes(db)) {
    catalogo.set(documento.code.trim().toUpperCase(), documento.id)
  }

  const avisos: string[] = []
  const porCodigo = new Map<string, GateQueryInput>()
  const orden: string[] = []

  for (const [indice, fila] of filas.entries()) {
    const disciplina = (fila['disciplina'] ?? 'safety').trim() || 'safety'
    const codigo = (fila['codigo'] ?? '').trim()
    const clave = `${disciplina.toLowerCase()}|${codigo.toUpperCase()}`
    const pregunta = (fila['pregunta'] ?? '').trim()

    const entregables: { documentTypeId: string; maturity: string | null }[] = []
    for (const nombrado of leeEntregables(fila['entregables'] ?? '')) {
      const id = catalogo.get(nombrado.code.toUpperCase())
      if (id === undefined) {
        // No aborta: la hoja de la Checkliste y el catálogo los mantiene gente
        // distinta, y un nombre que todavía no existe es información, no una
        // razón para no cargar las otras doscientas filas.
        avisos.push(
          `Fila ${String(indice + 2)}: la consulta ${codigo} nombra «${nombrado.code}», que no está en el catálogo`,
        )
        continue
      }
      entregables.push({ documentTypeId: id, maturity: nombrado.maturity })
    }

    const enPuerta = {
      gate: (fila['puerta'] ?? '').trim(),
      level: (fila['nivel'] ?? '').trim().toUpperCase() as NivelDeConsulta,
      proofRequest: (fila['prueba'] ?? '').trim() || null,
    }

    const ya = porCodigo.get(clave)
    if (ya === undefined) {
      orden.push(clave)
      porCodigo.set(clave, {
        discipline: disciplina,
        chapter: (fila['capitulo'] ?? '').trim(),
        chapterName: (fila['capitulo_nombre'] ?? '').trim() || null,
        code: codigo,
        question: pregunta,
        sortKey: orden.length,
        gates: [enPuerta],
        documents: entregables,
      })
      continue
    }

    // La pregunta se repite en cada fila de la misma consulta, y dos redacciones
    // distintas significan que alguien editó una fila y no las otras. Manda la
    // primera y se dice, en vez de quedarse con la última en silencio.
    if (pregunta !== '' && ya.question !== '' && pregunta !== ya.question) {
      avisos.push(
        `Fila ${String(indice + 2)}: la consulta ${codigo} trae dos preguntas distintas; se queda la primera`,
      )
    }

    porCodigo.set(clave, {
      ...ya,
      question: ya.question === '' ? pregunta : ya.question,
      chapterName: ya.chapterName ?? ((fila['capitulo_nombre'] ?? '').trim() || null),
      gates: [...ya.gates, enPuerta],
      // Los entregables de una consulta son los mismos en todas sus puertas
      // salvo la madurez, y quien la escriba en una fila y no en otra está
      // diciendo dos cosas: se acumulan sin repetir.
      documents: [
        ...ya.documents,
        ...entregables.filter(
          (nuevo) =>
            !ya.documents.some(
              (viejo) =>
                viejo.documentTypeId === nuevo.documentTypeId &&
                (viejo.maturity ?? '').toUpperCase() === (nuevo.maturity ?? '').toUpperCase(),
            ),
        ),
      ],
    })
  }

  const consultas = orden.map((clave) => porCodigo.get(clave)).filter((x) => x !== undefined)
  const sinPregunta = consultas.filter((consulta) => consulta.question === '')
  if (sinPregunta.length > 0) {
    throw new ImportError(
      'Hay consultas sin pregunta',
      sinPregunta.map((consulta) => `La consulta ${consulta.code} no trae ninguna pregunta`),
    )
  }

  const escritas = await setGateQueries(db, consultas)
  const puertas = [
    ...new Set(consultas.flatMap((consulta) => consulta.gates.map((g) => g.gate.toUpperCase()))),
  ].sort()

  return {
    queries: consultas.length,
    created: escritas.creadas,
    updated: escritas.actualizadas,
    gates: escritas.puertas,
    links: escritas.enlaces,
    gateNames: puertas,
    humanOnly: consultas.filter((consulta) => consulta.documents.length === 0).length,
    warnings: avisos,
  }
}
