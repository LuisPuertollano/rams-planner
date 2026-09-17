/**
 * Declaración de permisos por ruta, y la comprobación que la mantiene al día.
 *
 * Fastify permite colgar `config` de cada ruta; aquí se usa para decir qué
 * permiso hace falta. `collectRoutePermissions` engancha el hook `onRoute` y se
 * queda con lo que la aplicación registra **de verdad**, no con una lista
 * paralela que alguien tiene que acordarse de actualizar.
 *
 * De ahí sale `auditRoutes`, que es lo que hace que la promesa se cumpla: una
 * ruta sin permiso, o con un permiso que no está en el catálogo, es un fallo
 * que CI enseña con nombre y apellidos.
 */

import type { FastifyInstance } from 'fastify'
import { PERMISSION_BY_CODE, PUBLIC_ROUTES } from './permissions.js'

export interface RegisteredRoute {
  readonly method: string
  readonly url: string
  readonly permission: string | undefined
}

/** Empieza a anotar las rutas que se registren a partir de ahora. */
export function collectRoutePermissions(app: FastifyInstance): RegisteredRoute[] {
  const routes: RegisteredRoute[] = []
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/api/')) return
    const config = route.config as { permission?: string } | undefined
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    for (const method of methods) {
      if (method === 'HEAD' || method === 'OPTIONS') continue
      routes.push({ method, url: route.url, permission: config?.permission })
    }
  })
  return routes
}

export interface RouteProblem {
  readonly route: string
  readonly problem: string
}

/**
 * Comprueba que toda ruta de la API dice quién puede usarla.
 *
 * Dos formas de fallar, y las dos importan:
 *
 *   - **Sin permiso declarado**: alguien añadió un endpoint y no dijo quién
 *     puede llamarlo. Por omisión quedaría abierto, que es la peor manera de
 *     que algo quede abierto: sin que nadie lo decida.
 *   - **Con un permiso que no existe**: una errata en el código deja la ruta
 *     pidiendo algo que nadie puede tener nunca, y se descubre en producción.
 */
export function auditRoutes(routes: readonly RegisteredRoute[]): readonly RouteProblem[] {
  const problems: RouteProblem[] = []
  for (const route of routes) {
    const name = `${route.method} ${route.url}`
    if (PUBLIC_ROUTES.has(route.url)) {
      if (route.permission !== undefined) {
        problems.push({
          route: name,
          problem: `es pública y además declara «${route.permission}»: decide una de las dos cosas.`,
        })
      }
      continue
    }
    if (route.permission === undefined) {
      problems.push({
        route: name,
        problem:
          'no declara permiso. Añade `config: { permission: "..." }` con un código del catálogo, ' +
          'o inclúyela en PUBLIC_ROUTES con su razón.',
      })
      continue
    }
    if (!PERMISSION_BY_CODE.has(route.permission)) {
      problems.push({
        route: name,
        problem: `declara «${route.permission}», que no está en el catálogo de permisos.`,
      })
    }
  }
  return problems
}

/**
 * Permisos del catálogo que no protegen nada: sobran, o falta usarlos.
 *
 * Los que declaran `enforcedIn` no cuentan como huérfanos —se comprueban dentro
 * de un manejador— pero tampoco quedan sueltos: `misplacedEnforcement` verifica
 * que las rutas que dicen proteger existen.
 */
export function unusedPermissions(routes: readonly RegisteredRoute[]): readonly string[] {
  const usados = new Set(routes.map((route) => route.permission).filter((code) => code !== undefined))
  return [...PERMISSION_BY_CODE.values()]
    .filter((permission) => permission.enforcedIn === undefined && !usados.has(permission.code))
    .map((permission) => permission.code)
    .sort()
}

/**
 * Permisos que dicen aplicarse dentro de una ruta que no existe.
 *
 * Pasa cuando se renombra un endpoint y nadie actualiza el catálogo: el permiso
 * se queda apuntando al vacío y deja de proteger lo que decía proteger, sin que
 * nada lo delate.
 */
export function misplacedEnforcement(routes: readonly RegisteredRoute[]): readonly string[] {
  const existentes = new Set(routes.map((route) => `${route.method} ${route.url}`))
  const problemas: string[] = []
  for (const permission of PERMISSION_BY_CODE.values()) {
    for (const ruta of permission.enforcedIn ?? []) {
      if (!existentes.has(ruta)) {
        problemas.push(`«${permission.code}» dice aplicarse en «${ruta}», que no existe.`)
      }
    }
  }
  return problemas.sort()
}
