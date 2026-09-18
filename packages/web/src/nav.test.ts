/**
 * La forma de la navegación.
 *
 * Lo que el compilador ya garantiza —que ninguna clave de texto esté inventada—
 * no se prueba aquí. Lo que se prueba es lo que un tipo no ve: que no haya dos
 * vistas con el mismo identificador (el `find` se quedaría con la primera y la
 * segunda no se abriría nunca), que ninguna vista se quede sin permiso con el
 * que entrar, y que arriba sigan siendo seis pestañas y no catorce, que es la
 * razón por la que existe este fichero.
 */

import { describe, expect, it } from 'vitest'
import { GRUPOS, VISTAS } from './nav.js'
import { es } from './i18n/es.js'

describe('la navegación', () => {
  it('arriba hay seis grupos', () => {
    expect(GRUPOS).toHaveLength(6)
  })

  it('ningún grupo está vacío', () => {
    for (const grupo of GRUPOS) {
      expect(grupo.vistas.length, grupo.id).toBeGreaterThan(0)
    }
  })

  it('ninguna vista repite identificador', () => {
    const ids = VISTAS.map((vista) => vista.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('ninguna vista se queda sin permiso con el que entrar', () => {
    for (const vista of VISTAS) {
      expect(vista.permission.length, vista.id).toBeGreaterThan(0)
    }
  })

  it('cada texto de la navegación existe en el diccionario', () => {
    // El tipo ya lo exige. Esto caza el caso que el tipo no ve: una clave que
    // existe pero que se quedó vacía en el castellano, que es la fuente.
    for (const grupo of GRUPOS) {
      expect(es[grupo.label].trim(), grupo.id).not.toBe('')
      expect(es[grupo.hint].trim(), grupo.id).not.toBe('')
      for (const vista of grupo.vistas) {
        expect(es[vista.label].trim(), vista.id).not.toBe('')
        expect(es[vista.hint].trim(), vista.id).not.toBe('')
        expect(es[vista.nota].trim(), vista.id).not.toBe('')
      }
    }
  })

  it('la portada es lo primero que se abre', () => {
    expect(GRUPOS[0]?.id).toBe('hoy')
    expect(GRUPOS[0]?.vistas[0]?.id).toBe('hoy')
  })
})
