/**
 * Que ningún hallazgo del motor se quede sin traducir.
 *
 * Es una regla **entre paquetes**: el catálogo de códigos vive en el núcleo
 * (`@planner/domain`) y las frases en la interfaz (`@planner/web`). Ninguno de
 * los dos puede comprobarla solo, y la interfaz no debe depender del núcleo
 * para averiguarlo: es un adaptador que habla con la API por HTTP, no por
 * tipos, y atarla al núcleo sólo para una prueba obliga a compilar el núcleo
 * antes de pasar el `lint`. Ya pasó.
 *
 * Así que se comprueba como la regla de dependencia: **leyendo el código
 * fuente del disco**, sin compilar nada y sin que ningún paquete importe a
 * otro. Función pura, para poder probarla sin tocar el disco.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Los códigos del catálogo, sacados de la unión `FindingCode`.
 *
 * @param {string} fuente Contenido de `packages/domain/src/finding.ts`.
 * @returns {string[]}
 */
export function parseFindingCodes(fuente) {
  const declaracion = /export type FindingCode\s*=([\s\S]*?);?\n\n/.exec(fuente)
  if (declaracion === null) {
    throw new Error('No se encontró la unión FindingCode en finding.ts. ¿Cambió de forma?')
  }
  const codigos = [...declaracion[1].matchAll(/'([A-Z0-9_]+)'/g)].map((coincidencia) => coincidencia[1])
  if (codigos.length < 10) {
    throw new Error(`Sólo se leyeron ${String(codigos.length)} códigos de FindingCode. El parseo está roto.`)
  }
  return codigos
}

/**
 * Las claves de un diccionario. Sirve cualquiera de los cuatro: el tipo ya
 * garantiza que tienen las mismas, y esto sólo necesita los nombres.
 *
 * @param {string} fuente Contenido de `packages/web/src/i18n/<idioma>.ts`.
 * @returns {string[]}
 */
export function parseDictionaryKeys(fuente) {
  const claves = [...fuente.matchAll(/^\s{2}'([^']+)':/gm)].map((coincidencia) => coincidencia[1])
  if (claves.length < 50) {
    throw new Error(`Sólo se leyeron ${String(claves.length)} claves del diccionario. El parseo está roto.`)
  }
  return claves
}

/**
 * Los problemas, o una lista vacía.
 *
 * Se comprueba en los dos sentidos. Que falte una clave deja un hallazgo sin
 * traducir; que sobre una es texto que nadie va a enseñar, y una errata en el
 * nombre de un código se lee exactamente igual que una clave válida.
 *
 * @param {string[]} codigos
 * @param {string[]} claves
 * @returns {{kind: string, detail: string}[]}
 */
export function checkFindingTranslations(codigos, claves) {
  const problemas = []
  const conocidos = new Set(codigos)

  for (const codigo of codigos) {
    const directa = claves.includes(`hallazgo.${codigo}`)
    const conVariante = claves.some((clave) => clave.startsWith(`hallazgo.${codigo}.`))
    if (!directa && !conVariante) {
      problemas.push({
        kind: 'falta-la-frase',
        detail: `El hallazgo "${codigo}" no tiene frase: añade "hallazgo.${codigo}" a los cuatro diccionarios.`,
      })
    }
    if (!claves.includes(`hallazgo.que.${codigo}`)) {
      problemas.push({
        kind: 'falta-la-explicacion',
        detail: `El hallazgo "${codigo}" no tiene explicación: añade "hallazgo.que.${codigo}".`,
      })
    }
  }

  for (const clave of claves) {
    if (!clave.startsWith('hallazgo.')) continue
    const resto = clave.slice('hallazgo.'.length)
    if (resto.startsWith('que.')) {
      const codigo = resto.slice('que.'.length)
      if (!conocidos.has(codigo)) {
        problemas.push({
          kind: 'explicacion-huerfana',
          detail: `"${clave}" explica un código que no existe. ¿Se retiró "${codigo}", o hay una errata?`,
        })
      }
      continue
    }
    // Lo que no empieza en mayúscula es texto de la pantalla —las gravedades,
    // el estado vacío—, no un código.
    if (!/^[A-Z]/.test(resto)) continue
    const codigo = resto.split('.')[0]
    if (!conocidos.has(codigo)) {
      problemas.push({
        kind: 'frase-huerfana',
        detail: `"${clave}" traduce un código que no existe. ¿Se retiró "${codigo}", o hay una errata?`,
      })
    }
  }

  return problemas
}

/** Lee el workspace del disco. Aparte, para que la comprobación sea pura. */
export async function loadFindingSources(rootDir) {
  return {
    codigos: parseFindingCodes(await readFile(join(rootDir, 'packages/domain/src/finding.ts'), 'utf8')),
    claves: parseDictionaryKeys(await readFile(join(rootDir, 'packages/web/src/i18n/es.ts'), 'utf8')),
  }
}
