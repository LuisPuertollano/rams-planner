/**
 * La parte de las horas reales que no necesita base de datos: juntar las
 * entradas que caen en la misma clave.
 *
 * No es una comodidad y de ahí la prueba. `ON CONFLICT ... DO UPDATE` **falla**
 * si un mismo `INSERT` trae dos filas que chocan entre sí, y un parte de horas
 * trae eso constantemente. Sin esto, el fichero más corriente del mundo —dos
 * apuntes del mismo día en la misma tarea— revienta la importación entera con
 * un error de PostgreSQL que no dice nada a nadie.
 */

import { describe, expect, it } from 'vitest'
import { mergeActuals, type ActualEntryInput } from './actuals.js'

const NODO = '00000000-0000-4000-8000-000000000001'
const OTRO_NODO = '00000000-0000-4000-8000-000000000002'
const ANA = '00000000-0000-4000-8000-0000000000a1'
const MARC = '00000000-0000-4000-8000-0000000000a2'

const entrada = (parcial: Partial<ActualEntryInput> = {}): ActualEntryInput => ({
  nodeId: NODO,
  resourceId: ANA,
  workDate: '2026-03-02',
  minutes: 60,
  source: 'timesheet',
  ...parcial,
})

describe('juntar las horas que comparten clave', () => {
  it('suma dos apuntes del mismo día en la misma tarea', () => {
    // Alguien paró a comer. Son dos ratos de trabajo, no una corrección: la
    // corrección es volver a cargar el fichero, y de eso se encarga el UPDATE.
    const juntas = mergeActuals([entrada({ minutes: 180 }), entrada({ minutes: 120 })])
    expect(juntas).toHaveLength(1)
    expect(juntas[0]?.minutes).toBe(300)
  })

  it('no junta lo que no es el mismo dato', () => {
    const juntas = mergeActuals([
      entrada(),
      entrada({ nodeId: OTRO_NODO }),
      entrada({ resourceId: MARC }),
      entrada({ workDate: '2026-03-03' }),
      // El origen es parte de la clave a propósito: una hora estimada y una
      // fichada del mismo día no son el mismo dato y no se pisan.
      entrada({ source: 'estimate' }),
    ])
    expect(juntas).toHaveLength(5)
    expect(juntas.every((fila) => fila.minutes === 60)).toBe(true)
  })

  it('un lote vacío sale vacío, sin inventarse una fila', () => {
    expect(mergeActuals([])).toEqual([])
  })

  it('la referencia que sobrevive es la última que la trae', () => {
    const juntas = mergeActuals([
      entrada({ minutes: 60, externalRef: 'TS-1' }),
      entrada({ minutes: 60, externalRef: 'TS-2' }),
    ])
    expect(juntas[0]?.externalRef).toBe('TS-2')
  })

  it('una fila sin referencia no borra la que ya había', () => {
    // Si el fichero trae el apunte identificado y luego uno suelto del mismo
    // día, perder el identificador dejaría la suma sin rastro de dónde vino.
    const juntas = mergeActuals([entrada({ externalRef: 'TS-1' }), entrada({})])
    expect(juntas[0]?.externalRef).toBe('TS-1')
  })

  it('el orden de salida es el de la primera aparición', () => {
    // Importa para que el mensaje de una violación de clave ajena señale a la
    // fila que la persona reconoce, y no a una cualquiera.
    const juntas = mergeActuals([entrada({ nodeId: OTRO_NODO }), entrada(), entrada({ nodeId: OTRO_NODO })])
    expect(juntas.map((fila) => fila.nodeId)).toEqual([OTRO_NODO, NODO])
  })
})
