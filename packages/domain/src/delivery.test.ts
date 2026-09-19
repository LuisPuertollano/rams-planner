/**
 * Las entregas previas de un documento.
 *
 * Lo que se comprueba aquí es lo que decide si una Checkliste declarada sirve:
 * que el reparto deje algo para la entrega final, y que una entrega «previa» lo
 * sea de verdad. Todo son avisos: el catálogo se guarda igual.
 */

import { describe, expect, it } from 'vitest'
import { checkDeliveries, deliveryMinutes, type PreviousDelivery } from './delivery.js'

const entrega = (over: Partial<PreviousDelivery> = {}): PreviousDelivery => ({
  position: 1,
  gate: 'PGR',
  maturity: 'preliminar',
  weeksBeforeGate: 4,
  shareBp: 3_000,
  ...over,
})

describe('las entregas previas de un documento', () => {
  it('sin entregas previas no hay nada que decir', () => {
    expect(checkDeliveries([], 'documento', 'CGR')).toEqual([])
  })

  it('una declaración correcta no avisa de nada', () => {
    const problemas = checkDeliveries(
      [entrega(), entrega({ position: 2, gate: 'IGR', shareBp: 2_000 })],
      'documento',
      'CGR',
    )
    expect(problemas).toEqual([])
  })

  it('avisa cuando las previas se llevan todo el esfuerzo', () => {
    // Si no queda nada para la final, la final sale gratis: el reparto está mal.
    const problemas = checkDeliveries(
      [entrega({ shareBp: 6_000 }), entrega({ position: 2, gate: 'IGR', shareBp: 4_000 })],
      'documento',
      'CGR',
    )
    expect(problemas.map((p) => p.code)).toEqual(['DELIVERY_SHARE_FULL'])
    expect(problemas[0]?.payload['sharePercent']).toBe(100)
  })

  it('una entrega previa a la misma puerta que la final no es previa', () => {
    const problemas = checkDeliveries([entrega({ gate: 'cgr' })], 'documento', 'CGR')
    expect(problemas.map((p) => p.code)).toEqual(['DELIVERY_SAME_AS_FINAL'])
  })

  it('sin puerta final, una entrega previa no es previa a nada', () => {
    const problemas = checkDeliveries([entrega()], 'documento', null)
    expect(problemas.map((p) => p.code)).toEqual(['DELIVERY_WITHOUT_FINAL_GATE'])
  })

  it('un hito no se entrega en borrador', () => {
    // Un hito es un instante, y una fase agrupa. Ninguno se va madurando.
    for (const kind of ['hito', 'fase'] as const) {
      const problemas = checkDeliveries([entrega()], kind, 'CGR')
      expect(problemas.map((p) => p.code)).toEqual(['DELIVERY_ON_CONTAINER'])
    }
  })

  it('reparte los minutos sin perder ninguno', () => {
    // 100 h: 30 % preliminar, 20 % intermedia, y el resto —y el redondeo— a la
    // final, que es la que más pesa.
    const { previous, final } = deliveryMinutes(6_000, [
      entrega({ shareBp: 3_000 }),
      entrega({ position: 2, gate: 'IGR', shareBp: 2_000 }),
    ])
    expect(previous).toEqual([1_800, 1_200])
    expect(final).toBe(3_000)
    expect(previous.reduce((a, b) => a + b, 0) + final).toBe(6_000)
  })

  it('el resto de la división va a la final, no se pierde', () => {
    const { previous, final } = deliveryMinutes(1_000, [entrega({ shareBp: 3_333 })])
    expect(previous[0]).toBe(333)
    expect(final).toBe(667)
    expect((previous[0] ?? 0) + final).toBe(1_000)
  })

  it('un entregable sin minutos declarados no rompe el reparto', () => {
    const { previous, final } = deliveryMinutes(0, [entrega()])
    expect(previous).toEqual([0])
    expect(final).toBe(0)
  })
})
