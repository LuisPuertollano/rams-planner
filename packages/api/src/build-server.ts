/**
 * Monta la aplicación. Sin escuchar en ningún puerto y sin leer el entorno.
 *
 * Está separado de `server.ts` por una razón concreta: los permisos sólo se
 * pueden probar de verdad pidiendo a la aplicación entera —guardián incluido—,
 * y para eso hace falta poder construirla dentro de un test. Un servidor que
 * sólo existe como efecto secundario del arranque no se puede probar.
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { type Pool } from '@planner/persistence'
import { registerAdminRoutes } from './admin-routes.js'
import { registerAuthRoutes } from './auth-routes.js'
import { registerDocumentRoutes } from './document-routes.js'
import { registerMatrixRoutes } from './matrix-routes.js'
import { registerPlanRoutes } from './plan-routes.js'
import { auditRoutes, collectRoutePermissions } from './route-permissions.js'
import { registerRebalanceRoutes } from './rebalance-routes.js'
import { registerReportRoutes } from './report-routes.js'
import { registerResourceRoutes } from './resources-routes.js'
import { registerSkillRoutes } from './skills-routes.js'
import { registerRoutes } from './routes.js'

/**
 * Todas las rutas de la API, en un solo sitio.
 *
 * Está aparte para que la prueba que audita los permisos registre **lo mismo**
 * que el servidor. Una lista paralela en la prueba se olvidaría de la ruta
 * nueva —que es justo el caso que la prueba existe para cazar— y daría verde
 * mientras el endpoint queda sin comprobar.
 */
export function registerAllRoutes(app: FastifyInstance, pool: Pool): void {
  registerAuthRoutes(app, pool)
  registerAdminRoutes(app, pool)
  registerRoutes(app, pool)
  registerResourceRoutes(app, pool)
  registerPlanRoutes(app, pool)
  registerSkillRoutes(app, pool)
  registerDocumentRoutes(app, pool)
  registerMatrixRoutes(app, pool)
  registerRebalanceRoutes(app, pool)
  registerReportRoutes(app, pool)
}

export interface BuildOptions {
  /** Carpeta de la interfaz compilada. Sin ella la API sólo sirve `/api/`. */
  readonly webRoot?: string | undefined
  readonly logLevel?: string | undefined
}

export async function buildServer(pool: Pool, options: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: options.logLevel ?? 'info' },
    // El identificador de petición viaja a `change_event.request_id`, que es
    // UUID: el `req-1` que Fastify usa por defecto reventaría el trigger de
    // auditoría en cada escritura. Además, así el log y el historial hablan
    // del mismo identificador, que es medio problema resuelto cuando algo
    // falla en producción.
    genReqId: () => randomUUID(),
  })

  await app.register(cors, { origin: true })
  // El CSV entra como texto plano: es lo que manda un formulario de fichero.
  app.addContentTypeParser(['text/csv', 'text/plain'], { parseAs: 'string' }, (_request, body, done) => {
    done(null, body)
  })

  // Se empieza a anotar ANTES de registrar nada: el hook sólo ve lo que viene
  // después de engancharlo.
  const registeredRoutes = collectRoutePermissions(app)

  registerAllRoutes(app, pool)

  // Y se comprueba en el arranque, no sólo en CI: una ruta sin permiso no llega
  // a atender peticiones. Es mejor no arrancar que arrancar con un agujero.
  //
  // Sin `app.ready()` a propósito: el hook `onRoute` ya se ha disparado al
  // registrar cada ruta, y llamar a `ready()` aquí congelaría la instancia
  // antes de registrar el servidor de la interfaz, que viene justo debajo.
  const routeProblems = auditRoutes(registeredRoutes)
  if (routeProblems.length > 0) {
    for (const problem of routeProblems) app.log.error(`Ruta ${problem.route} ${problem.problem}`)
    throw new Error(
      `${String(routeProblems.length)} ruta(s) de la API sin permiso válido. Mira los errores de arriba.`,
    )
  }

  // En producción la API sirve también la interfaz compilada: un solo
  // contenedor, un solo origen, cero configuración de CORS para el usuario.
  if (options.webRoot !== undefined && existsSync(options.webRoot)) {
    await app.register(fastifyStatic, { root: options.webRoot })
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) return reply.status(404).send({ error: 'No existe ese endpoint' })
      return reply.sendFile('index.html')
    })
    app.log.info({ webRoot: options.webRoot }, 'sirviendo la interfaz compilada')
  }

  app.setErrorHandler((error: unknown, _request, reply) => {
    app.log.error({ err: error }, 'error al atender la petición')
    const status = (error as { statusCode?: number }).statusCode ?? 500
    return reply.status(status).send({
      error: error instanceof Error ? error.message : 'Error inesperado',
      // El código del hallazgo o del error de calendario viaja al cliente para
      // que la interfaz pueda explicarlo en vez de mostrar «error inesperado».
      code: (error as { code?: string }).code ?? null,
    })
  })

  return app
}
