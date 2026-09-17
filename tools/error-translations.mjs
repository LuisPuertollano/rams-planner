/**
 * Que ningún error de la API se quede sin traducir, y que ninguna ruta se
 * invente su propia frase por detrás.
 *
 * Mismo sitio y misma razón que las reglas de los hallazgos y de los permisos:
 * el catálogo vive en la API (`packages/api/src/errors.ts`) y las frases en la
 * interfaz, y ninguno de los dos lo puede comprobar solo. Se lee el código
 * fuente del disco, sin compilar nada y sin que ningún paquete importe a otro.
 *
 * La segunda comprobación es la que de verdad evita la recaída. Traducir los
 * veintiún errores que había fue trabajo de una tarde; lo que cuesta es que el
 * número veintidós no vuelva a nacer como una frase suelta en un
 * `reply.status(422).send({ error: '...' })`, que es exactamente como nacieron
 * los veintiuno.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const DIRECTORIO_API = 'packages/api/src'

/**
 * El único sitio que manda un error sin pasar por `fallar`, y a propósito: el
 * manejador global reenvía un código que no acuñó él —del calendario o del
 * motor—, así que no está en este catálogo.
 */
const EXENTOS = new Set(['errors.ts', 'build-server.ts'])

/**
 * Los códigos del catálogo.
 *
 * @param {string} fuente Contenido de `packages/api/src/errors.ts`.
 * @returns {string[]}
 */
export function parseErrorCodes(fuente) {
  const declarados = /export const ERROR_CODES = \[([\s\S]*?)\] as const/.exec(fuente)
  if (declarados === null) {
    throw new Error('No se encontró ERROR_CODES en errors.ts. ¿Cambió de forma?')
  }
  const codigos = [...declarados[1].matchAll(/'([A-Z_]+)'/g)].map((c) => c[1])
  if (codigos.length < 20) {
    throw new Error(`Sólo se leyeron ${String(codigos.length)} códigos. El parseo está roto.`)
  }
  return codigos
}

/**
 * Los sitios que responden con un error escrito a mano, sin pasar por `fallar`.
 *
 * @param {string} fichero Nombre del fichero, para poder decirlo.
 * @param {string} fuente Su contenido.
 * @returns {{fichero: string, linea: number, texto: string}[]}
 */
export function parseRawErrorSends(fichero, fuente) {
  if (EXENTOS.has(fichero)) return []
  const sueltos = []
  const lineas = fuente.split('\n')
  // Un `.send(` con una clave `error:` a menos de cinco líneas. Cinco porque es
  // lo que ocupa el cuerpo formateado más largo que había, y porque más allá de
  // eso el `error:` ya pertenece a otra cosa.
  for (const [indice, linea] of lineas.entries()) {
    if (!linea.includes('.send(')) continue
    const trozo = lineas.slice(indice, indice + 5).join('\n')
    if (!/\berror:/.test(trozo)) continue
    sueltos.push({ fichero, linea: indice + 1, texto: linea.trim() })
  }
  return sueltos
}

/**
 * Los problemas, o una lista vacía. Se comprueba en los dos sentidos, como las
 * otras dos reglas: lo que falta deja un error en castellano en medio de una
 * pantalla en alemán, y lo que sobra es texto que nadie va a enseñar —o una
 * errata que se lee exactamente igual que una clave buena.
 *
 * @param {string[]} codigos
 * @param {string[]} claves
 * @param {{fichero: string, linea: number, texto: string}[]} sueltos
 * @returns {{kind: string, detail: string}[]}
 */
export function checkErrorTranslations(codigos, claves, sueltos = []) {
  const problemas = []
  const conocidos = new Set(codigos)

  for (const codigo of codigos) {
    const directa = claves.includes(`error.${codigo}`)
    const conVariante = claves.some((clave) => clave.startsWith(`error.${codigo}.`))
    if (!directa && !conVariante) {
      problemas.push({
        kind: 'falta-la-frase',
        detail: `El error "${codigo}" no tiene frase: añade "error.${codigo}" a los cuatro diccionarios.`,
      })
    }
  }

  for (const clave of claves) {
    if (!clave.startsWith('error.')) continue
    const resto = clave.slice('error.'.length)
    // Lo que no empieza en mayúscula es texto de la interfaz —`error.local.*`,
    // lo que se dice cuando no hubo respuesta—, no un código del servidor.
    if (!/^[A-Z]/.test(resto)) continue
    const codigo = resto.split('.')[0]
    if (!conocidos.has(codigo)) {
      problemas.push({
        kind: 'frase-huerfana',
        detail: `"${clave}" traduce un código que no existe. ¿Se retiró "${codigo}", o hay una errata?`,
      })
    }
  }

  for (const suelto of sueltos) {
    problemas.push({
      kind: 'error-sin-codigo',
      detail:
        `${suelto.fichero}:${String(suelto.linea)} responde con un error escrito a mano. ` +
        `Usa \`fallar(reply, status, CODIGO, mensaje)\` para que la interfaz pueda traducirlo: ${suelto.texto}`,
    })
  }

  return problemas
}

/** Lee el workspace del disco. Aparte, para que la comprobación sea pura. */
export async function loadErrorSources(rootDir, parseDictionaryKeys) {
  const directorio = join(rootDir, DIRECTORIO_API)
  const ficheros = (await readdir(directorio)).filter(
    (nombre) => nombre.endsWith('.ts') && !nombre.includes('.test.') && !nombre.includes('.integration.'),
  )

  const sueltos = []
  for (const fichero of ficheros) {
    sueltos.push(...parseRawErrorSends(fichero, await readFile(join(directorio, fichero), 'utf8')))
  }

  return {
    codigos: parseErrorCodes(await readFile(join(directorio, 'errors.ts'), 'utf8')),
    claves: parseDictionaryKeys(await readFile(join(rootDir, 'packages/web/src/i18n/es.ts'), 'utf8')),
    sueltos,
  }
}
