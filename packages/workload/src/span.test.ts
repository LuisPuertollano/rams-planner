/**
 * La curva de carga de una tarea que dura una fase.
 *
 * Es el motivo por el que existe la tarea continua, y por eso la prueba está
 * aquí y no sólo en el motor: lo que estaba mal no eran las fechas de la
 * gestión de un proyecto, era **la curva**. 300 h de gestión declaradas como
 * tarea normal salían como un bloque de dos meses a jornada completa seguido de
 * siete meses a cero, y esa curva es la que alguien mira para decidir si
 * contrata. Repartidas por la fase, salen como lo que son: un goteo.
 */

import { calendarDate } from '@planner/domain'
import { schedulePlan } from '@planner/scheduler'
import { describe, expect, it } from 'vitest'
import { PlanBuilder } from '../../scheduler/src/__fixtures__/plan.js'
import { levelPlan } from './leveling.js'
import { computeWorkload } from './timephase.js'

const d = calendarDate

/** 300 h de gestión entre el arranque y IQA, que son siete meses. */
const gestion = (): ReturnType<PlanBuilder['build']> =>
  new PlanBuilder()
    .project({
      id: 'p2',
      statusStart: d('2026-03-02'),
      gates: { IQA: d('2026-09-30') },
    })
    .resource('ana')
    .task('gestion', {
      projectId: 'p2',
      taskType: 'fixed_work',
      workDeclaredMinutes: 60 * 300,
      spanFrom: 'arranque',
      spanTo: 'IQA',
    })
    .assign('gestion', 'ana')
    .build(d('2027-12-31'))

describe('la carga de una tarea que dura una fase', () => {
  it('el trabajo se reparte por toda la fase, no se apila al principio', () => {
    const snapshot = gestion()
    const { timephased } = computeWorkload(snapshot, schedulePlan(snapshot))

    const dias = timephased.filter((cell) => cell.plannedMinutes > 0)
    expect(dias.length).toBeGreaterThan(140)

    // Ni un solo día a jornada completa: 300 h en siete meses son unos 80 min
    // al día. Eso es exactamente lo que hay que poder ver.
    const mayor = Math.max(...dias.map((cell) => cell.plannedMinutes))
    expect(mayor).toBeLessThan(120)

    // Y el último mes de la fase tiene carga, que es lo que no pasaba antes.
    expect(timephased.some((cell) => cell.date >= '2026-09-01' && cell.plannedMinutes > 0)).toBe(true)
  })

  it('el reparto suma exactamente el trabajo declarado (P5)', () => {
    const snapshot = gestion()
    const { timephased } = computeWorkload(snapshot, schedulePlan(snapshot))
    const total = timephased.reduce((suma, cell) => suma + cell.plannedMinutes, 0)
    expect(total).toBe(60 * 300)
  })

  it('nivelar no la mueve: su ventana la ponen las puertas', () => {
    // Ana lleva la gestión y, encima, una tarea a jornada completa que la
    // satura. Nivelar tiene que retrasar la OTRA, nunca sacar la gestión de su
    // fase: una fase no se retrasa porque alguien vaya cargado.
    const snapshot = new PlanBuilder()
      .project({ id: 'p2', statusStart: d('2026-03-02'), gates: { IQA: d('2026-09-30') } })
      .resource('ana')
      .task('gestion', {
        projectId: 'p2',
        taskType: 'fixed_work',
        workDeclaredMinutes: 60 * 300,
        spanFrom: 'arranque',
        spanTo: 'IQA',
      })
      .assign('gestion', 'ana')
      .task('otra', { projectId: 'p2', durationMinutes: 480 * 20 })
      .assign('otra', 'ana')
      .build(d('2027-12-31'))

    const nivelado = levelPlan(snapshot, { maxIterations: 200 })
    expect(nivelado.delays.get('gestion') ?? 0).toBe(0)

    const despues = nivelado.schedule.taskResults.find((t) => t.nodeId === 'gestion')
    expect(despues?.scheduledStart.date).toBe('2026-03-02')
    expect(despues?.scheduledFinish.date).toBe('2026-09-30')
  })
})
