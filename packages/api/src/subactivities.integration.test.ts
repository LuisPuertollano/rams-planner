/**
 * Partir tareas en subactividades, contra PostgreSQL de verdad.
 *
 * El planificador puro ya tiene sus veintiséis pruebas. Lo que se comprueba
 * aquí es lo que sólo se rompe cuando la cirugía toca la base:
 *
 *   - que la tarea pase a contenedor y **deje de tener fila de tarea**, que es
 *     la invariante W3 y lo que el motor necesita para agregar;
 *   - que el trabajo total del proyecto **no se mueva ni un minuto**;
 *   - que las asignaciones, el entregable y las dependencias se muden a las
 *     puertas y no se queden colgando del contenedor;
 *   - que aplicar dos veces no vuelva a partir los trozos;
 *   - que quien puede editar el plan pero no su estructura no pueda partir.
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

const ARRANQUE_DEL_FICHERO = new Date()

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

const unico = (prefijo: string): string =>
  `${prefijo}-${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`

const CLAVE = 'una contraseña larga de prueba'

let app: FastifyInstance | null = null
let editor = ''
let sinEstructura = ''
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
  const correo = `${unico('subact')}@ejemplo.test`
  await withTransaction(pool, async (db) => {
    const userId = await createUser(db, {
      email: correo,
      displayName: 'Cuenta de prueba',
      password: CLAVE,
    })
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
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
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

interface Propuesta {
  readonly split: readonly {
    nodeId: string
    name: string
    documentTypeId: string
    children: readonly { step: string; role: string; minutes: number; isGate: boolean }[]
    chain: readonly (readonly [number, number])[]
    relinked: readonly { dependencyId: string; side: string; toOrder: number }[]
    movedResourceIds: readonly string[]
  }[]
  readonly skipped: readonly { nodeId: string; name: string; reason: string }[]
  readonly totals: {
    tasksBefore: number
    tasksAfter: number
    minutesBefore: number
    minutesAfter: number
  }
  readonly documents: readonly { id: string }[]
}

async function propuesta(cookie = editor): Promise<Propuesta> {
  const respuesta = await pedir('GET', `/api/projects/${projectId}/subactivities/plan`, cookie)
  expect(respuesta.statusCode).toBe(200)
  return respuesta.json<Propuesta>()
}

/** Lo que la base dice de un nodo, para poder mirar la cirugía por dentro. */
async function nodoEnLaBase(nodeId: string): Promise<{
  kind: string
  tieneFilaDeTarea: boolean
  hijos: number
}> {
  if (pool === null) return { kind: '', tieneFilaDeTarea: false, hijos: 0 }
  return withTransaction(pool, async (db) => {
    const { rows } = await db.query<{ node_kind: string; con_tarea: boolean; hijos: string }>(
      `SELECT n.node_kind,
              EXISTS (SELECT 1 FROM task t WHERE t.node_id = n.id) AS con_tarea,
              (SELECT count(*) FROM wbs_node h WHERE h.parent_id = n.id AND h.deleted_at IS NULL) AS hijos
       FROM wbs_node n WHERE n.id = $1`,
      [nodeId],
    )
    const fila = rows[0]
    return {
      kind: fila?.node_kind ?? '',
      tieneFilaDeTarea: fila?.con_tarea ?? false,
      hijos: Number(fila?.hijos ?? 0),
    }
  })
}

beforeAll(async () => {
  if (pool === null) return
  app = await buildServer(pool, { logLevel: 'silent' })

  editor = await cuentaCon([
    'plan.ver', 'plan.editar', 'plan.estructura', 'dependencias.editar',
    'asignaciones.editar', 'equipo.ver', 'equipo.editar', 'calcular',
    'documentos.ver', 'documentos.gestionar', 'documentos.asignar',
  ])
  // Puede editar el plan y las dependencias, pero no su estructura: partir una
  // tarea no es cambiarle un número, es cambiar de qué se compone el plan.
  sinEstructura = await cuentaCon(['plan.ver', 'plan.editar', 'dependencias.editar'])

  const proyecto = await pedir('POST', '/api/projects', editor, {
    code: unico('SUBACT'),
    name: 'Proyecto de las subactividades',
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

  // 40 h declaradas en cada una: es lo que se va a repartir.
  for (const nodeId of [tareaA, tareaB]) {
    const respuesta = await pedir('PATCH', `/api/tasks/${nodeId}`, editor, {
      workDeclaredMinutes: 2400,
    })
    expect(respuesta.statusCode).toBe(200)
  }

  const documento = async (prefijo: string): Promise<string> => {
    const respuesta = await pedir('POST', '/api/documents', editor, {
      code: unico(prefijo).slice(0, 60),
      name: `Documento ${prefijo}`,
    })
    expect(respuesta.statusCode).toBe(200)
    return respuesta.json<{ result: string }>().result
  }
  docA = await documento('SA')
  docB = await documento('SB')

  // El catálogo: crear y revisar, cuatro a uno, que es la proporción del libro.
  for (const documentId of [docA, docB]) {
    const respuesta = await pedir('PUT', `/api/documents/${documentId}/activities`, editor, {
      activities: [
        { step: 'create', position: 1, role: 'S-Eng', standardMinutes: 2400, signature: null },
        { step: 'review_1', position: 1, role: 'TL RAMS', standardMinutes: 600, signature: null },
      ],
    })
    expect(respuesta.statusCode).toBe(200)
  }

  expect(
    (await pedir('PUT', `/api/nodes/${tareaA}/documents/${docA}`, editor, { delivers: true }))
      .statusCode,
  ).toBe(200)
  expect(
    (await pedir('PUT', `/api/nodes/${tareaB}/documents/${docB}`, editor, { delivers: true }))
      .statusCode,
  ).toBe(200)

  // Y una dependencia entre las dos, para ver a dónde se re-engancha.
  expect(
    (
      await pedir('POST', '/api/dependencies', editor, {
        predecessorNodeId: tareaA,
        successorNodeId: tareaB,
      })
    ).statusCode,
  ).toBe(200)
}, 90_000)

afterAll(async () => {
  if (pool !== null) await withTransaction(pool, (db) => deleteRunsSince(db, ARRANQUE_DEL_FICHERO))
  await app?.close()
  await pool?.end()
})

const describeSiHayBase = pool === null ? describe.skip : describe

describeSiHayBase('partir tareas en subactividades', () => {
  it('la previsualización propone el reparto y no escribe nada', async () => {
    if (pool === null) return
    const plan = await propuesta()
    expect(plan.split).toHaveLength(2)
    const deA = plan.split.find((p) => p.nodeId === tareaA)
    expect(deA?.children.map((h) => [h.step, h.role, h.minutes])).toEqual([
      ['create', 'S-Eng', 1920],
      ['review_1', 'TL RAMS', 480],
    ])
    // Y la tarea sigue siendo una tarea: mirar no cambia nada.
    expect((await nodoEnLaBase(tareaA)).kind).toBe('task')
    expect((await nodoEnLaBase(tareaA)).hijos).toBe(0)
  })

  it('el trabajo total del proyecto no se mueve', async () => {
    if (pool === null) return
    const plan = await propuesta()
    expect(plan.totals.minutesAfter).toBe(plan.totals.minutesBefore)
    expect(plan.totals.minutesBefore).toBe(4800)
    expect(plan.totals.tasksBefore).toBe(2)
    expect(plan.totals.tasksAfter).toBe(4)
  })

  it('quien puede editar el plan pero no su estructura no parte nada', async () => {
    if (pool === null) return
    const respuesta = await pedir(
      'POST',
      `/api/projects/${projectId}/subactivities/apply`,
      sinEstructura,
      {},
    )
    expect(respuesta.statusCode).toBe(403)
    expect((await nodoEnLaBase(tareaA)).kind).toBe('task')
  })

  it('lo excluido no se parte', async () => {
    if (pool === null) return
    const respuesta = await pedir(
      'POST',
      `/api/projects/${projectId}/subactivities/apply`,
      editor,
      { exclude: [tareaA, tareaB] },
    )
    expect(respuesta.statusCode).toBe(200)
    expect(respuesta.json<{ result: { tasksSplit: number } }>().result.tasksSplit).toBe(0)
    expect((await nodoEnLaBase(tareaA)).kind).toBe('task')
  })

  it('aplicar convierte la tarea en paquete, sin fila de tarea y con sus hijos', async () => {
    if (pool === null) return
    const respuesta = await pedir('POST', `/api/projects/${projectId}/subactivities/apply`, editor, {})
    expect(respuesta.statusCode).toBe(200)
    const { result } = respuesta.json<{
      result: { tasksSplit: number; childrenCreated: number; chainLinks: number; relinked: number }
    }>()
    expect(result.tasksSplit).toBe(2)
    expect(result.childrenCreated).toBe(4)
    expect(result.chainLinks).toBe(2)
    // La dependencia A→B se re-engancha por sus dos extremos: sale de A y
    // entra en B, así que la cuenta dos veces, una por cada partición.
    expect(result.relinked).toBe(2)

    const contenedor = await nodoEnLaBase(tareaA)
    expect(contenedor.kind).toBe('work_package')
    // Es la invariante W3: un contenedor no tiene datos de tarea propios. Si
    // esta fila se quedara, el motor sumaría el trabajo dos veces.
    expect(contenedor.tieneFilaDeTarea).toBe(false)
    expect(contenedor.hijos).toBe(2)
  })

  it('el trabajo sigue siendo el mismo después de partir, y ahora en cuatro tareas', async () => {
    if (pool === null) return
    const total = await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{ suma: string; cuantas: string }>(
        `SELECT COALESCE(SUM(t.work_declared_minutes), 0) AS suma, count(*) AS cuantas
         FROM task t
         JOIN wbs_node n ON n.id = t.node_id AND n.deleted_at IS NULL
         WHERE n.project_id = $1`,
        [projectId],
      )
      return { suma: Number(rows[0]?.suma ?? 0), cuantas: Number(rows[0]?.cuantas ?? 0) }
    })
    expect(total.suma).toBe(4800)
    expect(total.cuantas).toBe(4)
  })

  it('la dependencia entre las dos tareas pasa a atar sus puertas', async () => {
    if (pool === null) return
    // Lo que esperaba a A espera ahora a su ÚLTIMA REVISIÓN, y empieza por la
    // CREACIÓN de B. Es lo que hace que B empiece antes de que A termine todo.
    const enlace = await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{ pred: string; suc: string; pred_padre: string; suc_padre: string }>(
        `SELECT p.name AS pred, s.name AS suc,
                p.parent_id::text AS pred_padre, s.parent_id::text AS suc_padre
         FROM dependency d
         JOIN wbs_node p ON p.id = d.predecessor_node_id
         JOIN wbs_node s ON s.id = d.successor_node_id
         WHERE p.parent_id = $1 AND s.parent_id = $2`,
        [tareaA, tareaB],
      )
      return rows[0]
    })
    expect(enlace?.pred).toContain('Revisar 1')
    expect(enlace?.suc).toContain('Crear')
  })

  it('el entregable lo entrega ahora la puerta que cierra', async () => {
    if (pool === null) return
    const quien = await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{ name: string; parent: string | null }>(
        `SELECT n.name, n.parent_id::text AS parent
         FROM node_document nd JOIN wbs_node n ON n.id = nd.node_id
         WHERE nd.document_type_id = $1`,
        [docA],
      )
      return rows[0]
    })
    expect(quien?.name).toContain('Revisar 1')
    expect(quien?.parent).toBe(tareaA)
  })

  it('aplicar otra vez no vuelve a partir los trozos', async () => {
    if (pool === null) return
    const plan = await propuesta()
    expect(plan.split).toEqual([])
    // Y las dos que se partieron salen descartadas por eso mismo.
    const partidas = plan.skipped.filter((s) => s.reason === 'ya-partida').map((s) => s.nodeId)
    expect(partidas.toSorted()).toEqual([tareaA, tareaB].toSorted())

    const respuesta = await pedir('POST', `/api/projects/${projectId}/subactivities/apply`, editor, {})
    expect(respuesta.statusCode).toBe(200)
    expect(respuesta.json<{ result: { tasksSplit: number } }>().result.tasksSplit).toBe(0)
    expect((await nodoEnLaBase(tareaA)).hijos).toBe(2)
  })

  it('cada hijo sabe de qué subactividad del catálogo viene', async () => {
    if (pool === null) return
    const filas = await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{ step: string; document_type_id: string }>(
        `SELECT v.step::text, v.document_type_id::text
         FROM node_activity v WHERE v.expanded_from = $1
         ORDER BY v.position, v.step`,
        [tareaA],
      )
      return rows
    })
    expect(filas.map((f) => f.step).toSorted()).toEqual(['create', 'review_1'])
    expect(filas.every((f) => f.document_type_id === docA)).toBe(true)
  })
})
