/**
 * Aplicar la matriz de documentos a un proyecto, contra PostgreSQL de verdad.
 *
 * El planificador puro ya tiene sus propias pruebas. Lo que se comprueba aquí
 * es lo otro: que lo que enseña la previsualización es exactamente lo que se
 * escribe, que aplicar dos veces no duplica nada, y que quien no puede editar
 * dependencias no puede aplicar aunque pueda mirar.
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

let app: FastifyInstance | null = null
let editor = ''
let mirón = ''
let projectId = ''
let tareaA = ''
let tareaB = ''
let docA = ''
let docB = ''

function aplicacion(): FastifyInstance {
  if (app === null) throw new Error('la aplicación no se ha montado: mira el beforeAll')
  return app
}

async function cuentaCon(permisos: readonly string[]): Promise<string> {
  if (pool === null || app === null) return ''
  const correo = `${unico('matriz')}@ejemplo.test`
  await withTransaction(pool, async (db) => {
    const userId = await createUser(db, { email: correo, displayName: 'Cuenta de prueba', password: CLAVE })
    const roleId = await createRole(db, { code: unico('rol'), name: 'Rol de prueba' })
    await setRolePermissions(db, roleId, permisos)
    await grantRole(db, userId, roleId, null)
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
  method: 'GET' | 'POST' | 'PUT',
  ruta: string,
  cookie: string,
  payload?: unknown,
): Promise<LightMyRequestResponse> {
  const opciones: InjectOptions =
    payload === undefined
      ? { method, url: ruta, headers: { cookie } }
      : { method, url: ruta, headers: { cookie }, payload: payload as Exclude<InjectOptions['payload'], undefined> }
  return aplicacion().inject(opciones)
}

beforeAll(async () => {
  if (pool === null) return
  app = await buildServer(pool, { logLevel: 'silent' })

  editor = await cuentaCon([
    'plan.ver', 'plan.estructura', 'dependencias.editar', 'calcular',
    'documentos.ver', 'documentos.gestionar', 'documentos.asignar',
  ])
  mirón = await cuentaCon(['plan.ver', 'documentos.ver'])

  const proyecto = await pedir('POST', '/api/projects', editor, {
    code: unico('MATRIZ'),
    name: 'Proyecto de la matriz',
    statusStart: '2026-03-02',
  })
  expect(proyecto.statusCode).toBe(200)
  projectId = proyecto.json<{ result: string }>().result

  const nodo = async (name: string): Promise<string> => {
    const respuesta = await pedir('POST', '/api/nodes', editor, {
      projectId,
      kind: 'task',
      name,
      durationMinutes: 480,
    })
    expect(respuesta.statusCode).toBe(200)
    return respuesta.json<{ result: string }>().result
  }
  tareaA = await nodo('Escribir el análisis')
  tareaB = await nodo('Escribir el informe')

  const documento = async (prefijo: string): Promise<string> => {
    const respuesta = await pedir('POST', '/api/documents', editor, {
      code: unico(prefijo).slice(0, 60),
      name: `Documento ${prefijo}`,
    })
    expect(respuesta.statusCode).toBe(200)
    return respuesta.json<{ result: string }>().result
  }
  docA = await documento('A')
  docB = await documento('B')

  // La matriz: A es condición necesaria de B.
  expect(
    (
      await pedir('PUT', '/api/documents/precedence', editor, {
        predecessorId: docA,
        successorId: docB,
        required: true,
      })
    ).statusCode,
  ).toBe(200)

  // Y las fichas: quién entrega qué.
  expect((await pedir('PUT', `/api/nodes/${tareaA}/documents/${docA}`, editor, { delivers: true })).statusCode).toBe(200)
  expect((await pedir('PUT', `/api/nodes/${tareaB}/documents/${docB}`, editor, { delivers: true })).statusCode).toBe(200)
}, 60_000)

afterAll(async () => {
  // Cada cálculo deja unas once mil filas de capacidad. Sin esto, una base
  // de desarrollo de unas semanas llega al millón y las pruebas que
  // recalculan se vuelven lentas hasta agotar el plazo: el síntoma parece
  // un fallo de la prueba y es basura acumulada.
  if (pool !== null) await withTransaction(pool, (db) => deleteRunsSince(db, ARRANQUE_DEL_FICHERO))
  await app?.close()
  await pool?.end()
})

interface Propuesta {
  readonly create: readonly { predecessorNodeId: string; successorNodeId: string }[]
  readonly skipped: readonly { predecessorNodeId: string; successorNodeId: string; reason: string }[]
  readonly missingDocuments: readonly string[]
  readonly tasks: readonly { nodeId: string; name: string }[]
  readonly documents: readonly { id: string }[]
}

const describeSiHayBase = pool === null ? describe.skip : describe

describeSiHayBase('aplicar la matriz a un proyecto', () => {
  it('la previsualización propone la dependencia y no escribe nada', async () => {
    const respuesta = await pedir('GET', `/api/projects/${projectId}/documents/plan`, editor)
    expect(respuesta.statusCode).toBe(200)
    const plan = respuesta.json<Propuesta>()

    expect(plan.create).toHaveLength(1)
    expect(plan.create[0]?.predecessorNodeId).toBe(tareaA)
    expect(plan.create[0]?.successorNodeId).toBe(tareaB)
    // Los nombres viajan con la propuesta: sin ellos no se puede enseñar.
    expect(plan.tasks.map((t) => t.nodeId)).toContain(tareaA)
    expect(plan.documents.map((d) => d.id)).toContain(docA)

    // Y el plan sigue sin la dependencia, porque esto no escribe.
    const estructura = await pedir('GET', '/api/plan/structure', editor)
    const enlaces = estructura.json<{ dependencies: readonly { predecessorNodeId: string }[] }>().dependencies
    expect(enlaces.some((d) => d.predecessorNodeId === tareaA)).toBe(false)
  })

  it('quien sólo mira no puede aplicar', async () => {
    const respuesta = await pedir('POST', `/api/projects/${projectId}/documents/apply`, mirón, {})
    expect(respuesta.statusCode).toBe(403)
    expect(respuesta.json<{ code: string }>().code).toBe('SIN_PERMISO')
  })

  it('lo excluido no se crea', async () => {
    const respuesta = await pedir('POST', `/api/projects/${projectId}/documents/apply`, editor, {
      exclude: [{ predecessorNodeId: tareaA, successorNodeId: tareaB }],
    })
    expect(respuesta.statusCode).toBe(200)
    expect(respuesta.json<{ result: { created: readonly unknown[] } }>().result.created).toHaveLength(0)
  })

  it('aplicar crea la dependencia y devuelve la ejecución nueva', async () => {
    const respuesta = await pedir('POST', `/api/projects/${projectId}/documents/apply`, editor, {})
    expect(respuesta.statusCode).toBe(200)
    const cuerpo = respuesta.json<{
      result: { created: readonly { predecessorNodeId: string; successorNodeId: string }[] }
      run: { runId: string }
    }>()
    expect(cuerpo.result.created).toHaveLength(1)
    // Toda edición recalcula: un plan editado que enseña las fechas de antes
    // es peor que no editarlo.
    expect(cuerpo.run.runId).toMatch(/^[0-9a-f-]{36}$/)

    const estructura = await pedir('GET', '/api/plan/structure', editor)
    const enlaces = estructura.json<{
      dependencies: readonly { predecessorNodeId: string; successorNodeId: string; kind: string }[]
    }>().dependencies
    const creada = enlaces.find((d) => d.predecessorNodeId === tareaA && d.successorNodeId === tareaB)
    expect(creada?.kind).toBe('FS')
  })

  it('aplicar otra vez no duplica: ahora está descartada por existir ya', async () => {
    const plan = (await pedir('GET', `/api/projects/${projectId}/documents/plan`, editor)).json<Propuesta>()
    expect(plan.create).toHaveLength(0)
    expect(plan.skipped).toHaveLength(1)
    expect(plan.skipped[0]?.reason).toBe('ya-existe')

    const otra = await pedir('POST', `/api/projects/${projectId}/documents/apply`, editor, {})
    expect(otra.statusCode).toBe(200)
    expect(otra.json<{ result: { created: readonly unknown[] } }>().result.created).toHaveLength(0)
  })

  it('un documento de la matriz que nadie entrega sale como hueco', async () => {
    const tercero = await pedir('POST', '/api/documents', editor, {
      code: unico('C').slice(0, 60),
      name: 'Documento C',
    })
    const docC = tercero.json<{ result: string }>().result
    await pedir('PUT', '/api/documents/precedence', editor, {
      predecessorId: docB,
      successorId: docC,
      required: true,
    })

    const plan = (await pedir('GET', `/api/projects/${projectId}/documents/plan`, editor)).json<Propuesta>()
    expect(plan.missingDocuments).toContain(docC)
    expect(plan.create).toHaveLength(0)
  })
})
