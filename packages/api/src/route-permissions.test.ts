/**
 * La prueba que hace que el catálogo no se desincronice.
 *
 * No comprueba una lista escrita a mano: **registra las rutas de verdad** con
 * las mismas funciones que usa el servidor, y audita lo que salga. Si mañana
 * alguien añade un endpoint y no dice quién puede usarlo, esto falla con el
 * método y la ruta en el mensaje.
 */

import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { PERMISSIONS, PERMISSION_BY_CODE, PUBLIC_ROUTES, SCREENS } from './permissions.js'
import {
  auditRoutes,
  collectRoutePermissions,
  misplacedEnforcement,
  unusedPermissions,
} from './route-permissions.js'
import { registerPlanRoutes } from './plan-routes.js'
import { registerRebalanceRoutes } from './rebalance-routes.js'
import { registerResourceRoutes } from './resources-routes.js'
import { registerRoutes } from './routes.js'
import { registerSkillRoutes } from './skills-routes.js'
import type { Pool } from '@planner/persistence'

/**
 * Registrar rutas no ejecuta ninguna: sólo se necesita un objeto que ocupe el
 * sitio del pool. Así esta prueba no necesita base de datos y corre en el bucle
 * rápido, que es donde tiene que fallar.
 */
const poolFalso = {
  query: () => Promise.resolve({ rows: [], rowCount: 0 }),
  connect: () => Promise.resolve({}),
} as unknown as Pool

async function rutasRegistradas(): ReturnType<typeof collectRoutePermissions> extends infer T
  ? Promise<T>
  : never {
  const app = Fastify({ logger: false })
  const routes = collectRoutePermissions(app)
  registerRoutes(app, poolFalso)
  registerResourceRoutes(app, poolFalso)
  registerPlanRoutes(app, poolFalso)
  registerSkillRoutes(app, poolFalso)
  registerRebalanceRoutes(app, poolFalso)
  await app.ready()
  await app.close()
  return routes
}

describe('permisos por ruta', () => {
  it('toda ruta de la API declara un permiso del catálogo', async () => {
    const problemas = auditRoutes(await rutasRegistradas())
    // El mensaje es la mitad del valor: dice qué ruta y qué hacer con ella.
    expect(problemas.map((problema) => `${problema.route} ${problema.problem}`)).toEqual([])
  })

  it('no hay permisos en el catálogo que no proteja nada', async () => {
    const huerfanos = unusedPermissions(await rutasRegistradas())
    // Los de administración aún no tienen rutas: llegan con la hoja de roles.
    expect(huerfanos).toEqual(['roles.gestionar', 'usuarios.gestionar'])
  })

  it('los permisos que se aplican dentro de un manejador nombran rutas que existen', async () => {
    // Si alguien renombra un endpoint, el permiso se queda apuntando al vacío y
    // deja de proteger lo que decía proteger. Esto lo caza.
    expect(misplacedEnforcement(await rutasRegistradas())).toEqual([])
  })

  it('las rutas públicas son pocas, conocidas y con su razón escrita', () => {
    expect([...PUBLIC_ROUTES.keys()].sort()).toEqual([
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/me',
      '/api/health',
    ])
    for (const [ruta, razon] of PUBLIC_ROUTES) {
      expect(razon.length, `${ruta} no explica por qué es pública`).toBeGreaterThan(20)
    }
  })
})

describe('catálogo de permisos', () => {
  it('no hay códigos repetidos', () => {
    expect(PERMISSION_BY_CODE.size).toBe(PERMISSIONS.length)
  })

  it('cada permiso dice a qué pantalla pertenece y qué significa', () => {
    for (const permission of PERMISSIONS) {
      expect(SCREENS, `${permission.code} apunta a una pantalla que no existe`).toContain(permission.screen)
      expect(permission.label.length, `${permission.code} sin etiqueta legible`).toBeGreaterThan(5)
      // El detalle es lo que lee quien reparte permisos antes de marcar la
      // casilla. Un código suelto no basta para decidir nada.
      expect(permission.detail.length, `${permission.code} sin explicación`).toBeGreaterThan(30)
    }
  })

  it('los códigos son estables: minúsculas, puntos y nada más', () => {
    for (const permission of PERMISSIONS) {
      expect(permission.code, `${permission.code} no sigue el formato`).toMatch(/^[a-z]+(\.[a-z]+)?$/)
    }
  })
})
