/**
 * Contraseñas, sesiones y permisos efectivos.
 *
 * Tres decisiones que conviene no revisar a la ligera:
 *
 *   - **La contraseña no se guarda.** Se guarda una derivación lenta con sal,
 *     con `scrypt` de la biblioteca estándar de Node. Nada de dependencias
 *     nativas que compilar en Alpine, y nada de digests rápidos: un SHA-256 de
 *     una contraseña se rompe con una tabla, por muy «hash» que sea.
 *   - **El identificador de sesión tampoco.** Se guarda su hash. Quien lea la
 *     tabla —una copia de seguridad, un volcado— no puede suplantar a nadie.
 *   - **La comparación es en tiempo constante.** Comparar con `===` filtra
 *     información por el tiempo que tarda en fallar.
 */

import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { promisify } from 'node:util'
import type { Queryable } from './db.js'

// `promisify` no conserva la sobrecarga de `scrypt` que acepta opciones, así
// que se tipa a mano. Sin esto no se podrían fijar los parámetros de coste, que
// es justo lo que hace que el hash sirva de algo.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>

/**
 * Parámetros de coste. `N` es el que manda: 2^15 tarda del orden de 100 ms en
 * un servidor modesto, que es caro para quien prueba millones de contraseñas y
 * ni se nota al entrar.
 */
const SCRYPT_N = 32_768
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 64

/**
 * `scrypt` es caro en memoria a propósito: eso es lo que lo hace resistente a
 * quien prueba contraseñas con hardware dedicado. Node trae un tope de 32 MB
 * que estos parámetros rozan, así que hay que declararlo o falla con un
 * «memory limit exceeded» que no dice nada de lo que pasa.
 *
 * El límite se calcula de N y r, no se fija a ojo: si mañana se sube el coste,
 * esto sube con él en vez de romperse.
 */
const maxmemFor = (n: number, r: number): number => Math.max(32 * 1024 * 1024, 256 * n * r)

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: maxmemFor(SCRYPT_N, SCRYPT_R),
  })
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$')
}

/**
 * Verifica una contraseña contra su hash.
 *
 * Lee los parámetros del propio hash en vez de usar las constantes de arriba:
 * así, el día que se suba el coste, las contraseñas viejas siguen entrando y se
 * pueden re-derivar al vuelo en vez de obligar a todo el mundo a cambiarla.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (stored === null) return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, hashB64] = parts
  const salt = Buffer.from(saltB64 ?? '', 'base64')
  const expected = Buffer.from(hashB64 ?? '', 'base64')
  if (salt.length === 0 || expected.length === 0) return false

  const derived = await scryptAsync(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: maxmemFor(Number(n), Number(r)),
  })
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

/** El identificador de sesión viaja en la cookie; en la base vive su hash. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

export interface AppUser {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly isActive: boolean
  readonly hasPassword: boolean
  readonly lastLoginAt: string | null
}

export async function readUsers(db: Queryable): Promise<readonly AppUser[]> {
  const { rows } = await db.query<{
    id: string
    email: string
    display_name: string
    is_active: boolean
    has_password: boolean
    last_login_at: Date | null
  }>(
    `SELECT id, email, display_name, is_active, password_hash IS NOT NULL AS has_password, last_login_at
     FROM app_user WHERE deleted_at IS NULL ORDER BY display_name, id`,
  )
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isActive: row.is_active,
    hasPassword: row.has_password,
    lastLoginAt: row.last_login_at?.toISOString() ?? null,
  }))
}

export async function createUser(
  db: Queryable,
  input: { readonly email: string; readonly displayName: string; readonly password: string },
): Promise<string> {
  const hash = await hashPassword(input.password)
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app_user (email, display_name, password_hash, password_changed_at)
     VALUES ($1, $2, $3, now()) RETURNING id`,
    [input.email.trim().toLowerCase(), input.displayName, hash],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('No se pudo crear el usuario')
  return id
}

export async function setUserPassword(db: Queryable, userId: string, password: string): Promise<void> {
  const hash = await hashPassword(password)
  await db.query(
    'UPDATE app_user SET password_hash = $2, password_changed_at = now() WHERE id = $1',
    [userId, hash],
  )
  // Cambiar la contraseña cierra las sesiones abiertas. Si se cambia porque
  // alguien la conocía, dejarle la sesión viva no arregla nada.
  await db.query('DELETE FROM user_session WHERE user_id = $1', [userId])
}

/**
 * Cambiar la propia contraseña, comprobando la actual.
 *
 * Pedir la actual no es burocracia: sin ella, una sesión robada o un ordenador
 * sin bloquear bastan para quedarse con la cuenta para siempre. Devuelve
 * `false` si la actual no es correcta, y quien llama contesta lo mismo que
 * contestaría al entrar mal.
 */
export async function changeOwnPassword(
  db: Queryable,
  userId: string,
  current: string,
  next: string,
): Promise<boolean> {
  const { rows } = await db.query<{ password_hash: string | null }>(
    'SELECT password_hash FROM app_user WHERE id = $1 AND is_active AND deleted_at IS NULL',
    [userId],
  )
  const hash = rows[0]?.password_hash
  if (hash === undefined || hash === null) return false
  if (!(await verifyPassword(current, hash))) return false
  await setUserPassword(db, userId, next)
  return true
}

export async function setUserActive(db: Queryable, userId: string, active: boolean): Promise<void> {
  await db.query('UPDATE app_user SET is_active = $2 WHERE id = $1', [userId, active])
  if (!active) await db.query('DELETE FROM user_session WHERE user_id = $1', [userId])
}

// ---------------------------------------------------------------------------
// Sesiones
// ---------------------------------------------------------------------------

/** Duración de una sesión. Se renueva sola mientras se use. */
const SESSION_DAYS = 14

export async function login(
  db: Queryable,
  email: string,
  password: string,
  userAgent: string | null,
): Promise<{ readonly token: string; readonly user: AppUser } | null> {
  const { rows } = await db.query<{
    id: string
    email: string
    display_name: string
    is_active: boolean
    password_hash: string | null
  }>(
    `SELECT id, email, display_name, is_active, password_hash
     FROM app_user WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
    [email.trim()],
  )
  const row = rows[0]

  // Se verifica igual aunque el usuario no exista o esté inactivo: si el
  // servidor contestara antes en ese caso, el tiempo de respuesta diría qué
  // correos están dados de alta.
  const ok = await verifyPassword(password, row?.password_hash ?? null)
  if (row === undefined || !ok || !row.is_active) return null

  const token = newSessionToken()
  await db.query(
    `INSERT INTO user_session (token_hash, user_id, expires_at, user_agent)
     VALUES ($1, $2, now() + ($3 || ' days')::interval, $4)`,
    [hashToken(token), row.id, String(SESSION_DAYS), userAgent],
  )
  await db.query('UPDATE app_user SET last_login_at = now() WHERE id = $1', [row.id])

  return {
    token,
    user: {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      isActive: row.is_active,
      hasPassword: true,
      lastLoginAt: new Date().toISOString(),
    },
  }
}

export async function findSession(db: Queryable, token: string): Promise<AppUser | null> {
  const { rows } = await db.query<{
    id: string
    email: string
    display_name: string
    is_active: boolean
    last_login_at: Date | null
  }>(
    `SELECT u.id, u.email, u.display_name, u.is_active, u.last_login_at
     FROM user_session s JOIN app_user u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.deleted_at IS NULL AND u.is_active`,
    [hashToken(token)],
  )
  const row = rows[0]
  if (row === undefined) return null

  // La sesión se renueva mientras se usa: quien trabaja a diario no tiene que
  // volver a entrar cada dos semanas por el reloj.
  await db.query(
    `UPDATE user_session SET last_seen_at = now(), expires_at = now() + ($2 || ' days')::interval
     WHERE token_hash = $1`,
    [hashToken(token), String(SESSION_DAYS)],
  )

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isActive: row.is_active,
    hasPassword: true,
    lastLoginAt: row.last_login_at?.toISOString() ?? null,
  }
}

export async function logout(db: Queryable, token: string): Promise<void> {
  await db.query('DELETE FROM user_session WHERE token_hash = $1', [hashToken(token)])
}

/** Las sesiones caducadas no sirven de nada y se acumulan. */
export async function purgeExpiredSessions(db: Queryable): Promise<number> {
  const { rowCount } = await db.query('DELETE FROM user_session WHERE expires_at < now()')
  return rowCount ?? 0
}
