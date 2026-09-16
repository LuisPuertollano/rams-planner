import { calendarDate } from '@planner/domain'
import { schedulePlan } from '@planner/scheduler'
import { describe, expect, it } from 'vitest'
import { PlanBuilder } from '../../scheduler/src/__fixtures__/plan.js'
import { aggregateLoad, aggregateUtilization, periodOf } from './aggregate.js'
import { contourWeights } from './contours.js'
import { computeWorkload } from './timephase.js'
import type { PlanSnapshot } from '@planner/scheduler'

const d = calendarDate

const runWorkload = (snapshot: PlanSnapshot) => computeWorkload(snapshot, schedulePlan(snapshot))

const minutesOn = (cells: readonly { date: string; plannedMinutes: number }[], date: string): number =>
  cells.filter((cell) => cell.date === date).reduce((sum, cell) => sum + cell.plannedMinutes, 0)

describe('reparto diario', () => {
  it('reparte el trabajo de una tarea de una semana en sus cinco días', () => {
    const snapshot = new PlanBuilder()
      .resource('ana')
      .task('a', { durationMinutes: 2400 })
      .assign('a', 'ana')
      .build()
    const { timephased } = runWorkload(snapshot)

    expect(timephased).toHaveLength(5)
    expect(timephased.map((cell) => cell.plannedMinutes)).toEqual([480, 480, 480, 480, 480])
    expect(timephased[0]?.date).toBe('2026-03-02')
    expect(timephased[4]?.date).toBe('2026-03-06')
  })

  it('no reparte nada en fin de semana', () => {
    const snapshot = new PlanBuilder().resource('ana').task('a', { durationMinutes: 4800 }).assign('a', 'ana').build()
    const { timephased } = runWorkload(snapshot)
    expect(minutesOn(timephased, '2026-03-07')).toBe(0)
    expect(minutesOn(timephased, '2026-03-08')).toBe(0)
  })

  it('la suma del reparto es exactamente el trabajo, aunque no divida', () => {
    const snapshot = new PlanBuilder()
      .resource('ana')
      .task('a', { taskType: 'fixed_work', workDeclaredMinutes: 1000, durationMinutes: 1000 })
      .assign('a', 'ana')
      .build()
    const { timephased } = runWorkload(snapshot)
    expect(timephased.reduce((sum, cell) => sum + cell.plannedMinutes, 0)).toBe(1000)
  })

  it('media dedicación reparte la mitad del trabajo', () => {
    const snapshot = new PlanBuilder()
      .resource('ana')
      .task('a', { durationMinutes: 960 })
      .assign('a', 'ana', { unitsBp: 5_000 })
      .build()
    const { timephased } = runWorkload(snapshot)
    expect(timephased.reduce((sum, cell) => sum + cell.plannedMinutes, 0)).toBe(480)
  })

  it('dos recursos con calendarios distintos reparten según el suyo', () => {
    const snapshot = new PlanBuilder()
      .resource('ana')
      .resource('marc', { calendarId: 'cal-35h' })
      .task('a', { durationMinutes: 960 })
      .assign('a', 'ana')
      .assign('a', 'marc')
      .build()
    const { timephased } = runWorkload(snapshot)
    const ana = timephased.filter((cell) => cell.resourceId === 'ana')
    const marc = timephased.filter((cell) => cell.resourceId === 'marc')
    expect(ana.reduce((sum, cell) => sum + cell.plannedMinutes, 0)).toBe(960)
    expect(marc.reduce((sum, cell) => sum + cell.plannedMinutes, 0)).toBe(960)
    // Ambos reciben el mismo trabajo, pero Marc sólo tiene 420 minutos al día:
    // el mismo plan lo satura a él y a Ana no. Esto es exactamente lo que la
    // herramienta existe para enseñar.
    const { findings } = runWorkload(snapshot)
    const saturados = findings
      .filter((finding) => finding.code === 'RESOURCE_OVERALLOCATED')
      .map((finding) => finding.entityId)
    expect(saturados).toEqual(['marc'])
  })

  it('calcula el coste con la tarifa vigente', () => {
    const snapshot = new PlanBuilder()
      .resource('ana', { costRates: [{ from: d('2026-01-01'), to: d('2026-12-31'), standardCentsPerHour: 6_000 }] })
      .task('a', { durationMinutes: 480 })
      .assign('a', 'ana')
      .build()
    const { timephased } = runWorkload(snapshot)
    // 8 horas a 60 €/h = 480 €
    expect(timephased[0]?.costCents).toBe(48_000)
  })
})

describe('capacidad', () => {
  it('descuenta la disponibilidad parcial', () => {
    const snapshot = new PlanBuilder()
      .resource('ana', { availability: [{ from: d('2026-01-01'), to: d('2026-12-31'), unitsBp: 5_000 }] })
      .task('a')
      .assign('a', 'ana')
      .build()
    const { capacity } = runWorkload(snapshot)
    expect(capacity.capacityOf('ana', d('2026-03-02'))).toBe(240)
  })

  it('descuenta las ausencias, sin bajar de cero', () => {
    const snapshot = new PlanBuilder()
      .resource('ana', {
        absences: [
          { from: d('2026-03-02'), to: d('2026-03-03'), kind: 'vacation' },
          { from: d('2026-03-04'), to: d('2026-03-04'), kind: 'training', minutesPerDay: 240 },
        ],
      })
      .task('a')
      .assign('a', 'ana')
      .build()
    const { capacity } = runWorkload(snapshot)
    expect(capacity.capacityOf('ana', d('2026-03-02'))).toBe(0)
    expect(capacity.capacityOf('ana', d('2026-03-04'))).toBe(240)
    expect(capacity.capacityOf('ana', d('2026-03-05'))).toBe(480)
  })

  it('un día no laborable no tiene capacidad', () => {
    const snapshot = new PlanBuilder().resource('ana').task('a').assign('a', 'ana').build()
    const { capacity } = runWorkload(snapshot)
    expect(capacity.capacityOf('ana', d('2026-03-07'))).toBe(0)
  })
})

describe('saturación', () => {
  it('avisa una vez por recurso y mes, con el pico y los días afectados', () => {
    const snapshot = new PlanBuilder()
      .resource('ana')
      .task('a', { durationMinutes: 2400 })
      .task('b', { durationMinutes: 2400 })
      .assign('a', 'ana')
      .assign('b', 'ana')
      .build()
    const { findings } = runWorkload(snapshot)
    const overallocated = findings.filter((finding) => finding.code === 'RESOURCE_OVERALLOCATED')
    expect(overallocated).toHaveLength(1)
    expect(overallocated[0]?.payload?.['days']).toBe(5)
    expect(overallocated[0]?.payload?.['peakUtilizationBp']).toBe(20_000)
  })

  it('no avisa cuando la carga cabe', () => {
    const snapshot = new PlanBuilder().resource('ana').task('a', { durationMinutes: 2400 }).assign('a', 'ana').build()
    expect(runWorkload(snapshot).findings.filter((f) => f.code === 'RESOURCE_OVERALLOCATED')).toHaveLength(0)
  })

  it('avisa cuando el recurso no tiene ningún día laborable en la tarea', () => {
    const snapshot = new PlanBuilder()
      .resource('ana', { absences: [] })
      .task('a', { constraintKind: 'must_start_on', constraintDate: d('2026-03-07'), durationMinutes: 0, isMilestone: true })
      .assign('a', 'ana')
      .build()
    const findings = runWorkload(snapshot).findings
    expect(findings.some((f) => f.code === 'RESOURCE_NO_CAPACITY' || f.code === 'RESOURCE_OVERALLOCATED')).toBe(false)
  })
})

describe('contornos', () => {
  it('el plano reparte por igual', () => {
    expect(contourWeights('flat', 4)).toEqual([1, 1, 1, 1])
  })

  it('el frontal carga al principio y el posterior al final', () => {
    const front = contourWeights('front_loaded', 5)
    const back = contourWeights('back_loaded', 5)
    expect(front[0]).toBeGreaterThan(front[4] ?? 0)
    expect(back[4]).toBeGreaterThan(back[0] ?? 0)
  })

  it('la campana es simétrica y el trapecio es plano en el centro', () => {
    const bell = contourWeights('bell', 5)
    expect(bell[1]).toBeCloseTo(bell[3] ?? 0, 10)
    expect(contourWeights('turtle', 11)[5]).toBe(1)
  })

  it('un solo día recibe todo el peso, y cero días ninguno', () => {
    expect(contourWeights('bell', 1)).toEqual([1])
    expect(contourWeights('flat', 0)).toEqual([])
  })

  it('el contorno frontal reparte más trabajo el primer día que el último', () => {
    const snapshot = new PlanBuilder()
      .resource('ana')
      .task('a', { durationMinutes: 2400 })
      .assign('a', 'ana', { contour: 'front_loaded' })
      .build()
    const { timephased } = runWorkload(snapshot)
    expect(timephased[0]?.plannedMinutes).toBeGreaterThan(timephased[4]?.plannedMinutes ?? 0)
    expect(timephased.reduce((sum, cell) => sum + cell.plannedMinutes, 0)).toBe(2400)
  })

  it('el reparto manual se respeta y se avisa si no cuadra', () => {
    const snapshot = new PlanBuilder()
      .resource('ana')
      .task('a', { durationMinutes: 960 })
      .assign('a', 'ana', {
        contour: 'manual',
        manualContour: [
          { date: d('2026-03-02'), minutes: 100 },
          { date: d('2026-03-03'), minutes: 200 },
        ],
      })
      .build()
    const { timephased, findings } = runWorkload(snapshot)
    expect(timephased.map((cell) => cell.plannedMinutes)).toEqual([100, 200])
    expect(findings.some((finding) => finding.code === 'CONTOUR_MISMATCH')).toBe(true)
  })
})

describe('agregaciones', () => {
  it('agrupa por mes, y el total coincide con el diario', () => {
    const snapshot = new PlanBuilder()
      .resource('ana')
      .task('a', { durationMinutes: 19_200 })
      .assign('a', 'ana')
      .build()
    const { timephased } = runWorkload(snapshot)
    const monthly = aggregateLoad(timephased, 'month')
    const totalDaily = timephased.reduce((sum, cell) => sum + cell.plannedMinutes, 0)
    const totalMonthly = monthly.reduce((sum, row) => sum + row.plannedMinutes, 0)
    expect(totalMonthly).toBe(totalDaily)
    expect(monthly.length).toBeGreaterThan(1)
  })

  it('calcula la utilización por mes', () => {
    const snapshot = new PlanBuilder()
      .resource('ana')
      .task('a', { durationMinutes: 2400 })
      .assign('a', 'ana')
      .build()
    const { timephased, capacity } = runWorkload(snapshot)
    const rows = aggregateUtilization(timephased, capacity, 'month')
    const march = rows.find((row) => row.period === '2026-03')
    expect(march?.plannedMinutes).toBe(2400)
    expect(march?.capacityMinutes).toBe(22 * 480) // 22 días laborables en marzo de 2026
    expect(march?.utilizationBp).toBe(Math.round((2400 * 10_000) / (22 * 480)))
  })

  it('etiqueta correctamente los periodos', () => {
    expect(periodOf(d('2026-03-16'), 'day')).toBe('2026-03-16')
    expect(periodOf(d('2026-03-16'), 'month')).toBe('2026-03')
    expect(periodOf(d('2026-03-16'), 'quarter')).toBe('2026-T1')
    expect(periodOf(d('2026-11-16'), 'quarter')).toBe('2026-T4')
    expect(periodOf(d('2026-03-16'), 'week')).toBe('2026-S12')
    expect(periodOf(d('2027-01-01'), 'week')).toBe('2026-S53')
    expect(periodOf(d('2026-01-01'), 'week')).toBe('2026-S01')
  })
})
