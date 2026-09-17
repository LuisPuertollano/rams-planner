/** El punto de entrada: lee el entorno, monta la aplicación y escucha. */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPool } from '@planner/persistence'
import { buildServer } from './build-server.js'
import { readConfig } from './config.js'

const config = readConfig(process.env)
const pool = createPool(config.databaseUrl)

const app = await buildServer(pool, {
  webRoot: config.webRoot ?? join(dirname(fileURLToPath(import.meta.url)), '../../web/dist'),
  logLevel: process.env['LOG_LEVEL'],
})

await app.listen({ port: config.port, host: config.host })
