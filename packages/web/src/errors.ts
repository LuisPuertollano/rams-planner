/**
 * La frase de un error, en el idioma activo.
 *
 * Mismo trato que los hallazgos y que el catálogo de permisos: el servidor
 * manda el **código** —que es estable— con los datos que la frase necesita, y
 * la frase castellana de respaldo. El texto que se lee sale del diccionario.
 *
 * Aquí el respaldo importa más que en los hallazgos, porque un error es lo
 * último que debería quedarse en blanco. Se cae en tres escalones, de más
 * preciso a menos:
 *
 *   1. El código está en el diccionario: la frase, en el idioma de quien mira.
 *   2. Es un error de la API con un código que esta versión no conoce: la frase
 *      castellana que mandó el servidor, que dice la verdad aunque no sea su
 *      idioma.
 *   3. No llegó a haber respuesta —la red, el navegador—: la frase de respaldo
 *      que pone quien llama, que sí está traducida.
 *
 * Que ningún código se quede sin traducir lo comprueba `pnpm check:errores`,
 * que vive en `tools/` y lee el catálogo de la API del disco.
 */

import { ErrorDeLaApi } from './api.js'
import { es } from './i18n/es.js'
import type { Diccionario } from './i18n/index.js'
import { permissionLabel } from './permissions.js'

type Traductor = (clave: keyof Diccionario, ...valores: readonly (string | number)[]) => string

function hay(clave: string): clave is keyof Diccionario {
  return clave in es
}

const texto = (datos: Readonly<Record<string, unknown>>, nombre: string): string => {
  const valor = datos[nombre]
  return typeof valor === 'string' && valor !== '' ? valor : '—'
}

const lista = (datos: Readonly<Record<string, unknown>>, nombre: string): string => {
  const valor = datos[nombre]
  return Array.isArray(valor) ? valor.map((item) => String(item)).join(', ') : '—'
}

/**
 * Lo que se le dice a quien mira.
 *
 * El `respaldo` es una clave del diccionario, no una frase: el caso en el que
 * hace falta es justo el que no trae texto del servidor, así que dejarlo en
 * castellano sería quedarse sin idioma cuando más se nota.
 */
export function errorText(t: Traductor, cause: unknown, respaldo: keyof Diccionario): string {
  if (!(cause instanceof ErrorDeLaApi)) return t(respaldo)

  if (cause.code === null) return cause.message

  // Un código que dice varias cosas trae la clave que las distingue, igual que
  // el `variant` de un hallazgo. `SIN_PERMISO` es el caso: son tres frases
  // —falta en toda la herramienta, falta en este proyecto, falta sin más— y
  // cuál toca lo sabe el servidor.
  const d = cause.datos
  const conVariante = `error.${cause.code}.${texto(d, 'donde')}`
  const clave = hay(conVariante) ? conVariante : `error.${cause.code}`
  if (!hay(clave)) return cause.message

  switch (clave) {
    case 'error.SIN_PERMISO.toda-la-herramienta':
    case 'error.SIN_PERMISO.este-proyecto':
    case 'error.SIN_PERMISO.sin-mas':
      // «Lo tienes, pero no aquí» es la mitad que más se pregunta, así que la
      // etiqueta de la función se dice traducida, no con su código.
      return t(clave, permissionLabel(t, texto(d, 'permiso'), texto(d, 'etiqueta')))

    case 'error.FUNCIONES_DESCONOCIDAS':
      return t(clave, lista(d, 'funciones'))
    case 'error.ROL_DE_SISTEMA_NO_SE_EDITA':
      return t(clave, texto(d, 'rol'))

    // El detalle es del fichero o de la base de quien lo provocó, no una frase
    // nuestra: va dentro de una que sí se traduce.
    case 'error.CSV_INVALIDO':
    case 'error.DATOS_INVALIDOS':
    case 'error.ESCRITURA_RECHAZADA':
      return t(clave, texto(d, 'detalle'))

    default:
      return t(clave)
  }
}

/** Las filas del CSV que la importación rechazó, si las mandó. */
export function errorRows(cause: unknown): readonly string[] {
  if (!(cause instanceof ErrorDeLaApi)) return []
  const rows = cause.datos['rows']
  return Array.isArray(rows) ? rows.map((row) => String(row)) : []
}
