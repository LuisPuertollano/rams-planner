import { describe, expect, it } from 'vitest'
import {
  answerGateChecklist,
  type GateChecklistInput,
  type GateQuery,
  type NivelDeConsulta,
} from './gate-checklist.js'
import type { GateEvidence, GateReadinessRow } from './gate-readiness.js'

const FMECA = '11111111-1111-1111-1111-111111111111'
const HAZLOG = '22222222-2222-2222-2222-222222222222'

const entrega = (parcial: Partial<GateEvidence> = {}): GateEvidence => ({
  documentTypeId: FMECA,
  documentCode: 'S-FMECA',
  documentName: 'FMECA',
  maturity: 'preliminar',
  state: 'a-tiempo',
  dueOn: '2026-05-15',
  weeks: 0,
  nodeId: 'n1',
  taskName: 'FMECA · preliminar',
  finish: '2026-05-01',
  daysLate: null,
  percentCompleteBp: 0,
  ...parcial,
})

const puertaResuelta = (evidence: readonly GateEvidence[]): GateReadinessRow => ({
  gate: 'PGR',
  date: '2026-05-15',
  evidence,
  totals: {
    esperadas: evidence.length,
    aTiempo: 0,
    tarde: 0,
    sinPartir: 0,
    sinFecha: 0,
    sinFechaDePuerta: 0,
  },
})

const consulta = (parcial: Partial<GateQuery> = {}): GateQuery => ({
  id: 'q1',
  discipline: 'safety',
  chapter: '3',
  chapterName: 'Safety Demonstration & Closure',
  code: '3.5',
  question: '¿Está emitido o actualizado el FMECA orgánico?',
  sortKey: 35,
  gates: [{ gate: 'PGR', level: 'M', proofRequest: 'Final version to be provided.' }],
  documents: [{ documentTypeId: FMECA, maturity: 'preliminar' }],
  ...parcial,
})

const entrada = (parcial: Partial<GateChecklistInput> = {}): GateChecklistInput => ({
  queries: [consulta()],
  readiness: [puertaResuelta([entrega()])],
  gates: [{ gate: 'PGR', date: '2026-05-15' }],
  ...parcial,
})

describe('answerGateChecklist', () => {
  it('una consulta cuyo entregable llega a tiempo queda contestada por el plan', () => {
    const resultado = answerGateChecklist(entrada())
    const fila = resultado.gates[0]?.queries[0]
    expect(fila?.state).toBe('cumple')
    expect(fila?.evidence).toHaveLength(1)
    expect(fila?.evidence[0]?.current).toBe(true)
    expect(resultado.findings).toEqual([])
  })

  it('si el entregable llega tarde, la consulta no se cumple y lo dice', () => {
    const resultado = answerGateChecklist(
      entrada({
        readiness: [puertaResuelta([entrega({ state: 'tarde', daysLate: 18, finish: '2026-06-02' })])],
      }),
    )
    expect(resultado.gates[0]?.queries[0]?.state).toBe('no-cumple')
    const hallazgo = resultado.findings[0]
    expect(hallazgo?.code).toBe('GATE_QUERY_UNMET')
    expect(hallazgo?.payload).toMatchObject({ consulta: '3.5', puerta: 'PGR', nivel: 'M' })
  })

  it('el nivel que declara la Checkliste decide la gravedad, no mi criterio', () => {
    const gravedades: Record<NivelDeConsulta, string> = {
      M: 'error',
      HR: 'warning',
      R: 'info',
      C: 'info',
    }
    for (const nivel of ['M', 'HR', 'R', 'C'] as const) {
      const resultado = answerGateChecklist(
        entrada({
          queries: [consulta({ gates: [{ gate: 'PGR', level: nivel, proofRequest: null }] })],
          readiness: [puertaResuelta([entrega({ state: 'tarde', daysLate: 3 })])],
        }),
      )
      expect(resultado.findings[0]?.severity).toBe(gravedades[nivel])
    }
  })

  it('sólo las obligatorias que fallan cuentan como lo que para la puerta', () => {
    const resultado = answerGateChecklist(
      entrada({
        queries: [
          consulta({ id: 'a', code: '3.5', gates: [{ gate: 'PGR', level: 'M', proofRequest: null }] }),
          consulta({ id: 'b', code: '3.6', gates: [{ gate: 'PGR', level: 'R', proofRequest: null }] }),
        ],
        readiness: [puertaResuelta([entrega({ state: 'tarde', daysLate: 2 })])],
      }),
    )
    const totales = resultado.gates[0]?.totals
    expect(totales?.noCumplen).toBe(2)
    expect(totales?.obligatoriasQueFallan).toBe(1)
  })

  it('la consulta que no nombra ningún entregable la contesta una persona, y se dice', () => {
    const resultado = answerGateChecklist(
      entrada({ queries: [consulta({ documents: [] })] }),
    )
    expect(resultado.gates[0]?.queries[0]?.state).toBe('la-contesta-una-persona')
    // No es un fallo: es media Checkliste, y saberlo de antemano es el trabajo.
    expect(resultado.findings).toEqual([])
    expect(resultado.totals.deUnaPersona).toBe(1)
  })

  it('un entregable que la consulta nombra y el proyecto no entrega no se cumple', () => {
    const resultado = answerGateChecklist(
      entrada({ queries: [consulta({ documents: [{ documentTypeId: HAZLOG, maturity: null }] })] }),
    )
    const fila = resultado.gates[0]?.queries[0]
    expect(fila?.state).toBe('no-cumple')
    expect(fila?.missing).toEqual([HAZLOG])
  })

  it('sin fecha calculada la consulta no se da por buena: es «sin saber»', () => {
    const resultado = answerGateChecklist(
      entrada({ readiness: [puertaResuelta([entrega({ state: 'sin-fecha', finish: null })])] }),
    )
    expect(resultado.gates[0]?.queries[0]?.state).toBe('sin-saber')
    expect(resultado.findings).toEqual([])
  })

  it('una consulta de una puerta que el proyecto no ha fechado se dice, no se calla', () => {
    // Es el caso de FEI y de IQA: la Checkliste pregunta en puertas que la
    // cartera real no declara. Callarlo dejaría una puerta entera fuera.
    const resultado = answerGateChecklist(
      entrada({
        queries: [consulta({ gates: [{ gate: 'FEI', level: 'M', proofRequest: null }] })],
        readiness: [],
        gates: [{ gate: 'PGR', date: '2026-05-15' }],
      }),
    )
    expect(resultado.gates[0]?.gate).toBe('FEI')
    expect(resultado.gates[0]?.queries[0]?.state).toBe('puerta-sin-fechar')
    expect(resultado.findings).toEqual([])
  })

  it('la misma consulta pesa distinto en cada puerta, que es lo que dice la hoja', () => {
    const resultado = answerGateChecklist(
      entrada({
        queries: [
          consulta({
            gates: [
              { gate: 'IGR', level: 'R', proofRequest: 'Initial version.' },
              { gate: 'PGR', level: 'M', proofRequest: 'Final version.' },
            ],
          }),
        ],
        readiness: [
          { ...puertaResuelta([entrega()]), gate: 'IGR', date: '2026-02-10' },
          puertaResuelta([entrega()]),
        ],
        gates: [
          { gate: 'IGR', date: '2026-02-10' },
          { gate: 'PGR', date: '2026-05-15' },
        ],
      }),
    )
    expect(resultado.gates.map((p) => p.gate)).toEqual(['IGR', 'PGR'])
    expect(resultado.gates[0]?.queries[0]?.level).toBe('R')
    expect(resultado.gates[0]?.queries[0]?.proofRequest).toBe('Initial version.')
    expect(resultado.gates[1]?.queries[0]?.level).toBe('M')
    expect(resultado.gates[1]?.queries[0]?.proofRequest).toBe('Final version.')
  })

  it('las consultas salen en el orden de la hoja, no en el que vengan', () => {
    const resultado = answerGateChecklist(
      entrada({
        queries: [
          consulta({ id: 'c', code: '3.5', sortKey: 35 }),
          consulta({ id: 'a', code: '0.1', sortKey: 1 }),
          consulta({ id: 'b', code: '1.7', sortKey: 17 }),
        ],
      }),
    )
    expect(resultado.gates[0]?.queries.map((q) => q.code)).toEqual(['0.1', '1.7', '3.5'])
  })

  it('las puertas casan por nombre normalizado', () => {
    const resultado = answerGateChecklist(
      entrada({
        queries: [consulta({ gates: [{ gate: ' pgr ', level: 'M', proofRequest: null }] })],
      }),
    )
    expect(resultado.gates[0]?.queries[0]?.state).toBe('cumple')
  })

  it('la versión vigente puede venir de una puerta ANTERIOR, y eso no es un fallo', () => {
    // El caso real: en IQR la Checkliste pregunta si el Hazard Log sigue al
    // día, y el Hazard Log se entrega en CGR. Buscar sólo en la puerta de la
    // consulta decía «no está en el plan» de un documento ya terminado.
    const resultado = answerGateChecklist({
      queries: [
        consulta({
          gates: [{ gate: 'IQR', level: 'M', proofRequest: null }],
          documents: [{ documentTypeId: FMECA, maturity: null }],
        }),
      ],
      readiness: [
        {
          ...puertaResuelta([entrega({ maturity: null, state: 'a-tiempo' })]),
          gate: 'CGR',
          date: '2026-09-30',
        },
      ],
      gates: [
        { gate: 'CGR', date: '2026-09-30' },
        { gate: 'IQR', date: '2027-03-15' },
      ],
    })
    const fila = resultado.gates.find((puerta) => puerta.gate === 'IQR')?.queries[0]
    expect(fila?.state).toBe('vigente-de-antes')
    expect(fila?.missing).toEqual([])
    expect(fila?.evidence[0]?.gate).toBe('CGR')
    expect(fila?.evidence[0]?.current).toBe(false)
    // No es un fallo, así que no genera hallazgo.
    expect(resultado.findings).toEqual([])
  })

  it('una entrega POSTERIOR a la puerta no vale como evidencia en ella', () => {
    // Lo contrario del caso anterior, y es el que no se puede aflojar: en PGR
    // no se puede enseñar algo que se entrega en CGR.
    const resultado = answerGateChecklist({
      queries: [
        consulta({
          gates: [{ gate: 'PGR', level: 'M', proofRequest: null }],
          documents: [{ documentTypeId: FMECA, maturity: null }],
        }),
      ],
      readiness: [
        {
          ...puertaResuelta([entrega({ maturity: null })]),
          gate: 'CGR',
          date: '2026-09-30',
        },
      ],
      gates: [
        { gate: 'PGR', date: '2026-05-15' },
        { gate: 'CGR', date: '2026-09-30' },
      ],
    })
    const fila = resultado.gates.find((puerta) => puerta.gate === 'PGR')?.queries[0]
    expect(fila?.state).toBe('no-cumple')
    expect(fila?.missing).toEqual([FMECA])
  })

  it('cuando la consulta declara madurez, una final anterior no tapa el preliminar que falta', () => {
    const resultado = answerGateChecklist({
      queries: [
        consulta({
          gates: [{ gate: 'CGR', level: 'M', proofRequest: null }],
          documents: [{ documentTypeId: FMECA, maturity: 'preliminar' }],
        }),
      ],
      readiness: [
        {
          ...puertaResuelta([entrega({ maturity: null })]),
          gate: 'PGR',
          date: '2026-05-15',
        },
      ],
      gates: [
        { gate: 'PGR', date: '2026-05-15' },
        { gate: 'CGR', date: '2026-09-30' },
      ],
    })
    expect(resultado.gates.find((p) => p.gate === 'CGR')?.queries[0]?.state).toBe('no-cumple')
  })

  it('entre dos versiones anteriores manda la más reciente', () => {
    const resultado = answerGateChecklist({
      queries: [
        consulta({
          gates: [{ gate: 'IQR', level: 'M', proofRequest: null }],
          documents: [{ documentTypeId: FMECA, maturity: null }],
        }),
      ],
      readiness: [
        {
          ...puertaResuelta([entrega({ maturity: null, taskName: 'la vieja' })]),
          gate: 'IGR',
          date: '2026-02-10',
        },
        {
          ...puertaResuelta([entrega({ maturity: null, taskName: 'la buena' })]),
          gate: 'CGR',
          date: '2026-09-30',
        },
      ],
      gates: [
        { gate: 'IGR', date: '2026-02-10' },
        { gate: 'CGR', date: '2026-09-30' },
        { gate: 'IQR', date: '2027-03-15' },
      ],
    })
    const fila = resultado.gates.find((puerta) => puerta.gate === 'IQR')?.queries[0]
    expect(fila?.evidence[0]?.cell.taskName).toBe('la buena')
  })

  it('una puerta sin fecha no entra en el orden: no puede ser «la anterior» de nadie', () => {
    const resultado = answerGateChecklist({
      queries: [
        consulta({
          gates: [{ gate: 'CGR', level: 'M', proofRequest: null }],
          documents: [{ documentTypeId: FMECA, maturity: null }],
        }),
      ],
      readiness: [
        { ...puertaResuelta([entrega({ maturity: null })]), gate: 'SGR', date: null },
      ],
      gates: [{ gate: 'CGR', date: '2026-09-30' }],
    })
    expect(resultado.gates[0]?.queries[0]?.state).toBe('no-cumple')
  })

  it('la misma entrada da exactamente la misma salida (P2)', () => {
    const fija = entrada({
      queries: [consulta({ id: 'a', code: '1.7' }), consulta({ id: 'b', code: '3.5' })],
    })
    expect(answerGateChecklist(fija)).toEqual(answerGateChecklist(fija))
  })
})
