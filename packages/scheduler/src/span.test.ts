/**
 * La tarea que dura una fase.
 *
 * Lo que hay que demostrar, en orden de importancia:
 *
 *   1. La ventana la ponen las puertas, no el trabajo declarado. Una tarea de
 *      dos días con la ventana de un año dura un año.
 *   2. No la colocan sus predecesoras. Va en paralelo, que es lo que significa.
 *   3. Cuando las anclas no cuadran, el plan **sale igual** y lo dice. Una
 *      puerta sin fecha es un dato que falta, no un cálculo imposible.
 */

import { describe, expect, it } from 'vitest'
import { calendarDate } from '@planner/domain'
import { PlanBuilder } from './__fixtures__/plan.js'
import { schedulePlan } from './schedule.js'

const d = calendarDate

/** La tarea, o un fallo que dice cuál falta. */
function tarea(
  resultado: { taskResults: readonly { nodeId: string }[] },
  nodeId: string,
): {
  scheduledStart: { date: string }
  scheduledFinish: { date: string }
  durationMinutes: number
  workMinutes: number
  totalSlackMinutes: number
} {
  const encontrada = resultado.taskResults.find((t) => t.nodeId === nodeId)
  if (encontrada === undefined) throw new Error(`No hay resultado para «${nodeId}»`)
  return encontrada as never
}

/** Un proyecto con dos puertas puestas, que es el caso de siempre. */
const conPuertas = (): PlanBuilder =>
  new PlanBuilder().project({
    id: 'p2',
    statusStart: d('2026-03-02'),
    gates: { IQA: d('2026-09-30'), FQA: d('2027-09-30') },
  })

describe('la tarea que dura una fase', () => {
  it('la ventana la ponen las puertas, no el trabajo declarado', () => {
    // 16 h de trabajo declarado: como tarea normal duraría dos días. Declarada
    // entre el arranque y IQA, dura los siete meses de la fase.
    const snapshot = conPuertas()
      .task('gestion', {
        projectId: 'p2',
        taskType: 'fixed_work',
        workDeclaredMinutes: 480 * 2,
        spanFrom: 'arranque',
        spanTo: 'IQA',
      })
      .build(d('2027-12-31'))
    const resultado = schedulePlan(snapshot)
    const gestion = tarea(resultado, 'gestion')

    expect(gestion.scheduledStart.date).toBe('2026-03-02')
    expect(gestion.scheduledFinish.date).toBe('2026-09-30')
    // El trabajo NO cambia: sigue siendo lo que alguien declaró. Lo que cambia
    // es la duración, y con ella la intensidad a la que hay que llevarlo.
    expect(gestion.workMinutes).toBe(480 * 2)
    expect(gestion.durationMinutes).toBeGreaterThan(480 * 100)
  })

  it('dos puertas, sin pasar por el arranque', () => {
    const snapshot = conPuertas()
      .task('garantia', {
        projectId: 'p2',
        taskType: 'fixed_work',
        workDeclaredMinutes: 480 * 20,
        spanFrom: 'IQA',
        spanTo: 'FQA',
      })
      .build(d('2027-12-31'))
    const garantia = tarea(schedulePlan(snapshot), 'garantia')
    expect(garantia.scheduledStart.date).toBe('2026-09-30')
    expect(garantia.scheduledFinish.date).toBe('2027-09-30')
  })

  it('el nombre de la puerta no distingue mayúsculas ni espacios', () => {
    // Las puertas se escriben a mano en tres sitios distintos. Que «iqa » y
    // «IQA» sean la misma no puede depender de quién teclea.
    const snapshot = conPuertas()
      .task('gestion', { projectId: 'p2', spanFrom: ' arranque ', spanTo: ' iqa ' })
      .build(d('2027-12-31'))
    const resultado = schedulePlan(snapshot)
    expect(tarea(resultado, 'gestion').scheduledFinish.date).toBe('2026-09-30')
    expect(resultado.findings.some((f) => f.code === 'SPAN_ANCHOR_MISSING')).toBe(false)
  })

  it('no la colocan sus predecesoras: va en paralelo', () => {
    // Es la mitad del asunto. La gestión de un proyecto no espera a que termine
    // nada; encadenarla detrás de la primera tarea la sacaría de su fase.
    const snapshot = conPuertas()
      .task('previa', { projectId: 'p2', durationMinutes: 480 * 60 })
      .task('gestion', { projectId: 'p2', spanFrom: 'arranque', spanTo: 'IQA' })
      .link('previa', 'gestion')
      .build(d('2027-12-31'))
    const resultado = schedulePlan(snapshot)
    // La predecesora termina en mayo; la gestión sigue empezando en marzo.
    expect(tarea(resultado, 'previa').scheduledFinish.date > '2026-05-01').toBe(true)
    expect(tarea(resultado, 'gestion').scheduledStart.date).toBe('2026-03-02')
  })

  it('tampoco la mueve una restricción de las blandas', () => {
    const snapshot = conPuertas()
      .task('gestion', {
        projectId: 'p2',
        spanFrom: 'arranque',
        spanTo: 'IQA',
        constraintKind: 'start_no_earlier_than',
        constraintDate: d('2026-06-01'),
      })
      .build(d('2027-12-31'))
    expect(tarea(schedulePlan(snapshot), 'gestion').scheduledStart.date).toBe('2026-03-02')
  })

  it('su holgura es cero: no hay nada que decidir', () => {
    const snapshot = conPuertas()
      .task('gestion', { projectId: 'p2', spanFrom: 'arranque', spanTo: 'IQA' })
      .build(d('2027-12-31'))
    expect(tarea(schedulePlan(snapshot), 'gestion').totalSlackMinutes).toBe(0)
  })

  it('una puerta sin fecha no revienta el plan: lo dice y calcula como siempre', () => {
    const snapshot = new PlanBuilder()
      .project({ id: 'p2', statusStart: d('2026-03-02'), gates: { IQA: d('2026-09-30') } })
      .task('gestion', {
        projectId: 'p2',
        durationMinutes: 480 * 3,
        spanFrom: 'IQA',
        spanTo: 'FQA',
      })
      .build(d('2027-12-31'))
    const resultado = schedulePlan(snapshot)

    const hallazgo = resultado.findings.find((f) => f.code === 'SPAN_ANCHOR_MISSING')
    expect(hallazgo).toBeDefined()
    expect(hallazgo?.severity).toBe('warning')
    expect(hallazgo?.entityId).toBe('gestion')
    // El aviso nombra la puerta que hay que ir a buscar a la ficha.
    expect(hallazgo?.payload?.['falta']).toBe('FQA')
    // Y la tarea sale, con su duración de siempre y desde el arranque.
    const gestion = tarea(resultado, 'gestion')
    expect(gestion.durationMinutes).toBe(480 * 3)
    expect(gestion.scheduledStart.date).toBe('2026-03-02')
  })

  it('dos puertas del revés tampoco revientan el plan', () => {
    const snapshot = new PlanBuilder()
      .project({
        id: 'p2',
        statusStart: d('2026-03-02'),
        // FQA antes que IQA: los datos del proyecto no cuadran.
        gates: { IQA: d('2026-09-30'), FQA: d('2026-05-30') },
      })
      .task('garantia', { projectId: 'p2', durationMinutes: 480 * 3, spanFrom: 'IQA', spanTo: 'FQA' })
      .build(d('2027-12-31'))
    const resultado = schedulePlan(snapshot)

    const hallazgo = resultado.findings.find((f) => f.code === 'SPAN_INVERTED')
    expect(hallazgo).toBeDefined()
    expect(hallazgo?.severity).toBe('error')
    // Las dos fechas, para que se vea de un vistazo cuál está mal.
    expect(hallazgo?.payload?.['fechaDesde']).toBe('2026-09-30')
    expect(hallazgo?.payload?.['fechaHasta']).toBe('2026-05-30')
    expect(tarea(resultado, 'garantia').durationMinutes).toBe(480 * 3)
  })

  it('una tarea normal no cambia ni un minuto', () => {
    // La red de seguridad: nada de esto puede tocar lo que ya funcionaba.
    const snapshot = new PlanBuilder()
      .project({ id: 'p2', gates: { IQA: d('2026-09-30') } })
      .task('a', { projectId: 'p2', durationMinutes: 480 * 5 })
      .build(d('2027-12-31'))
    const resultado = schedulePlan(snapshot)
    expect(tarea(resultado, 'a').scheduledStart.date).toBe('2026-03-02')
    expect(tarea(resultado, 'a').durationMinutes).toBe(480 * 5)
    expect(resultado.findings.some((f) => f.code.startsWith('SPAN_'))).toBe(false)
  })
})

describe('una tarea continua y el camino crítico', () => {
  it('no es crítica, aunque su holgura sea cero', () => {
    // Su holgura es cero porque la ventana está clavada, no porque retrasarla
    // retrase el plan — retrasarla no se puede. Salió mirando el cronograma:
    // la gestión de cada proyecto aparecía en rojo y en el contador de tareas
    // críticas, que es justo donde se va a buscar lo que sí se puede mover.
    const snapshot = conPuertas()
      .task('gestion', { projectId: 'p2', spanFrom: 'arranque', spanTo: 'IQA' })
      .task('normal', { projectId: 'p2', durationMinutes: 480 * 5 })
      .build(d('2027-12-31'))
    const resultado = schedulePlan(snapshot)

    const gestion = tarea(resultado, 'gestion')
    expect(gestion.totalSlackMinutes).toBe(0)
    expect(resultado.taskResults.find((t) => t.nodeId === 'gestion')?.isCritical).toBe(false)
    // Y la tarea normal sin holgura sigue siendo crítica: no se ha roto nada.
    expect(resultado.taskResults.find((t) => t.nodeId === 'normal')?.isCritical).toBe(true)
  })

  it('tampoco estira el fin del proyecto, que es lo que vaciaba el camino crítico', () => {
    // El fallo de verdad, y el peor: la gestión va del arranque a la puesta en
    // servicio, así que si contara para el fin calculado del proyecto, el resto
    // de las tareas saldría con meses de holgura y el proyecto se quedaría SIN
    // camino crítico. En silencio, que es lo que lo hace peligroso.
    const snapshot = conPuertas()
      .task('gestion', { projectId: 'p2', spanFrom: 'arranque', spanTo: 'FQA' })
      .task('a', { projectId: 'p2', durationMinutes: 480 * 5 })
      .task('b', { projectId: 'p2', durationMinutes: 480 * 5 })
      .link('a', 'b')
      .build(d('2027-12-31'))
    const resultado = schedulePlan(snapshot)

    // La cadena a → b es el camino crítico del proyecto, y lo sigue siendo
    // aunque la gestión termine un año después.
    expect(tarea(resultado, 'a').totalSlackMinutes).toBe(0)
    expect(tarea(resultado, 'b').totalSlackMinutes).toBe(0)
    expect(resultado.taskResults.filter((t) => t.isCritical).map((t) => t.nodeId).sort())
      .toEqual(['a', 'b'])
  })
})
