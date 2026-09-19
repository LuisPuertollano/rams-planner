/**
 * Partir la tarea en las entregas que pide la Checkliste.
 *
 * Lo que más se comprueba aquí no es el reparto —porcentajes, poco que
 * discutir— sino **lo que la función se niega a hacer** y, sobre todo, que el
 * tamaño de la tarea no se mueva: declarar una Checkliste no puede cambiar lo
 * que cuesta un proyecto.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  planDeliveries,
  type CatalogueDelivery,
  type DeliveryPlanInput,
  type DeliveryTask,
} from './delivery-plan.js'

const tarea = (over: Partial<DeliveryTask> = {}): DeliveryTask => ({
  nodeId: 'n1',
  name: 'Redactar el FMECA',
  path: '001',
  kind: 'task',
  workDeclaredMinutes: 6_000,
  durationMinutes: 4_800,
  hasActuals: false,
  alreadySplit: false,
  isPiece: false,
  ...over,
})

const previa = (over: Partial<CatalogueDelivery> = {}): CatalogueDelivery => ({
  documentTypeId: 'd1',
  position: 1,
  gate: 'PGR',
  maturity: 'preliminar',
  weeksBeforeGate: 4,
  shareBp: 3_000,
  ...over,
})

const entrada = (over: Partial<DeliveryPlanInput> = {}): DeliveryPlanInput => ({
  tasks: [tarea()],
  deliveries: [{ nodeId: 'n1', documentTypeId: 'd1' }],
  documents: [
    { documentTypeId: 'd1', code: 'FMECA', name: 'FMECA', gate: 'CGR', weeksBeforeGate: 2 },
  ],
  checkliste: [previa()],
  assignments: [],
  links: [],
  ...over,
})

describe('partir el entregable en sus entregas', () => {
  it('parte en las previas más la final, y la final se lleva lo que sobra', () => {
    const plan = planDeliveries(entrada())
    const [propuesta] = plan.split
    expect(propuesta?.deliveries).toEqual([
      { order: 0, gate: 'PGR', maturity: 'preliminar', weeksBeforeGate: 4, minutes: 1_800, shareBp: 3_000, isFinal: false },
      { order: 1, gate: 'CGR', maturity: null, weeksBeforeGate: 2, minutes: 4_200, shareBp: 7_000, isFinal: true },
    ])
    expect(propuesta?.chain).toEqual([[0, 1]])
  })

  it('el tamaño de la tarea no se mueve', () => {
    // Declarar una Checkliste no puede cambiar lo que cuesta un proyecto.
    const plan = planDeliveries(
      entrada({ checkliste: [previa(), previa({ position: 2, gate: 'IGR', shareBp: 2_000 })] }),
    )
    expect(plan.totals.minutesAfter).toBe(plan.totals.minutesBefore)
    expect(plan.totals.minutesBefore).toBe(6_000)
  })

  it('reparte la duración cuando la tarea no declara trabajo', () => {
    // Una fixed_duration lleva su tamaño en la duración: repartir el trabajo
    // declarado la dejaría en cero.
    const plan = planDeliveries(entrada({ tasks: [tarea({ workDeclaredMinutes: 0 })] }))
    expect(plan.split[0]?.magnitude).toBe('duracion')
    expect(plan.split[0]?.deliveries.reduce((s, e) => s + e.minutes, 0)).toBe(4_800)
  })

  it('lo que esperaba a la tarea espera a la primera entrega, y lo que esperaba por ella a la final', () => {
    const plan = planDeliveries(
      entrada({
        links: [
          { id: 'L1', predecessorNodeId: 'otra', successorNodeId: 'n1' },
          { id: 'L2', predecessorNodeId: 'n1', successorNodeId: 'siguiente' },
        ],
      }),
    )
    expect(plan.split[0]?.relinked).toEqual([
      { dependencyId: 'L1', side: 'entrada', toOrder: 0 },
      { dependencyId: 'L2', side: 'salida', toOrder: 1 },
    ])
  })

  it('sin entregas previas no hay nada que partir', () => {
    const plan = planDeliveries(entrada({ checkliste: [] }))
    expect(plan.split).toHaveLength(0)
    expect(plan.skipped[0]?.reason).toBe('sin-entregas-previas')
  })

  it('no parte lo que ya está partido, ni un trozo de otra cosa', () => {
    // Las entregas van ANTES que la cadena de subactividades: si ya se partió,
    // aquí ya es tarde y partir los trozos no significaría nada.
    for (const [over, motivo] of [
      [{ alreadySplit: true }, 'ya-partida'],
      [{ isPiece: true }, 'es-un-trozo'],
      [{ hasActuals: true }, 'con-horas-reales'],
      [{ kind: 'milestone' as const }, 'no-es-tarea'],
      [{ workDeclaredMinutes: 0, durationMinutes: 0 }, 'sin-tamano'],
    ] as const) {
      const plan = planDeliveries(entrada({ tasks: [tarea(over)] }))
      expect(plan.split).toHaveLength(0)
      expect(plan.skipped[0]?.reason).toBe(motivo)
    }
  })

  it('no elige entre dos entregables', () => {
    const plan = planDeliveries(
      entrada({
        deliveries: [
          { nodeId: 'n1', documentTypeId: 'd1' },
          { nodeId: 'n1', documentTypeId: 'd2' },
        ],
      }),
    )
    expect(plan.skipped[0]?.reason).toBe('varios-entregables')
  })

  it('un reparto que no deja nada para la final no se aplica', () => {
    const plan = planDeliveries(
      entrada({ checkliste: [previa({ shareBp: 6_000 }), previa({ position: 2, gate: 'IGR', shareBp: 4_000 })] }),
    )
    expect(plan.skipped[0]?.reason).toBe('reparto-completo')
  })

  it('partir dos veces no vuelve a proponer nada', () => {
    // Idempotencia: tras aplicar, la tarea es contenedor y sus trozos son
    // trozos, así que la segunda pasada no encuentra nada.
    const plan = planDeliveries(
      entrada({
        tasks: [
          tarea({ alreadySplit: true }),
          tarea({ nodeId: 'n1a', isPiece: true }),
          tarea({ nodeId: 'n1b', isPiece: true }),
        ],
      }),
    )
    expect(plan.split).toHaveLength(0)
  })

  it('el reparto suma siempre el total exacto', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500_000 }),
        fc.array(fc.integer({ min: 100, max: 3_000 }), { minLength: 1, maxLength: 4 }),
        (total, partes) => {
          const suma = partes.reduce((a, b) => a + b, 0)
          if (suma >= 10_000) return true
          const plan = planDeliveries(
            entrada({
              tasks: [tarea({ workDeclaredMinutes: total })],
              checkliste: partes.map((share, i) =>
                previa({ position: i + 1, gate: `G${String(i)}`, shareBp: share }),
              ),
            }),
          )
          const reparto = plan.split[0]?.deliveries.reduce((s, e) => s + e.minutes, 0) ?? -1
          return reparto === total
        },
      ),
      { numRuns: 300 },
    )
  })
})
