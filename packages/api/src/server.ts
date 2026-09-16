import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { createPool } from '@planner/persistence'
import { readConfig } from './config.js'
import { registerPlanRoutes } from './plan-routes.js'
import { registerResourceRoutes } from './resources-routes.js'
import { registerSkillRoutes } from './skills-routes.js'
import { registerRoutes } from './routes.js'

const config = readConfig(process.env)
const pool = createPool(config.databaseUrl)

const app = Fastify({
  logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
})

await app.register(cors, { origin: true })
// El CSV entra como texto plano: es lo que manda un formulario de fichero.
app.addContentTypeParser(['text/csv', 'text/plain'], { parseAs: 'string' }, (_request, body, done) => {
  done(null, body)
})
registerRoutes(app, pool)
registerResourceRoutes(app, pool)
registerPlanRoutes(app, pool)
registerSkillRoutes(app, pool)

// En producción la API sirve también la interfaz compilada: un solo contenedor,
// un solo origen, cero configuración de CORS para el usuario.
const webRoot = config.webRoot ?? join(dirname(fileURLToPath(import.meta.url)), '../../web/dist')
if (existsSync(webRoot)) {
  await app.register(fastifyStatic, { root: webRoot })
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) return reply.status(404).send({ error: 'No existe ese endpoint' })
    return reply.sendFile('index.html')
  })
  app.log.info({ webRoot }, 'sirviendo la interfaz compilada')
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

await app.listen({ port: config.port, host: config.host })
