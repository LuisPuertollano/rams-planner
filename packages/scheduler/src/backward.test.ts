/**
 * Planificar hacia atrás, desde la puerta.
 *
 * Lo que hay que demostrar son tres cosas, y la tercera es la que justifica el
 * modo entero:
 *
 *   1. Un proyecto que va hacia delante no cambia. Nada de esto puede mover una
 *      sola fecha de lo que ya funcionaba.
 *   2. Hacia atrás, la tarea se pega a su fecha objetivo en vez de al arranque.
 *   3. Cuando no se llega, lo dice **antes** y en términos accionables: no
 *      «llegas tarde» sino «habrías tenido que empezar el día tal».
 */

import { describe, expect, it } from 'vitest'
import { calendarDate } from '@planner/domain'
import { PlanBuilder } from './__fixtures__/plan.js'
import { schedulePlan } from './schedule.js'

const d = calendarDate

/**
 * La tarea, o un fallo que dice cuál falta.
 *
 * Sin esto habría un `!` por línea, que el lint prohíbe con razón: cuando la
 * tarea no está, `!` revienta con «cannot read property of undefined» y hay que
 * ir a buscar cuál era.
 */
function tarea(
  resultado: { taskResults: readonly { nodeId: string }[] },
  nodeId: string,
): { scheduledStart: { date: string }; scheduledFinish: { date: string }; totalSlackMinutes: number } {
  const encontrada = resultado.taskResults.find((t) => t.nodeId === nodeId)
  if (encontrada === undefined) throw new Error(`No hay resultado para «${nodeId}»`)
  return encontrada as never
}

/** El día de una fecha programada, que es lo que se compara aquí. */
const dia = (instante: { date: string }): string => instante.date

describe('planificar hacia atrás', () => {
  it('un proyecto hacia delante no se mueve ni un día', () => {
    // La red de seguridad de todo lo demás: el modo de siempre es el de serie y
    // tiene que dar exactamente lo que daba.
    const snapshot = new PlanBuilder()
      .task('a', { durationMinutes: 480 * 5, deadline: d('2026-06-30') })
      .build()
    const resultado = schedulePlan(snapshot)
    const a = tarea(resultado, 'a')
    expect(dia(a.scheduledStart)).toBe('2026-03-02')
    expect(a.totalSlackMinutes).toBe(0)
  })

  it('hacia atrás, la tarea se pega a su fecha objetivo', () => {
    const snapshot = new PlanBuilder()
      .project({ id: 'p2', scheduleMode: 'atras', statusStart: d('2026-03-02') })
      .task('a', { projectId: 'p2', durationMinutes: 480 * 5, deadline: d('2026-06-30') })
      .build()
    const resultado = schedulePlan(snapshot)
    const a = tarea(resultado, 'a')
    // Cinco días laborables que acaban el 30 de junio: empieza el 24.
    expect(dia(a.scheduledFinish)).toBe('2026-06-30')
    expect(dia(a.scheduledStart)).toBe('2026-06-24')
    // Y la holgura es el margen de verdad: lo que hay entre poder y tener que.
    expect(a.totalSlackMinutes).toBeGreaterThan(0)
  })

  it('la cadena entera se arrastra detrás de la puerta', () => {
    // Tres tareas encadenadas y una sola fecha objetivo, en la última. Hacia
    // atrás, las tres se colocan a partir de ella.
    const snapshot = new PlanBuilder()
      .project({ id: 'p2', scheduleMode: 'atras' })
      .task('a', { projectId: 'p2', durationMinutes: 480 * 2 })
      .task('b', { projectId: 'p2', durationMinutes: 480 * 3 })
      .task('c', { projectId: 'p2', durationMinutes: 480 * 2, deadline: d('2026-06-30') })
      .link('a', 'b')
      .link('b', 'c')
      .build()
    const resultado = schedulePlan(snapshot)
    expect(dia(tarea(resultado, 'c').scheduledFinish)).toBe('2026-06-30')
    // `b` acaba justo antes de que empiece `c`, y `a` antes de `b`.
    expect(dia(tarea(resultado, 'c').scheduledStart)).toBe('2026-06-29')
    expect(dia(tarea(resultado, 'b').scheduledFinish)).toBe('2026-06-26')
    expect(dia(tarea(resultado, 'a').scheduledFinish)).toBe('2026-06-23')
  })

  it('cuando no se llega, lo dice antes y con el número de días que faltan', () => {
    // El caso de verdad: la puerta cae dentro de tres días y hay veinte de
    // trabajo. Hacia delante esto se vería como «termina tarde»; hacia atrás se
    // ve como lo que es — la puerta no es alcanzable.
    const snapshot = new PlanBuilder()
      .project({ id: 'p2', scheduleMode: 'atras', statusStart: d('2026-03-02') })
      .task('a', { projectId: 'p2', durationMinutes: 480 * 20, deadline: d('2026-03-05') })
      .build()
    const resultado = schedulePlan(snapshot)

    const hallazgo = resultado.findings.find((f) => f.code === 'GATE_UNREACHABLE')
    expect(hallazgo).toBeDefined()
    expect(hallazgo?.entityId).toBe('a')
    expect(hallazgo?.severity).toBe('warning')
    // Lo accionable: cuántos días laborables faltan.
    expect(hallazgo?.payload?.['diasQueFaltan']).toBeGreaterThan(0)
    // Y si la cuenta se topó contra el principio del horizonte, lo dice: el
    // número real sería mayor, y callarlo haría que alguien planificase con
    // una cifra corta.
    expect(hallazgo?.payload?.['alMenos']).toBe(true)
    expect(hallazgo?.message).toContain('al menos')
    // Y dice las dos fechas, la que haría falta y la que se puede.
    expect(hallazgo?.message).toContain('tendría que empezar')
    expect(hallazgo?.message).toContain('lo más pronto que puede empezar')
  })

  it('el mismo plan hacia delante NO da ese hallazgo', () => {
    // Porque hacia delante la holgura nunca es negativa: el ancla del paso
    // atrás es el propio fin calculado. Es lo que hace que este hallazgo sea
    // información nueva y no una segunda forma de decir DEADLINE_MISSED.
    const snapshot = new PlanBuilder()
      .task('a', { durationMinutes: 480 * 20, deadline: d('2026-03-05') })
      .build()
    const resultado = schedulePlan(snapshot)
    expect(resultado.findings.some((f) => f.code === 'GATE_UNREACHABLE')).toBe(false)
    // Lo que sí da es el aviso de siempre, que dice otra cosa.
    expect(resultado.findings.some((f) => f.code === 'DEADLINE_MISSED')).toBe(true)
  })

  it('los dos modos conviven en la misma cartera sin mezclarse', () => {
    // Es la razón de que esto vaya por proyecto: una oferta se planifica hacia
    // delante para saber qué se promete, y un proyecto en marcha hacia atrás.
    const snapshot = new PlanBuilder()
      .project({ id: 'oferta', scheduleMode: 'adelante' })
      .project({ id: 'enMarcha', scheduleMode: 'atras' })
      .task('o', { projectId: 'oferta', durationMinutes: 480 * 5, deadline: d('2026-06-30') })
      .task('m', { projectId: 'enMarcha', durationMinutes: 480 * 5, deadline: d('2026-06-30') })
      .build()
    const resultado = schedulePlan(snapshot)
    expect(dia(tarea(resultado, 'o').scheduledStart)).toBe('2026-03-02')
    expect(dia(tarea(resultado, 'm').scheduledFinish)).toBe('2026-06-30')
  })

  it('una tarea sin fecha objetivo no se ancla en ninguna parte', () => {
    // Hacia atrás, lo que no tiene puerta se coloca por sus sucesores. Si no
    // tiene ninguno, se queda donde el fin del proyecto lo deja: inventarle una
    // puerta sería inventarse un compromiso.
    const snapshot = new PlanBuilder()
      .project({ id: 'p2', scheduleMode: 'atras' })
      .task('suelta', { projectId: 'p2', durationMinutes: 480 * 3 })
      .build()
    const resultado = schedulePlan(snapshot)
    expect(tarea(resultado, 'suelta').totalSlackMinutes).toBe(0)
    expect(resultado.findings.some((f) => f.code === 'GATE_UNREACHABLE')).toBe(false)
  })
})
