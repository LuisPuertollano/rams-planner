/**
 * Los cuatro idiomas de la herramienta.
 *
 * El castellano es la fuente: `es.ts` define qué claves existen y los otros
 * tres se escriben **contra ese tipo**. Una traducción a la que le falte una
 * clave no compila, y una clave que sobre tampoco. Es el mismo trato que el
 * catálogo de permisos y la regla de dependencias: la regla se hace cumplir, no
 * se recuerda, porque una traducción incompleta no falla — se queda en
 * castellano en medio de una pantalla en alemán y nadie lo ve hasta que lo ve
 * un cliente.
 *
 * No hay librería detrás a propósito. Lo que hace falta es un diccionario, un
 * `%s` y elegir plural; tres cosas que caben aquí y que no justifican una
 * dependencia que hay que actualizar durante diez años.
 */

import { createContext, useContext } from 'react'
import { es } from './es.js'
import { en } from './en.js'
import { de } from './de.js'
import { fr } from './fr.js'

export const IDIOMAS = ['es', 'en', 'de', 'fr'] as const
export type Idioma = (typeof IDIOMAS)[number]

/** Cómo se llama cada idioma en su propio idioma. Nunca traducido. */
export const NOMBRE_DEL_IDIOMA: Readonly<Record<Idioma, string>> = {
  es: 'Español',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
}

/** El `locale` para fechas y números. El idioma solo no basta para formatear. */
export const LOCALE: Readonly<Record<Idioma, string>> = {
  es: 'es-ES',
  en: 'en-GB',
  de: 'de-DE',
  fr: 'fr-FR',
}

/**
 * El diccionario completo. Lo define el castellano; el resto lo cumple.
 *
 * Las claves son exactamente las de `es` —ni una menos ni una de más— y los
 * valores, texto. El `as const` de `es` haría que cada valor fuese su propia
 * frase literal, y entonces la traducción alemana no podría ser alemana.
 */
export type Diccionario = { readonly [K in keyof typeof es]: string }

const DICCIONARIOS: Readonly<Record<Idioma, Diccionario>> = { es, en, de, fr }

export interface Traductor {
  readonly idioma: Idioma
  readonly locale: string
  /**
   * Traduce. Los `%s` se sustituyen por los argumentos, en orden.
   *
   * No admite claves inventadas: el tipo de `clave` sale del diccionario, así
   * que una errata es un error de compilación y no una pantalla con
   * `menu.guardarr` escrito en medio.
   */
  readonly t: (clave: keyof Diccionario, ...valores: readonly (string | number)[]) => string
}

export function crearTraductor(idioma: Idioma): Traductor {
  const diccionario = DICCIONARIOS[idioma]
  return {
    idioma,
    locale: LOCALE[idioma],
    t: (clave, ...valores) => {
      const plantilla = diccionario[clave]
      if (valores.length === 0) return plantilla
      let indice = 0
      return plantilla.replace(/%s/g, () => String(valores[indice++] ?? ''))
    },
  }
}

const TraductorContext = createContext<Traductor>(crearTraductor('es'))

export const TraductorProvider = TraductorContext.Provider

export function useT(): Traductor {
  return useContext(TraductorContext)
}

const ALMACEN = 'planner.idioma'

/**
 * El idioma con el que arrancar: el que se eligió la última vez, y si no, el
 * del navegador. Alguien que abre la herramienta en Fráncfort no debería tener
 * que buscar el selector para entender la pantalla de entrada.
 */
export function idiomaInicial(): Idioma {
  try {
    const guardado = window.localStorage.getItem(ALMACEN)
    if (esIdioma(guardado)) return guardado
  } catch {
    // Ventana privada o almacenamiento bloqueado: se usa el del navegador.
  }
  for (const preferido of window.navigator.languages) {
    const corto = preferido.slice(0, 2).toLowerCase()
    if (esIdioma(corto)) return corto
  }
  return 'es'
}

export function recordarIdioma(idioma: Idioma): void {
  try {
    window.localStorage.setItem(ALMACEN, idioma)
  } catch {
    // Da igual: es una comodidad, no un dato del plan.
  }
}

function esIdioma(valor: string | null): valor is Idioma {
  return valor !== null && (IDIOMAS as readonly string[]).includes(valor)
}
