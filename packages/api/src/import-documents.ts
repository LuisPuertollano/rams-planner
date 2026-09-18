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
  checkSignatureCycle,
  type ActivitySignatureRef,
  type DocumentActivity,
  type Signature,
} from '@planner/domain'
import {
  createDocumentType,
  readDocumentTypes,
  setActivities,
  setPredecessors,
  setSignatures,
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
  /**
   * El ciclo de firma que declara la fila, por rol. `null` cuando el fichero no
   * trae ninguna de las cinco columnas: entonces no dice nada del ciclo y no se
   * toca, igual que `esperaA`. Con las columnas presentes pero vacías, dice que
   * no hay ciclo y se borra el que hubiera.
   */
  readonly firmas: readonly Signature[] | null
  /**
   * La cadena que declara la fila. `null` cuando el fichero no trae ninguna de
   * las cinco columnas: entonces no dice nada de la cadena y no se toca, igual
   * que `esperaA` y que las firmas.
   */
  readonly subactividades: readonly DocumentActivity[] | null
}

/** Las cinco casillas del ciclo, y a qué paso va cada una. */
const COLUMNAS_DE_FIRMA = [
  { columna: 'autor', step: 'author', position: 1, lista: false },
  { columna: 'verificador_1', step: 'verifier', position: 1, lista: false },
  { columna: 'verificador_2', step: 'verifier', position: 2, lista: false },
  { columna: 'aprobador', step: 'approver', position: 1, lista: false },
  { columna: 'revisores', step: 'reviewer', position: 1, lista: true },
] as const

/**
 * Las cinco casillas de la cadena, y a qué paso va cada una.
 *
 * Mismo reparto que las firmas y por el mismo motivo: son las cinco que la
 * pantalla enseña, así que una columna por casilla se lee de un vistazo y se
 * rellena en Excel sin inventarse una sintaxis. La posición es siempre 1 —el
 * modelo admite varias por paso, y ninguna cadena real de las que han pasado
 * por aquí la ha usado—.
 */
const COLUMNAS_DE_SUBACTIVIDAD = [
  { columna: 'crear', step: 'create' },
  { columna: 'revisar_1', step: 'review_1' },
  { columna: 'revisar_2', step: 'review_2' },
  { columna: 'revisar_3', step: 'review_3' },
  { columna: 'soportar', step: 'support' },
] as const

/** Los nombres con los que una subactividad cita la firma que descarga. */
const FIRMA_POR_NOMBRE: Readonly<Record<string, ActivitySignatureRef>> = {
  autor: { step: 'author', position: 1 },
  verificador_1: { step: 'verifier', position: 1 },
  verificador_2: { step: 'verifier', position: 2 },
  aprobador: { step: 'approver', position: 1 },
  revisores: { step: 'reviewer', position: 1 },
}

export interface DocumentsSummary {
  readonly rows: number
  readonly created: number
  readonly updated: number
  readonly links: number
  /** Cuántas firmas se escribieron. Cero también cuando el fichero no habla del ciclo. */
  readonly signatures: number
  /** Cuántas subactividades se escribieron. Cero también cuando el fichero no habla de la cadena. */
  readonly activities: number
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
    const firmas = leerFirmas(fila, columnas)
    const subactividades = leerSubactividades(fila, columnas, line, problemas)
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
      firmas,
      subactividades,
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
  let signatures = 0
  let activities = 0
  const sinMinutos: string[] = []
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
    let id = conocido
    if (conocido === undefined) {
      id = await createDocumentType(db, campos)
      idPorCodigo.set(fila.code.toLowerCase(), id)
      created += 1
    } else {
      await updateDocumentType(db, conocido, campos)
      updated += 1
    }
    // El ciclo de firma se sustituye entero, como los predecesores. Sin las
    // columnas en el fichero, `firmas` es null y no se toca nada.
    if (id !== undefined && fila.firmas !== null) {
      await setSignatures(db, id, fila.firmas)
      signatures += fila.firmas.length
    }
    // La cadena, DESPUÉS de las firmas y por una razón que el esquema impone:
    // una subactividad apunta a la firma que descarga con una clave ajena, así
    // que la firma tiene que existir antes.
    if (id !== undefined && fila.subactividades !== null) {
      await setActivities(db, id, fila.subactividades)
      activities += fila.subactividades.length
      if (fila.subactividades.some((actividad) => actividad.standardMinutes === null)) {
        sinMinutos.push(fila.code)
      }
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
    signatures,
    activities,
    warnings: [
      ...avisos(filas, aristas),
      // Una cadena sin minutos entra, pero no sirve para partir una tarea: el
      // reparto usa la proporción del catálogo y sin minutos no hay proporción.
      ...(sinMinutos.length === 0
        ? []
        : [
            `Estas cadenas entran sin horas en alguna casilla, así que no se puede partir con ellas: ${sinMinutos.join(', ')}.`,
          ]),
    ],
  }
}

/**
 * Lo que no impide cargar el fichero pero merece leerse: los ciclos de la
 * matriz y los ciclos de firma mal repartidos.
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
  const deLaMatriz = [...new Set(ciclos)]
    .slice(0, 10)
    .map((ruta) => `Ciclo: ${ruta}. Ningún plan que salga de aquí se puede calcular.`)

  return [...deLaMatriz, ...avisosDeFirma(filas)]
}

/**
 * Lo que está mal repartido en un ciclo de firma.
 *
 * La frase se escribe aquí, en castellano, igual que la del ciclo de la matriz:
 * el resumen de una importación es un texto que se lee una vez y se cierra, no
 * una pantalla que vive en cuatro idiomas. La ficha del entregable sí recibe el
 * código y el dato, y ahí la frase la escribe el diccionario.
 */
function avisosDeFirma(filas: readonly FilaLeida[]): readonly string[] {
  const avisos: string[] = []
  for (const fila of filas) {
    if (fila.firmas === null) continue
    for (const problema of checkSignatureCycle(fila.kind ?? 'documento', fila.firmas)) {
      avisos.push(`Fila ${String(fila.line)} («${fila.code}»): ${frase(problema.code, problema.payload)}`)
    }
  }
  return avisos.slice(0, 20)
}

function frase(code: string, payload: Readonly<Record<string, string | number>>): string {
  const rol = String(payload['role'] ?? '')
  switch (code) {
    case 'SIGNATURE_NO_AUTHOR':
      return 'el ciclo de firma no dice quién lo escribe.'
    case 'SIGNATURE_NO_APPROVER':
      return 'el ciclo de firma no dice quién lo aprueba, así que el entregable no se puede cerrar.'
    case 'SIGNATURE_NOT_INDEPENDENT':
      return `«${rol}» firma su propio trabajo: es el autor y también ${String(payload['step']) === 'approver' ? 'el aprobador' : 'un verificador'}.`
    case 'SIGNATURE_ROLE_REPEATED':
      return `«${rol}» aparece dos veces en el mismo paso: es una firma escrita dos veces, no dos firmas.`
    case 'SIGNATURE_ON_CONTAINER':
      return `es un ${String(payload['kind'])} y trae ciclo de firma; una fase agrupa y un hito es un instante, ninguno se firma.`
    default:
      return code
  }
}

/**
 * Las cinco casillas del ciclo de firma de una fila.
 *
 * Devuelve `null` cuando el fichero no trae ninguna de las cinco columnas: un
 * catálogo que no habla del ciclo no lo borra. Es la misma regla que `espera_a`
 * y por el mismo motivo — un fichero parcial toca lo que nombra y nada más.
 *
 * El esfuerzo de cada firma no viaja en el CSV. Son cinco columnas más para un
 * dato que casi nadie tiene el primer día, y que se rellena mejor en la ficha
 * del entregable, una a una, que en una hoja de ochenta filas.
 */
/**
 * La cadena de una fila: `crear`, `revisar_1`…`revisar_3`, `soportar`.
 *
 * Cada casilla se escribe `rol:horas` y, si hace falta, `rol:horas:firma`, con
 * la firma nombrada como su columna —«autor», «verificador_1»…—. Ese tercer
 * trozo es lo que permite que la herramienta avise de *una firma que cuesta
 * minutos y que ninguna subactividad hace*, que si no se pierde sin que nadie
 * lo note (ADR-0037).
 *
 * Las horas son **opcionales**, y la primera versión de esto las exigía. El
 * catálogo de verdad lo desmintió a la primera: un hito —una puerta de
 * revisión— trae su rol y no trae horas, y el esquema permite `standard_minutes`
 * nulo justamente por eso. Rechazar el fichero entero por ello dejaba fuera un
 * catálogo correcto.
 *
 * Lo que sí importa se dice en vez de imponerse: partir una tarea reparte su
 * tamaño **en la proporción del catálogo** (ADR-0039), así que una cadena sin
 * minutos entra pero no sirve para partir. Se avisa al terminar, con la cuenta,
 * y el descarte `catalogo-sin-minutos` ya estaba ahí para cuando alguien lo
 * intente.
 */
function leerSubactividades(
  fila: Readonly<Record<string, string | undefined>>,
  columnas: ReadonlySet<string>,
  line: number,
  problemas: string[],
): readonly DocumentActivity[] | null {
  if (!COLUMNAS_DE_SUBACTIVIDAD.some((casilla) => columnas.has(casilla.columna))) return null

  const cadena: DocumentActivity[] = []
  for (const casilla of COLUMNAS_DE_SUBACTIVIDAD) {
    const texto = (fila[casilla.columna] ?? '').trim()
    if (texto === '') continue
    const trozos = texto.split(':').map((trozo) => trozo.trim())
    const role = trozos[0] ?? ''
    if (role === '') {
      problemas.push(`Fila ${String(line)}: «${casilla.columna}» no dice qué rol la hace`)
      continue
    }
    const horas = trozos.length > 1 ? leerNumero(trozos[1], casilla.columna, line, problemas) : null
    let signature: ActivitySignatureRef | null = null
    const nombreDeFirma = trozos[2]
    if (nombreDeFirma !== undefined && nombreDeFirma !== '') {
      const referencia = FIRMA_POR_NOMBRE[nombreDeFirma.toLowerCase()]
      if (referencia === undefined) {
        problemas.push(
          `Fila ${String(line)}: «${nombreDeFirma}» no es una casilla de firma. ` +
            `Las que hay: ${Object.keys(FIRMA_POR_NOMBRE).join(', ')}`,
        )
        continue
      }
      signature = referencia
    }
    cadena.push({
      step: casilla.step,
      position: 1,
      role,
      standardMinutes: horas === null ? null : Math.round(horas * MINUTOS_POR_HORA),
      signature,
    })
  }
  return cadena
}

function leerFirmas(
  fila: Readonly<Record<string, string | undefined>>,
  columnas: ReadonlySet<string>,
): readonly Signature[] | null {
  if (!COLUMNAS_DE_FIRMA.some((casilla) => columnas.has(casilla.columna))) return null

  const firmas: Signature[] = []
  for (const casilla of COLUMNAS_DE_FIRMA) {
    const texto = (fila[casilla.columna] ?? '').trim()
    if (texto === '') continue
    const roles = casilla.lista ? listaDeCodigos(texto) : [texto]
    for (const [indice, role] of roles.entries()) {
      firmas.push({
        step: casilla.step,
        // Una lista ocupa posiciones consecutivas desde la suya; una casilla
        // simple, la que le toca. Así «Calidad|Compras» son revisor 1 y 2.
        position: casilla.position + indice,
        role,
        standardMinutes: null,
      })
    }
  }
  return firmas
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
