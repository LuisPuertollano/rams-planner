/**
 * Que ninguna frase que alguien lee esté escrita a mano en la interfaz.
 *
 * Es la cuarta regla de la misma familia —hallazgos, permisos, errores— y la
 * que faltaba. Las otras tres vigilan lo que el servidor manda; ésta vigila lo
 * que la pantalla escribe por su cuenta. El síntoma es el mismo y la avería
 * también: una cabecera de tabla escrita `<th>Recurso</th>` compila, pasa las
 * pruebas, y se queda en castellano en medio de una pantalla en alemán. Nadie
 * lo ve hasta que lo ve un cliente.
 *
 * Traducir las que había fue trabajo de una tarde. Lo que cuesta es que la
 * columna siguiente no vuelva a nacer escrita a mano, que es como nacieron
 * todas.
 *
 * A diferencia de las otras tres, esta regla **sí usa el analizador de
 * TypeScript**. No compila el proyecto ni cruza paquetes: lee un fichero del
 * disco y mira su árbol. Con expresiones regulares no se distingue
 * `<th>Recurso</th>` de `Promise<void>` ni de `if (a > b && c < d)`, y una
 * regla que avisa de lo que no es se desactiva en una semana.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'

const DIRECTORIO = 'packages/web/src'

/** Atributos que alguien lee. `className` o `href` no son frases. */
const ATRIBUTOS_QUE_SE_LEEN = new Set(['title', 'aria-label', 'placeholder', 'alt'])

/**
 * La coartada. Va en un comentario pegado al literal, con su razón escrita:
 *
 * ```tsx
 * {/* texto-fijo: es un comando, se copia y se pega tal cual *\/}
 * <code>pnpm --filter @planner/api seed:demo</code>
 * ```
 *
 * Se exige la razón a propósito: la excepción sin motivo es la puerta por la
 * que vuelve a entrar todo.
 */
const COARTADA = /texto-fijo:\s*[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/

/**
 * `<code>` es técnico por definición: un comando, un nombre de fichero, una
 * clave. No se traduce, y exigir una coartada en cada uno sería ruido.
 */
const ETIQUETAS_TECNICAS = new Set(['code', 'kbd', 'samp', 'pre'])

/** Hace falta una palabra de verdad. «·», «%», «h» o «—» no son frases. */
const PALABRA = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,}/

/**
 * Los literales que alguien lee, en un fichero.
 *
 * @param {string} fichero Ruta, para poder decirla.
 * @param {string} fuente Su contenido.
 * @returns {{fichero: string, linea: number, donde: string, texto: string}[]}
 */
export function buscaLiterales(fichero, fuente) {
  const arbol = ts.createSourceFile(fichero, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const encontrados = []

  const linea = (nodo) => arbol.getLineAndCharacterOfPosition(nodo.getStart(arbol)).line + 1

  const lineas = fuente.split('\n')

  /**
   * ¿Lleva coartada este nodo?
   *
   * Se mira su propia línea y la de arriba. En JSX, un `{/* … *\/}` no es
   * trivia del nodo siguiente sino un hermano, así que buscarlo por el árbol no
   * lo encuentra; por líneas, sí, y es donde lo escribe quien lo escribe.
   *
   * También perdona lo que está dentro de una etiqueta técnica, y para eso sí
   * hace falta subir por los padres.
   */
  const perdonado = (nodo) => {
    const numero = linea(nodo)
    const cerca = `${lineas[numero - 2] ?? ''}\n${lineas[numero - 1] ?? ''}`
    if (COARTADA.test(cerca)) return true
    for (let actual = nodo; actual !== undefined; actual = actual.parent) {
      if (ts.isJsxElement(actual) && ETIQUETAS_TECNICAS.has(actual.openingElement.tagName.getText(arbol))) {
        return true
      }
    }
    return false
  }

  const visitar = (nodo) => {
    if (ts.isJsxText(nodo)) {
      const texto = nodo.text.trim()
      if (texto !== '' && PALABRA.test(texto) && !perdonado(nodo)) {
        encontrados.push({ fichero, linea: linea(nodo), donde: 'texto', texto })
      }
    }

    if (ts.isJsxAttribute(nodo) && nodo.initializer !== undefined) {
      const nombre = nodo.name.getText(arbol)
      const valor = nodo.initializer
      if (ATRIBUTOS_QUE_SE_LEEN.has(nombre) && ts.isStringLiteral(valor)) {
        if (PALABRA.test(valor.text) && !perdonado(nodo)) {
          encontrados.push({ fichero, linea: linea(nodo), donde: nombre, texto: valor.text })
        }
      }
    }

    ts.forEachChild(nodo, visitar)
  }

  visitar(arbol)
  return encontrados
}

/**
 * Todos los `.tsx` de la interfaz, ordenados para que el informe no baile.
 *
 * @param {string} rootDir
 * @returns {Promise<string[]>}
 */
export async function listaDeVistas(rootDir) {
  const encontrados = []
  const recorrer = async (dir) => {
    for (const entrada of await readdir(join(rootDir, dir), { withFileTypes: true })) {
      const ruta = `${dir}/${entrada.name}`
      if (entrada.isDirectory()) await recorrer(ruta)
      else if (ruta.endsWith('.tsx')) encontrados.push(ruta)
    }
  }
  await recorrer(DIRECTORIO)
  return encontrados.sort()
}

/**
 * @param {string} rootDir
 * @returns {Promise<{ficheros: number, literales: {fichero: string, linea: number, donde: string, texto: string}[]}>}
 */
export async function buscaEnLaInterfaz(rootDir) {
  const ficheros = await listaDeVistas(rootDir)
  const literales = []
  for (const fichero of ficheros) {
    literales.push(...buscaLiterales(fichero, await readFile(join(rootDir, fichero), 'utf8')))
  }
  return { ficheros: ficheros.length, literales }
}
