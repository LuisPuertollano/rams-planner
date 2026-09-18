/**
 * Las subactividades de punta a punta, contra PostgreSQL de verdad.
 *
 * La función pura ya tiene sus veinticuatro pruebas y la escritura sus ocho. Lo
 * que se comprueba aquí es lo que sólo se rompe cuando las piezas se juntan:
 *
 *   - que el catálogo devuelva la cadena, lo que cuesta y **por dónde cierra**,
 *     que es el número que decidirá el plan;
 *   - que una cadena a medias **se guarde y se avise**, en vez de rechazarla;
 *   - que la firma que cuesta minutos y nadie hace se diga, que es el hueco que
 *     ADR-0032 dejó abierto;
 *   - que quien sólo puede mirar no pueda escribir una cadena.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import {
  createPool,
  createRole,
  createUser,
  grantRole,
  setRolePermissions,
  withTransaction,
} from '@planner/persistence'
import { buildServer } from './build-server.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

const unico = (prefijo: string): string =>
  `${prefijo}-${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`

const CLAVE = 'una contraseña larga de prueba'

let app: FastifyInstance | null = null
let editor = ''
let mirón = ''
const MARCA = unico('SUB').toUpperCase()

function aplicacion(): FastifyInstance {
  if (app === null) throw new Error('la aplicación no se ha montado: mira el beforeAll')
  return app
}

async function cuentaCon(permisos: readonly string[]): Promise<string> {
  if (pool === null || app === null) return ''
  const correo = `${unico('subs')}@ejemplo.test`
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
  method: 'GET' | 'POST' | 'PUT',
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

interface Catalogo {
  readonly types: readonly { id: string; code: string }[]
  readonly activities: readonly {
    documentTypeId: string
    step: string
    role: string
    standardMinutes: number | null
    signature: { step: string; position: number } | null
  }[]
  readonly activityProblems: readonly { documentTypeId: string; code: string }[]
  readonly activityEffort: readonly {
    documentTypeId: string
    minutes: number
    gateStep: string | null
    gateRole: string | null
  }[]
}

async function catalogo(): Promise<Catalogo> {
  const respuesta = await pedir('GET', '/api/documents', editor)
  expect(respuesta.statusCode).toBe(200)
  return respuesta.json<Catalogo>()
}

/** Crea un entregable de esta ejecución y devuelve su id. */
async function entregable(sufijo: string): Promise<string> {
  const alta = await pedir('POST', '/api/documents', editor, {
    code: `${MARCA}-${sufijo}`,
    name: `Entregable ${sufijo}`,
  })
  expect(alta.statusCode).toBe(200)
  const { types } = await catalogo()
  const creado = types.find((tipo) => tipo.code === `${MARCA}-${sufijo}`)
  expect(creado).toBeDefined()
  return creado?.id ?? ''
}

beforeAll(async () => {
  if (pool === null) return
  app = await buildServer(pool, { logLevel: 'silent' })
  editor = await cuentaCon(['documentos.ver', 'documentos.gestionar'])
  mirón = await cuentaCon(['documentos.ver'])
})

afterAll(async () => {
  await app?.close()
  await pool?.end()
})

describe.skipIf(pool === null)('las subactividades de punta a punta', () => {
  it('la cadena se escribe y el catálogo dice lo que cuesta y por dónde cierra', async () => {
    if (pool === null) return
    const id = await entregable('CADENA')
    // 40 h de quien escribe, 10 h de quien revisa: la proporción del libro.
    const escrito = await pedir('PUT', `/api/documents/${id}/activities`, editor, {
      activities: [
        { step: 'create', position: 1, role: 'S-Eng', standardMinutes: 2400, signature: null },
        { step: 'review_1', position: 1, role: 'TL RAMS', standardMinutes: 600, signature: null },
      ],
    })
    expect(escrito.statusCode).toBe(200)

    const { activities, activityEffort, activityProblems } = await catalogo()
    const mias = activities.filter((actividad) => actividad.documentTypeId === id)
    expect(mias.map((actividad) => actividad.role)).toEqual(['S-Eng', 'TL RAMS'])

    const esfuerzo = activityEffort.find((fila) => fila.documentTypeId === id)
    expect(esfuerzo?.minutes).toBe(3000)
    // La que cierra es la REVISIÓN, no la creación: es lo que hará esperar al
    // siguiente documento, y es lo que el libro hace en 299 de sus enlaces.
    expect(esfuerzo?.gateStep).toBe('review_1')
    expect(esfuerzo?.gateRole).toBe('TL RAMS')
    expect(activityProblems.filter((p) => p.documentTypeId === id)).toEqual([])
  })

  it('el soporte cuenta en el esfuerzo y no cierra nada', async () => {
    if (pool === null) return
    const id = await entregable('SOPORTE')
    await pedir('PUT', `/api/documents/${id}/activities`, editor, {
      activities: [
        { step: 'create', position: 1, role: 'R-Eng', standardMinutes: 2400, signature: null },
        { step: 'support', position: 1, role: 'TL RAMS', standardMinutes: 6000, signature: null },
      ],
    })

    const esfuerzo = (await catalogo()).activityEffort.find((fila) => fila.documentTypeId === id)
    expect(esfuerzo?.minutes).toBe(8400)
    expect(esfuerzo?.gateStep).toBe('create')
  })

  it('un entregable que sólo revisamos entra y sale sin un solo aviso', async () => {
    if (pool === null) return
    // Lo escribe otro departamento y aquí sólo se revisa en segundo nivel. Es
    // la mitad del trabajo de un equipo de seguridad, y una regla que lo
    // llamara error habría avisado de todo el catálogo.
    const id = await entregable('AJENO')
    await pedir('PUT', `/api/documents/${id}/activities`, editor, {
      activities: [
        { step: 'review_2', position: 1, role: 'S-Eng', standardMinutes: 240, signature: null },
      ],
    })

    const { activityProblems, activityEffort } = await catalogo()
    expect(activityProblems.filter((p) => p.documentTypeId === id)).toEqual([])
    expect(activityEffort.find((fila) => fila.documentTypeId === id)?.gateStep).toBe('review_2')
  })

  it('la firma que cuesta minutos y nadie hace se guarda igual, y se avisa', async () => {
    if (pool === null) return
    const id = await entregable('HUERFANA')
    await pedir('PUT', `/api/documents/${id}/signatures`, editor, {
      signatures: [
        { step: 'author', position: 1, role: 'Ing. RAMS', standardMinutes: 2400 },
        { step: 'approver', position: 1, role: 'PrEM', standardMinutes: 180 },
      ],
    })
    // La creación descarga la firma del autor. La del aprobador no la hace nadie.
    const escrito = await pedir('PUT', `/api/documents/${id}/activities`, editor, {
      activities: [
        {
          step: 'create',
          position: 1,
          role: 'Ing. RAMS',
          standardMinutes: 2400,
          signature: { step: 'author', position: 1 },
        },
      ],
    })
    expect(escrito.statusCode).toBe(200)

    const mios = (await catalogo()).activityProblems.filter((p) => p.documentTypeId === id)
    expect(mios.map((problema) => problema.code)).toEqual(['ACTIVITY_SIGNATURE_ORPHAN'])
  })

  it('el soporte que firma se avisa: acompaña, no firma', async () => {
    if (pool === null) return
    const id = await entregable('SOPORTEFIRMA')
    await pedir('PUT', `/api/documents/${id}/signatures`, editor, {
      signatures: [{ step: 'approver', position: 1, role: 'PrEM', standardMinutes: 180 }],
    })
    await pedir('PUT', `/api/documents/${id}/activities`, editor, {
      activities: [
        {
          step: 'support',
          position: 1,
          role: 'TL RAMS',
          standardMinutes: 6000,
          signature: { step: 'approver', position: 1 },
        },
      ],
    })

    const mios = (await catalogo()).activityProblems.filter((p) => p.documentTypeId === id)
    // Dos avisos y no uno: el soporte no firma, y además esa firma se queda sin
    // quien la haga. Las dos cosas son verdad y las dos hay que arreglarlas.
    expect(mios.map((problema) => problema.code).toSorted()).toEqual([
      'ACTIVITY_SIGNATURE_ORPHAN',
      'ACTIVITY_SUPPORT_SIGNS',
    ])
  })

  it('la casilla repetida sí se rechaza: es un cuerpo que se contradice', async () => {
    if (pool === null) return
    const id = await entregable('REPE')
    const respuesta = await pedir('PUT', `/api/documents/${id}/activities`, editor, {
      activities: [
        { step: 'review_1', position: 1, role: 'TL RAMS', standardMinutes: 600, signature: null },
        { step: 'review_1', position: 1, role: 'SYS', standardMinutes: 240, signature: null },
      ],
    })
    expect(respuesta.statusCode).toBe(422)
    expect(respuesta.json<{ code: string }>().code).toBe('SUBACTIVIDAD_CASILLA_REPETIDA')
  })

  it('volver a guardar la cadena la sustituye entera', async () => {
    if (pool === null) return
    const id = await entregable('SUSTITUYE')
    await pedir('PUT', `/api/documents/${id}/activities`, editor, {
      activities: [
        { step: 'create', position: 1, role: 'S-Eng', standardMinutes: 2400, signature: null },
        { step: 'review_1', position: 1, role: 'TL RAMS', standardMinutes: 600, signature: null },
      ],
    })
    await pedir('PUT', `/api/documents/${id}/activities`, editor, {
      activities: [
        { step: 'create', position: 1, role: 'R-Eng', standardMinutes: 3000, signature: null },
      ],
    })

    const mias = (await catalogo()).activities.filter((a) => a.documentTypeId === id)
    expect(mias).toHaveLength(1)
    expect(mias[0]?.role).toBe('R-Eng')
  })

  it('quien sólo puede mirar no escribe una cadena', async () => {
    if (pool === null) return
    const id = await entregable('MIRON')
    const respuesta = await pedir('PUT', `/api/documents/${id}/activities`, mirón, {
      activities: [
        { step: 'create', position: 1, role: 'S-Eng', standardMinutes: 2400, signature: null },
      ],
    })
    expect(respuesta.statusCode).toBe(403)
    expect((await catalogo()).activities.filter((a) => a.documentTypeId === id)).toEqual([])
  })
})
