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
import {
  PERMISSIONS,
  PERMISSION_BY_CODE,
  PUBLIC_ROUTES,
  SCREENS,
  SESSION_ONLY_ROUTES,
} from './permissions.js'
import {
  auditRoutes,
  collectRoutePermissions,
  misplacedEnforcement,
  unusedPermissions,
} from './route-permissions.js'
import { registerAdminRoutes } from './admin-routes.js'
import { registerAuthRoutes } from './auth-routes.js'
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
  registerAuthRoutes(app, poolFalso)
  registerAdminRoutes(app, poolFalso)
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

  it('las rutas con un permiso por proyecto dicen de qué proyecto hablan', async () => {
    // Es la mitad que un permiso declarado no garantiza. Sin esta línea, una
    // ruta nueva con `plan.editar` dejaría pasar a quien puede editar en
    // *cualquier* proyecto, y el rol acotado dejaría de acotar sin que nada
    // lo dijera.
    const rutas = await rutasRegistradas()
    const porProyecto = rutas.filter(
      (ruta) =>
        ruta.permission !== undefined &&
        PERMISSION_BY_CODE.get(ruta.permission)?.scope === 'project',
    )
    expect(porProyecto.length).toBeGreaterThan(10)
    expect(porProyecto.filter((ruta) => ruta.project === undefined)).toEqual([])
  })

  it('una ruta por proyecto sin declararlo rompe el arranque', () => {
    const problemas = auditRoutes([
      { method: 'PATCH', url: '/api/inventada/:id', permission: 'plan.editar', project: undefined },
    ])
    expect(problemas).toHaveLength(1)
    expect(problemas[0]?.problem).toContain('se concede por proyecto')
  })

  it('un permiso global con un proyecto declarado también lo rompe', () => {
    const problemas = auditRoutes([
      {
        method: 'POST',
        url: '/api/inventada',
        permission: 'equipo.editar',
        project: { from: 'request', refs: [{ in: 'params', name: 'projectId' }] },
      },
    ])
    expect(problemas).toHaveLength(1)
    expect(problemas[0]?.problem).toContain('sólo se concede en toda la herramienta')
  })

  it('no hay permisos en el catálogo que no proteja nada', async () => {
    // Ya no queda ninguno suelto: la hoja de roles trajo las rutas que faltaban.
    expect(unusedPermissions(await rutasRegistradas())).toEqual([])
  })

  it('los permisos que se aplican dentro de un manejador nombran rutas que existen', async () => {
    // Si alguien renombra un endpoint, el permiso se queda apuntando al vacío y
    // deja de proteger lo que decía proteger. Esto lo caza.
    expect(misplacedEnforcement(await rutasRegistradas())).toEqual([])
  })

  it('las rutas que sólo piden sesión son las de la propia cuenta, y ninguna más', () => {
    // Esta lista es la que más vigilancia merece: lo que entre aquí deja de
    // estar sujeto a los roles para siempre. Que sea una sola entrada, y que
    // sea cambiarse la contraseña, no es casualidad.
    expect([...SESSION_ONLY_ROUTES.keys()]).toEqual(['/api/auth/clave'])
    for (const [ruta, razon] of SESSION_ONLY_ROUTES) {
      expect(ruta.startsWith('/api/')).toBe(true)
      expect(razon.length).toBeGreaterThan(20)
    }
  })

  it('una ruta de sesión que además pida permiso rompe el arranque', () => {
    const problemas = auditRoutes([
      { method: 'POST', url: '/api/auth/clave', permission: 'usuarios.gestionar', project: undefined },
    ])
    expect(problemas).toHaveLength(1)
    expect(problemas[0]?.problem).toContain('sólo pide sesión')
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

  it('cada permiso dice si se puede acotar a un proyecto', () => {
    for (const permission of PERMISSIONS) {
      expect(['project', 'global']).toContain(permission.scope)
    }
    // Las dos formas existen: si un día se quedara sólo una, el alcance habría
    // dejado de significar algo y esto lo diría.
    expect(PERMISSIONS.some((permission) => permission.scope === 'project')).toBe(true)
    expect(PERMISSIONS.some((permission) => permission.scope === 'global')).toBe(true)
  })

  it('lo que es de todo el equipo no se puede acotar a un proyecto', () => {
    // Personas, tarifas, competencias y administración son de todos los
    // proyectos a la vez. Marcar una de éstas como «por proyecto» prometería
    // un recorte que no existe.
    const deTodos = ['Equipo', 'Competencias', 'Administración']
    for (const permission of PERMISSIONS) {
      if (deTodos.includes(permission.screen)) expect(permission.scope).toBe('global')
    }
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
