/**
 * Rutas de la hoja de competencias.
 *
 * Igual que el resto de lo declarado, toda escritura recalcula: cambiar quién
 * sabe qué cambia los hallazgos de competencia del plan, y dejarlos viejos en
 * pantalla sería enseñar avisos que ya no son ciertos.
 */

import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  createSkill,
  deleteSkill,
  readSkillMatrix,
  setNodeSkillRequirement,
  setResourceSkill,
  withTransaction,
  type Pool,
} from '@planner/persistence'
import { calculate, defaultScenarioId } from './engine.js'

/** 0 retira; 1 a 5 es la escala declarada en el esquema. */
const nivel = z.number().int().min(0).max(5)

export function registerSkillRoutes(app: FastifyInstance, pool: Pool): void {
  const write = async (
    reply: FastifyReply,
    comment: string,
    reason: string,
    handler: Parameters<typeof withTransaction<void>>[1],
  ): Promise<unknown> => {
    try {
      await withTransaction(pool, handler, { comment })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && String(error.code) === '23505') {
        return reply.status(422).send({ error: 'Ya existe una competencia con ese código.' })
      }
      throw error
    }
    const scenarioId = await withTransaction(pool, (db) => defaultScenarioId(db))
    return { run: await calculate(pool, scenarioId, reason) }
  }

  app.get('/api/skills', { config: { permission: 'competencias.ver' } }, async () => withTransaction(pool, (db) => readSkillMatrix(db)))

  app.post('/api/skills', { config: { permission: 'competencias.catalogo' } }, async (request, reply) => {
    const body = z
      .object({ code: z.string().min(1).max(60), name: z.string().min(1).max(200) })
      .parse(request.body)
    return write(reply, `alta de la competencia ${body.code}`, 'cambio en las competencias', async (db) => {
      await createSkill(db, body.code, body.name)
    })
  })

  app.delete('/api/skills/:skillId', { config: { permission: 'competencias.catalogo' } }, async (request, reply) => {
    const { skillId } = z.object({ skillId: z.string().uuid() }).parse(request.params)
    return write(reply, 'baja de una competencia', 'cambio en las competencias', async (db) => {
      await deleteSkill(db, skillId)
    })
  })

  app.put('/api/resources/:resourceId/skills/:skillId', { config: { permission: 'competencias.editar' } }, async (request, reply) => {
    const { resourceId, skillId } = z
      .object({ resourceId: z.string().uuid(), skillId: z.string().uuid() })
      .parse(request.params)
    const { level } = z.object({ level: nivel }).parse(request.body)
    return write(reply, 'cambio de nivel de competencia', 'cambio en las competencias', async (db) => {
      await setResourceSkill(db, resourceId, skillId, level)
    })
  })

  app.put('/api/nodes/:nodeId/skills/:skillId', { config: { permission: 'requisitos.editar' } }, async (request, reply) => {
    const { nodeId, skillId } = z
      .object({ nodeId: z.string().uuid(), skillId: z.string().uuid() })
      .parse(request.params)
    const { minLevel } = z.object({ minLevel: nivel }).parse(request.body)
    return write(reply, 'cambio de requisito de competencia', 'cambio en los requisitos', async (db) => {
      await setNodeSkillRequirement(db, nodeId, skillId, minLevel)
    })
  })
}
