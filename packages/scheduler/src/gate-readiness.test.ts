import { describe, expect, it } from 'vitest'
import {
  assessGateReadiness,
  type GateExpectation,
  type GateReadinessInput,
  type PlannedDelivery,
} from './gate-readiness.js'

const FMECA = '11111111-1111-1111-1111-111111111111'
const HAZLOG = '22222222-2222-2222-2222-222222222222'

const documentos = [
  { documentTypeId: FMECA, code: 'S-FMECA', name: 'FMECA' },
  { documentTypeId: HAZLOG, code: 'S-HAZLOG', name: 'Hazard Log' },
]

const entrega = (parcial: Partial<PlannedDelivery> = {}): PlannedDelivery => ({
  nodeId: 'n1',
  name: 'FMECA · preliminar',
  path: '1.1',
  documentTypeId: FMECA,
  maturity: 'preliminar',
  scheduledFinish: '2026-05-01',
  percentCompleteBp: 0,
  ...parcial,
})

const esperada = (parcial: Partial<GateExpectation> = {}): GateExpectation => ({
  gate: 'PGR',
  documentTypeId: FMECA,
  maturity: 'preliminar',
  weeksBeforeGate: null,
  ...parcial,
})

const entrada = (parcial: Partial<GateReadinessInput> = {}): GateReadinessInput => ({
  gates: [{ gate: 'PGR', date: '2026-05-15' }],
  expectations: [esperada()],
  planned: [entrega()],
  documents: documentos,
  documentsInPlan: [FMECA],
  ...parcial,
})

describe('assessGateReadiness', () => {
  it('una entrega que termina antes de su puerta llega a tiempo', () => {
    const resultado = assessGateReadiness(entrada())
    expect(resultado.gates).toHaveLength(1)
    expect(resultado.gates[0]?.evidence[0]?.state).toBe('a-tiempo')
    expect(resultado.gates[0]?.evidence[0]?.dueOn).toBe('2026-05-15')
    expect(resultado.findings).toEqual([])
  })

  it('el día de la puerta cuenta como a tiempo: el límite es inclusivo', () => {
    const resultado = assessGateReadiness(
      entrada({ planned: [entrega({ scheduledFinish: '2026-05-15' })] }),
    )
    expect(resultado.gates[0]?.evidence[0]?.state).toBe('a-tiempo')
  })

  it('una entrega que termina después sale tarde, y dice por cuántos días', () => {
    const resultado = assessGateReadiness(
      entrada({ planned: [entrega({ scheduledFinish: '2026-06-02' })] }),
    )
    const fila = resultado.gates[0]?.evidence[0]
    expect(fila?.state).toBe('tarde')
    expect(fila?.daysLate).toBe(18)

    const hallazgo = resultado.findings.find((f) => f.code === 'GATE_EVIDENCE_LATE')
    expect(hallazgo?.severity).toBe('warning')
    expect(hallazgo?.entityId).toBe(FMECA)
    expect(hallazgo?.occursOn).toBe('2026-05-15')
    // El payload lleva los nombres resueltos, nunca un identificador.
    expect(hallazgo?.payload).toMatchObject({
      documento: 'S-FMECA · preliminar',
      puerta: 'PGR',
      limite: '2026-05-15',
      fin: '2026-06-02',
      dias: 18,
    })
  })

  it('las semanas antes de la puerta adelantan el límite, y pueden volver tarde lo que llegaba', () => {
    const resultado = assessGateReadiness(
      entrada({ expectations: [esperada({ weeksBeforeGate: 4 })] }),
    )
    const fila = resultado.gates[0]?.evidence[0]
    // 15/05 menos cuatro semanas: 17/04, y la entrega termina el 01/05.
    expect(fila?.dueOn).toBe('2026-04-17')
    expect(fila?.weeks).toBe(4)
    expect(fila?.state).toBe('tarde')
    expect(fila?.daysLate).toBe(14)
  })

  it('lo que la puerta espera y el plan no tiene sale sin partir, con su hallazgo', () => {
    const resultado = assessGateReadiness(
      entrada({
        // El proyecto entrega el FMECA, pero sin partir: sólo la final.
        planned: [entrega({ maturity: null, name: 'FMECA' })],
        expectations: [esperada(), esperada({ gate: 'CGR', maturity: null })],
        gates: [
          { gate: 'PGR', date: '2026-05-15' },
          { gate: 'CGR', date: '2026-09-30' },
        ],
      }),
    )
    const pgr = resultado.gates.find((puerta) => puerta.gate === 'PGR')
    expect(pgr?.evidence[0]?.state).toBe('sin-partir')
    expect(pgr?.evidence[0]?.nodeId).toBeNull()
    const cgr = resultado.gates.find((puerta) => puerta.gate === 'CGR')
    expect(cgr?.evidence[0]?.state).toBe('a-tiempo')

    const hallazgo = resultado.findings.find((f) => f.code === 'GATE_EVIDENCE_MISSING')
    expect(hallazgo?.payload).toMatchObject({
      documento: 'S-FMECA · preliminar',
      puerta: 'PGR',
      entregable: 'S-FMECA',
      madurez: 'preliminar',
    })
  })

  it('un documento que este proyecto no entrega no genera ninguna fila', () => {
    const resultado = assessGateReadiness(
      entrada({
        expectations: [esperada(), esperada({ documentTypeId: HAZLOG })],
        documentsInPlan: [FMECA],
      }),
    )
    expect(resultado.totals.esperadas).toBe(1)
    expect(resultado.findings).toEqual([])
  })

  it('una puerta que el proyecto no ha fechado se dice, no se da por buena', () => {
    const resultado = assessGateReadiness(entrada({ gates: [] }))
    const fila = resultado.gates[0]?.evidence[0]
    expect(fila?.state).toBe('sin-fecha-de-puerta')
    expect(fila?.dueOn).toBeNull()
    expect(fila?.weeks).toBeNull()
    expect(resultado.findings).toEqual([])
  })

  it('una entrega sin fin calculado no es «a tiempo»: es «sin fecha»', () => {
    const resultado = assessGateReadiness(
      entrada({ planned: [entrega({ scheduledFinish: null })] }),
    )
    expect(resultado.gates[0]?.evidence[0]?.state).toBe('sin-fecha')
    expect(resultado.findings).toEqual([])
  })

  it('cuando dos tareas ocupan la misma casilla, manda la que termina más tarde', () => {
    const resultado = assessGateReadiness(
      entrada({
        planned: [
          entrega({ nodeId: 'pronto', scheduledFinish: '2026-05-01' }),
          entrega({ nodeId: 'tarde', scheduledFinish: '2026-06-02' }),
        ],
      }),
    )
    // La puerta la cierra la última, no la primera.
    expect(resultado.gates[0]?.evidence[0]?.nodeId).toBe('tarde')
    expect(resultado.gates[0]?.evidence[0]?.state).toBe('tarde')
  })

  it('una entrega sin fecha no desbanca a una que sí la tiene', () => {
    const resultado = assessGateReadiness(
      entrada({
        planned: [
          entrega({ nodeId: 'con-fecha', scheduledFinish: '2026-05-01' }),
          entrega({ nodeId: 'sin-fecha', scheduledFinish: null }),
        ],
      }),
    )
    expect(resultado.gates[0]?.evidence[0]?.nodeId).toBe('con-fecha')
  })

  it('la madurez casa aunque cambien mayúsculas y espacios', () => {
    const resultado = assessGateReadiness(
      entrada({
        expectations: [esperada({ maturity: 'as designed' })],
        planned: [entrega({ maturity: '  As Designed ' })],
      }),
    )
    const fila = resultado.gates[0]?.evidence[0]
    expect(fila?.state).toBe('a-tiempo')
    // Y la fila enseña el texto declarado, no el normalizado.
    expect(fila?.maturity).toBe('as designed')
  })

  it('las puertas salen por fecha, y las que no la tienen al final', () => {
    const resultado = assessGateReadiness(
      entrada({
        expectations: [
          esperada({ gate: 'SGR' }),
          esperada({ gate: 'IGR' }),
          esperada({ gate: 'PGR' }),
        ],
        planned: [entrega()],
        gates: [
          { gate: 'PGR', date: '2026-05-15' },
          { gate: 'IGR', date: '2026-02-10' },
        ],
      }),
    )
    expect(resultado.gates.map((puerta) => puerta.gate)).toEqual(['IGR', 'PGR', 'SGR'])
  })

  it('las puertas casan por nombre normalizado: «pgr » y «PGR» son la misma', () => {
    const resultado = assessGateReadiness(
      entrada({ gates: [{ gate: 'pgr ', date: '2026-05-15' }] }),
    )
    expect(resultado.gates[0]?.evidence[0]?.state).toBe('a-tiempo')
  })

  it('los totales cuentan cada estado una vez, y la suma son las esperadas', () => {
    const resultado = assessGateReadiness(
      entrada({
        expectations: [
          esperada(),
          esperada({ gate: 'CGR', maturity: null }),
          esperada({ gate: 'IGR', maturity: 'borrador' }),
        ],
        gates: [
          { gate: 'PGR', date: '2026-05-15' },
          { gate: 'CGR', date: '2026-04-01' },
          { gate: 'IGR', date: '2026-01-10' },
        ],
        planned: [entrega(), entrega({ nodeId: 'n2', maturity: null, name: 'FMECA' })],
      }),
    )
    const { esperadas, aTiempo, tarde, sinPartir, sinFecha, sinFechaDePuerta } = resultado.totals
    expect(esperadas).toBe(3)
    expect(aTiempo + tarde + sinPartir + sinFecha + sinFechaDePuerta).toBe(esperadas)
    expect(sinPartir).toBe(1)
    expect(tarde).toBe(1)
  })

  it('la misma entrada da exactamente la misma salida (P2)', () => {
    const entradaFija = entrada({
      expectations: [esperada(), esperada({ gate: 'CGR', maturity: null })],
      planned: [entrega(), entrega({ nodeId: 'n2', maturity: null })],
      gates: [
        { gate: 'CGR', date: '2026-09-30' },
        { gate: 'PGR', date: '2026-05-15' },
      ],
    })
    expect(assessGateReadiness(entradaFija)).toEqual(assessGateReadiness(entradaFija))
  })
})
