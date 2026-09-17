/**
 * Lo que el tipo no puede comprobar.
 *
 * Que a una traducción no le falte una clave lo garantiza el compilador. Lo que
 * no garantiza es que la traducción sea una traducción: `'clave.tal': ''` o una
 * copia literal del castellano compilan igual de bien y se ven igual de mal.
 */

import { describe, expect, it } from 'vitest'
import { IDIOMAS, LOCALE, NOMBRE_DEL_IDIOMA, crearTraductor } from './index.js'
import { es } from './es.js'
import { en } from './en.js'
import { de } from './de.js'
import { fr } from './fr.js'

const DICCIONARIOS = { es, en, de, fr }
const CLAVES = Object.keys(es) as (keyof typeof es)[]

describe('los cuatro idiomas', () => {
  it('todos tienen exactamente las mismas claves', () => {
    for (const idioma of IDIOMAS) {
      expect(Object.keys(DICCIONARIOS[idioma]).sort()).toEqual([...CLAVES].sort())
    }
  })

  it('ninguna traducción está vacía', () => {
    for (const idioma of IDIOMAS) {
      for (const clave of CLAVES) {
        expect(DICCIONARIOS[idioma][clave].trim(), `${idioma}/${clave}`).not.toBe('')
      }
    }
  })

  it('los huecos %s son los mismos en los cuatro', () => {
    // Una traducción a la que le sobra o le falta un `%s` deja un hueco sin
    // rellenar o se come un dato. No lo ve el compilador y sí el usuario.
    for (const clave of CLAVES) {
      const enCastellano = (es[clave].match(/%s/g) ?? []).length
      for (const idioma of IDIOMAS) {
        const suyos = (DICCIONARIOS[idioma][clave].match(/%s/g) ?? []).length
        expect(suyos, `${idioma}/${clave}`).toBe(enCastellano)
      }
    }
  })

  it('las traducciones no son copias del castellano', () => {
    // Algunas coinciden de verdad —«Plan» es «Plan» en los cuatro— así que no
    // se exige que todas cambien; se exige que la mayoría lo haga. Un idioma
    // que copia el castellano entero es un idioma sin traducir.
    for (const idioma of IDIOMAS.filter((codigo) => codigo !== 'es')) {
      const iguales = CLAVES.filter((clave) => DICCIONARIOS[idioma][clave] === es[clave]).length
      expect(iguales / CLAVES.length, idioma).toBeLessThan(0.2)
    }
  })

  it('cada idioma tiene su nombre y su locale', () => {
    for (const idioma of IDIOMAS) {
      expect(NOMBRE_DEL_IDIOMA[idioma].length).toBeGreaterThan(2)
      expect(LOCALE[idioma]).toMatch(/^[a-z]{2}-[A-Z]{2}$/)
    }
  })

  it('los %s se sustituyen en orden', () => {
    const { t } = crearTraductor('es')
    expect(t('lineaBase.porDefecto', '3/4/2026')).toBe('Plan 3/4/2026')
    expect(t('ejecucion.chip', 'abc', '1.0.0', 'hoy', 61)).toBe('ejecución abc · motor 1.0.0 · hoy · 61 ms')
  })
})
