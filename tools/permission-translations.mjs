/**
 * Que ninguna función del catálogo de permisos se quede sin traducir.
 *
 * Misma regla y mismo sitio que la de los hallazgos, por la misma razón: el
 * catálogo vive en la API (`packages/api/src/permissions.ts`) y las etiquetas
 * en la interfaz, y ninguno de los dos puede comprobarlo solo. Se lee el
 * código fuente del disco, sin compilar nada y sin que ningún paquete importe
 * a otro.
 *
 * Importa más de lo que parece: esta hoja es lo que lee quien reparte el
 * acceso, y una casilla cuyo texto no entiende es una casilla que marca a
 * ciegas.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Los códigos del catálogo y las pantallas en que se agrupan.
 *
 * @param {string} fuente Contenido de `packages/api/src/permissions.ts`.
 * @returns {{codigos: string[], pantallas: string[]}}
 */
export function parsePermissionCatalogue(fuente) {
  const pantallasDeclaradas = /export const SCREENS = \[([\s\S]*?)\] as const/.exec(fuente)
  if (pantallasDeclaradas === null) {
    throw new Error('No se encontró SCREENS en permissions.ts. ¿Cambió de forma?')
  }
  const pantallas = [...pantallasDeclaradas[1].matchAll(/'([^']+)'/g)].map((c) => c[1])
  const codigos = [...fuente.matchAll(/^\s{4}code: '([^']+)',$/gm)].map((c) => c[1])

  if (pantallas.length < 5) {
    throw new Error(`Sólo se leyeron ${String(pantallas.length)} pantallas. El parseo está roto.`)
  }
  if (codigos.length < 20) {
    throw new Error(`Sólo se leyeron ${String(codigos.length)} permisos. El parseo está roto.`)
  }
  return { codigos, pantallas }
}

/**
 * Los problemas, o una lista vacía. Se comprueba en los dos sentidos, como la
 * regla de los hallazgos: lo que falta deja una casilla sin texto, y lo que
 * sobra es texto que nadie va a enseñar —o una errata que se lee igual que una
 * clave buena.
 *
 * @param {{codigos: string[], pantallas: string[]}} catalogo
 * @param {string[]} claves
 * @returns {{kind: string, detail: string}[]}
 */
export function checkPermissionTranslations(catalogo, claves) {
  const problemas = []
  const conocidos = new Set(catalogo.codigos)
  const pantallas = new Set(catalogo.pantallas)

  for (const code of catalogo.codigos) {
    if (!claves.includes(`permiso.${code}`)) {
      problemas.push({
        kind: 'falta-la-etiqueta',
        detail: `El permiso "${code}" no tiene etiqueta: añade "permiso.${code}" a los cuatro diccionarios.`,
      })
    }
    if (!claves.includes(`permiso.${code}.detalle`)) {
      problemas.push({
        kind: 'falta-el-detalle',
        detail: `El permiso "${code}" no tiene detalle: añade "permiso.${code}.detalle". Es lo que hace que marcar la casilla sea una decisión informada.`,
      })
    }
  }

  for (const pantalla of catalogo.pantallas) {
    if (!claves.includes(`pantalla.${pantalla}`)) {
      problemas.push({
        kind: 'falta-la-pantalla',
        detail: `La pantalla "${pantalla}" no tiene nombre traducido: añade "pantalla.${pantalla}".`,
      })
    }
  }

  for (const clave of claves) {
    if (clave.startsWith('pantalla.')) {
      const nombre = clave.slice('pantalla.'.length)
      if (!pantallas.has(nombre)) {
        problemas.push({
          kind: 'pantalla-huerfana',
          detail: `"${clave}" nombra una pantalla que no existe. ¿Se retiró "${nombre}", o hay una errata?`,
        })
      }
      continue
    }
    if (!clave.startsWith('permiso.')) continue
    const resto = clave.slice('permiso.'.length)
    const code = resto.endsWith('.detalle') ? resto.slice(0, -'.detalle'.length) : resto
    if (!conocidos.has(code)) {
      problemas.push({
        kind: 'permiso-huerfano',
        detail: `"${clave}" traduce un permiso que no existe. ¿Se retiró "${code}", o hay una errata?`,
      })
    }
  }

  return problemas
}

/** Lee el workspace del disco. Aparte, para que la comprobación sea pura. */
export async function loadPermissionSources(rootDir, parseDictionaryKeys) {
  return {
    catalogo: parsePermissionCatalogue(
      await readFile(join(rootDir, 'packages/api/src/permissions.ts'), 'utf8'),
    ),
    claves: parseDictionaryKeys(await readFile(join(rootDir, 'packages/web/src/i18n/es.ts'), 'utf8')),
  }
}
