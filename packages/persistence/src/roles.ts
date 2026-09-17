/**
 * Roles, permisos y a quién se le conceden.
 *
 * El permiso efectivo sobre un proyecto es la **unión** de dos cosas: lo que se
 * tiene en toda la herramienta y lo que se tiene en ese proyecto. Es lo que la
 * gente espera —quien es planificador global también lo es en cada proyecto,
 * sin repetirlo— y evita la trampa contraria: que un rol por proyecto reste
 * permisos que ya se tenían, que es imposible de razonar cuando hay tres roles.
 *
 * El rol de sistema no lee permisos de la tabla: los tiene todos por
 * definición. Así no hay ninguna fila que borrar para dejarte fuera.
 */

import type { Queryable } from './db.js'

export interface Role {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly isSystem: boolean
  readonly permissions: readonly string[]
}

export interface RoleGrant {
  readonly id: string
  readonly userId: string
  readonly roleId: string
  /** `null` = en toda la herramienta. */
  readonly projectId: string | null
}

export async function readRoles(db: Queryable): Promise<readonly Role[]> {
  const { rows } = await db.query<{
    id: string
    code: string
    name: string
    description: string | null
    is_system: boolean
  }>(
    `SELECT id, code, name, description, is_system FROM app_role
     WHERE deleted_at IS NULL ORDER BY sort_key, code`,
  )
  const permisos = await db.query<{ role_id: string; permission_code: string }>(
    'SELECT role_id, permission_code FROM role_permission ORDER BY role_id, permission_code',
  )
  const porRol = new Map<string, string[]>()
  for (const fila of permisos.rows) {
    const lista = porRol.get(fila.role_id) ?? []
    lista.push(fila.permission_code)
    porRol.set(fila.role_id, lista)
  }
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
    permissions: porRol.get(row.id) ?? [],
  }))
}

export async function createRole(
  db: Queryable,
  input: { readonly code: string; readonly name: string; readonly description?: string | null | undefined },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app_role (code, name, description, sort_key)
     VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort_key), 0) + 10 FROM app_role)) RETURNING id`,
    [input.code, input.name, input.description ?? null],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('No se pudo crear el rol')
  return id
}

/**
 * Sustituye los permisos de un rol por los que se le pasen.
 *
 * Reemplazo completo y no «marca» / «desmarca» a propósito: la hoja se guarda
 * entera, así que dos personas editando a la vez no se quedan con una mezcla de
 * las dos ediciones que no eligió ninguna.
 */
export async function setRolePermissions(
  db: Queryable,
  roleId: string,
  permissions: readonly string[],
): Promise<void> {
  await db.query('DELETE FROM role_permission WHERE role_id = $1', [roleId])
  if (permissions.length === 0) return
  const unicos = [...new Set(permissions)].sort()
  await db.query(
    `INSERT INTO role_permission (role_id, permission_code)
     SELECT $1, code FROM unnest($2::text[]) AS t(code)`,
    [roleId, unicos],
  )
}

export async function deleteRole(db: Queryable, roleId: string): Promise<void> {
  await db.query('UPDATE app_role SET deleted_at = now() WHERE id = $1 AND NOT is_system', [roleId])
  await db.query('DELETE FROM user_role WHERE role_id = $1', [roleId])
}

export async function readGrants(db: Queryable): Promise<readonly RoleGrant[]> {
  const { rows } = await db.query<{
    id: string
    user_id: string
    role_id: string
    project_id: string | null
  }>(
    `SELECT g.id, g.user_id, g.role_id, g.project_id
     FROM user_role g JOIN app_role r ON r.id = g.role_id AND r.deleted_at IS NULL
     ORDER BY g.user_id, g.role_id, g.project_id NULLS FIRST`,
  )
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    roleId: row.role_id,
    projectId: row.project_id,
  }))
}

export async function grantRole(
  db: Queryable,
  userId: string,
  roleId: string,
  projectId: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO user_role (user_id, role_id, project_id) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [userId, roleId, projectId],
  )
}

export async function revokeGrant(db: Queryable, grantId: string): Promise<void> {
  await db.query('DELETE FROM user_role WHERE id = $1', [grantId])
}

// ---------------------------------------------------------------------------
// Permisos efectivos
// ---------------------------------------------------------------------------

export interface EffectivePermissions {
  /** `true` si es superadministrador: lo puede todo, en todas partes. */
  readonly isSuperadmin: boolean
  /** Permisos que valen en toda la herramienta. */
  readonly global: ReadonlySet<string>
  /** Permisos añadidos en un proyecto concreto, además de los globales. */
  readonly byProject: ReadonlyMap<string, ReadonlySet<string>>
}

export async function effectivePermissions(db: Queryable, userId: string): Promise<EffectivePermissions> {
  const { rows } = await db.query<{
    permission_code: string | null
    project_id: string | null
    is_system: boolean
  }>(
    `SELECT p.permission_code, g.project_id, r.is_system
     FROM user_role g
     JOIN app_role r ON r.id = g.role_id AND r.deleted_at IS NULL
     LEFT JOIN role_permission p ON p.role_id = r.id
     WHERE g.user_id = $1`,
    [userId],
  )

  const isSuperadmin = rows.some((row) => row.is_system)
  const global = new Set<string>()
  const byProject = new Map<string, Set<string>>()

  for (const row of rows) {
    if (row.permission_code === null) continue
    if (row.project_id === null) {
      global.add(row.permission_code)
      continue
    }
    const actual = byProject.get(row.project_id) ?? new Set<string>()
    actual.add(row.permission_code)
    byProject.set(row.project_id, actual)
  }

  return { isSuperadmin, global, byProject }
}

/**
 * ¿Puede esta persona hacer esto?
 *
 * Sin proyecto, la pregunta es «¿puede en algún sitio?»: sirve para decidir si
 * la pestaña se le enseña. Con proyecto, es la pregunta de verdad, la que se
 * hace antes de dejar escribir.
 */
export function can(
  permissions: EffectivePermissions,
  code: string,
  projectId?: string | null,
): boolean {
  if (permissions.isSuperadmin) return true
  if (permissions.global.has(code)) return true
  if (projectId !== undefined && projectId !== null) {
    return permissions.byProject.get(projectId)?.has(code) ?? false
  }
  // Sin proyecto concreto: basta con poder en alguno.
  for (const conjunto of permissions.byProject.values()) {
    if (conjunto.has(code)) return true
  }
  return false
}

/** Los proyectos en los que esta persona puede hacer algo concreto. */
export function projectsWhere(permissions: EffectivePermissions, code: string): 'all' | readonly string[] {
  if (permissions.isSuperadmin || permissions.global.has(code)) return 'all'
  return [...permissions.byProject.entries()]
    .filter(([, conjunto]) => conjunto.has(code))
    .map(([projectId]) => projectId)
    .sort()
}
