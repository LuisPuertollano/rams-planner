/**
 * El informe, pedido a la aplicación entera contra PostgreSQL de verdad.
 *
 * Lo que se comprueba aquí no es la aritmética —eso lo cubren las pruebas del
 * paquete puro— sino lo que sólo se ve de extremo a extremo: que el periodo
 * recorta, que el alcance recorta, y que lo que alguien no puede ver **no
 * llega**, y se dice.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import {
  createPool,
  createRole,
  createUser,
  deleteRunsSince,
  grantRole,
  setRolePermissions,
  withTransaction,
} from '@planner/persistence'
import { buildServer } from './build-server.js'

/**
 * El instante en que arranca este fichero. Lo que se calcule a partir de
 * aquí es suyo y se borra al terminar: con `fileParallelism` desactivado
 * cuando hay base de datos, no hay otro fichero calculando a la vez.
 */
const ARRANQUE_DEL_FICHERO = new Date()

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

const unico = (prefijo: string): string =>
  `${prefijo}-${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`

const CLAVE = 'una contraseña larga de prueba'

/** El proyecto del informe empieza aquí y dura una semana laborable. */
const ARRANQUE = '2026-04-06'

let app: FastifyInstance | null = null
let todo = ''
let sinCostes = ''
let sinCarga = ''
let soloOtro = ''
let projectId = ''
let otroProyecto = ''

function aplicacion(): FastifyInstance {
  if (app === null) throw new Error('la aplicación no se ha montado: mira el beforeAll')
  return app
}

async function cuentaCon(permisos: readonly string[], projectScope: string | null = null): Promise<string> {
  if (pool === null || app === null) return ''
  const correo = `${unico('informe')}@ejemplo.test`
  await withTransaction(pool, async (db) => {
    const userId = await createUser(db, { email: correo, displayName: 'Cuenta de prueba', password: CLAVE })
    const roleId = await createRole(db, { code: unico('rol'), name: 'Rol de prueba' })
    await setRolePermissions(db, roleId, permisos)
    await grantRole(db, userId, roleId, projectScope)
  })
  const respuesta = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: correo, password: CLAVE },
  })
  expect(respuesta.statusCode).toBe(200)
  return respuesta.headers['set-cookie']?.toString() ?? ''
}

async function pedir(
  method: 'GET' | 'POST',
  ruta: string,
  cookie: string,
  payload?: unknown,
): Promise<LightMyRequestResponse> {
  const opciones: InjectOptions =
    payload === undefined
      ? { method, url: ruta, headers: { cookie } }
      : {
          method,
          url: ruta,
          headers: { cookie },
          payload: payload as Exclude<InjectOptions['payload'], undefined>,
        }
  return aplicacion().inject(opciones)
}

interface Informe {
  readonly runId: string
  readonly period: { from: string; to: string }
  readonly costsHidden: boolean
  readonly peopleHidden: boolean
  readonly tldr: readonly { kind: string; numbers: Record<string, number> }[]
  readonly totals: {
    projectCount: number
    tasksInPeriod: number
    plannedMinutes: number
    costCents: number
    overloadedPeople: number
  }
  readonly projects: readonly { projectId: string; code: string; plannedMinutes: number }[]
  readonly people: readonly { displayName: string }[]
  readonly months: readonly { period: string; plannedMinutes: number }[]
}

const informe = (respuesta: LightMyRequestResponse): Informe => respuesta.json<Informe>()

beforeAll(async () => {
  if (pool === null) return
  app = await buildServer(pool, { logLevel: 'silent' })

  todo = await cuentaCon([
    'informes.ver', 'carga.ver', 'costes.ver', 'plan.ver', 'plan.estructura',
    'asignaciones.editar', 'equipo.ver', 'equipo.editar', 'calcular',
  ])

  const proyecto = async (prefijo: string): Promise<string> => {
    const respuesta = await pedir('POST', '/api/projects', todo, {
      code: unico(prefijo),
      name: `Proyecto ${prefijo}`,
      statusStart: ARRANQUE,
    })
    expect(respuesta.statusCode).toBe(200)
    return respuesta.json<{ result: string }>().result
  }
  projectId = await proyecto('INFORME')
  otroProyecto = await proyecto('INFORME-OTRO')

  const tarea = await pedir('POST', '/api/nodes', todo, {
    projectId,
    kind: 'task',
    name: 'Tarea del informe',
    durationMinutes: 2_400,
  })
  expect(tarea.statusCode).toBe(200)
  const nodeId = tarea.json<{ result: string }>().result

  const recurso = await pedir('POST', '/api/resources', todo, {
    code: unico('rec').slice(0, 60),
    displayName: 'Persona del informe',
  })
  expect(recurso.statusCode).toBe(200)

  const equipo = await pedir('GET', '/api/resources', todo)
  const resourceId = equipo
    .json<{ resources: readonly { id: string; displayName: string }[] }>()
    .resources.find((r) => r.displayName === 'Persona del informe')?.id
  expect(resourceId).toBeDefined()

  expect(
    (await pedir('POST', '/api/assignments', todo, { nodeId, resourceId, unitsBp: 10_000 })).statusCode,
  ).toBe(200)
  expect((await pedir('POST', '/api/calculate', todo, { reason: 'informe' })).statusCode).toBe(200)

  sinCostes = await cuentaCon(['informes.ver', 'carga.ver', 'plan.ver'])
  sinCarga = await cuentaCon(['informes.ver', 'costes.ver', 'plan.ver'])
  soloOtro = await cuentaCon(['informes.ver', 'carga.ver', 'plan.ver'], otroProyecto)
}, 90_000)

afterAll(async () => {
  // Cada cálculo deja unas once mil filas de capacidad. Sin esto, una base
  // de desarrollo de unas semanas llega al millón y las pruebas que
  // recalculan se vuelven lentas hasta agotar el plazo: el síntoma parece
  // un fallo de la prueba y es basura acumulada.
  if (pool !== null) await withTransaction(pool, (db) => deleteRunsSince(db, ARRANQUE_DEL_FICHERO))
  await app?.close()
  await pool?.end()
})

const describeSiHayBase = pool === null ? describe.skip : describe

const soloEsteProyecto = (cookie: string, desde = '2026-01-01', hasta = '2026-12-31'): Promise<LightMyRequestResponse> =>
  pedir('GET', `/api/report?projects=${projectId}&from=${desde}&to=${hasta}`, cookie)

describeSiHayBase('el informe', () => {
  it('cuenta el trabajo del proyecto pedido y viene con su ejecución', async () => {
    const respuesta = await soloEsteProyecto(todo)
    expect(respuesta.statusCode).toBe(200)
    const cuerpo = informe(respuesta)

    expect(cuerpo.runId).toMatch(/^[0-9a-f-]{36}$/)
    expect(cuerpo.totals.projectCount).toBe(1)
    expect(cuerpo.projects).toHaveLength(1)
    expect(cuerpo.projects[0]?.projectId).toBe(projectId)
    expect(cuerpo.totals.plannedMinutes).toBe(2_400)
    expect(cuerpo.totals.tasksInPeriod).toBe(1)
    // Los meses suman el total del periodo, siempre.
    expect(cuerpo.months.reduce((total, mes) => total + mes.plannedMinutes, 0)).toBe(2_400)
  })

  it('un periodo fuera del plan devuelve ceros, no el plan entero', async () => {
    const cuerpo = informe(await soloEsteProyecto(todo, '2020-01-01', '2020-12-31'))
    expect(cuerpo.period).toEqual({ from: '2020-01-01', to: '2020-12-31' })
    expect(cuerpo.totals.plannedMinutes).toBe(0)
    expect(cuerpo.totals.tasksInPeriod).toBe(0)
    expect(cuerpo.months).toEqual([])
  })

  it('el periodo se puede recortar a un mes y sólo cuenta ese mes', async () => {
    const abril = informe(await soloEsteProyecto(todo, '2026-04-01', '2026-04-30'))
    expect(abril.totals.plannedMinutes).toBe(2_400)
    const mayo = informe(await soloEsteProyecto(todo, '2026-05-01', '2026-05-31'))
    expect(mayo.totals.plannedMinutes).toBe(0)
  })

  it('sin permiso de costes el importe no sale, y se dice', async () => {
    const cuerpo = informe(await soloEsteProyecto(sinCostes))
    expect(cuerpo.costsHidden).toBe(true)
    expect(cuerpo.totals.costCents).toBe(0)
    expect(cuerpo.tldr.some((punto) => punto.kind === 'coste')).toBe(false)
  })

  it('sin permiso de carga no llega el reparto por persona, y se dice', async () => {
    const cuerpo = informe(await soloEsteProyecto(sinCarga))
    expect(cuerpo.peopleHidden).toBe(true)
    expect(cuerpo.people).toEqual([])
    expect(cuerpo.totals.overloadedPeople).toBe(0)
    // El trabajo del plan sí sigue: es del proyecto, no de nadie en concreto.
    expect(cuerpo.totals.plannedMinutes).toBe(2_400)
  })

  it('pedir un proyecto ajeno no lo trae ni confirma que exista', async () => {
    const respuesta = await soloEsteProyecto(soloOtro)
    expect(respuesta.statusCode).toBe(200)
    const cuerpo = informe(respuesta)
    expect(cuerpo.projects).toEqual([])
    expect(cuerpo.totals.plannedMinutes).toBe(0)
  })

  it('sin decir qué proyectos, salen todos los que se pueden ver', async () => {
    const cuerpo = informe(
      await pedir('GET', '/api/report?from=2026-01-01&to=2026-12-31', soloOtro),
    )
    expect(cuerpo.projects.map((p) => p.projectId)).toEqual([otroProyecto])
  })

  it('un periodo del revés se rechaza en vez de devolver nada en silencio', async () => {
    const respuesta = await soloEsteProyecto(todo, '2026-12-31', '2026-01-01')
    expect(respuesta.statusCode).toBe(422)
  })

  it('quien no tiene la función no entra', async () => {
    const nadie = await cuentaCon(['plan.ver'])
    const respuesta = await soloEsteProyecto(nadie)
    expect(respuesta.statusCode).toBe(403)
    expect(respuesta.json<{ code: string }>().code).toBe('SIN_PERMISO')
  })
})
