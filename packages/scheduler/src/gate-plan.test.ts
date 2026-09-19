/**
 * La puerta le pone fecha objetivo a la tarea que entrega el documento.
 *
 * Lo que más se comprueba aquí no es la resta —siete días por semana, poco que
 * discutir— sino **lo que la función se niega a hacer**: recortar una fecha que
 * no cabe, elegir entre dos entregables, o inventarse la fecha de una puerta que
 * el proyecto no ha declarado. Cada uno de esos es un descarte con nombre.
 */

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { planGateDeadlines, type GateDocument, type GatePlanInput, type GateTask } from './gate-plan.js'

const tarea = (over: Partial<GateTask> = {}): GateTask => ({
  nodeId: 'n1',
  name: 'Redactar el FMECA',
  path: '001',
  kind: 'task',
  deadline: null,
  ...over,
})

const documento = (over: Partial<GateDocument> = {}): GateDocument => ({
  documentTypeId: 'd1',
  code: 'FMECA',
  name: 'Análisis de modos de fallo',
  gate: 'CGR',
  weeksBeforeGate: 4,
  ...over,
})

const entrada = (over: Partial<GatePlanInput> = {}): GatePlanInput => ({
  tasks: [tarea()],
  deliveries: [{ nodeId: 'n1', documentTypeId: 'd1' }],
  documents: [documento()],
  gates: [{ gate: 'CGR', date: '2028-05-14' }],
  projectStart: '2026-01-01',
  ...over,
})

describe('la puerta da la fecha', () => {
  it('resta siete días por cada semana declarada', () => {
    const plan = planGateDeadlines(entrada())
    expect(plan.set).toHaveLength(1)
    // 2028-05-14 menos cuatro semanas (28 días) es 2028-04-16.
    expect(plan.set[0]?.deadline).toBe('2028-04-16')
    expect(plan.set[0]?.weeks).toBe(4)
    expect(plan.set[0]?.gateDate).toBe('2028-05-14')
    expect(plan.totals.nuevas).toBe(1)
    expect(plan.totals.cambiadas).toBe(0)
  })

  it('sin semanas declaradas pone el objetivo en la puerta misma', () => {
    // El catálogo extraído del DocFlowChart viene entero así: dice a qué puerta
    // va cada entregable y no cuántas semanas antes. Se lee como cero, y el
    // cero viaja en la propuesta para que se vea que es una lectura.
    const plan = planGateDeadlines(
      entrada({ documents: [documento({ weeksBeforeGate: null })] }),
    )
    expect(plan.set[0]?.deadline).toBe('2028-05-14')
    expect(plan.set[0]?.weeks).toBe(0)
  })

  it('un objetivo que ya estaba puesto no se vuelve a proponer', () => {
    const plan = planGateDeadlines(entrada({ tasks: [tarea({ deadline: '2028-04-16' })] }))
    expect(plan.set).toHaveLength(0)
    expect(plan.skipped[0]?.reason).toBe('ya-puesta')
  })

  it('un objetivo distinto se propone como cambio, con el anterior a la vista', () => {
    const plan = planGateDeadlines(entrada({ tasks: [tarea({ deadline: '2027-01-01' })] }))
    expect(plan.set[0]?.previous).toBe('2027-01-01')
    expect(plan.set[0]?.deadline).toBe('2028-04-16')
    expect(plan.totals.cambiadas).toBe(1)
    expect(plan.totals.nuevas).toBe(0)
  })

  it('no recorta la fecha que cae antes del arranque: la enseña', () => {
    // La hoja hace MAX(fecha, suelo) porque una celda tiene que dar un día. Un
    // objetivo recortado al arranque se cumple siempre y no avisa de nada.
    const plan = planGateDeadlines(
      entrada({
        gates: [{ gate: 'CGR', date: '2026-01-15' }],
        documents: [documento({ weeksBeforeGate: 8 })],
      }),
    )
    expect(plan.set).toHaveLength(0)
    expect(plan.skipped[0]?.reason).toBe('antes-del-arranque')
    // Y el día que habría salido se enseña igual, que es de lo que se habla.
    expect(plan.skipped[0]?.deadline).toBe('2025-11-20')
  })

  it('una puerta que el proyecto no ha fechado se descarta con su nombre', () => {
    const plan = planGateDeadlines(entrada({ gates: [] }))
    expect(plan.skipped[0]?.reason).toBe('puerta-sin-fecha')
    expect(plan.skipped[0]?.gate).toBe('CGR')
    expect(plan.totals.puertasSinFecha).toEqual(['CGR'])
  })

  it('casa la puerta aunque esté escrita en otra caja o con espacios', () => {
    const plan = planGateDeadlines(entrada({ gates: [{ gate: '  cgr ', date: '2028-05-14' }] }))
    expect(plan.set[0]?.deadline).toBe('2028-04-16')
  })

  it('no elige entre dos entregables de la misma tarea', () => {
    const plan = planGateDeadlines(
      entrada({
        deliveries: [
          { nodeId: 'n1', documentTypeId: 'd1' },
          { nodeId: 'n1', documentTypeId: 'd2' },
        ],
        documents: [documento(), documento({ documentTypeId: 'd2', code: 'FTA', gate: 'IQR' })],
      }),
    )
    expect(plan.set).toHaveLength(0)
    expect(plan.skipped[0]?.reason).toBe('varios-entregables')
  })

  it('una tarea sin entregable no tiene puerta de la que sacar nada', () => {
    const plan = planGateDeadlines(entrada({ deliveries: [] }))
    expect(plan.skipped[0]?.reason).toBe('sin-entregable')
  })

  it('un entregable sin puerta declarada se queda como está', () => {
    const plan = planGateDeadlines(entrada({ documents: [documento({ gate: null })] }))
    expect(plan.skipped[0]?.reason).toBe('sin-puerta')
    // Y una puerta escrita en blanco cuenta igual que ninguna.
    const enBlanco = planGateDeadlines(entrada({ documents: [documento({ gate: '   ' })] }))
    expect(enBlanco.skipped[0]?.reason).toBe('sin-puerta')
  })

  it('un hito sí puede llevar objetivo; una fase y un paquete no', () => {
    // Una puerta de revisión es un hito, y es lo más natural que lleve fecha.
    const hito = planGateDeadlines(entrada({ tasks: [tarea({ kind: 'milestone' })] }))
    expect(hito.set).toHaveLength(1)

    for (const kind of ['phase', 'work_package'] as const) {
      const plan = planGateDeadlines(entrada({ tasks: [tarea({ kind })] }))
      expect(plan.set).toHaveLength(0)
      expect(plan.skipped[0]?.reason).toBe('no-es-tarea')
    }
  })

  it('cada tarea sale una vez, o en la propuesta o en los descartes', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            nodeId: fc.uuid(),
            kind: fc.constantFrom('task' as const, 'milestone' as const, 'phase' as const),
            semanas: fc.option(fc.integer({ min: 0, max: 200 }), { nil: null }),
            entrega: fc.boolean(),
            fechada: fc.boolean(),
          }),
          { maxLength: 40 },
        ),
        (filas) => {
          const unicas = [...new Map(filas.map((f) => [f.nodeId, f])).values()]
          const plan = planGateDeadlines({
            tasks: unicas.map((f, i) => tarea({ nodeId: f.nodeId, kind: f.kind, path: String(i) })),
            deliveries: unicas
              .filter((f) => f.entrega)
              .map((f) => ({ nodeId: f.nodeId, documentTypeId: `doc-${f.nodeId}` })),
            documents: unicas.map((f) =>
              documento({
                documentTypeId: `doc-${f.nodeId}`,
                gate: f.fechada ? 'CGR' : 'SIN-FECHAR',
                weeksBeforeGate: f.semanas,
              }),
            ),
            gates: [{ gate: 'CGR', date: '2040-01-01' }],
            projectStart: '2026-01-01',
          })
          return plan.set.length + plan.skipped.length === unicas.length
        },
      ),
      { numRuns: 200 },
    )
  })
})

describe('la puerta de una entrega concreta manda sobre la del catálogo', () => {
  it('el borrador va a su puerta, no a la del entregable', () => {
    // El FMECA va a CGR, pero su preliminar va a PGR: la tarea que ES ese
    // preliminar tiene que recibir la fecha de PGR (ADR-0047).
    const plan = planGateDeadlines(
      entrada({
        tasks: [tarea({ ownGate: { gate: 'PGR', weeksBeforeGate: 2 } })],
        gates: [
          { gate: 'CGR', date: '2028-05-14' },
          { gate: 'PGR', date: '2027-03-19' },
        ],
      }),
    )
    expect(plan.set[0]?.gate).toBe('PGR')
    // 2027-03-19 menos dos semanas.
    expect(plan.set[0]?.deadline).toBe('2027-03-05')
  })

  it('sin puerta propia sigue mandando la del catálogo', () => {
    const plan = planGateDeadlines(entrada())
    expect(plan.set[0]?.gate).toBe('CGR')
  })

  it('una entrega sin semanas propias no hereda las del catálogo', () => {
    // Son cosas distintas: las semanas del catálogo son las de la entrega
    // final. Un borrador sin semanas va el día de SU puerta.
    const plan = planGateDeadlines(
      entrada({
        tasks: [tarea({ ownGate: { gate: 'PGR', weeksBeforeGate: null } })],
        gates: [{ gate: 'PGR', date: '2027-03-19' }],
      }),
    )
    expect(plan.set[0]?.weeks).toBe(0)
    expect(plan.set[0]?.deadline).toBe('2027-03-19')
  })
})
