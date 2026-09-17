import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  buildReport,
  type Highlight,
  type HighlightKind,
  type ReportCapacityCell,
  type ReportInput,
  type ReportProject,
  type ReportTask,
} from './report.js'
import type { CommitmentLevel } from '@planner/domain'

const PERIODO = { from: '2026-01-01', to: '2026-06-30' }

const tarea = (parcial: Partial<ReportTask> & { nodeId: string }): ReportTask => ({
  projectId: 'p1',
  kind: 'task',
  name: parcial.nodeId,
  path: parcial.nodeId,
  scheduledStart: '2026-02-01',
  scheduledFinish: '2026-02-28',
  workMinutes: 480,
  percentCompleteBp: 0,
  totalSlackMinutes: 0,
  isCritical: false,
  deadline: null,
  assignees: [],
  ...parcial,
})

/** Un proyecto del informe. Sin decir nada, `firme`: es lo que pone el esquema. */
const proyecto = (
  id: string,
  code: string,
  name: string,
  commitment: CommitmentLevel = 'firme',
): ReportProject => ({ id, code, name, commitment })

/**
 * Una celda de capacidad. El bruto por defecto es igual al neto, que es lo que
 * ve una instalación sin factores declarados.
 */
const capacidad = (
  resourceId: string,
  period: string,
  capacityMinutes: number,
  grossMinutes = capacityMinutes,
): ReportCapacityCell => ({ resourceId, period, capacityMinutes, grossMinutes })

const entrada = (parcial: Partial<ReportInput>): ReportInput => ({
  runId: 'run-1',
  period: PERIODO,
  asOf: '2026-03-15',
  projects: [proyecto('p1', 'UNO', 'Proyecto uno')],
  tasks: [],
  load: [],
  capacity: [],
  resources: [],
  findings: [],
  costsHidden: false,
  peopleHidden: false,
  ...parcial,
})

const punto = (informe: { tldr: readonly Highlight[] }, kind: HighlightKind): Highlight | undefined =>
  informe.tldr.find((h) => h.kind === kind)

describe('el informe', () => {
  it('sólo cuenta las tareas que solapan el periodo', () => {
    const informe = buildReport(
      entrada({
        tasks: [
          tarea({ nodeId: 'dentro' }),
          tarea({ nodeId: 'antes', scheduledStart: '2025-01-01', scheduledFinish: '2025-12-31' }),
          tarea({ nodeId: 'despues', scheduledStart: '2027-01-01', scheduledFinish: '2027-02-01' }),
          // Empieza antes y termina dentro: cuenta.
          tarea({ nodeId: 'a-caballo', scheduledStart: '2025-12-01', scheduledFinish: '2026-01-15' }),
        ],
      }),
    )

    expect(informe.totals.tasksInPeriod).toBe(2)
    expect(informe.totals.tasksTotal).toBe(4)
  })

  it('los bordes del periodo son inclusivos por los dos lados', () => {
    const informe = buildReport(
      entrada({
        tasks: [
          // Empieza el último día del periodo.
          tarea({ nodeId: 'ultimo', scheduledStart: '2026-06-30', scheduledFinish: '2026-07-15' }),
          // Y termina el primero.
          tarea({ nodeId: 'primero', scheduledStart: '2025-12-15', scheduledFinish: '2026-01-01' }),
        ],
      }),
    )

    expect(informe.totals.tasksInPeriod).toBe(2)
  })

  it('el avance se pondera por trabajo, no por número de tareas', () => {
    const informe = buildReport(
      entrada({
        tasks: [
          // Diez fichas de una hora, terminadas.
          ...Array.from({ length: 10 }, (_, i) =>
            tarea({ nodeId: `corta-${String(i)}`, workMinutes: 60, percentCompleteBp: 10_000 }),
          ),
          // Y una de mil horas, sin empezar.
          tarea({ nodeId: 'larga', workMinutes: 60_000, percentCompleteBp: 0 }),
        ],
      }),
    )

    // Contando tareas saldría un 91 %. Ponderando, un 1 %.
    expect(informe.totals.percentCompleteBp).toBe(99)
    expect(informe.totals.completedTasks).toBe(10)
  })

  it('una tarea sin fechas no entra en los totales del periodo, y se avisa', () => {
    const informe = buildReport(
      entrada({
        tasks: [tarea({ nodeId: 'con' }), tarea({ nodeId: 'sin', scheduledStart: null, scheduledFinish: null })],
      }),
    )

    expect(informe.totals.tasksInPeriod).toBe(1)
    expect(informe.totals.tasksWithoutDates).toBe(1)
    expect(punto(informe, 'sin-fechas')?.numbers['tasks']).toBe(1)
  })

  it('la saturación de una persona es la de su peor mes, no su media', () => {
    const informe = buildReport(
      entrada({
        resources: [{ id: 'r1', code: 'ANA', displayName: 'Ana' }],
        load: [
          { resourceId: 'r1', projectId: 'p1', period: '2026-05', plannedMinutes: 20_000, costCents: 0 },
          { resourceId: 'r1', projectId: 'p1', period: '2026-06', plannedMinutes: 2_000, costCents: 0 },
        ],
        capacity: [
          capacidad('r1', '2026-05', 10_000),
          capacidad('r1', '2026-06', 10_000),
        ],
      }),
    )

    const ana = informe.people[0]
    // De media va al 110 %, que no le pasa en ningún mes.
    expect(ana?.utilizationBp).toBe(11_000)
    expect(ana?.worst).toEqual({ period: '2026-05', utilizationBp: 20_000 })
    expect(informe.totals.overloadedPeople).toBe(1)
    expect(punto(informe, 'sobrecarga')?.labels).toEqual(['Ana', '2026-05'])
  })

  it('una fecha límite superada pesa más que un retraso, y se dice de cuánto', () => {
    const informe = buildReport(
      entrada({
        tasks: [
          tarea({
            nodeId: 'tarde',
            path: '002',
            scheduledFinish: '2026-02-20',
            percentCompleteBp: 5_000,
          }),
          tarea({
            nodeId: 'limite',
            path: '001',
            scheduledFinish: '2026-02-28',
            deadline: '2026-02-18',
          }),
        ],
      }),
    )

    expect(informe.risks.map((r) => r.kind)).toEqual(['fecha-limite', 'retraso'])
    expect(informe.risks[0]?.amount).toBe(10)
    // «Retraso» se mide contra hoy, no contra el límite.
    expect(informe.risks[1]?.amount).toBe(23)
    expect(punto(informe, 'riesgo')?.severity).toBe('error')
  })

  it('una tarea terminada no está retrasada aunque su fin quede atrás', () => {
    const informe = buildReport(
      entrada({
        tasks: [tarea({ nodeId: 'hecha', scheduledFinish: '2026-01-31', percentCompleteBp: 10_000 })],
      }),
    )

    expect(informe.risks).toEqual([])
  })

  it('sin permiso de costes el importe no sale en el resumen', () => {
    const celda = { resourceId: 'r1', projectId: 'p1', period: '2026-02', plannedMinutes: 480 }

    // Sin permiso el servidor ya manda los importes a cero; el informe lo dice.
    const oculto = buildReport(entrada({ load: [{ ...celda, costCents: 0 }], costsHidden: true }))
    expect(punto(oculto, 'coste')).toBeUndefined()
    expect(oculto.costsHidden).toBe(true)

    const visible = buildReport(entrada({ load: [{ ...celda, costCents: 120_000 }], costsHidden: false }))
    expect(punto(visible, 'coste')?.numbers['costCents']).toBe(120_000)
  })

  it('con varios proyectos, cada uno lleva su línea y el total los suma', () => {
    const informe = buildReport(
      entrada({
        projects: [
          proyecto('p2', 'DOS', 'Proyecto dos'),
          proyecto('p1', 'UNO', 'Proyecto uno'),
        ],
        tasks: [tarea({ nodeId: 'a', projectId: 'p1' }), tarea({ nodeId: 'b', projectId: 'p2' })],
        load: [
          { resourceId: 'r1', projectId: 'p1', period: '2026-02', plannedMinutes: 600, costCents: 100 },
          { resourceId: 'r1', projectId: 'p2', period: '2026-02', plannedMinutes: 400, costCents: 200 },
        ],
      }),
    )

    // Ordenados por código, para que dos informes iguales salgan iguales.
    expect(informe.projects.map((p) => p.code)).toEqual(['DOS', 'UNO'])
    expect(informe.projects.find((p) => p.code === 'UNO')?.plannedMinutes).toBe(600)
    expect(informe.totals.plannedMinutes).toBe(1_000)
    expect(informe.totals.costCents).toBe(300)
    expect(punto(informe, 'alcance')?.numbers['projects']).toBe(2)
  })

  it('lo que no está en el alcance no cuenta, ni siquiera sus hallazgos', () => {
    const informe = buildReport(
      entrada({
        projects: [proyecto('p1', 'UNO', 'Proyecto uno')],
        tasks: [tarea({ nodeId: 'mia' }), tarea({ nodeId: 'ajena', projectId: 'p9' })],
        load: [
          { resourceId: 'r1', projectId: 'p9', period: '2026-02', plannedMinutes: 9_999, costCents: 0 },
        ],
        findings: [
          { severity: 'blocking', code: 'X', projectId: 'p9', entityName: null, message: 'ajeno', occursOn: null },
          // Un hallazgo sin proyecto es del cálculo entero: ese sí cuenta.
          { severity: 'warning', code: 'Y', projectId: null, entityName: null, message: 'global', occursOn: null },
        ],
      }),
    )

    expect(informe.totals.tasksTotal).toBe(1)
    expect(informe.totals.plannedMinutes).toBe(0)
    expect(informe.totals.blockingFindings).toBe(0)
    expect(informe.totals.warningFindings).toBe(1)
  })

  it('un informe vacío no miente: ceros y nada más', () => {
    const informe = buildReport(entrada({}))
    expect(informe.totals.plannedMinutes).toBe(0)
    expect(informe.totals.utilizationBp).toBeNull()
    expect(informe.totals.percentCompleteBp).toBe(0)
    expect(informe.risks).toEqual([])
    expect(informe.tldr.map((h) => h.kind)).toEqual(['alcance'])
  })

  it('el mismo cálculo y el mismo periodo dan el mismo informe', () => {
    const base = entrada({
      tasks: [tarea({ nodeId: 'a' }), tarea({ nodeId: 'b' })],
      resources: [
        { id: 'r1', code: 'ANA', displayName: 'Ana' },
        { id: 'r2', code: 'BEA', displayName: 'Bea' },
      ],
      load: [
        { resourceId: 'r1', projectId: 'p1', period: '2026-02', plannedMinutes: 600, costCents: 10 },
        { resourceId: 'r2', projectId: 'p1', period: '2026-02', plannedMinutes: 600, costCents: 10 },
      ],
    })
    const barajado = entrada({
      ...base,
      tasks: [...base.tasks].reverse(),
      resources: [...base.resources].reverse(),
      load: [...base.load].reverse(),
    })

    expect(buildReport(barajado)).toEqual(buildReport(base))
  })

  it('los totales por mes suman siempre el total del periodo', () => {
    const celda = fc.record({
      resourceId: fc.constantFrom('r1', 'r2'),
      projectId: fc.constant('p1'),
      period: fc.constantFrom('2026-01', '2026-02', '2026-03'),
      plannedMinutes: fc.integer({ min: 0, max: 100_000 }),
      costCents: fc.integer({ min: 0, max: 1_000_000 }),
    })

    fc.assert(
      fc.property(fc.array(celda, { maxLength: 30 }), (load) => {
        const informe = buildReport(entrada({ load }))
        const porMeses = informe.months.reduce((total, mes) => total + mes.plannedMinutes, 0)
        const costePorMeses = informe.months.reduce((total, mes) => total + mes.costCents, 0)
        expect(porMeses).toBe(informe.totals.plannedMinutes)
        expect(costePorMeses).toBe(informe.totals.costCents)
      }),
    )
  })
})

describe('lo que el informe no puede enseñar', () => {
  it('sin el reparto por persona, no dice cero: no dice nada', () => {
    const base = {
      resources: [{ id: 'r1', code: 'ANA', displayName: 'Ana' }],
      load: [{ resourceId: 'r1', projectId: 'p1', period: '2026-05', plannedMinutes: 20_000, costCents: 0 }],
      capacity: [capacidad('r1', '2026-05', 10_000)],
    }
    const visible = buildReport(entrada(base))
    expect(visible.totals.overloadedPeople).toBe(1)

    const oculto = buildReport(entrada({ ...base, peopleHidden: true }))
    expect(oculto.people).toEqual([])
    expect(oculto.peopleHidden).toBe(true)
    expect(punto(oculto, 'sobrecarga')).toBeUndefined()
    expect(oculto.totals.overloadedPeople).toBe(0)
    // Pero el total de horas del periodo sí sigue: es del plan, no de nadie.
    expect(oculto.totals.plannedMinutes).toBe(20_000)
  })
})

describe('la capacidad contra la que se compara', () => {
  it('es la de quien trabaja en estos proyectos, no la del equipo entero', () => {
    const informe = buildReport(
      entrada({
        resources: [
          { id: 'r1', code: 'ANA', displayName: 'Ana' },
          { id: 'r2', code: 'BEA', displayName: 'Bea' },
        ],
        load: [
          { resourceId: 'r1', projectId: 'p1', period: '2026-02', plannedMinutes: 5_000, costCents: 0 },
        ],
        capacity: [
          capacidad('r1', '2026-02', 10_000),
          // Bea no toca este proyecto: su capacidad no entra en la cuenta.
          capacidad('r2', '2026-02', 90_000),
        ],
      }),
    )

    expect(informe.totals.capacityMinutes).toBe(10_000)
    // Con el equipo entero saldría un 5 %, que es cierto y no dice nada.
    expect(informe.totals.utilizationBp).toBe(5_000)
    expect(informe.people.map((p) => p.displayName)).toEqual(['Ana'])
  })
})

describe('los casos que no se ven hasta que pasan', () => {
  it('con dos personas pasadas, el resumen cita a la peor', () => {
    const informe = buildReport(
      entrada({
        resources: [
          { id: 'r1', code: 'ANA', displayName: 'Ana' },
          { id: 'r2', code: 'BEA', displayName: 'Bea' },
        ],
        load: [
          { resourceId: 'r1', projectId: 'p1', period: '2026-02', plannedMinutes: 11_000, costCents: 0 },
          { resourceId: 'r2', projectId: 'p1', period: '2026-02', plannedMinutes: 12_000, costCents: 0 },
        ],
        capacity: [
          capacidad('r1', '2026-02', 10_000),
          capacidad('r2', '2026-02', 10_000),
        ],
      }),
    )

    expect(informe.totals.overloadedPeople).toBe(2)
    expect(punto(informe, 'sobrecarga')?.labels[0]).toBe('Bea')
    // 120 % pasa del 100 pero no es para ponerse rojo.
    expect(punto(informe, 'sobrecarga')?.severity).toBe('warning')
  })

  it('el peor mes puede ser el último, no sólo el primero', () => {
    const informe = buildReport(
      entrada({
        resources: [{ id: 'r1', code: 'ANA', displayName: 'Ana' }],
        load: [
          { resourceId: 'r1', projectId: 'p1', period: '2026-02', plannedMinutes: 2_000, costCents: 0 },
          { resourceId: 'r1', projectId: 'p1', period: '2026-03', plannedMinutes: 15_000, costCents: 0 },
        ],
        capacity: [
          capacidad('r1', '2026-02', 10_000),
          capacidad('r1', '2026-03', 10_000),
        ],
      }),
    )

    expect(informe.people[0]?.worst).toEqual({ period: '2026-03', utilizationBp: 15_000 })
  })

  it('a igual trabajo, las personas salen por nombre', () => {
    const informe = buildReport(
      entrada({
        resources: [
          { id: 'r2', code: 'ZOE', displayName: 'Zoe' },
          { id: 'r1', code: 'ANA', displayName: 'Ana' },
        ],
        load: [
          { resourceId: 'r2', projectId: 'p1', period: '2026-02', plannedMinutes: 600, costCents: 0 },
          { resourceId: 'r1', projectId: 'p1', period: '2026-02', plannedMinutes: 600, costCents: 0 },
        ],
      }),
    )

    expect(informe.people.map((p) => p.displayName)).toEqual(['Ana', 'Zoe'])
  })

  it('un mes con trabajo y sin capacidad no inventa una saturación', () => {
    const informe = buildReport(
      entrada({
        resources: [{ id: 'r1', code: 'ANA', displayName: 'Ana' }],
        load: [
          { resourceId: 'r1', projectId: 'p1', period: '2026-02', plannedMinutes: 600, costCents: 50 },
          { resourceId: 'r1', projectId: 'p1', period: '2026-03', plannedMinutes: 600, costCents: 50 },
        ],
        // Marzo sin capacidad: de baja, o fuera del equipo ese mes.
        capacity: [capacidad('r1', '2026-02', 10_000)],
      }),
    )

    expect(informe.months.map((mes) => mes.utilizationBp)).toEqual([600, null])
    expect(informe.people[0]?.worst).toEqual({ period: '2026-02', utilizationBp: 600 })
  })

  it('un mes con capacidad y sin trabajo sale a cero, no desaparece', () => {
    const informe = buildReport(
      entrada({
        resources: [{ id: 'r1', code: 'ANA', displayName: 'Ana' }],
        load: [
          { resourceId: 'r1', projectId: 'p1', period: '2026-02', plannedMinutes: 600, costCents: 50 },
        ],
        capacity: [
          capacidad('r1', '2026-02', 10_000),
          capacidad('r1', '2026-03', 10_000),
        ],
      }),
    )

    const marzo = informe.months.find((mes) => mes.period === '2026-03')
    expect(marzo).toEqual({
      period: '2026-03',
      plannedMinutes: 0,
      capacityMinutes: 10_000,
      utilizationBp: 0,
      costCents: 0,
    })
  })

  it('la holgura negativa es un riesgo por sí sola, aunque no haya fecha límite', () => {
    const informe = buildReport(
      entrada({
        tasks: [
          tarea({ nodeId: 'apretada', totalSlackMinutes: -960 }),
          // Y ésta llega tarde, pero la holgura pesa más.
          tarea({ nodeId: 'tarde', path: '999', scheduledFinish: '2026-02-01' }),
        ],
      }),
    )

    expect(informe.risks.map((r) => r.kind)).toEqual(['holgura-negativa', 'retraso'])
    expect(informe.risks[0]?.amount).toBe(960)
  })

  it('un hallazgo bloqueante pinta el resumen de rojo; uno de error, de amarillo', () => {
    const hallazgo = (severity: string): {
      severity: string
      code: string
      projectId: string | null
      entityName: string | null
      message: string
      occursOn: string | null
    } => ({ severity, code: 'X', projectId: 'p1', entityName: null, message: 'algo', occursOn: null })

    const bloqueante = buildReport(entrada({ findings: [hallazgo('blocking')] }))
    expect(punto(bloqueante, 'hallazgos')?.severity).toBe('error')
    expect(bloqueante.projects[0]?.blockingFindings).toBe(1)

    const error = buildReport(entrada({ findings: [hallazgo('error')] }))
    expect(punto(error, 'hallazgos')?.severity).toBe('warning')
    expect(error.projects[0]?.blockingFindings).toBe(0)
  })

  it('una tarea sin trabajo declarado no cuenta para el avance', () => {
    const informe = buildReport(
      entrada({
        tasks: [
          tarea({ nodeId: 'sin-horas', workMinutes: null, percentCompleteBp: 0 }),
          tarea({ nodeId: 'cero-horas', workMinutes: 0, percentCompleteBp: 0 }),
          tarea({ nodeId: 'con-horas', workMinutes: 600, percentCompleteBp: 10_000 }),
        ],
      }),
    )

    // Si contaran, el avance saldría a un tercio en vez de entero.
    expect(informe.totals.percentCompleteBp).toBe(10_000)
    expect(informe.totals.tasksInPeriod).toBe(3)
  })

  // --- Compromiso ----------------------------------------------------------

  it('reparte el trabajo del periodo por lo comprometido que está', () => {
    const informe = buildReport(
      entrada({
        projects: [
          proyecto('p1', 'UNO', 'Contratado'),
          proyecto('p2', 'DOS', 'Esperado', 'probable'),
          proyecto('p3', 'TRES', 'Una oferta', 'posible'),
        ],
        load: [
          { resourceId: 'r1', projectId: 'p1', period: '2026-02', plannedMinutes: 600, costCents: 0 },
          { resourceId: 'r1', projectId: 'p2', period: '2026-02', plannedMinutes: 300, costCents: 0 },
          { resourceId: 'r1', projectId: 'p3', period: '2026-02', plannedMinutes: 100, costCents: 0 },
        ],
      }),
    )

    expect(informe.totals.plannedByCommitment).toEqual({ firme: 600, probable: 300, posible: 100 })
    // Y sigue sumando el total: repartir no puede perder ni inventar minutos.
    expect(informe.totals.plannedMinutes).toBe(1_000)
  })

  it('no dice nada del compromiso cuando todo está contratado', () => {
    // Una línea de «el 100 % es firme» en todos los informes es ruido, y el
    // resumen está para lo que hay que mirar.
    const informe = buildReport(
      entrada({
        load: [{ resourceId: 'r1', projectId: 'p1', period: '2026-02', plannedMinutes: 600, costCents: 0 }],
      }),
    )
    expect(punto(informe, 'compromiso')).toBeUndefined()
    expect(informe.totals.plannedByCommitment).toEqual({ firme: 600, probable: 0, posible: 0 })
  })

  it('pasa a rojo cuando más de la mitad del trabajo todavía no está firmado', () => {
    const conReparto = (firme: number, posible: number) =>
      buildReport(
        entrada({
          projects: [proyecto('p1', 'UNO', 'Contratado'), proyecto('p2', 'DOS', 'Oferta', 'posible')],
          load: [
            { resourceId: 'r1', projectId: 'p1', period: '2026-02', plannedMinutes: firme, costCents: 0 },
            { resourceId: 'r1', projectId: 'p2', period: '2026-02', plannedMinutes: posible, costCents: 0 },
          ],
        }),
      )

    expect(punto(conReparto(900, 100), 'compromiso')?.severity).toBe('warning')
    // Justo la mitad todavía no es «más de la mitad».
    expect(punto(conReparto(500, 500), 'compromiso')?.severity).toBe('warning')
    expect(punto(conReparto(400, 600), 'compromiso')?.severity).toBe('error')
    expect(punto(conReparto(400, 600), 'compromiso')?.numbers['notFirmBp']).toBe(6_000)
  })

  // --- Capacidad reservada --------------------------------------------------

  it('dice cuánta capacidad hay que el equipo no puede comprometer', () => {
    const informe = buildReport(
      entrada({
        load: [{ resourceId: 'r1', projectId: 'p1', period: '2026-02', plannedMinutes: 600, costCents: 0 }],
        capacity: [capacidad('r1', '2026-02', 9_300, 10_000)],
      }),
    )

    const reservada = punto(informe, 'capacidad-reservada')
    expect(reservada?.numbers).toEqual({
      grossMinutes: 10_000,
      plannableMinutes: 9_300,
      reservedMinutes: 700,
      reservedBp: 700,
    })
    // Y la saturación se mide contra lo planificable, que es lo que hay.
    expect(informe.totals.capacityMinutes).toBe(9_300)
    expect(informe.totals.grossCapacityMinutes).toBe(10_000)
  })

  it('no dice nada de la reserva cuando no hay factores declarados', () => {
    const informe = buildReport(
      entrada({
        load: [{ resourceId: 'r1', projectId: 'p1', period: '2026-02', plannedMinutes: 600, costCents: 0 }],
        capacity: [capacidad('r1', '2026-02', 10_000)],
      }),
    )
    expect(punto(informe, 'capacidad-reservada')).toBeUndefined()
    expect(informe.totals.grossCapacityMinutes).toBe(informe.totals.capacityMinutes)
  })
})
