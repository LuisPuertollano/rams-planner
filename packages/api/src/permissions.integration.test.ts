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
import {
  createPool,
  createRole,
  createUser,
  grantRole,
  setRolePermissions,
  withTransaction,
  type Pool,
} from '@planner/persistence'
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

/** El pool, para las pruebas que escriben directamente en la base. */
function baseDeDatos(): Pool {
  if (pool === null) throw new Error('sin DATABASE_URL: esta prueba no debería haberse ejecutado')
  return pool
}

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

/**
 * La dirección del servidor escuchando de verdad.
 *
 * Casi todo se prueba con `app.inject`, que es más rápido y basta. Pero el
 * contexto de auditoría **no**: `inject` no pasa por el socket y conserva una
 * cadena asíncrona que el servidor real no conserva, así que un fallo en la
 * propagación del actor pasaría desapercibido. De hecho pasó: el historial
 * guardaba los cambios sin nombre y `inject` los daba por firmados.
 */
let base = ''

beforeAll(async () => {
  if (pool === null) return
  app = await buildServer(pool, { logLevel: 'silent' })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const direccion = app.server.address()
  base = typeof direccion === 'object' && direccion !== null ? `http://127.0.0.1:${String(direccion.port)}` : ''
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
      'plan.ver', 'plan.editar', 'plan.estructura', 'carga.ver', 'costes.ver', 'equipo.ver',
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

/** Una petición por HTTP de verdad, con su cookie. */
async function pedir(
  method: string,
  ruta: string,
  cookie: string,
  cuerpo?: unknown,
): Promise<{ status: number; body: unknown }> {
  const respuesta = await fetch(`${base}${ruta}`, {
    method,
    headers: cuerpo === undefined ? { cookie } : { cookie, 'content-type': 'application/json' },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  })
  return { status: respuesta.status, body: await respuesta.json() }
}

describeSiHayBase('el historial dice quién', () => {
  it('un cambio hecho con sesión queda firmado, y el registro lo cuenta', async () => {
    // Por HTTP, no por `inject`: es la única forma de que esta prueba pueda
    // fallar cuando el contexto de auditoría deje de propagarse.
    const creado = await pedir('POST', '/api/projects', basica, {
      code: unico('FIRMA'),
      name: 'Proyecto firmado',
      statusStart: '2026-03-02',
    })
    expect(creado.status).toBe(200)
    const projectId = (creado.body as { result: string }).result

    // Quien lo creó no puede leer el registro: son permisos distintos, y eso
    // también conviene que siga siendo verdad.
    const denegado = await pedir('GET', '/api/history', basica)
    expect(denegado.status).toBe(403)

    const cronista = await cuentaCon(['historial.ver'])
    const historial = await pedir('GET', `/api/history/${projectId}`, cronista)
    expect(historial.status).toBe(200)
    const eventos = (
      historial.body as {
        events: readonly { actorId: string | null; actorName: string | null; operation: string }[]
      }
    ).events

    const alta = eventos.find((evento) => evento.operation === 'insert')
    expect(alta).toBeDefined()
    // Lo que faltaba hasta ahora: el cambio se guardaba sin nombre.
    expect(alta?.actorId).not.toBeNull()
    expect(alta?.actorName).toBe('Cuenta de prueba')
  })

  it('el registro general trae el nombre de lo que cambió, no sólo su identificador', async () => {
    const cronista = await cuentaCon(['historial.ver'])
    const respuesta = await pedir('GET', '/api/history?limit=50', cronista)
    expect(respuesta.status).toBe(200)
    const eventos = (respuesta.body as { events: readonly { entityName: string | null }[] }).events
    expect(eventos.length).toBeGreaterThan(0)
    expect(eventos.some((evento) => evento.entityName !== null)).toBe(true)
  })
})


describeSiHayBase('cambiarse la contraseña no depende de ningún rol', () => {
  it('quien no tiene ningún permiso puede cambiarla igualmente', async () => {
    const correo = `${unico('nadie')}@ejemplo.test`
    await withTransaction(baseDeDatos(), async (db) => {
      await createUser(db, { email: correo, displayName: 'Sin roles', password: CLAVE })
    })

    const entrada = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: correo, password: CLAVE }),
    })
    expect(entrada.status).toBe(200)
    const cookie = entrada.headers.get('set-cookie') ?? ''

    // No puede hacer nada más: es una cuenta sin roles.
    expect((await pedir('GET', '/api/state', cookie)).status).toBe(403)

    // Pero esto sí, y es el punto: ningún rol se lo puede quitar.
    const nueva = 'otra contraseña bien larga'
    const cambio = await pedir('POST', '/api/auth/clave', cookie, { actual: CLAVE, nueva })
    expect(cambio.status).toBe(200)

    // Cambiarla cierra la sesión: la cookie de antes ya no vale.
    expect((await pedir('GET', '/api/auth/estado', cookie)).status).toBe(401)

    // Y la nueva entra, la vieja no.
    const conVieja = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: correo, password: CLAVE }),
    })
    expect(conVieja.status).toBe(401)
    const conNueva = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: correo, password: nueva }),
    })
    expect(conNueva.status).toBe(200)
  })

  it('con la contraseña actual equivocada no cambia nada', async () => {
    const cambio = await pedir('POST', '/api/auth/clave', basica, {
      actual: 'esta no es',
      nueva: 'una contraseña nueva larga',
    })
    expect(cambio.status).toBe(401)

    // Y la sesión sigue viva: un intento fallido no expulsa a nadie.
    expect((await pedir('GET', '/api/state', basica)).status).toBe(200)
  })

  it('sin sesión no se puede cambiar la de nadie', async () => {
    const cambio = await pedir('POST', '/api/auth/clave', '', {
      actual: CLAVE,
      nueva: 'una contraseña nueva larga',
    })
    expect(cambio.status).toBe(401)
  })
})


describeSiHayBase('los importes también se recortan por proyecto', () => {
  it('ver costes en un proyecto no enseña los del de al lado', async () => {
    // `basica` ve la carga de todos los proyectos pero no tiene `costes.ver`;
    // `soloEnMio` lo tiene, pero sólo sobre el suyo. Lo que hay que comprobar
    // es que el segundo no recibe los importes del primero.
    const conCostes = await cuentaCon(['carga.ver', 'costes.ver', 'plan.ver', 'calcular'])
    const estado = await aplicacion().inject({ method: 'GET', url: '/api/state', headers: { cookie: conCostes } })
    const runId = estado.json<{ run: { id: string } | null }>().run?.id
    if (runId === undefined) return

    const todo = await aplicacion().inject({
      method: 'GET',
      url: `/api/runs/${runId}/load?bucket=month`,
      headers: { cookie: conCostes },
    })
    expect(todo.json<{ costsHidden: boolean }>().costsHidden).toBe(false)

    const recortado = await aplicacion().inject({
      method: 'GET',
      url: `/api/runs/${runId}/load?bucket=month`,
      headers: { cookie: soloEnMio },
    })
    expect(recortado.statusCode).toBe(200)
    const cells = recortado.json<{ cells: readonly { projectId: string; costCents: number }[] }>().cells
    // Sólo llegan las celdas de su proyecto, y ésas sí con su importe.
    expect(cells.every((cell) => cell.projectId === proyectoMio)).toBe(true)
  })

  it('la tarifa de una persona pide ver costes en toda la herramienta', async () => {
    // La tarifa no es de un proyecto: es lo que cobra alguien. Ve al equipo
    // entero —`equipo.ver` global— pero los costes sólo en su proyecto, que es
    // el caso que hay que separar.
    const correo = `${unico('mirón')}@ejemplo.test`
    await withTransaction(baseDeDatos(), async (db) => {
      const userId = await createUser(db, { email: correo, displayName: 'Mirón', password: CLAVE })

      const global = await createRole(db, { code: unico('rol'), name: 'Ve al equipo' })
      await setRolePermissions(db, global, ['equipo.ver', 'carga.ver', 'plan.ver'])
      await grantRole(db, userId, global, null)

      const soloUno = await createRole(db, { code: unico('rol'), name: 'Ve costes de uno' })
      await setRolePermissions(db, soloUno, ['costes.ver'])
      await grantRole(db, userId, soloUno, proyectoMio)
    })
    const entrada = await aplicacion().inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: correo, password: CLAVE },
    })
    expect(entrada.statusCode).toBe(200)
    const cookie = entrada.headers['set-cookie']?.toString() ?? ''

    const equipo = await aplicacion().inject({
      method: 'GET',
      url: '/api/resources',
      headers: { cookie },
    })
    expect(equipo.statusCode).toBe(200)
    const cuerpo = equipo.json<{
      costsHidden: boolean
      resources: readonly { costRates: readonly unknown[] }[]
    }>()
    expect(cuerpo.costsHidden).toBe(true)
    for (const recurso of cuerpo.resources) expect(recurso.costRates).toEqual([])
  })
})

describeSiHayBase('la matriz de documentos', () => {
  it('se declara una vez y se lee igual: la fila es condición de la columna', async () => {
    const editor = await cuentaCon(['documentos.ver', 'documentos.gestionar'])

    const antes = await pedir('POST', '/api/documents', editor, {
      code: unico('ANTES'),
      name: 'El que va primero',
      description: 'Sin esto no se puede cerrar el otro',
    })
    expect(antes.status).toBe(200)
    const despues = await pedir('POST', '/api/documents', editor, {
      code: unico('DESPUES'),
      name: 'El que espera',
    })
    expect(despues.status).toBe(200)

    const predecessorId = (antes.body as { result: string }).result
    const successorId = (despues.body as { result: string }).result

    const marcada = await pedir('PUT', '/api/documents/precedence', editor, {
      predecessorId,
      successorId,
      required: true,
    })
    expect(marcada.status).toBe(200)

    const catalogo = await pedir('GET', '/api/documents', editor)
    const cruces = (catalogo.body as {
      precedences: readonly { predecessorId: string; successorId: string }[]
    }).precedences
    expect(
      cruces.some((c) => c.predecessorId === predecessorId && c.successorId === successorId),
    ).toBe(true)
    // Y no al revés: la matriz no es simétrica, que es justamente lo que dice.
    expect(
      cruces.some((c) => c.predecessorId === successorId && c.successorId === predecessorId),
    ).toBe(false)

    // Desmarcar manda el estado que debe quedar, no «alterna».
    const quitada = await pedir('PUT', '/api/documents/precedence', editor, {
      predecessorId,
      successorId,
      required: false,
    })
    expect(quitada.status).toBe(200)
    const despuesDeQuitar = await pedir('GET', '/api/documents', editor)
    expect(
      (despuesDeQuitar.body as { precedences: readonly { predecessorId: string }[] }).precedences.some(
        (c) => c.predecessorId === predecessorId,
      ),
    ).toBe(false)
  })

  it('un documento no se espera a sí mismo', async () => {
    const editor = await cuentaCon(['documentos.ver', 'documentos.gestionar'])
    const creado = await pedir('POST', '/api/documents', editor, {
      code: unico('SOLO'),
      name: 'El solitario',
    })
    const id = (creado.body as { result: string }).result
    const respuesta = await pedir('PUT', '/api/documents/precedence', editor, {
      predecessorId: id,
      successorId: id,
      required: true,
    })
    expect(respuesta.status).toBe(422)
  })

  it('mirar la matriz y cambiarla son permisos distintos', async () => {
    const mirón = await cuentaCon(['documentos.ver'])
    expect((await pedir('GET', '/api/documents', mirón)).status).toBe(200)
    const intento = await pedir('POST', '/api/documents', mirón, {
      code: unico('NOPE'),
      name: 'No debería crearse',
    })
    expect(intento.status).toBe(403)
  })

  it('decir qué entrega una tarea se acota al proyecto de esa tarea', async () => {
    // `soloEnMio` tiene permisos sobre su proyecto; el documento es del equipo,
    // pero la tarea a la que se le cuelga es de un proyecto concreto.
    const editor = await cuentaCon(['documentos.ver', 'documentos.gestionar'])
    const creado = await pedir('POST', '/api/documents', editor, {
      code: unico('ENTREGA'),
      name: 'Un entregable',
    })
    const documentId = (creado.body as { result: string }).result

    const nodoAjeno = await pedir('POST', '/api/nodes', basica, {
      projectId: proyectoAjeno,
      kind: 'task',
      name: 'Tarea del vecino',
      durationMinutes: 480,
    })
    expect(nodoAjeno.status).toBe(200)
    const nodeId = (nodoAjeno.body as { result: string }).result

    const conPermisoDeOtroProyecto = await cuentaCon(['documentos.asignar'], proyectoMio)
    const intento = await pedir(
      'PUT',
      `/api/nodes/${nodeId}/documents/${documentId}`,
      conPermisoDeOtroProyecto,
      { delivers: true },
    )
    expect(intento.status).toBe(403)
  })
})
