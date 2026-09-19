/**
 * Un ZIP escrito y leído a mano, con `node:zlib` y nada más.
 *
 * No hay librería detrás a propósito, por lo mismo que no la hay detrás del
 * i18n: lo que hace falta es un contenedor con unas cuantas cabeceras, un CRC y
 * `deflateRaw`, y eso cabe aquí. Una dependencia más es una dependencia que hay
 * que actualizar durante diez años, y el formato ZIP no ha cambiado desde 1993.
 *
 * Lo que sí importa y por eso está escrito:
 *
 * - **La marca de UTF-8 va puesta** (bit 11 de las banderas). Sin ella, un
 *   nombre con acento se abre mal en Windows, y aquí los ficheros se llaman
 *   `01-declarado/calendarios.csv` y `03-historia/líneas-base.csv`.
 * - **El instante es un parámetro.** Dos copias del mismo dato dan el mismo
 *   zip byte a byte si se les da el mismo instante, y eso es lo que permite
 *   comprobar en una prueba que exportar es determinista (P2).
 * - **Se lee el directorio central, no los encabezados locales.** Es lo que
 *   dice la norma y lo único fiable: un encabezado local puede declarar los
 *   tamaños a cero y dejarlos en un descriptor posterior.
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib'

/** Un fichero dentro del zip: su ruta y su contenido. */
export interface ZipEntry {
  readonly path: string
  readonly data: Buffer
}

const FIRMA_LOCAL = 0x04034b50
const FIRMA_CENTRAL = 0x02014b50
const FIRMA_FINAL = 0x06054b50
const METODO_DEFLATE = 8
const METODO_CRUDO = 0
const BANDERA_UTF8 = 0x0800
const VERSION = 20

/** Tabla del CRC-32 de PKZIP, construida una vez. */
const TABLA_CRC = ((): Uint32Array => {
  const tabla = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let bit = 0; bit < 8; bit += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    tabla[i] = c >>> 0
  }
  return tabla
})()

export function crc32(data: Buffer): number {
  let c = 0xffffffff
  for (const byte of data) c = (TABLA_CRC[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * La fecha y la hora en el formato de MS-DOS, que es lo que el ZIP guarda.
 *
 * Segundos en pasos de dos y años desde 1980: no es una elección de nadie de
 * aquí, es lo que hay en el formato desde que existe.
 */
function fechaDos(instante: Date): { hora: number; fecha: number } {
  const anio = Math.max(1980, instante.getUTCFullYear())
  return {
    hora:
      (instante.getUTCHours() << 11) |
      (instante.getUTCMinutes() << 5) |
      (Math.floor(instante.getUTCSeconds() / 2) & 0x1f),
    fecha: ((anio - 1980) << 9) | ((instante.getUTCMonth() + 1) << 5) | instante.getUTCDate(),
  }
}

/**
 * Empaqueta las entradas en un zip.
 *
 * Se comprime con deflate salvo cuando comprimir **engorda** el fichero, que
 * pasa de verdad con los CSV de una o dos líneas. En ese caso se guarda tal
 * cual: un zip no tiene por qué mentir sobre lo que le ahorra a nadie.
 */
export function crearZip(entradas: readonly ZipEntry[], instante: Date): Buffer {
  const { hora, fecha } = fechaDos(instante)
  const trozos: Buffer[] = []
  const central: Buffer[] = []
  let desplazamiento = 0

  for (const entrada of entradas) {
    const nombre = Buffer.from(entrada.path, 'utf8')
    const comprimido = deflateRawSync(entrada.data, { level: 9 })
    const usaDeflate = comprimido.length < entrada.data.length
    const cuerpo = usaDeflate ? comprimido : entrada.data
    const metodo = usaDeflate ? METODO_DEFLATE : METODO_CRUDO
    const suma = crc32(entrada.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(FIRMA_LOCAL, 0)
    local.writeUInt16LE(VERSION, 4)
    local.writeUInt16LE(BANDERA_UTF8, 6)
    local.writeUInt16LE(metodo, 8)
    local.writeUInt16LE(hora, 10)
    local.writeUInt16LE(fecha, 12)
    local.writeUInt32LE(suma, 14)
    local.writeUInt32LE(cuerpo.length, 18)
    local.writeUInt32LE(entrada.data.length, 22)
    local.writeUInt16LE(nombre.length, 26)
    local.writeUInt16LE(0, 28)
    trozos.push(local, nombre, cuerpo)

    const ficha = Buffer.alloc(46)
    ficha.writeUInt32LE(FIRMA_CENTRAL, 0)
    ficha.writeUInt16LE(VERSION, 4)
    ficha.writeUInt16LE(VERSION, 6)
    ficha.writeUInt16LE(BANDERA_UTF8, 8)
    ficha.writeUInt16LE(metodo, 10)
    ficha.writeUInt16LE(hora, 12)
    ficha.writeUInt16LE(fecha, 14)
    ficha.writeUInt32LE(suma, 16)
    ficha.writeUInt32LE(cuerpo.length, 20)
    ficha.writeUInt32LE(entrada.data.length, 24)
    ficha.writeUInt16LE(nombre.length, 28)
    ficha.writeUInt32LE(desplazamiento, 42)
    central.push(ficha, nombre)

    desplazamiento += local.length + nombre.length + cuerpo.length
  }

  const directorio = Buffer.concat(central)
  const final = Buffer.alloc(22)
  final.writeUInt32LE(FIRMA_FINAL, 0)
  final.writeUInt16LE(entradas.length, 8)
  final.writeUInt16LE(entradas.length, 10)
  final.writeUInt32LE(directorio.length, 12)
  final.writeUInt32LE(desplazamiento, 16)

  return Buffer.concat([...trozos, directorio, final])
}

/** Lo que se dice cuando el fichero que llega no es un zip que sepamos leer. */
export class ZipError extends Error {}

/**
 * Saca las entradas de un zip, leyendo el directorio central.
 *
 * Devuelve un `Map` de ruta a contenido porque es como se usa: la restauración
 * pregunta por `01-declarado/plan.csv`, no recorre el zip en orden.
 */
export function leerZip(zip: Buffer): ReadonlyMap<string, Buffer> {
  const finDelDirectorio = buscarFinal(zip)
  const cuantas = zip.readUInt16LE(finDelDirectorio + 10)
  let cursor = zip.readUInt32LE(finDelDirectorio + 16)

  const entradas = new Map<string, Buffer>()
  for (let i = 0; i < cuantas; i += 1) {
    if (zip.readUInt32LE(cursor) !== FIRMA_CENTRAL) {
      throw new ZipError('El directorio del zip está roto')
    }
    const metodo = zip.readUInt16LE(cursor + 10)
    const sumaEsperada = zip.readUInt32LE(cursor + 16)
    const comprimido = zip.readUInt32LE(cursor + 20)
    const largoNombre = zip.readUInt16LE(cursor + 28)
    const largoExtra = zip.readUInt16LE(cursor + 30)
    const largoComentario = zip.readUInt16LE(cursor + 32)
    const inicioLocal = zip.readUInt32LE(cursor + 42)
    const nombre = zip.subarray(cursor + 46, cursor + 46 + largoNombre).toString('utf8')

    // El encabezado local tiene sus propias longitudes de nombre y extra, y no
    // tienen por qué coincidir con las del directorio: hay que leer las suyas.
    const nombreLocal = zip.readUInt16LE(inicioLocal + 26)
    const extraLocal = zip.readUInt16LE(inicioLocal + 28)
    const inicioDatos = inicioLocal + 30 + nombreLocal + extraLocal
    const cuerpo = zip.subarray(inicioDatos, inicioDatos + comprimido)

    const datos =
      metodo === METODO_DEFLATE
        ? inflateRawSync(cuerpo)
        : metodo === METODO_CRUDO
          ? Buffer.from(cuerpo)
          : null
    if (datos === null) throw new ZipError(`«${nombre}» usa una compresión que no se lee`)
    // Se comprueba el CRC aquí y no más arriba: un zip que llega corrupto tiene
    // que fallar al abrirlo, no a mitad de restaurar y con media base escrita.
    if (crc32(datos) !== sumaEsperada) throw new ZipError(`«${nombre}» llega corrupto`)
    entradas.set(nombre, datos)

    cursor += 46 + largoNombre + largoExtra + largoComentario
  }
  return entradas
}

/**
 * El final del directorio central, buscado desde atrás.
 *
 * Hay que buscarlo y no saltar a los últimos 22 bytes porque el formato admite
 * un comentario al final, de hasta 64 kB.
 */
function buscarFinal(zip: Buffer): number {
  const minimo = Math.max(0, zip.length - 22 - 0xffff)
  for (let i = zip.length - 22; i >= minimo; i -= 1) {
    if (zip.readUInt32LE(i) === FIRMA_FINAL) return i
  }
  throw new ZipError('El fichero no es un zip')
}
