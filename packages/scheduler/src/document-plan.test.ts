import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { planDocumentDependencies, type DocumentPlanInput } from './document-plan.js'
import { topologicalOrder } from './graph.js'

const tarea = (nodeId: string): { nodeId: string; name: string; path: string } => ({
  nodeId,
  name: nodeId,
  path: `1.${nodeId}`,
})

const entrada = (parcial: Partial<DocumentPlanInput>): DocumentPlanInput => ({
  tasks: [],
  deliveries: [],
  precedences: [],
  existing: [],
  ...parcial,
})

describe('aplicar la matriz de documentos a un proyecto', () => {
  it('ata la tarea que entrega la condición con la que entrega lo condicionado', () => {
    const plan = planDocumentDependencies(
      entrada({
        tasks: [tarea('a'), tarea('b')],
        deliveries: [
          { nodeId: 'a', documentTypeId: 'riesgos' },
          { nodeId: 'b', documentTypeId: 'seguridad' },
        ],
        precedences: [{ predecessorId: 'riesgos', successorId: 'seguridad' }],
      }),
    )

    expect(plan.create).toEqual([
      {
        predecessorNodeId: 'a',
        successorNodeId: 'b',
        documentPredecessorId: 'riesgos',
        documentSuccessorId: 'seguridad',
      },
    ])
    expect(plan.skipped).toEqual([])
    expect(plan.missingDocuments).toEqual([])
  })

  it('hace el producto cartesiano cuando varias tareas entregan el mismo documento', () => {
    const plan = planDocumentDependencies(
      entrada({
        tasks: [tarea('a1'), tarea('a2'), tarea('b1'), tarea('b2')],
        deliveries: [
          { nodeId: 'a1', documentTypeId: 'A' },
          { nodeId: 'a2', documentTypeId: 'A' },
          { nodeId: 'b1', documentTypeId: 'B' },
          { nodeId: 'b2', documentTypeId: 'B' },
        ],
        precedences: [{ predecessorId: 'A', successorId: 'B' }],
      }),
    )

    expect(plan.create.map((d) => `${d.predecessorNodeId}->${d.successorNodeId}`)).toEqual([
      'a1->b1',
      'a1->b2',
      'a2->b1',
      'a2->b2',
    ])
  })

  it('no propone lo que ya está en el plan', () => {
    const plan = planDocumentDependencies(
      entrada({
        tasks: [tarea('a'), tarea('b')],
        deliveries: [
          { nodeId: 'a', documentTypeId: 'A' },
          { nodeId: 'b', documentTypeId: 'B' },
        ],
        precedences: [{ predecessorId: 'A', successorId: 'B' }],
        existing: [{ predecessorNodeId: 'a', successorNodeId: 'b' }],
      }),
    )

    expect(plan.create).toEqual([])
    expect(plan.skipped).toHaveLength(1)
    expect(plan.skipped[0]?.reason).toBe('ya-existe')
  })

  it('no ata una tarea consigo misma cuando entrega los dos documentos', () => {
    const plan = planDocumentDependencies(
      entrada({
        tasks: [tarea('a')],
        deliveries: [
          { nodeId: 'a', documentTypeId: 'A' },
          { nodeId: 'a', documentTypeId: 'B' },
        ],
        precedences: [{ predecessorId: 'A', successorId: 'B' }],
      }),
    )

    expect(plan.create).toEqual([])
    expect(plan.skipped[0]?.reason).toBe('misma-tarea')
  })

  it('descarta la dependencia que cerraría un ciclo y dice por dónde', () => {
    const plan = planDocumentDependencies(
      entrada({
        tasks: [tarea('a'), tarea('b')],
        deliveries: [
          { nodeId: 'a', documentTypeId: 'A' },
          { nodeId: 'b', documentTypeId: 'B' },
        ],
        precedences: [{ predecessorId: 'A', successorId: 'B' }],
        // El plan ya dice que b precede a a. Atarlas al revés lo cerraría.
        existing: [{ predecessorNodeId: 'b', successorNodeId: 'a' }],
      }),
    )

    expect(plan.create).toEqual([])
    expect(plan.skipped[0]?.reason).toBe('crearia-un-ciclo')
    expect(plan.skipped[0]?.path).toEqual(['b', 'a'])
  })

  it('ve el ciclo que se cerraría por un camino largo', () => {
    const plan = planDocumentDependencies(
      entrada({
        tasks: ['a', 'b', 'c', 'd'].map(tarea),
        deliveries: [
          { nodeId: 'd', documentTypeId: 'A' },
          { nodeId: 'a', documentTypeId: 'B' },
        ],
        precedences: [{ predecessorId: 'A', successorId: 'B' }],
        existing: [
          { predecessorNodeId: 'a', successorNodeId: 'b' },
          { predecessorNodeId: 'b', successorNodeId: 'c' },
          { predecessorNodeId: 'c', successorNodeId: 'd' },
        ],
      }),
    )

    expect(plan.create).toEqual([])
    expect(plan.skipped[0]?.path).toEqual(['a', 'b', 'c', 'd'])
  })

  it('cuenta el ciclo que cerrarían dos propuestas de la misma tanda', () => {
    const plan = planDocumentDependencies(
      entrada({
        tasks: [tarea('a'), tarea('b')],
        deliveries: [
          { nodeId: 'a', documentTypeId: 'A' },
          { nodeId: 'b', documentTypeId: 'B' },
        ],
        // La matriz se contradice: A es condición de B y B lo es de A.
        precedences: [
          { predecessorId: 'A', successorId: 'B' },
          { predecessorId: 'B', successorId: 'A' },
        ],
      }),
    )

    expect(plan.create).toHaveLength(1)
    expect(plan.skipped).toHaveLength(1)
    expect(plan.skipped[0]?.reason).toBe('crearia-un-ciclo')
  })

  it('ignora las tareas que no son del proyecto', () => {
    const plan = planDocumentDependencies(
      entrada({
        tasks: [tarea('a')],
        deliveries: [
          { nodeId: 'a', documentTypeId: 'A' },
          { nodeId: 'ajena', documentTypeId: 'B' },
        ],
        precedences: [{ predecessorId: 'A', successorId: 'B' }],
      }),
    )

    expect(plan.create).toEqual([])
    // B no lo entrega nadie de este proyecto: es un hueco, no una dependencia.
    expect(plan.missingDocuments).toEqual(['B'])
  })

  it('enumera los documentos de la matriz que nadie entrega', () => {
    const plan = planDocumentDependencies(
      entrada({
        tasks: [tarea('a')],
        deliveries: [{ nodeId: 'a', documentTypeId: 'B' }],
        precedences: [
          { predecessorId: 'A', successorId: 'B' },
          { predecessorId: 'B', successorId: 'C' },
        ],
      }),
    )

    expect(plan.missingDocuments).toEqual(['A', 'C'])
  })

  it('no cambia si se barajan las entradas', () => {
    const base = entrada({
      tasks: ['a', 'b', 'c'].map(tarea),
      deliveries: [
        { nodeId: 'a', documentTypeId: 'A' },
        { nodeId: 'b', documentTypeId: 'B' },
        { nodeId: 'c', documentTypeId: 'C' },
      ],
      precedences: [
        { predecessorId: 'A', successorId: 'B' },
        { predecessorId: 'B', successorId: 'C' },
        { predecessorId: 'A', successorId: 'C' },
      ],
    })
    const alReves = entrada({
      tasks: [...base.tasks].reverse(),
      deliveries: [...base.deliveries].reverse(),
      precedences: [...base.precedences].reverse(),
    })

    expect(planDocumentDependencies(alReves)).toEqual(planDocumentDependencies(base))
  })

  it('nunca deja el grafo con un ciclo, se le eche lo que se le eche', () => {
    const id = fc.constantFrom('a', 'b', 'c', 'd', 'e')
    const doc = fc.constantFrom('D1', 'D2', 'D3')

    fc.assert(
      fc.property(
        fc.array(fc.record({ nodeId: id, documentTypeId: doc }), { maxLength: 12 }),
        fc.array(fc.record({ predecessorId: doc, successorId: doc }), { maxLength: 9 }),
        fc.array(fc.record({ predecessorNodeId: id, successorNodeId: id }), { maxLength: 8 }),
        (deliveries, precedences, existing) => {
          const tasks = ['a', 'b', 'c', 'd', 'e'].map(tarea)
          const sinBucles = existing.filter((e) => e.predecessorNodeId !== e.successorNodeId)
          const plan = planDocumentDependencies(
            entrada({ tasks, deliveries, precedences, existing: sinBucles }),
          )

          const aristas = [...sinBucles, ...plan.create].map((d, index) => ({
            id: String(index),
            predecessorNodeId: d.predecessorNodeId,
            successorNodeId: d.successorNodeId,
            kind: 'FS' as const,
            lagMinutes: 0,
          }))
          const departida = topologicalOrder(
            tasks.map((t) => t.nodeId),
            sinBucles.map((d, index) => ({
              id: String(index),
              predecessorNodeId: d.predecessorNodeId,
              successorNodeId: d.successorNodeId,
              kind: 'FS' as const,
              lagMinutes: 0,
            })),
          )
          // Si el plan ya venía con un ciclo, no es cosa del aplicador. Pero si
          // venía limpio, tiene que seguir limpio después de aplicar.
          if (departida.cycle === undefined) {
            expect(
              topologicalOrder(
                tasks.map((t) => t.nodeId),
                aristas,
              ).cycle,
            ).toBeUndefined()
          }
        },
      ),
    )
  })
})
