/**
 * El catálogo de documentos y la matriz de precedencias.
 *
 * Nada de lo que se escribe aquí cambia un plan por sí solo, así que nada de
 * esto recalcula. Es una declaración: qué entregables hay y en qué orden se
 * pueden hacer. Lo que la aplica a un proyecto concreto viene después.
 */

import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  createDocumentType,
  readDocumentTypes,
  readPrecedences,
  setNodeDocument,
  setPrecedence,
  softDeleteDocumentType,
  updateDocumentType,
  withTransaction,
  type Pool,
} from '@planner/persistence'
import { desde, porNodo } from './permissions.js'

export function registerDocumentRoutes(app: FastifyInstance, pool: Pool): void {
  const escribir = async (
    reply: FastifyReply,
    comment: string,
    handler: Parameters<typeof withTransaction<unknown>>[1],
  ): Promise<unknown> => {
    try {
      return { result: await withTransaction(pool, handler, { comment }) }
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && String(error.code) === '23505') {
        return reply.status(422).send({ error: 'Ya existe un documento con ese código.' })
      }
      throw error
    }
  }

  /** El catálogo y la matriz, que es lo que pinta la pantalla de una vez. */
  app.get('/api/documents', { config: { permission: 'documentos.ver' } }, async () =>
    withTransaction(pool, async (db) => ({
      types: await readDocumentTypes(db),
      precedences: await readPrecedences(db),
    })),
  )

  app.post('/api/documents', { config: { permission: 'documentos.gestionar' } }, async (request, reply) => {
    const body = z
      .object({
        code: z.string().min(1).max(60),
        name: z.string().min(1).max(200),
        description: z.string().max(1000).nullable().optional(),
        sortKey: z.number().int().min(0).max(100_000).optional(),
      })
      .parse(request.body)
    return escribir(reply, `alta del documento ${body.code}`, (db) => createDocumentType(db, body))
  })

  app.patch('/api/documents/:documentId', { config: { permission: 'documentos.gestionar' } }, async (request, reply) => {
    const { documentId } = z.object({ documentId: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        code: z.string().min(1).max(60).optional(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(1000).nullable().optional(),
        sortKey: z.number().int().min(0).max(100_000).optional(),
      })
      .parse(request.body)
    if (Object.keys(body).length === 0) return reply.status(400).send({ error: 'No hay nada que cambiar' })
    return escribir(reply, 'edición de un documento', async (db) => {
      await updateDocumentType(db, documentId, body)
    })
  })

  app.delete('/api/documents/:documentId', { config: { permission: 'documentos.gestionar' } }, async (request, reply) => {
    const { documentId } = z.object({ documentId: z.string().uuid() }).parse(request.params)
    return escribir(reply, 'baja de un documento', async (db) => {
      await softDeleteDocumentType(db, documentId)
    })
  })

  /**
   * Una casilla de la matriz.
   *
   * Se manda el estado que debe quedar, no «alterna»: dos pestañas abiertas
   * sobre la misma matriz no deberían dejar la casilla donde no la dejó nadie.
   */
  app.put('/api/documents/precedence', { config: { permission: 'documentos.gestionar' } }, async (request, reply) => {
    const body = z
      .object({
        predecessorId: z.string().uuid(),
        successorId: z.string().uuid(),
        required: z.boolean(),
      })
      .parse(request.body)
    if (body.predecessorId === body.successorId) {
      return reply.status(422).send({ error: 'Un documento no se espera a sí mismo.' })
    }
    return escribir(
      reply,
      body.required ? 'nueva precedencia entre documentos' : 'precedencia entre documentos retirada',
      async (db) => {
        await setPrecedence(db, body.predecessorId, body.successorId, body.required)
      },
    )
  })

  /** Qué entrega una tarea. Es lo que ata la matriz a un plan de verdad. */
  app.put(
    '/api/nodes/:nodeId/documents/:documentId',
    { config: { permission: 'documentos.asignar', project: desde(porNodo()) } },
    async (request, reply) => {
      const { nodeId, documentId } = z
        .object({ nodeId: z.string().uuid(), documentId: z.string().uuid() })
        .parse(request.params)
      const body = z.object({ delivers: z.boolean() }).parse(request.body)
      return escribir(reply, 'documento que entrega una tarea', async (db) => {
        await setNodeDocument(db, nodeId, documentId, body.delivers)
      })
    },
  )
}
