/**
 * Los permisos, pedidos a la aplicación entera contra PostgreSQL de verdad.
 *
 * Las pruebas de `route-permissions.test.ts` comprueban que cada ruta *declara*
 * un permiso. Esto comprueba lo otro, que es lo que de verdad importa: que
 * declararlo sirve de algo. Aquí se entra con una cuenta de verdad, con los
 * permisos que le hayan concedido, y se mira lo que contesta el servidor.
 *
 * Los tres permisos que no son una puerta sino un filtro —`costes.ver`,
 * `nivelar` y `plantillas.gestionar`— son la mitad de este fichero, porque son
 * los que un `auditRoutes()` no puede comprobar: la ruta se deja pasar y lo que
 * cambia es la respuesta.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createPool, createRole, createUser, grantRole, setRolePermissions, withTransaction } from '@planner/persistence'
import { buildServer } from './build-server.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

const unico = (prefijo: string): string =>
  `${prefijo}-${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`

const CLAVE = 'una contraseña larga de prueba'

let app: FastifyInstance | null = null
/** Sesión de alguien que lo ve todo menos los importes. */
let sinCostes = ''
/** Sesión de alguien que puede recalcular pero no nivelar ni tocar plantillas. */
let basica = ''
/** Sesión de alguien con permisos amplios pero sólo dentro de un proyecto. */
let soloEnMio = ''
/** El proyecto que esa cuenta sí puede tocar, y otro que no. */
let proyectoMio = ''
let proyectoAjeno = ''

/** La aplicación ya montada. Un `!` en cada línea sólo escondería el fallo. */
function aplicacion(): FastifyInstance {
  if (app === null) throw new Error('la aplicación no se ha montado: mira el beforeAll')
  return app
}

/**
 * Da de alta una cuenta con exactamente estos permisos y devuelve su cookie.
 * Con `projectId` el rol se concede **sólo sobre ese proyecto**, que es lo que
 * hay que poder probar.
 */
async function cuentaCon(permisos: readonly string[], projectId: string | null = null): Promise<string> {
  if (pool === null || app === null) return ''
  const correo = `${unico('prueba')}@ejemplo.test`
  await withTransaction(pool, async (db) => {
    const userId = await createUser(db, { email: correo, displayName: 'Cuenta de prueba', password: CLAVE })
    const roleId = await createRole(db, { code: unico('rol'), name: 'Rol de prueba' })
    await setRolePermissions(db, roleId, permisos)
    await grantRole(db, userId, roleId, projectId)
  })
  const respuesta = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: correo, password: CLAVE },
  })
  expect(respuesta.statusCode).toBe(200)
  return respuesta.headers['set-cookie']?.toString() ?? ''
}

beforeAll(async () => {
  if (pool === null) return
  app = await buildServer(pool, { logLevel: 'silent' })
  sinCostes = await cuentaCon(['carga.ver', 'plan.ver', 'equipo.ver', 'exportar', 'ejecuciones.ver'])
  basica = await cuentaCon(['carga.ver', 'plan.ver', 'plan.estructura', 'calcular', 'plantillas.usar'])

  // Dos proyectos de verdad: uno que la cuenta acotada puede tocar y otro que
  // no. Sin los dos, «no puede salirse del suyo» no se puede comprobar.
  const superadmin = await cuentaCon([
    'plan.ver', 'plan.estructura', 'plan.editar', 'carga.ver', 'costes.ver',
    'asignaciones.editar', 'dependencias.editar', 'equipo.ver', 'equipo.editar', 'calcular',
  ])
  proyectoMio = await creaProyecto(superadmin, 'MIO')
  proyectoAjeno = await creaProyecto(superadmin, 'AJENO')

  soloEnMio = await cuentaCon(
    [
      'plan.ver', 'plan.editar', 'plan.estructura', 'carga.ver', 'costes.ver',
      'asignaciones.editar', 'dependencias.editar',
      // Globales a propósito: el rol las lleva, pero concedido sobre un
      // proyecto no deberían contar.
      'equipo.editar', 'calcular',
    ],
    proyectoMio,
  )
}, 60_000)

async function creaProyecto(cookie: string, prefijo: string): Promise<string> {
  const respuesta = await aplicacion().inject({
    method: 'POST',
    url: '/api/projects',
    headers: { cookie },
    payload: { code: unico(prefijo), name: `Proyecto ${prefijo}`, statusStart: '2026-03-02' },
  })
  expect(respuesta.statusCode).toBe(200)
  return respuesta.json<{ result: string }>().result
}

afterAll(async () => {
  await app?.close()
  await pool?.end()
})

const describeSiHayBase = pool === null ? describe.skip : describe

describeSiHayBase('la puerta', () => {
  /**
   * Ojo con esta: no comprueba sólo el 401. Comprueba que la herramienta **se
   * cierra sola** en cuanto existe el primer usuario.
   *
   * El `beforeAll` monta la aplicación sobre una base todavía sin usuarios y
   * los crea después, que es exactamente lo que pasa en una instalación de
   * verdad cuando alguien ejecuta `crear-superadmin` con el servidor ya en
   * marcha. Si el estado «no hay usuarios» se cacheara, esto daría 200 y la
   * herramienta seguiría abierta a cualquiera.
   */
  it('sin sesión no se ve nada de la API, pero la salud sí', async () => {
    expect((await aplicacion().inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
    const estado = await aplicacion().inject({ method: 'GET', url: '/api/state' })
    expect(estado.statusCode).toBe(401)
    expect(estado.json<{ code: string }>().code).toBe('SIN_SESION')
  })

  it('un permiso que falta se explica con el nombre de la función, no con un 403 pelado', async () => {
    const respuesta = await aplicacion().inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: sinCostes },
      payload: { code: unico('P'), name: 'No debería crearse', statusStart: '2026-03-02' },
    })
    expect(respuesta.statusCode).toBe(403)
    const cuerpo = respuesta.json<{ error: string; code: string }>()
    expect(cuerpo.code).toBe('SIN_PERMISO')
    expect(cuerpo.error).toContain('proyectos')
  })
})

describeSiHayBase('costes.ver: un filtro, no una puerta', () => {
  it('la ficha del equipo llega sin tarifas: lista vacía, no ceros', async () => {
    const respuesta = await aplicacion().inject({ method: 'GET', url: '/api/resources', headers: { cookie: sinCostes } })
    expect(respuesta.statusCode).toBe(200)
    const cuerpo = respuesta.json<{
      costsHidden: boolean
      resources: readonly { costRates: readonly unknown[] }[]
    }>()
    expect(cuerpo.costsHidden).toBe(true)
    for (const recurso of cuerpo.resources) expect(recurso.costRates).toEqual([])
  })

  it('la carga se ve entera; los importes no salen del servidor', async () => {
    const estado = await aplicacion().inject({ method: 'GET', url: '/api/state', headers: { cookie: sinCostes } })
    const runId = estado.json<{ run: { id: string } | null }>().run?.id
    if (runId === undefined) return // Base sin calcular: no hay nada que filtrar.

    const carga = await aplicacion().inject({
      method: 'GET',
      url: `/api/runs/${runId}/load?bucket=month`,
      headers: { cookie: sinCostes },
    })
    expect(carga.statusCode).toBe(200)
    const cuerpo = carga.json<{ costsHidden: boolean; cells: readonly { costCents: number }[] }>()
    expect(cuerpo.costsHidden).toBe(true)
    expect(cuerpo.cells.every((celda) => celda.costCents === 0)).toBe(true)
  })

  it('el CSV sale sin la columna de coste: un cero se leería como «costó cero»', async () => {
    const estado = await aplicacion().inject({ method: 'GET', url: '/api/state', headers: { cookie: sinCostes } })
    const runId = estado.json<{ run: { id: string } | null }>().run?.id
    if (runId === undefined) return

    const csv = await aplicacion().inject({
      method: 'GET',
      url: `/api/runs/${runId}/export.csv?bucket=month`,
      headers: { cookie: sinCostes },
    })
    expect(csv.statusCode).toBe(200)
    const cabecera = csv.body.split('\n')[0] ?? ''
    expect(cabecera).not.toContain('coste_eur')
    expect(cabecera).toContain('horas')
  })
})

describeSiHayBase('nivelar y las plantillas: la misma ruta, dos decisiones', () => {
  it('quien puede recalcular no puede, por eso, nivelar', async () => {
    const nivelando = await aplicacion().inject({
      method: 'POST',
      url: '/api/calculate',
      headers: { cookie: basica },
      payload: { level: true },
    })
    expect(nivelando.statusCode).toBe(403)
    expect(nivelando.json<{ permiso: string }>().permiso).toBe('nivelar')
  })

  it('crear un proyecto desde una plantilla se puede; guardar uno como plantilla, no', async () => {
    const estado = await aplicacion().inject({ method: 'GET', url: '/api/state', headers: { cookie: basica } })
    const projects = estado.json<{ projects: readonly { id: string; isTemplate: boolean }[] }>().projects
    const molde = projects.find((proyecto) => proyecto.isTemplate)
    if (molde === undefined) return

    const desdePlantilla = await aplicacion().inject({
      method: 'POST',
      url: `/api/projects/${molde.id}/duplicate`,
      headers: { cookie: basica },
      payload: { code: unico('DESDE'), name: 'Proyecto desde plantilla', statusStart: '2026-03-02' },
    })
    expect(desdePlantilla.statusCode).toBe(200)

    const comoPlantilla = await aplicacion().inject({
      method: 'POST',
      url: `/api/projects/${molde.id}/duplicate`,
      headers: { cookie: basica },
      payload: {
        code: unico('MOLDE'),
        name: 'Molde nuevo',
        statusStart: '2026-03-02',
        asTemplate: true,
      },
    })
    expect(comoPlantilla.statusCode).toBe(403)
    expect(comoPlantilla.json<{ permiso: string }>().permiso).toBe('plantillas.gestionar')
  })

  it('convertir un proyecto en molde tampoco entra por la puerta de editar proyectos', async () => {
    const creado = await aplicacion().inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: basica },
      payload: { code: unico('EDIT'), name: 'Proyecto para editar', statusStart: '2026-03-02' },
    })
    expect(creado.statusCode).toBe(200)
    const projectId = creado.json<{ result: string }>().result

    const renombrar = await aplicacion().inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}`,
      headers: { cookie: basica },
      payload: { name: 'Nombre nuevo' },
    })
    expect(renombrar.statusCode).toBe(200)

    const convertir = await aplicacion().inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}`,
      headers: { cookie: basica },
      payload: { isTemplate: true },
    })
    expect(convertir.statusCode).toBe(403)
    expect(convertir.json<{ permiso: string }>().permiso).toBe('plantillas.gestionar')
  })
})


describeSiHayBase('un rol concedido sobre un proyecto no se sale de él', () => {
  it('edita el proyecto donde se lo concedieron', async () => {
    const respuesta = await aplicacion().inject({
      method: 'PATCH',
      url: `/api/projects/${proyectoMio}`,
      headers: { cookie: soloEnMio },
      payload: { name: 'Renombrado desde dentro' },
    })
    expect(respuesta.statusCode).toBe(200)
  })

  it('no edita el de al lado, aunque el permiso sea el mismo', async () => {
    const respuesta = await aplicacion().inject({
      method: 'PATCH',
      url: `/api/projects/${proyectoAjeno}`,
      headers: { cookie: soloEnMio },
      payload: { name: 'Esto no debería colar' },
    })
    expect(respuesta.statusCode).toBe(403)
    expect(respuesta.json<{ error: string }>().error).toContain('en este proyecto')
  })

  it('tampoco por debajo: una tarea del proyecto ajeno se deniega por su nodo', async () => {
    const nodo = await aplicacion().inject({
      method: 'POST',
      url: '/api/nodes',
      headers: { cookie: soloEnMio },
      payload: { projectId: proyectoAjeno, kind: 'task', name: 'Tarea colada', durationMinutes: 480 },
    })
    expect(nodo.statusCode).toBe(403)
  })

  it('una tarea del proyecto propio sí, y editarla también', async () => {
    const creado = await aplicacion().inject({
      method: 'POST',
      url: '/api/nodes',
      headers: { cookie: soloEnMio },
      payload: { projectId: proyectoMio, kind: 'task', name: 'Tarea propia', durationMinutes: 480 },
    })
    expect(creado.statusCode).toBe(200)
    const nodeId = creado.json<{ result: string }>().result

    const editado = await aplicacion().inject({
      method: 'PATCH',
      url: `/api/nodes/${nodeId}`,
      headers: { cookie: soloEnMio },
      payload: { name: 'Tarea propia, renombrada' },
    })
    expect(editado.statusCode).toBe(200)
  })

  it('un identificador que no existe se deniega, no se confirma que no existe', async () => {
    const respuesta = await aplicacion().inject({
      method: 'PATCH',
      url: '/api/nodes/00000000-0000-4000-8000-0000000000ff',
      headers: { cookie: soloEnMio },
      payload: { name: 'Nada' },
    })
    expect(respuesta.statusCode).toBe(403)
  })

  it('las funciones de toda la herramienta no viajan dentro de un rol por proyecto', async () => {
    // El rol lleva `equipo.editar` y `calcular`, pero concedido sobre un
    // proyecto: el equipo y el motor son de todos, así que no cuentan.
    const equipo = await aplicacion().inject({
      method: 'POST',
      url: '/api/resources',
      headers: { cookie: soloEnMio },
      payload: { code: unico('R'), displayName: 'Alguien nuevo' },
    })
    expect(equipo.statusCode).toBe(403)

    const calculo = await aplicacion().inject({
      method: 'POST',
      url: '/api/calculate',
      headers: { cookie: soloEnMio },
      payload: {},
    })
    expect(calculo.statusCode).toBe(403)
  })

  it('crear un proyecto nuevo pide el permiso en toda la herramienta, y lo dice', async () => {
    const respuesta = await aplicacion().inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: soloEnMio },
      payload: { code: unico('NUEVO'), name: 'Proyecto nuevo', statusStart: '2026-03-02' },
    })
    expect(respuesta.statusCode).toBe(403)
    expect(respuesta.json<{ error: string }>().error).toContain('en toda la herramienta')
  })
})

describeSiHayBase('lo que se lee también viene recortado', () => {
  it('el estado sólo trae los proyectos que se pueden ver', async () => {
    const respuesta = await aplicacion().inject({
      method: 'GET',
      url: '/api/state',
      headers: { cookie: soloEnMio },
    })
    expect(respuesta.statusCode).toBe(200)
    const projects = respuesta.json<{ projects: readonly { id: string }[] }>().projects
    expect(projects.map((project) => project.id)).toEqual([proyectoMio])
  })

  it('la saturación del equipo pide ver la carga en toda la herramienta', async () => {
    const estado = await aplicacion().inject({
      method: 'GET',
      url: '/api/state',
      headers: { cookie: basica },
    })
    const runId = estado.json<{ run: { id: string } | null }>().run?.id
    if (runId === undefined) return

    const respuesta = await aplicacion().inject({
      method: 'GET',
      url: `/api/runs/${runId}/utilization?bucket=month`,
      headers: { cookie: soloEnMio },
    })
    expect(respuesta.statusCode).toBe(403)
  })

  it('la carga de una ejecución llega sin las celdas de proyectos ajenos', async () => {
    const estado = await aplicacion().inject({
      method: 'GET',
      url: '/api/state',
      headers: { cookie: basica },
    })
    const runId = estado.json<{ run: { id: string } | null }>().run?.id
    if (runId === undefined) return

    const respuesta = await aplicacion().inject({
      method: 'GET',
      url: `/api/runs/${runId}/load?bucket=month`,
      headers: { cookie: soloEnMio },
    })
    expect(respuesta.statusCode).toBe(200)
    const cells = respuesta.json<{ cells: readonly { projectId: string }[] }>().cells
    expect(cells.every((cell) => cell.projectId === proyectoMio)).toBe(true)
  })
})
