/**
 * La escala del tiempo.
 *
 * Lo que hay que demostrar, y lo tercero es lo único que puede mentir sin que
 * se note:
 *
 *   1. Un mes cae en su trimestre y en su año.
 *   2. El rango se rellena sin huecos, también cuando hay un año sin trabajo.
 *   3. **La saturación no se suma, se recalcula.** La media de las
 *      saturaciones mensuales pesa igual un agosto de vacaciones que un marzo
 *      entero, y eso da un número que parece razonable y no lo es.
 */

import { describe, expect, it } from 'vitest'
import { agrupar, claveDe, periodosActivos } from './periods.js'

describe('la clave de un periodo', () => {
  it('coloca cada mes en su trimestre', () => {
    expect(claveDe('2026-01', 'trimestre')).toBe('2026-T1')
    expect(claveDe('2026-03', 'trimestre')).toBe('2026-T1')
    expect(claveDe('2026-04', 'trimestre')).toBe('2026-T2')
    expect(claveDe('2026-12', 'trimestre')).toBe('2026-T4')
  })

  it('y en su año', () => {
    expect(claveDe('2026-07', 'anio')).toBe('2026')
  })

  it('en escala de mes no toca nada', () => {
    expect(claveDe('2026-07', 'mes')).toBe('2026-07')
  })
})

describe('el rango que se enseña', () => {
  it('rellena los meses que faltan entre el primero y el último', () => {
    expect(periodosActivos(['2026-11', '2027-02'], 'mes')).toEqual([
      '2026-11', '2026-12', '2027-01', '2027-02',
    ])
  })

  it('en años, un año sin trabajo en medio sigue saliendo', () => {
    // El hueco es el dato: un año vacío entre dos llenos es exactamente lo que
    // hay que ver en una cartera.
    expect(periodosActivos(['2026-03', '2028-09'], 'anio')).toEqual(['2026', '2027', '2028'])
  })

  it('en trimestres no repite el trimestre de tres meses seguidos', () => {
    expect(periodosActivos(['2026-01', '2026-08'], 'trimestre')).toEqual([
      '2026-T1', '2026-T2', '2026-T3',
    ])
  })

  it('sin trabajo, ningún periodo', () => {
    expect(periodosActivos([], 'anio')).toEqual([])
  })
})

interface Celda {
  readonly resourceId: string
  readonly period: string
  readonly plannedMinutes: number
  readonly capacityMinutes: number
  readonly utilizationBp: number | null
}

const saturacion = (acumulado: Celda, celda: Celda): Celda => {
  const trabajo = acumulado.plannedMinutes + celda.plannedMinutes
  const capacidad = acumulado.capacityMinutes + celda.capacityMinutes
  return {
    ...acumulado,
    plannedMinutes: trabajo,
    capacityMinutes: capacidad,
    utilizationBp: capacidad === 0 ? null : Math.round((trabajo * 10_000) / capacidad),
  }
}

describe('agrupar', () => {
  it('suma las horas de los meses de un año', () => {
    const celdas: readonly Celda[] = [
      { resourceId: 'ana', period: '2026-01', plannedMinutes: 100, capacityMinutes: 1000, utilizationBp: 1000 },
      { resourceId: 'ana', period: '2026-02', plannedMinutes: 200, capacityMinutes: 1000, utilizationBp: 2000 },
      { resourceId: 'ana', period: '2027-01', plannedMinutes: 50, capacityMinutes: 1000, utilizationBp: 500 },
    ]
    const anios = agrupar(celdas, 'anio', (c) => c.resourceId, saturacion)
    expect(anios.map((c) => [c.period, c.plannedMinutes])).toEqual([['2026', 300], ['2027', 50]])
  })

  it('la saturación se recalcula, no se promedia', () => {
    // Agosto: nadie trabaja y casi no hay capacidad. Marzo: mes entero.
    // La media de 200 % y 10 % daría 105 %; lo cierto es 26 %.
    const celdas: readonly Celda[] = [
      { resourceId: 'ana', period: '2026-08', plannedMinutes: 200, capacityMinutes: 100, utilizationBp: 20_000 },
      { resourceId: 'ana', period: '2026-03', plannedMinutes: 1000, capacityMinutes: 10_000, utilizationBp: 1000 },
    ]
    const anio = agrupar(celdas, 'anio', (c) => c.resourceId, saturacion)[0]
    expect(anio?.plannedMinutes).toBe(1200)
    expect(anio?.capacityMinutes).toBe(10_100)
    // 1200 / 10100 = 11,88 %. Ni 105 % ni nada que se le parezca.
    expect(anio?.utilizationBp).toBe(1188)
  })

  it('no mezcla dos personas en la misma casilla', () => {
    const celdas: readonly Celda[] = [
      { resourceId: 'ana', period: '2026-01', plannedMinutes: 100, capacityMinutes: 0, utilizationBp: null },
      { resourceId: 'bea', period: '2026-02', plannedMinutes: 200, capacityMinutes: 0, utilizationBp: null },
    ]
    expect(agrupar(celdas, 'anio', (c) => c.resourceId, saturacion)).toHaveLength(2)
  })

  it('en escala de mes devuelve lo mismo que entró, sin copiar', () => {
    const celdas: readonly Celda[] = [
      { resourceId: 'ana', period: '2026-01', plannedMinutes: 100, capacityMinutes: 0, utilizationBp: null },
    ]
    expect(agrupar(celdas, 'mes', (c) => c.resourceId, saturacion)).toBe(celdas)
  })
})
