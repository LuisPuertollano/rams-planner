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
  setPredecessors,
  softDeleteDocumentType,
  updateDocumentType,
  withTransaction,
  DOCUMENT_KINDS,
  type Pool,
} from '@planner/persistence'
import { toCsv } from './csv.js'
import { fallar } from './errors.js'
import { ImportError } from './import-plan.js'
import { importDocumentsCsv } from './import-documents.js'
import { desde, porNodo } from './permissions.js'

/** Los campos de la ficha, en un sitio: los comparten el alta y la edición. */
const ficha = {
  description: z.string().max(1000).nullable().optional(),
  kind: z.enum(DOCUMENT_KINDS).optional(),
  discipline: z.string().max(60).nullable().optional(),
  gate: z.string().max(60).nullable().optional(),
  weeksBeforeGate: z.number().int().min(0).max(1000).nullable().optional(),
  standardMinutes: z.number().int().min(0).max(10_000_000).nullable().optional(),
  taskCode: z.string().max(60).nullable().optional(),
  sortKey: z.number().int().min(0).max(100_000).optional(),
}

/** Las columnas del CSV del catálogo. Una sola lista para leer y para escribir. */
const COLUMNAS_CSV = [
  'codigo', 'nombre', 'tipo', 'disciplina', 'puerta',
  'semanas_antes', 'horas', 'codigo_tarea', 'descripcion', 'espera_a',
] as const

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
        return fallar(reply, 422, 'DOCUMENTO_YA_EXISTE', 'Ya existe un documento con ese código.')
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
        ...ficha,
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
        ...ficha,
      })
      .parse(request.body)
    if (Object.keys(body).length === 0) return fallar(reply, 400, 'NADA_QUE_CAMBIAR', 'No hay nada que cambiar.')
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
      return fallar(reply, 422, 'DOCUMENTO_NO_SE_ESPERA_A_SI_MISMO', 'Un documento no se espera a sí mismo.')
    }
    return escribir(
      reply,
      body.required ? 'nueva precedencia entre documentos' : 'precedencia entre documentos retirada',
      async (db) => {
        await setPrecedence(db, body.predecessorId, body.successorId, body.required)
      },
    )
  })

  /**
   * Los predecesores de un documento, de golpe.
   *
   * Es la operación que hace usable la matriz cuando el catálogo crece: con
   * ochenta entregables, la rejilla tiene 6.400 casillas y marcar seis es una
   * tarea de puntería. Esto es «este espera a estos seis», y **sustituye la
   * lista entera**: lo que no venga se borra.
   */
  app.put('/api/documents/:documentId/predecessors', { config: { permission: 'documentos.gestionar' } }, async (request, reply) => {
    const { documentId } = z.object({ documentId: z.string().uuid() }).parse(request.params)
    const body = z.object({ predecessorIds: z.array(z.string().uuid()).max(500) }).parse(request.body)
    if (body.predecessorIds.includes(documentId)) {
      return fallar(reply, 422, 'DOCUMENTO_NO_SE_ESPERA_A_SI_MISMO', 'Un documento no se espera a sí mismo.')
    }
    return escribir(reply, 'predecesores de un documento', async (db) => {
      await setPredecessors(db, documentId, body.predecessorIds)
    })
  })

  /**
   * El catálogo entero desde un CSV.
   *
   * Es la puerta por la que entra una plantilla de verdad: un catálogo EN 50126
   * son unas ochenta filas y unas ciento treinta flechas, y eso no se teclea.
   * Cargar dos veces el mismo fichero deja el catálogo igual que cargarlo una
   * vez: el código manda.
   */
  app.post('/api/documents/import', { config: { permission: 'documentos.gestionar' } }, async (request, reply) => {
    const text = typeof request.body === 'string' ? request.body : ''
    if (text.trim() === '') return fallar(reply, 400, 'CSV_VACIO', 'El cuerpo debe ser el CSV en texto plano.')
    try {
      return await withTransaction(pool, (db) => importDocumentsCsv(db, text), {
        comment: 'importación del catálogo de documentos desde CSV',
      })
    } catch (error) {
      if (error instanceof ImportError) {
        return fallar(reply, 422, 'CSV_INVALIDO', error.message, {
          detalle: error.message,
          rows: error.rows,
        })
      }
      throw error
    }
  })

  /**
   * El catálogo de vuelta a CSV.
   *
   * Mismas columnas que la importación, a propósito: exportar, corregir en la
   * hoja de cálculo y volver a importar es el camino corto para tocar ochenta
   * filas, y sólo funciona si el fichero que sale es el que entra.
   */
  app.get('/api/documents/export.csv', { config: { permission: 'documentos.ver' } }, async (_request, reply) => {
    const { types, precedences } = await withTransaction(pool, async (db) => ({
      types: await readDocumentTypes(db),
      precedences: await readPrecedences(db),
    }))
    const codigoDe = new Map(types.map((tipo) => [tipo.id, tipo.code]))
    const esperaA = new Map<string, string[]>()
    for (const p of precedences) {
      const lista = esperaA.get(p.successorId) ?? []
      const codigo = codigoDe.get(p.predecessorId)
      if (codigo !== undefined) lista.push(codigo)
      esperaA.set(p.successorId, lista)
    }
    const rows = types.map((tipo) => ({
      codigo: tipo.code,
      nombre: tipo.name,
      tipo: tipo.kind,
      disciplina: tipo.discipline ?? '',
      puerta: tipo.gate ?? '',
      semanas_antes: tipo.weeksBeforeGate === null ? '' : String(tipo.weeksBeforeGate),
      // De vuelta a horas con coma decimal, que es como se escribieron.
      horas:
        tipo.standardMinutes === null
          ? ''
          : (tipo.standardMinutes / 60).toFixed(2).replace(/\.?0+$/, '').replace('.', ','),
      codigo_tarea: tipo.taskCode ?? '',
      descripcion: tipo.description ?? '',
      espera_a: (esperaA.get(tipo.id) ?? []).join('|'),
    }))
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="catalogo-documentos.csv"')
      .send(toCsv(rows, COLUMNAS_CSV))
  })

  /** Plantilla del CSV, con tres filas que enseñan las tres formas de fila. */
  app.get('/api/documents/plantilla.csv', { config: { permission: 'documentos.gestionar' } }, async (_request, reply) => {
    const example = [
      {
        codigo: 'S-HAZLOG', nombre: 'Hazard Log preliminar', tipo: 'documento', disciplina: 'Safety',
        puerta: 'IGR', semanas_antes: '48', horas: '120', codigo_tarea: 'PWTDF-D800',
        descripcion: 'Registro de peligros de la primera vuelta', espera_a: '',
      },
      {
        codigo: 'S-FMECA', nombre: 'FMECA', tipo: 'documento', disciplina: 'Safety',
        puerta: 'CGR', semanas_antes: '28', horas: '450', codigo_tarea: 'PWTDF-D800',
        descripcion: '', espera_a: 'S-HAZLOG',
      },
      {
        codigo: 'MST-IQA', nombre: 'Puerta IQA', tipo: 'hito', disciplina: '',
        puerta: 'IQA', semanas_antes: '', horas: '', codigo_tarea: '',
        descripcion: 'Un hito no lleva horas', espera_a: 'S-FMECA',
      },
    ]
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="plantilla-documentos.csv"')
      .send(toCsv(example, COLUMNAS_CSV))
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
