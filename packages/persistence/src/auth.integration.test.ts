/**
 * Contraseñas, sesiones y permisos efectivos, contra PostgreSQL de verdad.
 *
 * Es la parte de la herramienta donde un fallo no se ve: nadie nota que un
 * permiso se concede de más hasta que alguien mira lo que no debía. Por eso
 * aquí se comprueba tanto que lo permitido funciona como que lo prohibido
 * falla, que es la mitad que se olvida.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { createPool, withTransaction } from './db.js'
import {
  createUser,
  findSession,
  hashPassword,
  login,
  logout,
  purgeExpiredSessions,
  setUserActive,
  setUserPassword,
  verifyPassword,
} from './auth.js'
import { createProject } from './plan-edit.js'
import { can, createRole, effectivePermissions, grantRole, projectsWhere, readRoles, setRolePermissions } from './roles.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

afterAll(async () => {
  await pool?.end()
})

const unico = (prefijo: string): string =>
  `${prefijo}-${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`

describe('contraseñas', () => {
  it('el hash no contiene la contraseña, y dos hashes de la misma difieren', async () => {
    const primero = await hashPassword('correcto caballo batería grapa')
    const segundo = await hashPassword('correcto caballo batería grapa')

    expect(primero).not.toContain('correcto')
    expect(primero).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[\w+/=]+\$[\w+/=]+$/)
    // Sales distintas: dos personas con la misma contraseña no comparten hash,
    // así que una tabla precalculada no sirve de nada.
    expect(primero).not.toBe(segundo)
  })

  it('acepta la correcta y rechaza la equivocada, la vacía y un hash corrupto', async () => {
    const hash = await hashPassword('la buena')
    expect(await verifyPassword('la buena', hash)).toBe(true)
    expect(await verifyPassword('la mala', hash)).toBe(false)
    expect(await verifyPassword('', hash)).toBe(false)
    expect(await verifyPassword('la buena', null)).toBe(false)
    expect(await verifyPassword('la buena', 'basura')).toBe(false)
    expect(await verifyPassword('la buena', 'scrypt$1$2$3$$')).toBe(false)
  })
})

describe.skipIf(pool === null)('sesiones', () => {
  it('entrar devuelve una sesión que identifica a quien entró', async () => {
    if (pool === null) return
    const email = `${unico('persona')}@ejemplo.test`
    await withTransaction(pool, (db) =>
      createUser(db, { email, displayName: 'Con sesión', password: 'una contraseña larga' }),
    )

    const sesion = await withTransaction(pool, (db) => login(db, email, 'una contraseña larga', 'pruebas'))
    expect(sesion).not.toBeNull()

    const quien = await withTransaction(pool, (db) => findSession(db, sesion?.token ?? ''))
    expect(quien?.email).toBe(email)
  })

  it('la contraseña equivocada no entra, y el correo desconocido tampoco', async () => {
    if (pool === null) return
    const email = `${unico('persona')}@ejemplo.test`
    await withTransaction(pool, (db) =>
      createUser(db, { email, displayName: 'Prueba', password: 'la buena de verdad' }),
    )

    expect(await withTransaction(pool, (db) => login(db, email, 'otra cosa', null))).toBeNull()
    expect(await withTransaction(pool, (db) => login(db, 'nadie@ejemplo.test', 'lo que sea', null))).toBeNull()
  })

  it('un identificador inventado no vale, y salir invalida el bueno', async () => {
    if (pool === null) return
    const email = `${unico('persona')}@ejemplo.test`
    await withTransaction(pool, (db) => createUser(db, { email, displayName: 'Sale', password: 'contraseña larga' }))
    const sesion = await withTransaction(pool, (db) => login(db, email, 'contraseña larga', null))
    const token = sesion?.token ?? ''

    expect(await withTransaction(pool, (db) => findSession(db, 'inventado'))).toBeNull()
    expect(await withTransaction(pool, (db) => findSession(db, token))).not.toBeNull()

    await withTransaction(pool, async (db) => { await logout(db, token) })
    expect(await withTransaction(pool, (db) => findSession(db, token))).toBeNull()
  })

  it('en la base se guarda el hash del identificador, nunca el identificador', async () => {
    if (pool === null) return
    const email = `${unico('persona')}@ejemplo.test`
    await withTransaction(pool, (db) => createUser(db, { email, displayName: 'Hash', password: 'contraseña larga' }))
    const sesion = await withTransaction(pool, (db) => login(db, email, 'contraseña larga', null))
    const token = sesion?.token ?? ''

    // Quien lea la tabla —una copia de seguridad, un volcado— no puede
    // suplantar a nadie con lo que ve.
    const { rows } = await pool.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM user_session WHERE token_hash = $1',
      [token],
    )
    expect(rows[0]?.total).toBe('0')
  })

  it('cambiar la contraseña y desactivar a alguien cierran sus sesiones', async () => {
    if (pool === null) return
    const email = `${unico('persona')}@ejemplo.test`
    const userId = await withTransaction(pool, (db) =>
      createUser(db, { email, displayName: 'Cambia', password: 'la primera larga' }),
    )
    const primera = await withTransaction(pool, (db) => login(db, email, 'la primera larga', null))
    await withTransaction(pool, async (db) => { await setUserPassword(db, userId, 'la segunda larga') })
    // Si se cambia porque alguien la conocía, dejarle la sesión viva no arregla nada.
    expect(await withTransaction(pool, (db) => findSession(db, primera?.token ?? ''))).toBeNull()

    const segunda = await withTransaction(pool, (db) => login(db, email, 'la segunda larga', null))
    expect(segunda).not.toBeNull()
    await withTransaction(pool, async (db) => { await setUserActive(db, userId, false) })
    expect(await withTransaction(pool, (db) => findSession(db, segunda?.token ?? ''))).toBeNull()
    // Y desactivado no puede volver a entrar.
    expect(await withTransaction(pool, (db) => login(db, email, 'la segunda larga', null))).toBeNull()
  })

  it('las sesiones caducadas se pueden retirar', async () => {
    if (pool === null) return
    expect(await withTransaction(pool, (db) => purgeExpiredSessions(db))).toBeGreaterThanOrEqual(0)
  })
})

describe.skipIf(pool === null)('permisos efectivos', () => {
  it('el rol global vale en todas partes; el de proyecto sólo en el suyo', async () => {
    if (pool === null) return

    const { userId, proyectoA, proyectoB } = await withTransaction(pool, async (db) => {
      const user = await createUser(db, {
        email: `${unico('permisos')}@ejemplo.test`,
        displayName: 'Con permisos',
        password: 'contraseña larga',
      })
      const a = await createProject(db, { code: unico('PA'), name: 'A', statusStart: '2026-03-02' })
      const b = await createProject(db, { code: unico('PB'), name: 'B', statusStart: '2026-03-02' })

      const global = await createRole(db, { code: unico('lector'), name: 'Lector' })
      await setRolePermissions(db, global, ['plan.ver'])
      await grantRole(db, user, global, null)

      const soloA = await createRole(db, { code: unico('editor'), name: 'Editor' })
      await setRolePermissions(db, soloA, ['plan.editar'])
      await grantRole(db, user, soloA, a)

      return { userId: user, proyectoA: a, proyectoB: b }
    })

    const permisos = await withTransaction(pool, (db) => effectivePermissions(db, userId))

    expect(permisos.isSuperadmin).toBe(false)
    // Lo global vale en los dos proyectos...
    expect(can(permisos, 'plan.ver', proyectoA)).toBe(true)
    expect(can(permisos, 'plan.ver', proyectoB)).toBe(true)
    // ...y lo del proyecto sólo en el suyo. Esto es lo que se pidió.
    expect(can(permisos, 'plan.editar', proyectoA)).toBe(true)
    expect(can(permisos, 'plan.editar', proyectoB)).toBe(false)
    // Lo que no se concedió, no se tiene en ninguna parte.
    expect(can(permisos, 'tarifas.editar', proyectoA)).toBe(false)
    expect(can(permisos, 'costes.ver')).toBe(false)

    expect(projectsWhere(permisos, 'plan.ver')).toBe('all')
    expect(projectsWhere(permisos, 'plan.editar')).toEqual([proyectoA])
    expect(projectsWhere(permisos, 'tarifas.editar')).toEqual([])

    // Las tres preguntas de `can` son distintas y la diferencia importa:
    // «¿en algún sitio?» sirve para enseñar una pestaña, «¿en toda la
    // herramienta?» para dejar crear un proyecto nuevo o tocar al equipo. Que
    // lo tenga sobre el proyecto A no lo hace global, y confundirlas es
    // exactamente cómo un rol acotado deja de estarlo.
    expect(can(permisos, 'plan.editar')).toBe(true)
    expect(can(permisos, 'plan.editar', null)).toBe(false)
    expect(can(permisos, 'plan.ver', null)).toBe(true)
  })

  it('el superadministrador lo puede todo sin tener una sola fila de permisos', async () => {
    if (pool === null) return

    const userId = await withTransaction(pool, async (db) => {
      const user = await createUser(db, {
        email: `${unico('jefe')}@ejemplo.test`,
        displayName: 'Superadmin',
        password: 'contraseña larga',
      })
      const roles = await readRoles(db)
      const sistema = roles.find((rol) => rol.isSystem)
      await grantRole(db, user, sistema?.id ?? '', null)
      // Y ese rol no tiene permisos en la tabla: los tiene por definición.
      expect(sistema?.permissions).toEqual([])
      return user
    })

    const permisos = await withTransaction(pool, (db) => effectivePermissions(db, userId))
    expect(permisos.isSuperadmin).toBe(true)
    expect(can(permisos, 'tarifas.editar')).toBe(true)
    expect(can(permisos, 'roles.gestionar')).toBe(true)
    expect(can(permisos, 'lo.que.sea.inventado')).toBe(true)
    expect(projectsWhere(permisos, 'costes.ver')).toBe('all')
  })

  it('quien no tiene ningún rol no puede nada', async () => {
    if (pool === null) return
    const userId = await withTransaction(pool, (db) =>
      createUser(db, {
        email: `${unico('nadie')}@ejemplo.test`,
        displayName: 'Sin roles',
        password: 'contraseña larga',
      }),
    )
    const permisos = await withTransaction(pool, (db) => effectivePermissions(db, userId))
    expect(permisos.isSuperadmin).toBe(false)
    expect(can(permisos, 'plan.ver')).toBe(false)
    expect(can(permisos, 'carga.ver')).toBe(false)
  })
})
