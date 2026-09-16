import { calendarDate } from '@planner/domain'
import { schedulePlan } from '@planner/scheduler'
import { describe, expect, it } from 'vitest'
import { PlanBuilder } from '../../scheduler/src/__fixtures__/plan.js'
import { proposeRebalance } from './rebalance.js'
import { computeWorkload } from './timephase.js'
import type { PlanSnapshot } from '@planner/scheduler'

const d = calendarDate

/** Propuestas para un plan, con el mismo camino que sigue la API. */
function propose(snapshot: PlanSnapshot, thresholdBp = 10_000) {
  const schedule = schedulePlan(snapshot)
  const { timephased, capacity } = computeWorkload(snapshot, schedule)
  return proposeRebalance(snapshot, timephased, capacity, { thresholdBp })
}

/**
 * Una persona con tres tareas solapadas y otra libre con las mismas
 * competencias. Es el caso que el reparto existe para resolver.
 */
function planSobrecargado(): PlanSnapshot {
  return new PlanBuilder()
    .resource('ana', { skills: [{ skillId: 'fmeca', level: 4 }] })
    .resource('sofia', { skills: [{ skillId: 'fmeca', level: 4 }] })
    .task('a', { durationMinutes: 4800 })
    .task('b', { durationMinutes: 4800 })
    .task('c', { durationMinutes: 4800 })
    .requireSkill('a', 'fmeca', 3, 'FMECA')
    .requireSkill('b', 'fmeca', 3, 'FMECA')
    .requireSkill('c', 'fmeca', 3, 'FMECA')
    .assign('a', 'ana')
    .assign('b', 'ana')
    .assign('c', 'ana')
    .build(d('2026-06-30'))
}

describe('propuesta de reparto', () => {
  it('propone mover trabajo de quien se pasa a quien tiene hueco y la competencia', () => {
    const { proposals } = propose(planSobrecargado())

    expect(proposals.length).toBeGreaterThan(0)
    const primera = proposals[0]
    expect(primera?.fromResourceId).toBe('ana')
    expect(primera?.toResourceId).toBe('sofia')
    // La propuesta se explica sola: quien la lee no tiene que deducir por qué.
    expect(primera?.reason).toContain('competencias')
    // Y dice qué arregla: quien suelta baja, quien recoge sube.
    expect(primera?.fromAfterBp).toBeLessThan(primera?.fromBeforeBp ?? 0)
    expect(primera?.toAfterBp).toBeGreaterThan(primera?.toBeforeBp ?? 0)
  })

  it('no propone a quien no tiene la competencia que la tarea pide', () => {
    const snapshot = new PlanBuilder()
      .resource('ana', { skills: [{ skillId: 'sil', level: 5 }] })
      .resource('novato', { skills: [] })
      .task('a', { durationMinutes: 4800 })
      .task('b', { durationMinutes: 4800 })
      .task('c', { durationMinutes: 4800 })
      .requireSkill('a', 'sil', 4, 'SIL')
      .requireSkill('b', 'sil', 4, 'SIL')
      .requireSkill('c', 'sil', 4, 'SIL')
      .assign('a', 'ana')
      .assign('b', 'ana')
      .assign('c', 'ana')
      .build(d('2026-06-30'))

    const { proposals, findings } = propose(snapshot)
    expect(proposals).toEqual([])
    // Y lo dice, en vez de callarse: el problema sigue ahí.
    expect(findings.map((finding) => finding.code)).toContain('REBALANCE_NO_CANDIDATE')
  })

  it('no propone a quien se quedaría sobrecargado: eso es mover el problema', () => {
    const snapshot = new PlanBuilder()
      .resource('ana', { skills: [{ skillId: 'ram', level: 4 }] })
      .resource('tambien-lleno', { skills: [{ skillId: 'ram', level: 4 }] })
      .task('a', { durationMinutes: 4800 })
      .task('b', { durationMinutes: 4800 })
      .task('c', { durationMinutes: 4800 })
      .task('d', { durationMinutes: 4800 })
      .task('e', { durationMinutes: 4800 })
      .task('f', { durationMinutes: 4800 })
      .requireSkill('a', 'ram', 3, 'RAM')
      .requireSkill('b', 'ram', 3, 'RAM')
      .requireSkill('c', 'ram', 3, 'RAM')
      .requireSkill('d', 'ram', 3, 'RAM')
      .requireSkill('e', 'ram', 3, 'RAM')
      .requireSkill('f', 'ram', 3, 'RAM')
      .assign('a', 'ana')
      .assign('b', 'ana')
      .assign('c', 'ana')
      .assign('d', 'tambien-lleno')
      .assign('e', 'tambien-lleno')
      .assign('f', 'tambien-lleno')
      .build(d('2026-06-30'))

    expect(propose(snapshot).proposals).toEqual([])
  })

  it('no toca a quien no está sobrecargado', () => {
    const snapshot = new PlanBuilder()
      .resource('ana', { skills: [{ skillId: 'plan', level: 4 }] })
      .resource('sofia', { skills: [{ skillId: 'plan', level: 4 }] })
      .task('a', { durationMinutes: 2400 })
      .requireSkill('a', 'plan', 3, 'Plan')
      .assign('a', 'ana')
      .build()

    expect(propose(snapshot).proposals).toEqual([])
  })

  it('es determinista: la misma entrada da la misma lista, en el mismo orden', () => {
    const snapshot = planSobrecargado()
    const primera = propose(snapshot).proposals
    const segunda = propose(snapshot).proposals
    expect(JSON.stringify(primera)).toBe(JSON.stringify(segunda))
  })

  it('el umbral manda: con el listón más bajo aparecen propuestas que antes no', () => {
    const snapshot = new PlanBuilder()
      .resource('ana', { skills: [{ skillId: 'vv', level: 4 }] })
      .resource('sofia', { skills: [{ skillId: 'vv', level: 4 }] })
      .task('a', { durationMinutes: 4800 })
      .task('b', { durationMinutes: 2400 })
      .requireSkill('a', 'vv', 3, 'V&V')
      .requireSkill('b', 'vv', 3, 'V&V')
      .assign('a', 'ana')
      .assign('b', 'ana')
      .build(d('2026-06-30'))

    // Al 100 % Ana no llega a pasarse; al 40 % sí.
    expect(propose(snapshot, 10_000).proposals).toEqual([])
    expect(propose(snapshot, 4_000).proposals.length).toBeGreaterThan(0)
  })
})
