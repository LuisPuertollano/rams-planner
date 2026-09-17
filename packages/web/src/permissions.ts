/**
 * El texto del catálogo de permisos, en el idioma activo.
 *
 * Mismo trato que los hallazgos: el servidor manda el **código** —que es
 * estable y es lo que se guarda— y su etiqueta en castellano de respaldo. El
 * texto que se lee sale del diccionario.
 *
 * Importa más que en cualquier otra pantalla: esta hoja es lo que lee quien
 * reparte el acceso, y una casilla cuyo texto no entiende es una casilla que
 * marca a ciegas.
 *
 * Que no falte ninguna clave lo comprueba `pnpm check:permisos`, que vive en
 * `tools/` y lee el catálogo del disco.
 */

import { es } from './i18n/es.js'
import type { Diccionario } from './i18n/index.js'

type Traductor = (clave: keyof Diccionario, ...valores: readonly (string | number)[]) => string

function hay(clave: string): clave is keyof Diccionario {
  return clave in es
}

/** Qué se puede hacer, en la frase que leería quien reparte los permisos. */
export function permissionLabel(t: Traductor, code: string, respaldo: string): string {
  const clave = `permiso.${code}`
  return hay(clave) ? t(clave) : respaldo
}

/** Por qué importa. Sin esto, marcar la casilla no es una decisión informada. */
export function permissionDetail(t: Traductor, code: string, respaldo: string): string {
  const clave = `permiso.${code}.detalle`
  return hay(clave) ? t(clave) : respaldo
}

/** El nombre de la pantalla en la que se agrupa una función. */
export function screenName(t: Traductor, screen: string): string {
  const clave = `pantalla.${screen}`
  return hay(clave) ? t(clave) : screen
}
