import { schedulePlan } from '@planner/scheduler'
import fc from 'fast-check'
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

describe('nivelar sin rehacer el reparto entero', () => {
  /**
   * La invariante de la optimización, y la única que la sostiene: parchear el
   * índice de carga tiene que dar **exactamente** lo mismo que rehacer el
   * reparto completo. Si esto se rompe, la nivelación elige otra tarea y el
   * plan nivelado deja de ser el que era, sin que nada más avise.
   */
  it('el reparto que devuelve es el del cálculo completo, celda a celda', () => {
    const snapshot = new PlanBuilder()
      .resource('ana')
      .resource('marc')
      .task('a', { durationMinutes: 2400 })
      .task('b', { durationMinutes: 2400 })
      .task('c', { durationMinutes: 1200 })
      .task('d', { durationMinutes: 1200 })
      .link('a', 'd')
      .assign('a', 'ana')
      .assign('b', 'ana')
      .assign('c', 'marc')
      .assign('d', 'marc')
      .build()

    const nivelado = levelPlan(snapshot)
    // El mismo plan, repartido desde cero con los retrasos que eligió nivelar.
    const completo = computeWorkload(
      snapshot,
      schedulePlan(snapshot, { levelingDelays: nivelado.delays }),
    )
    expect(nivelado.workload.timephased).toEqual(completo.timephased)
    expect(nivelado.workload.findings).toEqual(completo.findings)
  })

  it('da el mismo plan nivelado sea cual sea el tamaño del lío', () => {
    // Lo mismo, con planes generados: lo que se comprueba no es una escena
    // concreta sino que las dos rutas no se separan nunca.
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            dias: fc.integer({ min: 1, max: 6 }),
            quien: fc.constantFrom('ana', 'marc'),
            ata: fc.boolean(),
          }),
          { minLength: 2, maxLength: 9 },
        ),
        (tareas) => {
          const plan = new PlanBuilder().resource('ana').resource('marc')
          for (const [i, t] of tareas.entries()) {
            plan.task(`t${String(i)}`, { durationMinutes: t.dias * 480 })
          }
          for (const [i, t] of tareas.entries()) {
            plan.assign(`t${String(i)}`, t.quien)
            if (t.ata && i > 0) plan.link(`t${String(i - 1)}`, `t${String(i)}`)
          }
          const snapshot = plan.build()
          const nivelado = levelPlan(snapshot)
          const completo = computeWorkload(
            snapshot,
            schedulePlan(snapshot, { levelingDelays: nivelado.delays }),
          )
          return (
            JSON.stringify(nivelado.workload.timephased) === JSON.stringify(completo.timephased)
          )
        },
      ),
      { numRuns: 120 },
    )
  })

  it('un día que se queda sin carga deja de existir, no se queda a cero', () => {
    // Si al mover una tarea el día quedara con cero minutos en vez de borrarse,
    // el bucle lo recorrería para siempre buscando un conflicto que ya no está.
    const snapshot = new PlanBuilder()
      .resource('ana')
      .task('una', { durationMinutes: 2400 })
      .task('otra', { durationMinutes: 2400 })
      .assign('una', 'ana')
      .assign('otra', 'ana')
      .build()
    const nivelado = levelPlan(snapshot)
    expect(nivelado.converged).toBe(true)
    expect(nivelado.workload.timephased.every((celda) => celda.plannedMinutes > 0)).toBe(true)
  })
})
