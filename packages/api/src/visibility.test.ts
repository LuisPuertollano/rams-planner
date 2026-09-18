/**
 * Lo que sale por la puerta, no lo que pasa por ella.
 *
 * El caso que da nombre a este fichero es el del array vacío: `every` sobre
 * cero filas devuelve `true`, y esa verdad lógica ponía una columna de coste en
 * un CSV sin filas para quien no puede ver ni un importe. No se escapaba
 * ninguna cifra; se afirmaba un permiso que no existía, que es lo que alguien
 * lee en la cabecera para saber qué le dejan ver.
 */

import { describe, expect, it } from 'vitest'
import { columnaSensible, onlyVisible, seesEverything } from './visibility.js'

interface Fila {
  readonly projectId: string
}

const de = (...ids: readonly string[]): readonly Fila[] => ids.map((projectId) => ({ projectId }))
const proyectoDe = (fila: Fila): string => fila.projectId

describe('columnaSensible', () => {
  it('quien lo ve todo se lleva la columna, incluso sin filas', () => {
    expect(columnaSensible('all', de(), proyectoDe)).toBe(true)
    expect(columnaSensible('all', de('a', 'b'), proyectoDe)).toBe(true)
  })

  it('con todas las filas visibles, la columna va', () => {
    expect(columnaSensible(new Set(['a', 'b']), de('a', 'b', 'a'), proyectoDe)).toBe(true)
  })

  it('basta una fila de un proyecto que no se ve para quitarla', () => {
    // Una columna con huecos miente igual que un cero que se lee como «costó
    // cero»: es mejor no decirlo que decirlo a medias.
    expect(columnaSensible(new Set(['a']), de('a', 'b'), proyectoDe)).toBe(false)
  })

  it('sin filas y sin permiso global, la columna NO va', () => {
    expect(columnaSensible(new Set(['a']), de(), proyectoDe)).toBe(false)
    expect(columnaSensible(new Set<string>(), de(), proyectoDe)).toBe(false)
  })
})

describe('onlyVisible', () => {
  it('quien lo ve todo se lleva las filas tal cual', () => {
    const filas = de('a', 'b')
    expect(onlyVisible('all', filas, proyectoDe)).toBe(filas)
  })

  it('lo que no es de ningún proyecto sólo pasa con el permiso global', () => {
    const sueltas = [{ projectId: null }, { projectId: 'a' }]
    expect(onlyVisible(new Set(['a']), sueltas, (fila) => fila.projectId)).toEqual([{ projectId: 'a' }])
    expect(onlyVisible('all', sueltas, (fila) => fila.projectId)).toEqual(sueltas)
  })
})

describe('seesEverything', () => {
  it('un conjunto, aunque tenga todos los proyectos de hoy, no es «todo»', () => {
    // Mañana hay otro proyecto y el conjunto no lo incluye. «Todo» es un
    // permiso, no una coincidencia de cardinalidad.
    expect(seesEverything('all')).toBe(true)
    expect(seesEverything(new Set(['a', 'b']))).toBe(false)
  })
})
