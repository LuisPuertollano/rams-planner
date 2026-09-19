/**
 * El zip de la copia de seguridad: qué lleva dentro y cómo se lee sin nada.
 *
 * El requisito que manda sobre todos los demás es ese: **auditable sin la
 * herramienta**. De ahí sale todo lo que hay aquí —CSV con punto y coma y BOM
 * para que Excel los abra de dos clics, un LEEME en castellano que explica qué
 * es cada carpeta, y un fichero de sumas SHA-256 para poder demostrar que nadie
 * tocó nada— y de ahí sale también lo que NO hay: ni un formato propio, ni un
 * índice binario, ni nada que obligue a arrancar un contenedor para mirar
 * dentro.
 *
 * Una sola carpeta de datos, `tablas/`, y eso fue una decisión: la primera
 * versión llevaba además los mismos datos en el formato de las importaciones,
 * «para que se lean mejor». Dos representaciones de lo mismo son dos cosas que
 * pueden discrepar, y la que restaura tiene que ser una sola y exacta. El CSV
 * por tabla ya se lee en Excel; lo otro sobraba.
 */

import { createHash } from 'node:crypto'
import {
  leerCopia, NO_SE_COPIAN, NO_SE_RESTAURAN, restaurarCopia, tablasEnOrden,
  versionDelEsquema, SE_RECALCULAN,
  type ResumenDeCopia, type ResultadoDeRestauracion, type Queryable,
} from '@planner/persistence'
import type { ErrorCode } from './errors.js'
import { parseCsv, toCsv } from './csv.js'
import { crearZip, leerZip, ZipError, type ZipEntry } from './zip.js'

export const CARPETA_TABLAS = 'tablas'
export const FICHERO_LEEME = 'LEEME.txt'
export const FICHERO_MANIFIESTO = 'MANIFIESTO.csv'
export const FICHERO_SUMAS = 'sha256sums.txt'

const COLUMNAS_MANIFIESTO = ['fichero', 'tabla', 'zona', 'filas', 'sha256'] as const

/** La suma que va en `sha256sums.txt`, en el formato que espera `sha256sum -c`. */
function suma(datos: Buffer): string {
  return createHash('sha256').update(datos).digest('hex')
}

function texto(contenido: string): Buffer {
  return Buffer.from(contenido, 'utf8')
}

/**
 * El LEEME, que es la mitad del valor de la copia.
 *
 * Una copia que hay que preguntarle a alguien qué contiene no sirve dentro de
 * cinco años, que es justo cuando se necesita. Aquí va en castellano y dice
 * también lo que NO está y por qué, que es lo que a uno se le olvida escribir y
 * lo que más falta hace.
 */
function leeme(resumen: ResumenDeCopia, instante: Date, incluyeDerivadas: boolean): string {
  const porZona = (zona: string): number =>
    resumen.tablas.filter((t) => t.zona === zona).reduce((suma, t) => suma + t.filas, 0)
  const huella = resumen.ejecucion

  return [
    'COPIA DE SEGURIDAD — RAMS Planner',
    '='.repeat(60),
    '',
    `Sacada el ${instante.toISOString().replace('T', ' ').slice(0, 19)} UTC`,
    `Versión del esquema (última migración): ${resumen.esquema}`,
    '',
    'QUÉ HAY AQUÍ',
    '-'.repeat(60),
    '',
    `  ${CARPETA_TABLAS}/         Una CSV por tabla, tal cual está en la base.`,
    '                  Es lo que restaura, y es lo que se audita.',
    `  ${FICHERO_MANIFIESTO}   Qué fichero es qué, cuántas filas y su SHA-256.`,
    `  ${FICHERO_SUMAS}   Para comprobarlo: sha256sum -c ${FICHERO_SUMAS}`,
    '',
    'Los CSV llevan punto y coma, comillas dobles y BOM de UTF-8: se abren',
    'con doble clic en Excel y con cualquier cosa que lea texto. No hace',
    'falta la herramienta, ni Docker, ni una base de datos.',
    '',
    'CUÁNTO',
    '-'.repeat(60),
    '',
    `  Declarado (lo que alguien escribió) ....... ${String(porZona('declarada')).padStart(8)} filas`,
    `  Parametrización (calendarios, roles…) .... ${String(porZona('parametrizacion')).padStart(8)} filas`,
    `  Historia (líneas base, cambios) .......... ${String(porZona('historia')).padStart(8)} filas`,
    ...(incluyeDerivadas
      ? [`  Derivado (lo que calcula el motor) ....... ${String(porZona('derivada')).padStart(8)} filas`]
      : [
          `  Derivado (lo calcula el motor, NO va aquí)  ${String(porZona('derivada')).padStart(8)} filas`,
        ]),
    '',
    'LO QUE NO ESTÁ, Y POR QUÉ',
    '-'.repeat(60),
    '',
    ...(incluyeDerivadas
      ? ['  Nada: esta copia incluye también la zona derivada.', '']
      : [
          '  La zona derivada (task_result, assignment_timephased, finding,',
          '  derivation, capacity_cell) NO se guarda. Son cientos de miles de',
          '  filas que el motor recalcula en segundos, y guardarlas multiplicaría',
          '  este fichero por cien para probar menos.',
          '',
          '  Lo que prueba que la copia es fiel es la huella de más abajo:',
          '  restaurar, recalcular y obtener la MISMA huella demuestra que no se',
          '  perdió nada por el camino.',
          '',
        ]),
    ...Object.entries(NO_SE_COPIAN).map(([tabla, motivo]) => `  ${tabla}: ${motivo}.`),
    '',
    '  Las contraseñas no salen. Restaurar recrea las cuentas sin contraseña,',
    '  y hay que ponerles una nueva. Un zip de copia acaba en un disco',
    '  compartido, y ahí no puede haber con qué entrar.',
    '',
    'AL RESTAURAR',
    '-'.repeat(60),
    '',
    '  Restaurar BORRA todo lo que haya y lo sustituye por esto. Va dentro de',
    '  una transacción: o entra entero o no entra nada.',
    '',
    ...Object.entries(NO_SE_RESTAURAN).map(([tabla, motivo]) => `  ${tabla}: ${motivo}.`),
    '',
    '  Los roles de sistema y sus permisos se quedan como están: el esquema no',
    '  deja borrarlos, y hace bien.',
    '',
    'LA HUELLA',
    '-'.repeat(60),
    '',
    ...(huella === null
      ? ['  Esta base no tiene ningún cálculo terminado, así que no hay huella',
         '  con la que comprobar la restauración.']
      : [
          `  Última ejecución : ${huella.runId}`,
          `  Huella de entrada: ${huella.inputHash}`,
          `  Versión del motor: ${huella.engineVersion}`,
          `  Cuándo           : ${huella.startedAt}`,
          '',
          '  Después de restaurar, lanza un cálculo. Si la huella de entrada que',
          '  sale es esta misma, la restauración fue fiel hasta el último dato.',
          '  Si sale otra, algo se perdió y más vale saberlo ahora.',
        ]),
    '',
  ].join('\n')
}

export interface CopiaHecha {
  readonly zip: Buffer
  readonly resumen: ResumenDeCopia
  readonly ficheros: number
}

/** Saca la copia entera. No escribe nada en la base. */
export async function exportarCopia(
  db: Queryable,
  opciones: { readonly instante: Date; readonly incluirDerivadas?: boolean },
): Promise<CopiaHecha> {
  const incluirDerivadas = opciones.incluirDerivadas ?? false
  const { resumen, datos } = await leerCopia(db, incluirDerivadas)

  const entradas: ZipEntry[] = []
  const manifiesto: Record<string, string>[] = []
  const sumas: string[] = []

  for (const tabla of resumen.tablas) {
    const filas = datos.get(tabla.tabla)
    if (filas === undefined) continue
    const ruta = `${CARPETA_TABLAS}/${tabla.tabla}.csv`
    const cuerpo = texto(toCsv(filas, [...tabla.columnas]))
    entradas.push({ path: ruta, data: cuerpo })
    const sha = suma(cuerpo)
    manifiesto.push({
      fichero: ruta,
      tabla: tabla.tabla,
      zona: tabla.zona,
      filas: String(tabla.filas),
      sha256: sha,
    })
    sumas.push(`${sha}  ${ruta}`)
  }

  const cuerpoManifiesto = texto(toCsv(manifiesto, [...COLUMNAS_MANIFIESTO]))
  const cuerpoLeeme = texto(leeme(resumen, opciones.instante, incluirDerivadas))
  sumas.push(`${suma(cuerpoManifiesto)}  ${FICHERO_MANIFIESTO}`)
  sumas.push(`${suma(cuerpoLeeme)}  ${FICHERO_LEEME}`)

  // El LEEME primero: quien abra el zip tiene que tropezarse con él.
  entradas.unshift({ path: FICHERO_LEEME, data: cuerpoLeeme })
  entradas.push({ path: FICHERO_MANIFIESTO, data: cuerpoManifiesto })
  // Las sumas no se suman a sí mismas, por razones evidentes.
  entradas.push({ path: FICHERO_SUMAS, data: texto(`${sumas.join('\n')}\n`) })

  return { zip: crearZip(entradas, opciones.instante), resumen, ficheros: entradas.length }
}

/** Lo que se dice cuando la copia que llega no se puede restaurar. */
export class CopiaInvalida extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    readonly detalle?: string,
  ) {
    super(message)
  }
}

export interface CopiaLeida {
  readonly datos: ReadonlyMap<string, readonly Readonly<Record<string, string>>[]>
  readonly esquema: string
  readonly tablas: readonly string[]
}

/**
 * Abre el zip y comprueba que se puede restaurar, **antes** de tocar nada.
 *
 * Lo primero que mira es la versión del esquema. Restaurar una copia de un
 * esquema viejo sobre uno nuevo dejaría columnas sin poner y filas sin sentido,
 * y no fallaría: entraría, y la base quedaría mal de una forma que no se ve.
 * Por eso se rechaza y se dice con qué versión se sacó.
 */
export async function abrirCopia(db: Queryable, zip: Buffer): Promise<CopiaLeida> {
  let entradas: ReadonlyMap<string, Buffer>
  try {
    entradas = leerZip(zip)
  } catch (cause) {
    throw new CopiaInvalida(
      cause instanceof ZipError ? cause.message : 'El fichero no se pudo abrir',
      'COPIA_NO_ES_ZIP',
    )
  }

  const manifiesto = entradas.get(FICHERO_MANIFIESTO)
  if (manifiesto === undefined) {
    throw new CopiaInvalida('El zip no trae manifiesto', 'COPIA_SIN_MANIFIESTO')
  }

  // Las sumas se comprueban aquí, no al restaurar: un fichero cambiado tiene
  // que detenerlo todo antes de que se borre la primera fila.
  const sumasDeclaradas = new Map<string, string>()
  for (const linea of (entradas.get(FICHERO_SUMAS)?.toString('utf8') ?? '').split('\n')) {
    const corte = linea.indexOf('  ')
    if (corte > 0) sumasDeclaradas.set(linea.slice(corte + 2).trim(), linea.slice(0, corte).trim())
  }
  for (const [ruta, contenido] of entradas) {
    const esperada = sumasDeclaradas.get(ruta)
    if (esperada !== undefined && esperada !== suma(contenido)) {
      throw new CopiaInvalida(`«${ruta}» no cuadra con su suma`, 'COPIA_TOCADA', ruta)
    }
  }

  const esquemaAhora = await versionDelEsquema(db)
  const filasManifiesto = parseCsv(manifiesto.toString('utf8'))
  const esquemaCopia = leerEsquemaDelLeeme(entradas.get(FICHERO_LEEME)?.toString('utf8') ?? '')
  if (esquemaCopia !== '' && esquemaCopia !== esquemaAhora) {
    throw new CopiaInvalida(
      'La copia se sacó con otra versión del esquema',
      'COPIA_OTRO_ESQUEMA',
      `copia ${esquemaCopia}, base ${esquemaAhora}`,
    )
  }

  const datos = new Map<string, readonly Readonly<Record<string, string>>[]>()
  for (const fila of filasManifiesto) {
    const tabla = fila['tabla'] ?? ''
    const ruta = fila['fichero'] ?? ''
    if (tabla === '' || ruta === '') continue
    const contenido = entradas.get(ruta)
    if (contenido === undefined) {
      throw new CopiaInvalida(`El manifiesto nombra «${ruta}» y no está`, 'COPIA_INCOMPLETA', ruta)
    }
    datos.set(tabla, parseCsv(contenido.toString('utf8')))
  }

  // Y que estén todas las que la base espera. Una copia a la que le falta una
  // tabla restauraría una base incompleta sin decirlo.
  // La zona derivada no va en la copia a propósito, así que tampoco se echa de
  // menos: pedirla aquí daría por incompleta una copia que está entera.
  const esperadas = (await tablasEnOrden(db)).filter(
    (t) => !(t in NO_SE_RESTAURAN) && !SE_RECALCULAN.has(t),
  )
  const faltan = esperadas.filter((t) => !datos.has(t))
  if (faltan.length > 0) {
    throw new CopiaInvalida(
      'A la copia le faltan tablas', 'COPIA_INCOMPLETA', faltan.join(', '),
    )
  }

  return { datos, esquema: esquemaCopia, tablas: [...datos.keys()] }
}

/** La versión del esquema, sacada del LEEME. Va escrita en una línea fija. */
function leerEsquemaDelLeeme(leeme: string): string {
  const linea = leeme.split('\n').find((l) => l.startsWith('Versión del esquema'))
  return linea === undefined ? '' : (linea.split(':')[1] ?? '').trim()
}

/** Abre la copia, la comprueba y la mete. Todo dentro de la transacción que reciba. */
export async function importarCopia(
  db: Queryable,
  zip: Buffer,
  comentario: string,
): Promise<ResultadoDeRestauracion> {
  const copia = await abrirCopia(db, zip)
  return restaurarCopia(db, copia.datos, comentario)
}
