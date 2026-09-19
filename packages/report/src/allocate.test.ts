/**
 * El reparto de las horas reales.
 *
 * Lo que hay que demostrar, y el primero es el que sostiene todo lo demás:
 *
 *   1. **Ningún minuto se pierde.** Lo que entra, o cae en una tarea, o sale
 *      nombrado en un descuadre. Sin excepciones y sin redondeos que se comen
 *      un minuto por el camino.
 *   2. Los cuatro descuadres son cuatro situaciones distintas y cada una tiene
 *      su motivo, porque cada una tiene su arreglo.
 *   3. El mismo dato da el mismo reparto, bit a bit (P2).
 */

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { distributeInteger } from '@planner/domain'
import { matrizDeConciliacion, repartirReales, type ActualSplit, type MonthlyActual } from './allocate.js'

const mes = (resourceId: string, projectId: string, period: string, minutes: number): MonthlyActual =>
  ({ resourceId, projectId, period, minutes })
const parte = (resourceId: string, projectId: string, period: string, nodeId: string, shareBp: number): ActualSplit =>
  ({ resourceId, projectId, period, nodeId, shareBp })

describe('repartir las horas reales', () => {
  it('multiplica las horas del mes por lo declarado', () => {
    const resultado = repartirReales(
      [mes('ana', 'cbtc', '2026-04', 6000)],
      [parte('ana', 'cbtc', '2026-04', 'fmeca', 6000), parte('ana', 'cbtc', '2026-04', 'hazlog', 4000)],
    )
    expect(resultado.descuadres).toEqual([])
    expect(resultado.allocated.map((f) => [f.nodeId, f.actualMinutes])).toEqual([
      ['fmeca', 3600],
      ['hazlog', 2400],
    ])
  })

  it('la suma de las partes es exactamente el total, aunque no divida', () => {
    // 100 minutos a tres tercios: 33,33… cada uno. Uno de los tres se lleva el
    // minuto que sobra, y los tres suman 100.
    const resultado = repartirReales(
      [mes('ana', 'cbtc', '2026-04', 100)],
      [
        parte('ana', 'cbtc', '2026-04', 'a', 3334),
        parte('ana', 'cbtc', '2026-04', 'b', 3333),
        parte('ana', 'cbtc', '2026-04', 'c', 3333),
      ],
    )
    expect(resultado.allocated.reduce((s, f) => s + f.actualMinutes, 0)).toBe(100)
    expect(resultado.minutesUnallocated).toBe(0)
  })

  it('una parte tan pequeña que no llega ni a un minuto no deja fila', () => {
    // Un mes de un minuto repartido entre tres: uno se lo lleva y los otros dos
    // se quedan a cero. Una fila de cero minutos no es información, es ruido en
    // el informe y en la conciliación, así que no se escribe.
    const resultado = repartirReales(
      [mes('ana', 'cbtc', '2026-04', 1)],
      [
        parte('ana', 'cbtc', '2026-04', 'a', 3334),
        parte('ana', 'cbtc', '2026-04', 'b', 3333),
        parte('ana', 'cbtc', '2026-04', 'c', 3333),
      ],
    )
    expect(resultado.allocated).toHaveLength(1)
    expect(resultado.allocated[0]?.actualMinutes).toBe(1)
    // Y el minuto sigue sin perderse: el invariante aguanta también aquí.
    expect(resultado.minutesAllocated).toBe(1)
    expect(resultado.minutesUnallocated).toBe(0)
  })

  it('horas sin declaración: no se reparten y se dice', () => {
    const resultado = repartirReales([mes('ana', 'cbtc', '2026-04', 6000)], [])
    expect(resultado.allocated).toEqual([])
    expect(resultado.descuadres[0]?.motivo).toBe('sin-declarar')
    expect(resultado.descuadres[0]?.minutes).toBe(6000)
    expect(resultado.minutesUnallocated).toBe(6000)
  })

  it('una declaración que no suma 100 % NO se aplica a medias', () => {
    // La decisión que más se nota, y por un motivo que no es el que parece: el
    // reparto es PROPORCIONAL, así que aplicar una declaración del 60 % no
    // dejaría 2.400 minutos fuera — le daría al FMECA los 6.000 enteros,
    // incluidos los que se fueron a algo que nadie declaró. La prueba de abajo
    // lo fija para que nadie «arregle» esto aplicándolo a medias.
    const resultado = repartirReales(
      [mes('ana', 'cbtc', '2026-04', 6000)],
      [parte('ana', 'cbtc', '2026-04', 'fmeca', 6000)],
    )
    expect(resultado.allocated).toEqual([])
    expect(resultado.descuadres[0]?.motivo).toBe('no-suma-cien')
    expect(resultado.descuadres[0]?.declaredBp).toBe(6000)
    expect(resultado.minutesUnallocated).toBe(6000)
  })

  it('y si se aplicara a medias, el error sería inflar, no perder', () => {
    // Esto no prueba el comportamiento: prueba el MOTIVO del comportamiento, y
    // está aquí porque el motivo es contraintuitivo. `distributeInteger`
    // normaliza por la suma de los pesos, así que un único 60 % se lleva el
    // 100 %. Si algún día eso cambiara, la regla de arriba tendría que volver a
    // justificarse, y esta prueba es la que avisaría.
    expect(distributeInteger(6000, [6000])).toEqual([6000])
    expect(distributeInteger(6000, [3000, 3000])).toEqual([3000, 3000])
  })

  it('pasarse del 100 % tampoco se aplica', () => {
    const resultado = repartirReales(
      [mes('ana', 'cbtc', '2026-04', 6000)],
      [parte('ana', 'cbtc', '2026-04', 'a', 6000), parte('ana', 'cbtc', '2026-04', 'b', 6000)],
    )
    expect(resultado.allocated).toEqual([])
    expect(resultado.descuadres[0]?.declaredBp).toBe(12_000)
  })

  it('una declaración de un mes que nadie fichó se dice, aunque no pierda nada', () => {
    const resultado = repartirReales([], [parte('ana', 'cbtc', '2026-04', 'fmeca', 10_000)])
    expect(resultado.descuadres[0]?.motivo).toBe('sin-horas')
    expect(resultado.descuadres[0]?.minutes).toBe(0)
    expect(resultado.minutesIn).toBe(0)
  })

  it('un mes que ya tiene parte diario no se reparte: contaría dos veces', () => {
    const resultado = repartirReales(
      [mes('ana', 'cbtc', '2026-04', 6000)],
      [parte('ana', 'cbtc', '2026-04', 'fmeca', 10_000)],
      { conParteDiario: new Set(['ana|cbtc|2026-04']) },
    )
    expect(resultado.allocated).toEqual([])
    expect(resultado.descuadres[0]?.motivo).toBe('dos-caminos')
    // Y gana sobre los demás motivos: aunque la declaración fuera correcta.
    expect(resultado.descuadres[0]?.declaredBp).toBe(10_000)
  })

  it('el mismo dato da el mismo reparto en otro orden (P2)', () => {
    const meses = [mes('ana', 'cbtc', '2026-04', 997), mes('bea', 'dep', '2026-05', 331)]
    const partes = [
      parte('ana', 'cbtc', '2026-04', 'c', 3333),
      parte('ana', 'cbtc', '2026-04', 'a', 3334),
      parte('ana', 'cbtc', '2026-04', 'b', 3333),
      parte('bea', 'dep', '2026-05', 'z', 10_000),
    ]
    const directo = repartirReales(meses, partes)
    const revuelto = repartirReales([...meses].reverse(), [...partes].reverse())
    expect(revuelto).toEqual(directo)
  })

  it('ningún minuto se pierde, con los datos que sean', () => {
    // La propiedad que sostiene la funcionalidad entera: si esto falla, el
    // informe miente sobre cuánto se ha gastado y nadie puede notarlo.
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            resourceId: fc.constantFrom('ana', 'bea', 'caro'),
            projectId: fc.constantFrom('p1', 'p2'),
            period: fc.constantFrom('2026-04', '2026-05'),
            minutes: fc.integer({ min: 0, max: 20_000 }),
          }),
          { maxLength: 12 },
        ),
        fc.array(
          fc.record({
            resourceId: fc.constantFrom('ana', 'bea', 'caro'),
            projectId: fc.constantFrom('p1', 'p2'),
            period: fc.constantFrom('2026-04', '2026-05'),
            nodeId: fc.constantFrom('t1', 't2', 't3'),
            shareBp: fc.integer({ min: 1, max: 10_000 }),
          }),
          { maxLength: 12 },
        ),
        (mesesCrudos, partesCrudas) => {
          // La tabla tiene clave primaria: dos filas iguales no pueden existir.
          const meses = deduplicar(mesesCrudos, (f) => `${f.resourceId}|${f.projectId}|${f.period}`)
          const partes = deduplicar(
            partesCrudas,
            (f) => `${f.resourceId}|${f.projectId}|${f.period}|${f.nodeId}`,
          )
          const resultado = repartirReales(meses, partes)
          const repartido = resultado.allocated.reduce((s, f) => s + f.actualMinutes, 0)
          const fuera = resultado.descuadres.reduce((s, d) => s + d.minutes, 0)
          expect(repartido + fuera).toBe(resultado.minutesIn)
          expect(resultado.minutesAllocated).toBe(repartido)
          expect(resultado.minutesUnallocated).toBe(fuera)
        },
      ),
      { numRuns: 400 },
    )
  })
})

function deduplicar<T>(filas: readonly T[], clave: (fila: T) => string): readonly T[] {
  const vistas = new Map<string, T>()
  for (const fila of filas) vistas.set(clave(fila), fila)
  return [...vistas.values()]
}

describe('la matriz de conciliación', () => {
  it('junta los proyectos de una persona en una casilla por mes', () => {
    const meses = [mes('ana', 'p1', '2026-04', 600), mes('ana', 'p2', '2026-04', 400)]
    const reparto = repartirReales(meses, [parte('ana', 'p1', '2026-04', 'a', 10_000)])
    const matriz = matrizDeConciliacion(reparto, meses)
    expect(matriz).toHaveLength(1)
    expect(matriz[0]?.minutes).toBe(1000)
    expect(matriz[0]?.allocated).toBe(600)
    expect(matriz[0]?.motivo).toBe('sin-declarar')
    expect(matriz[0]?.proyectosConProblema).toBe(1)
  })

  it('cuando todo cuadra, la casilla no tiene motivo', () => {
    const meses = [mes('ana', 'p1', '2026-04', 600)]
    const reparto = repartirReales(meses, [parte('ana', 'p1', '2026-04', 'a', 10_000)])
    expect(matrizDeConciliacion(reparto, meses)[0]?.motivo).toBeNull()
  })

  it('enseña el peor motivo de la casilla, que es por el que hay que entrar', () => {
    const meses = [mes('ana', 'p1', '2026-04', 600), mes('ana', 'p2', '2026-04', 400)]
    const reparto = repartirReales(meses, [parte('ana', 'p2', '2026-04', 'a', 5000)], {
      conParteDiario: new Set(['ana|p1|2026-04']),
    })
    const casilla = matrizDeConciliacion(reparto, meses)[0]
    expect(casilla?.motivo).toBe('dos-caminos')
    expect(casilla?.proyectosConProblema).toBe(2)
  })
})
