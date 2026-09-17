/**
 * Administración: usuarios, roles y la hoja de permisos.
 *
 * Todo lo de aquí pide `usuarios.gestionar` o `roles.gestionar`, que en la
 * práctica sólo tiene el superadministrador. Dos cuidados que no son adorno:
 *
 *   - **El rol de sistema no se toca desde aquí.** La base de datos ya lo
 *     impide con un trigger; esto lo rechaza antes, con una frase en vez de un
 *     error de PostgreSQL.
 *   - **Los permisos que se guardan se validan contra el catálogo.** Guardar un
 *     código inventado dejaría una casilla marcada que no protege nada.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  createRole,
  createUser,
  deleteRole,
  grantRole,
  readGrants,
  readRoles,
  readUsers,
  revokeGrant,
  setRolePermissions,
  setUserActive,
  setUserPassword,
  withTransaction,
  type Pool,
} from '@planner/persistence'
import { olvidarEstadoDeInstalacion } from './auth-routes.js'
import { PERMISSIONS, PERMISSION_BY_CODE, SCREENS } from './permissions.js'

/** Una contraseña corta es una contraseña rota; no hay término medio útil. */
const contrasena = z.string().min(12).max(200)

export function registerAdminRoutes(app: FastifyInstance, pool: Pool): void {
  /**
   * Todo lo que la hoja necesita, de una vez: el catálogo de funciones, los
   * roles con lo que tienen marcado, los usuarios y a quién se le ha concedido
   * qué y dónde.
   */
  app.get('/api/admin/hoja', { config: { permission: 'roles.gestionar' } }, async () =>
    withTransaction(pool, async (db) => ({
      screens: SCREENS,
      permissions: PERMISSIONS,
      roles: await readRoles(db),
      users: await readUsers(db),
      grants: await readGrants(db),
    })),
  )

  app.post('/api/admin/roles', { config: { permission: 'roles.gestionar' } }, async (request) => {
    const body = z
      .object({
        code: z.string().min(2).max(40).regex(/^[a-z][a-z0-9_]*$/, 'Minúsculas, números y guion bajo'),
        name: z.string().min(2).max(80),
        description: z.string().max(300).optional(),
      })
      .parse(request.body)
    return withTransaction(pool, async (db) => ({ id: await createRole(db, body) }), {
      comment: `alta del rol ${body.code}`,
    })
  })

  /**
   * Guarda la hoja de un rol entera.
   *
   * Reemplazo completo en vez de marcar y desmarcar de una en una: así dos
   * personas editando a la vez no acaban con una mezcla que no eligió ninguna.
   */
  app.put('/api/admin/roles/:roleId/permissions', { config: { permission: 'roles.gestionar' } }, async (request, reply) => {
    const { roleId } = z.object({ roleId: z.string().uuid() }).parse(request.params)
    const body = z.object({ permissions: z.array(z.string()).max(200) }).parse(request.body)

    const desconocidos = body.permissions.filter((code) => !PERMISSION_BY_CODE.has(code))
    if (desconocidos.length > 0) {
      return reply.status(422).send({
        error: `Estas funciones no existen: ${desconocidos.join(', ')}.`,
      })
    }

    const roles = await withTransaction(pool, (db) => readRoles(db))
    const rol = roles.find((item) => item.id === roleId)
    if (rol === undefined) return reply.status(404).send({ error: 'Ese rol no existe.' })
    if (rol.isSystem) {
      return reply.status(422).send({
        error: `«${rol.name}» lo tiene todo por definición y no se edita. Es lo que evita que te quedes fuera.`,
      })
    }

    await withTransaction(pool, async (db) => { await setRolePermissions(db, roleId, body.permissions) }, {
      comment: `permisos del rol ${rol.code}`,
    })
    return { ok: true }
  })

  app.delete('/api/admin/roles/:roleId', { config: { permission: 'roles.gestionar' } }, async (request, reply) => {
    const { roleId } = z.object({ roleId: z.string().uuid() }).parse(request.params)
    const roles = await withTransaction(pool, (db) => readRoles(db))
    const rol = roles.find((item) => item.id === roleId)
    if (rol === undefined) return reply.status(404).send({ error: 'Ese rol no existe.' })
    if (rol.isSystem) return reply.status(422).send({ error: 'Un rol de sistema no se borra.' })
    await withTransaction(pool, async (db) => { await deleteRole(db, roleId) }, {
      comment: `baja del rol ${rol.code}`,
    })
    return { ok: true }
  })

  // --- Usuarios -------------------------------------------------------------

  app.get('/api/admin/usuarios', { config: { permission: 'usuarios.gestionar' } }, async () =>
    withTransaction(pool, async (db) => ({ users: await readUsers(db) })),
  )

  app.post('/api/admin/usuarios', { config: { permission: 'usuarios.gestionar' } }, async (request, reply) => {
    const body = z
      .object({
        email: z.string().email().max(200),
        displayName: z.string().min(2).max(120),
        password: contrasena,
      })
      .parse(request.body)
    try {
      const id = await withTransaction(pool, (db) => createUser(db, body), {
        comment: `alta del usuario ${body.email}`,
      })
      // El primer usuario cierra la instalación: que se note ya, sin esperar al
      // vencimiento de la caché.
      olvidarEstadoDeInstalacion()
      return { id }
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && String(error.code) === '23505') {
        return reply.status(422).send({ error: 'Ya hay un usuario con ese correo.' })
      }
      throw error
    }
  })

  app.put('/api/admin/usuarios/:userId/clave', { config: { permission: 'usuarios.gestionar' } }, async (request) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params)
    const body = z.object({ password: contrasena }).parse(request.body)
    await withTransaction(pool, async (db) => { await setUserPassword(db, userId, body.password) }, {
      comment: 'cambio de contraseña',
    })
    return { ok: true }
  })

  app.put('/api/admin/usuarios/:userId/activo', { config: { permission: 'usuarios.gestionar' } }, async (request, reply) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params)
    const body = z.object({ active: z.boolean() }).parse(request.body)

    // Desactivarse a uno mismo deja la herramienta sin quien la administre si
    // además es el único. Se rechaza antes de llegar a eso.
    if (!body.active && request.usuario?.id === userId) {
      return reply.status(422).send({ error: 'No puedes desactivar tu propia cuenta.' })
    }
    await withTransaction(pool, async (db) => { await setUserActive(db, userId, body.active) }, {
      comment: body.active ? 'reactivación de usuario' : 'baja de usuario',
    })
    return { ok: true }
  })

  // --- Concesiones ----------------------------------------------------------

  app.post('/api/admin/concesiones', { config: { permission: 'usuarios.gestionar' } }, async (request) => {
    const body = z
      .object({
        userId: z.string().uuid(),
        roleId: z.string().uuid(),
        // Nulo = en toda la herramienta; con proyecto, sólo ahí.
        projectId: z.string().uuid().nullable().default(null),
      })
      .parse(request.body)
    await withTransaction(pool, async (db) => { await grantRole(db, body.userId, body.roleId, body.projectId) }, {
      comment: 'concesión de rol',
    })
    return { ok: true }
  })

  app.delete('/api/admin/concesiones/:grantId', { config: { permission: 'usuarios.gestionar' } }, async (request, reply) => {
    const { grantId } = z.object({ grantId: z.string().uuid() }).parse(request.params)

    // Quitarse a uno mismo el rol de sistema es la forma más rápida de perder
    // el acceso a la herramienta para siempre.
    const concesiones = await withTransaction(pool, (db) => readGrants(db))
    const roles = await withTransaction(pool, (db) => readRoles(db))
    const concesion = concesiones.find((item) => item.id === grantId)
    const rol = roles.find((item) => item.id === concesion?.roleId)
    if (concesion?.userId === request.usuario?.id && rol?.isSystem === true) {
      return reply.status(422).send({
        error: 'No puedes quitarte a ti mismo la superadministración. Dásela a otra persona primero.',
      })
    }

    await withTransaction(pool, async (db) => { await revokeGrant(db, grantId) }, { comment: 'retirada de rol' })
    return { ok: true }
  })
}
