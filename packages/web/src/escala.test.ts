import { describe, expect, it } from 'vitest'
import {
  ESCALAS,
  ESCALA_NORMAL,
  escalaMasCercana,
  escalaVecina,
  guardarEscala,
  leerEscala,
  porcentajeDeEscala,
} from './escala.js'

/** Un almacenamiento de mentira que puede portarse mal a propósito. */
function almacen(inicial: Record<string, string> = {}, rompe = false): Storage {
  const datos = new Map(Object.entries(inicial))
  return {
    getItem: (clave: string) => {
      if (rompe) throw new Error('sin almacenamiento')
      return datos.get(clave) ?? null
    },
    setItem: (clave: string, valor: string) => {
      if (rompe) throw new Error('sin almacenamiento')
      datos.set(clave, valor)
    },
    removeItem: (clave: string) => { datos.delete(clave) },
    clear: () => { datos.clear() },
    key: (i: number) => [...datos.keys()][i] ?? null,
    get length() { return datos.size },
  }
}

describe('la escala de la pantalla', () => {
  it('los escalones van de menos a más y el 100 % está dentro', () => {
    expect([...ESCALAS]).toEqual([...ESCALAS].sort((a, b) => a - b))
    expect(ESCALAS).toContain(ESCALA_NORMAL)
  })

  it('un valor cualquiera cae en el escalón más cercano, no en el normal', () => {
    expect(escalaMasCercana(0.82)).toBe(0.8)
    expect(escalaMasCercana(1.2)).toBe(1.25)
    // Justo en medio de dos: se queda en el primero que empata, y no se cuelga.
    expect(ESCALAS).toContain(escalaMasCercana(0.85))
  })

  it('un valor imposible no rompe nada: se lee como el 100 %', () => {
    expect(escalaMasCercana(Number.NaN)).toBe(ESCALA_NORMAL)
    expect(escalaMasCercana(Number.POSITIVE_INFINITY)).toBe(ESCALA_NORMAL)
  })

  it('un valor fuera de rango se recorta al extremo, no se descarta', () => {
    expect(escalaMasCercana(0.1)).toBe(ESCALAS[0])
    expect(escalaMasCercana(9)).toBe(ESCALAS[ESCALAS.length - 1])
  })

  it('lo que se guarda es lo que se lee', () => {
    const disco = almacen()
    guardarEscala(disco, 1.25)
    expect(leerEscala(disco)).toBe(1.25)
  })

  it('sin nada guardado, el 100 %', () => {
    expect(leerEscala(almacen())).toBe(ESCALA_NORMAL)
  })

  it('un valor escrito a mano o de una versión vieja se acerca al escalón más próximo', () => {
    expect(leerEscala(almacen({ 'planner.escala': '1.15' }))).toBe(1.12)
    expect(leerEscala(almacen({ 'planner.escala': 'grande' }))).toBe(ESCALA_NORMAL)
  })

  it('si el almacenamiento lanza, la herramienta abre igual al 100 %', () => {
    // Es el caso de una ventana privada, y es el que no puede tumbar la app.
    expect(leerEscala(almacen({}, true))).toBe(ESCALA_NORMAL)
    expect(() => { guardarEscala(almacen({}, true), 0.8) }).not.toThrow()
  })

  it('sin almacenamiento siquiera, tampoco pasa nada', () => {
    expect(leerEscala(null)).toBe(ESCALA_NORMAL)
    expect(() => { guardarEscala(null, 1.25) }).not.toThrow()
  })

  it('el vecino no se sale por ningún extremo', () => {
    const primera = ESCALAS[0]
    const ultima = ESCALAS[ESCALAS.length - 1] ?? primera
    expect(escalaVecina(primera, -1)).toBe(primera)
    expect(escalaVecina(ultima, 1)).toBe(ultima)
    expect(escalaVecina(1, 1)).toBe(1.12)
    expect(escalaVecina(1, -1)).toBe(0.9)
  })

  it('el porcentaje se dice en entero, sin la basura de la coma flotante', () => {
    expect(porcentajeDeEscala(1.12)).toBe(112)
    expect(porcentajeDeEscala(0.8)).toBe(80)
    for (const escalon of ESCALAS) {
      expect(Number.isInteger(porcentajeDeEscala(escalon))).toBe(true)
    }
  })
})
