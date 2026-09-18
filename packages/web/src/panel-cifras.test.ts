/**
 * Las dos decisiones del panel que se discuten, fijadas por escrito.
 *
 * No se prueba que sumar sume. Se prueba qué meses entran en la cuenta y qué
 * pasa con la capacidad cuando alguien filtra por proyecto, porque las dos son
 * elecciones —no hechos— y las dos cambian el número que se lee.
 */

import { describe, expect, it } from 'vitest'
import { cifrasDelPanel, loQueViene, proporcion, POR_DEBAJO, POR_ENCIMA } from './panel-cifras.js'
import type { LoadCell, TaskRow, UtilizationCell } from './api.js'

const carga = (
  resourceId: string, projectId: string, period: string, minutos: number,
): LoadCell => ({ resourceId, projectId, nodeId: `${resourceId}-${period}`, period, plannedMinutes: minutos, costCents: 0 })

const capacidad = (resourceId: string, period: string, minutos: number): UtilizationCell => ({
  resourceId, period, plannedMinutes: 0, capacityMinutes: minutos, utilizationBp: null,
})

const tarea = (nodeId: string, projectId: string, finish: string | null, kind = 'task'): TaskRow => ({
  nodeId, projectId, parentId: null, kind, code: null, name: nodeId, path: nodeId,
  scheduledStart: null, scheduledFinish: finish, durationMinutes: null, workMinutes: 480,
  totalSlackMinutes: null, isCritical: null, percentCompleteBp: 0, constraintKind: null,
  deadline: null, taskType: null, assignees: [], declaredDurationMinutes: null,
  declaredWorkMinutes: null, declaredPercentCompleteBp: null,
})

const TODOS = new Set(['p1', 'p2'])

describe('proporcion', () => {
  it('sin capacidad no hay proporción: null, que no es cero', () => {
    expect(proporcion(600, 0)).toBeNull()
    expect(proporcion(0, 600)).toBe(0)
    expect(proporcion(300, 600)).toBe(5_000)
  })
})

describe('las cifras del panel', () => {
  it('sólo cuentan los meses con trabajo', () => {
    // La capacidad de 2026-05 existe, pero en mayo nadie tiene nada
    // planificado: sumarla bajaría la ocupación sin que nada haya cambiado.
    const cifras = cifrasDelPanel({
      load: [carga('r1', 'p1', '2026-03', 480)],
      utilization: [capacidad('r1', '2026-03', 960), capacidad('r1', '2026-09', 960)],
    }, '', TODOS)
    expect(cifras.capacidad).toBe(960)
    expect(cifras.demanda).toBe(480)
    expect(cifras.ocupacionBp).toBe(5_000)
    expect(cifras.meses.map((m) => m.period)).toEqual(['2026-03'])
  })

  it('los meses intermedios sin trabajo sí cuentan: el hueco de en medio es real', () => {
    const cifras = cifrasDelPanel({
      load: [carga('r1', 'p1', '2026-03', 480), carga('r1', 'p1', '2026-05', 480)],
      utilization: [
        capacidad('r1', '2026-03', 960), capacidad('r1', '2026-04', 960), capacidad('r1', '2026-05', 960),
      ],
    }, '', TODOS)
    expect(cifras.meses.map((m) => m.period)).toEqual(['2026-03', '2026-04', '2026-05'])
    expect(cifras.meses[1]).toEqual({ period: '2026-04', capacidad: 960, demanda: 0 })
  })

  it('al filtrar por proyecto la demanda se recorta y la capacidad NO', () => {
    // Es la decisión que más confunde: la capacidad es de la persona, no del
    // proyecto. Recortarla daría una ocupación que sólo dice «este no es su
    // único proyecto».
    const load = [carga('r1', 'p1', '2026-03', 240), carga('r1', 'p2', '2026-03', 240)]
    const utilization = [capacidad('r1', '2026-03', 960)]
    const todo = cifrasDelPanel({ load, utilization }, '', TODOS)
    const soloP1 = cifrasDelPanel({ load, utilization }, 'p1', TODOS)
    expect(todo.demanda).toBe(480)
    expect(soloP1.demanda).toBe(240)
    expect(soloP1.capacidad).toBe(todo.capacidad)
    expect(soloP1.ocupacionBp).toBe(2_500)
  })

  it('cuenta por encima y por debajo con los umbrales del libro', () => {
    const cifras = cifrasDelPanel({
      load: [
        carga('alta', 'p1', '2026-03', 1_200),   // 125 %
        carga('justa', 'p1', '2026-03', 900),    // 93,75 %
        carga('baja', 'p1', '2026-03', 300),     // 31,25 %
      ],
      utilization: [
        capacidad('alta', '2026-03', 960), capacidad('justa', '2026-03', 960), capacidad('baja', '2026-03', 960),
      ],
    }, '', TODOS)
    expect(cifras.porEncima).toBe(1)
    expect(cifras.porDebajo).toBe(1)
    expect(POR_DEBAJO).toBe(8_000)
    expect(POR_ENCIMA).toBe(10_000)
  })

  it('quien no tiene capacidad no cuenta en ninguno de los dos lados', () => {
    // Con capacidad cero la ocupación es «no se sabe». Contarla como 0 % la
    // metería entre las infrautilizadas, que es afirmar algo que no consta.
    const cifras = cifrasDelPanel({
      load: [carga('fantasma', 'p1', '2026-03', 480)],
      utilization: [],
    }, '', TODOS)
    expect(cifras.gente).toHaveLength(1)
    expect(cifras.gente[0]?.ocupacionBp).toBeNull()
    expect(cifras.porEncima).toBe(0)
    expect(cifras.porDebajo).toBe(0)
    expect(cifras.huecoPorPersona).toBe(0)
  })

  it('la gente sale de más ocupada a menos', () => {
    const cifras = cifrasDelPanel({
      load: [carga('a', 'p1', '2026-03', 240), carga('b', 'p1', '2026-03', 720)],
      utilization: [capacidad('a', '2026-03', 960), capacidad('b', '2026-03', 960)],
    }, '', TODOS)
    expect(cifras.gente.map((p) => p.resourceId)).toEqual(['b', 'a'])
  })
})

describe('lo que viene', () => {
  const tareas = {
    tasks: [
      tarea('ayer', 'p1', '2026-03-09T16:00:00.000Z'),
      tarea('hoy', 'p1', '2026-03-10T16:00:00.000Z'),
      tarea('dentro', 'p1', '2026-03-20T16:00:00.000Z'),
      tarea('justo', 'p1', '2026-03-25T16:00:00.000Z'),
      tarea('fuera', 'p1', '2026-03-26T16:00:00.000Z'),
      tarea('fase', 'p1', '2026-03-20T16:00:00.000Z', 'phase'),
      tarea('otra', 'p2', '2026-03-20T16:00:00.000Z'),
      tarea('sinFecha', 'p1', null),
    ],
  }

  it('coge la ventana de quince días, hoy incluido y el día quince también', () => {
    // «dentro» y «otra» terminan el mismo día y empatan: el orden entre ellas
    // es el de entrada, que es estable y por tanto reproducible.
    const fuera = loQueViene(tareas, '', TODOS, '2026-03-10')
    expect(fuera.map((f) => f.nodeId)).toEqual(['hoy', 'dentro', 'otra', 'justo'])
  })

  it('deja fuera los contenedores: una fase termina cuando termina su última hija', () => {
    expect(loQueViene(tareas, '', TODOS, '2026-03-10').some((f) => f.nodeId === 'fase')).toBe(false)
  })

  it('respeta el filtro de proyecto', () => {
    expect(loQueViene(tareas, 'p2', TODOS, '2026-03-10').map((f) => f.nodeId)).toEqual(['otra'])
  })

  it('respeta los proyectos que el corte de compromiso deja fuera', () => {
    expect(loQueViene(tareas, '', new Set(['p1']), '2026-03-10').some((f) => f.nodeId === 'otra')).toBe(false)
  })
})
