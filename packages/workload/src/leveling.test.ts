import { schedulePlan } from '@planner/scheduler'
import { describe, expect, it } from 'vitest'
import { PlanBuilder } from '../../scheduler/src/__fixtures__/plan.js'
import { levelPlan } from './leveling.js'
import { computeWorkload } from './timephase.js'

describe('nivelación', () => {
  it('resuelve una sobrecarga retrasando la tarea con más holgura', () => {
    // Ana tiene dos tareas de una semana a la vez: 200 % durante cinco días.
    const snapshot = new PlanBuilder()
      .resource('ana')
      .task('urgente', { durationMinutes: 2400 })
      .task('puede-esperar', { durationMinutes: 2400 })
      .task('cierre')
      .link('urgente', 'cierre')
      .assign('urgente', 'ana')
      .assign('puede-esperar', 'ana')
      .build()

    const before = computeWorkload(snapshot, schedulePlan(snapshot))
    expect(before.findings.some((finding) => finding.code === 'RESOURCE_OVERALLOCATED')).toBe(true)

    const leveled = levelPlan(snapshot)
    expect(leveled.converged).toBe(true)
    expect(leveled.workload.findings.some((finding) => finding.code === 'RESOURCE_OVERALLOCATED')).toBe(false)
    // Se retrasa la que no está en la cadena hacia «cierre».
    expect(leveled.delays.get('puede-esperar')).toBeGreaterThan(0)
    expect(leveled.delays.get('urgente') ?? 0).toBe(0)
    expect(leveled.findings.some((finding) => finding.code === 'LEVELING_DELAYED')).toBe(true)
  })

  it('no toca el trabajo total: sólo lo mueve en el tiempo', () => {
    const snapshot = new PlanBuilder()
      .resource('ana')
      .task('a', { durationMinutes: 2400 })
      .task('b', { durationMinutes: 2400 })
      .assign('a', 'ana')
      .assign('b', 'ana')
      .build()

    const sinNivelar = computeWorkload(snapshot, schedulePlan(snapshot))
    const nivelado = levelPlan(snapshot)
    const total = (cells: readonly { plannedMinutes: number }[]): number =>
      cells.reduce((sum, cell) => sum + cell.plannedMinutes, 0)

    expect(total(nivelado.workload.timephased)).toBe(total(sinNivelar.timephased))
  })

  it('es reproducible: dos ejecuciones dan exactamente el mismo plan', () => {
    const snapshot = new PlanBuilder()
      .resource('ana')
      .task('a', { durationMinutes: 1440 })
      .task('b', { durationMinutes: 1440 })
      .task('c', { durationMinutes: 1440 })
      .assign('a', 'ana')
      .assign('b', 'ana')
      .assign('c', 'ana')
      .build()

    const first = levelPlan(snapshot)
    const second = levelPlan(snapshot)
    expect([...first.delays.entries()].sort()).toEqual([...second.delays.entries()].sort())
    expect(JSON.stringify(first.schedule.taskResults)).toBe(JSON.stringify(second.schedule.taskResults))
  })

  it('se rinde si una tarea agotaría el retraso máximo', () => {
    const snapshot = new PlanBuilder()
      .resource('ana')
      .task('a', { durationMinutes: 2400 })
      .task('b', { durationMinutes: 2400 })
      .assign('a', 'ana')
      .assign('b', 'ana')
      .build()
    const leveled = levelPlan(snapshot, { maxDelayMinutes: 60 })
    expect(leveled.converged).toBe(false)
    expect(leveled.findings.some((finding) => finding.message.includes('retraso máximo'))).toBe(true)
  })

  it('respeta las restricciones duras y avisa en vez de romperlas', () => {
    const snapshot = new PlanBuilder()
      .resource('ana')
      .task('fija-a', {
        durationMinutes: 2400,
        constraintKind: 'must_start_on',
        constraintDate: '2026-03-02' as never,
      })
      .task('fija-b', {
        durationMinutes: 2400,
        constraintKind: 'must_start_on',
        constraintDate: '2026-03-02' as never,
      })
      .assign('fija-a', 'ana')
      .assign('fija-b', 'ana')
      .build()

    const leveled = levelPlan(snapshot)
    expect(leveled.converged).toBe(false)
    const finding = leveled.findings.find((item) => item.code === 'LEVELING_IMPOSSIBLE')
    expect(finding?.severity).toBe('error')
    expect(finding?.message).toContain('restricción dura')
  })

  it('un plan que ya cabe no se toca', () => {
    const snapshot = new PlanBuilder()
      .resource('ana')
      .task('a', { durationMinutes: 2400 })
      .assign('a', 'ana')
      .build()
    const leveled = levelPlan(snapshot)
    expect(leveled.iterations).toBe(0)
    expect(leveled.delays.size).toBe(0)
    expect(leveled.converged).toBe(true)
  })

  it('se rinde con un mensaje claro si no converge en el tope de iteraciones', () => {
    const snapshot = new PlanBuilder()
      .resource('ana')
      .task('a', { durationMinutes: 4800 })
      .task('b', { durationMinutes: 4800 })
      .task('c', { durationMinutes: 4800 })
      .assign('a', 'ana')
      .assign('b', 'ana')
      .assign('c', 'ana')
      .build()
    const leveled = levelPlan(snapshot, { maxIterations: 1 })
    expect(leveled.converged).toBe(false)
    expect(leveled.findings.some((finding) => finding.message.includes('iteraciones'))).toBe(true)
  })
})
