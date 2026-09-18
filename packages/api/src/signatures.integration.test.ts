/**
 * El ciclo de firma de punta a punta, contra PostgreSQL de verdad.
 *
 * La función pura ya tiene sus quince pruebas y la escritura las suyas. Lo que
 * se comprueba aquí es lo que sólo se rompe cuando las piezas se juntan:
 *
 *   - que **el fichero que sale sea el que entra** — importar un catálogo con
 *     ciclo, exportarlo y volver a importarlo tiene que dar lo mismo, que es
 *     todo el sentido de tener las dos columnas en el mismo contrato;
 *   - que un ciclo mal repartido **se guarde y se avise**, en vez de rechazar
 *     el fichero entero por una casilla;
 *   - que quien sólo puede mirar no pueda escribir un ciclo.
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
/** El prefijo de esta ejecución: la base acumula catálogos de otras pruebas. */
const MARCA = unico('FIRMA').toUpperCase()

function aplicacion(): FastifyInstance {
  if (app === null) throw new Error('la aplicación no se ha montado: mira el beforeAll')
  return app
}

async function cuentaCon(permisos: readonly string[]): Promise<string> {
  if (pool === null || app === null) return ''
  const correo = `${unico('firmas')}@ejemplo.test`
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

const CABECERA =
  'codigo;nombre;tipo;disciplina;puerta;semanas_antes;horas;codigo_tarea;descripcion;espera_a;' +
  'autor;verificador_1;verificador_2;aprobador;revisores'

/** El ciclo del «Plan RAM» y del «FMECA», como los trae la tabla 3. */
const CATALOGO = [
  CABECERA,
  `${MARCA}-PLAN;Plan RAM;documento;RAM;IGR;48;120;;;;Ing. RAMS;Ing. Sistemas;Jefe RAMS;PrEM;Calidad|Compras`,
  `${MARCA}-FMECA;FMECA;documento;RAM;CGR;28;450;;;${MARCA}-PLAN;Ing. RAMS 1;Ing. RAMS 2;Ing. Sistemas;PrEM;`,
].join('\n')

async function importar(texto: string, cookie = editor): Promise<LightMyRequestResponse> {
  return aplicacion().inject({
    method: 'POST',
    url: '/api/documents/import',
    headers: { cookie, 'content-type': 'text/plain' },
    payload: texto,
  })
}

/** Las filas de la exportación que son de esta ejecución, por su prefijo. */
async function exportadas(): Promise<readonly string[]> {
  const respuesta = await pedir('GET', '/api/documents/export.csv', editor)
  expect(respuesta.statusCode).toBe(200)
  return respuesta.body.split('\n').filter((linea) => linea.startsWith(MARCA))
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

describe.skipIf(pool === null)('el ciclo de firma de punta a punta', () => {
  it('entra desde el CSV y llega entero a la lectura del catálogo', async () => {
    if (pool === null) return
    const importado = await importar(CATALOGO)
    expect(importado.statusCode).toBe(200)
    const resumen = importado.json<{ signatures: number; warnings: readonly string[] }>()
    // 6 firmas del plan (dos revisores) + 4 del FMECA.
    expect(resumen.signatures).toBe(10)
    // Ningún ciclo está mal repartido: «Ing. RAMS 1» y «Ing. RAMS 2» son dos.
    expect(resumen.warnings).toEqual([])

    const catalogo = await pedir('GET', '/api/documents', editor)
    expect(catalogo.statusCode).toBe(200)
    const { types, signatures } = catalogo.json<{
      types: readonly { id: string; code: string }[]
      signatures: readonly { documentTypeId: string; step: string; position: number; role: string }[]
    }>()
    const plan = types.find((tipo) => tipo.code === `${MARCA}-PLAN`)
    expect(plan).toBeDefined()
    const suyas = signatures.filter((firma) => firma.documentTypeId === plan?.id)
    expect(suyas.map((firma) => `${firma.step}${String(firma.position)}=${firma.role}`)).toEqual([
      'author1=Ing. RAMS',
      'verifier1=Ing. Sistemas',
      'verifier2=Jefe RAMS',
      'approver1=PrEM',
      'reviewer1=Calidad',
      'reviewer2=Compras',
    ])
  })

  it('el fichero que sale es el que entra: exportar y volver a importar no cambia nada', async () => {
    if (pool === null) return
    expect((await importar(CATALOGO)).statusCode).toBe(200)
    const primera = await exportadas()
    expect(primera).toHaveLength(2)
    expect(primera[0]).toContain('Ing. RAMS;Ing. Sistemas;Jefe RAMS;PrEM;Calidad|Compras')

    // Se vuelve a importar tal cual salió, con su cabecera.
    const respuesta = await pedir('GET', '/api/documents/export.csv', editor)
    expect((await importar(respuesta.body)).statusCode).toBe(200)
    expect(await exportadas()).toEqual(primera)
  })

  it('un ciclo mal repartido se guarda y se avisa, en vez de rechazar el fichero', async () => {
    if (pool === null) return
    const roto = [
      CABECERA,
      // El autor se verifica a sí mismo y no hay aprobador.
      `${MARCA}-ROTO;Sin aprobador;documento;RAM;IGR;10;40;;;;Ing. RAMS;Ing. RAMS;;;`,
    ].join('\n')
    const importado = await importar(roto)
    expect(importado.statusCode).toBe(200)
    const resumen = importado.json<{ signatures: number; warnings: readonly string[] }>()
    expect(resumen.signatures).toBe(2)
    expect(resumen.warnings).toHaveLength(2)
    expect(resumen.warnings.join(' ')).toContain('no dice quién lo aprueba')
    expect(resumen.warnings.join(' ')).toContain('firma su propio trabajo')
  })

  it('las columnas ausentes no borran el ciclo que ya estaba', async () => {
    if (pool === null) return
    expect((await importar(CATALOGO)).statusCode).toBe(200)
    // El mismo catálogo sin las cinco columnas de firma: no habla del ciclo.
    const sinFirmas = [
      'codigo;nombre;disciplina',
      `${MARCA}-PLAN;Plan RAM;RAM`,
    ].join('\n')
    const importado = await importar(sinFirmas)
    expect(importado.statusCode).toBe(200)
    expect(importado.json<{ signatures: number }>().signatures).toBe(0)

    const filas = await exportadas()
    expect(filas.find((fila) => fila.startsWith(`${MARCA}-PLAN;`))).toContain('Ing. RAMS;Ing. Sistemas')
  })

  it('dos firmas en la misma casilla se rechazan: el cuerpo se contradice', async () => {
    if (pool === null) return
    expect((await importar(CATALOGO)).statusCode).toBe(200)
    const catalogo = await pedir('GET', '/api/documents', editor)
    const plan = catalogo
      .json<{ types: readonly { id: string; code: string }[] }>()
      .types.find((tipo) => tipo.code === `${MARCA}-PLAN`)

    const respuesta = await pedir('PUT', `/api/documents/${String(plan?.id)}/signatures`, editor, {
      signatures: [
        { step: 'verifier', position: 1, role: 'Uno', standardMinutes: null },
        { step: 'verifier', position: 1, role: 'Otro', standardMinutes: null },
      ],
    })
    expect(respuesta.statusCode).toBe(422)
    expect(respuesta.json<{ code: string }>().code).toBe('FIRMA_CASILLA_REPETIDA')
  })

  it('quien sólo puede mirar el catálogo no puede escribir un ciclo', async () => {
    if (pool === null) return
    expect((await importar(CATALOGO)).statusCode).toBe(200)
    const catalogo = await pedir('GET', '/api/documents', mirón)
    expect(catalogo.statusCode).toBe(200)
    const plan = catalogo
      .json<{ types: readonly { id: string; code: string }[] }>()
      .types.find((tipo) => tipo.code === `${MARCA}-PLAN`)

    const respuesta = await pedir('PUT', `/api/documents/${String(plan?.id)}/signatures`, mirón, {
      signatures: [{ step: 'author', position: 1, role: 'Yo mismo', standardMinutes: null }],
    })
    expect(respuesta.statusCode).toBe(403)
  })
})
