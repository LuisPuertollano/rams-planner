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
import { registerBackupRoutes } from './backup-routes.js'
import { registerDocumentRoutes } from './document-routes.js'
import { describeZodError, fallar } from './errors.js'
import { registerMatrixRoutes } from './matrix-routes.js'
import { registerSubactivityRoutes } from './subactivity-routes.js'
import { registerGateRoutes } from './gate-routes.js'
import { registerDeliveryRoutes } from './delivery-routes.js'
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
  registerSubactivityRoutes(app, pool)
  registerGateRoutes(app, pool)
  registerDeliveryRoutes(app, pool)
  registerBackupRoutes(app, pool)
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

  // La copia de seguridad llega como zip, y un zip es binario: si Fastify lo
  // pasa por un parser de texto, un byte 0x00 lo parte y el fichero llega roto.
  app.addContentTypeParser('application/zip', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body)
  })

  // Se empieza a anotar ANTES de registrar nada: el hook sólo ve lo que viene
  // después de engancharlo.
  const registeredRoutes = collectRoutePermissions(app)

  // **Antes de registrar las rutas**, y no es un detalle de estilo: cada ruta se
  // queda con el manejador de errores que hubiera en su contexto al
  // registrarla. Estaba al final del fichero y por eso no corría nunca — un
  // error del motor salía con el 500 de serie de Fastify, sin `code` y con
  // «Internal Server Error» por frase.
  //
  // Es el único sitio que manda un error sin pasar por `fallar`, y a propósito:
  // el código que reenvía no lo acuñó él —viene del calendario o del motor— así
  // que no está en el catálogo de `errors.ts`. La interfaz lo trata como
  // desconocido y enseña la frase que llegó, que es el respaldo de siempre.
  app.setErrorHandler((error: unknown, _request, reply) => {
    // Lo que Zod rechazó no es un fallo del programa: es un formulario mal
    // relleno, y merece decir qué campo en vez del volcado de los problemas.
    const invalido = describeZodError(error)
    if (invalido !== null) {
      app.log.info({ err: error }, 'petición con datos inválidos')
      return fallar(reply, 422, invalido.code, invalido.mensaje, { detalle: invalido.mensaje })
    }

    app.log.error({ err: error }, 'error al atender la petición')
    const status = (error as { statusCode?: number }).statusCode ?? 500
    return reply.status(status).send({
      error: error instanceof Error ? error.message : 'Error inesperado',
      code: (error as { code?: string }).code ?? null,
    })
  })

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
  const sirveLaInterfaz = options.webRoot !== undefined && existsSync(options.webRoot)
  if (sirveLaInterfaz) {
    // `wildcard: false` es lo que hace que un fichero que no está caiga en el
    // manejador de «no encontrado» de abajo. Con el comodín puesto, el plugin se
    // queda con **todo** lo que no encajó antes, `/api/lo-que-sea` incluido, y
    // entonces una URL mal escrita de la API no se puede distinguir de una
    // pantalla de la interfaz.
    await app.register(fastifyStatic, { root: options.webRoot, wildcard: false })
    app.log.info({ webRoot: options.webRoot }, 'sirviendo la interfaz compilada')
  }

  // Una ruta que no existe se dice así, con su código, y no con el 404 que trae
  // Fastify de serie. Se registra siempre: una URL mal escrita es una URL mal
  // escrita con interfaz compilada y sin ella.
  //
  // Lo que no es de la API es la interfaz pidiendo una de sus pantallas —las
  // resuelve ella en el navegador, así que del servidor sólo necesita el
  // `index.html`—. Lo que sí es de la API, no existe y se dice.
  app.setNotFoundHandler(async (request, reply) => {
    if (sirveLaInterfaz && !request.url.startsWith('/api/')) return reply.sendFile('index.html')
    return fallar(reply, 404, 'ENDPOINT_DESCONOCIDO', 'No existe ese endpoint.')
  })

  return app
}
