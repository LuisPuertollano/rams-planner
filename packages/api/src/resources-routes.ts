/**
 * Rutas de la ficha de recursos.
 *
 * Todas escriben dato DECLARADO y todas terminan recalculando: cambiar la
 * jornada, una ausencia o una tarifa cambia la capacidad y el coste, así que
 * dejar en pantalla el plan anterior sería mentir.
 */

import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  addAbsence,
  addAvailability,
  addCostRate,
  createResource,
  deleteAbsence,
  deleteAvailability,
  deleteCostRate,
  readCalendars,
  readResourceDetails,
  softDeleteResource,
  updateResource,
  withTransaction,
  type Pool,
} from '@planner/persistence'
import { puede } from './auth-routes.js'
import { calculate, defaultScenarioId } from './engine.js'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe ser AAAA-MM-DD')

const absenceKind = z.enum(['vacation', 'sick', 'training', 'parental', 'public_holiday', 'other'])

/**
 * Traduce los errores de PostgreSQL que un usuario puede provocar sin hacer
 * nada raro. Un `23P01` aquí no es un fallo del programa: es la invariante R1
 * («la disponibilidad de una persona no se solapa consigo misma») haciendo su
 * trabajo, y merece una frase en castellano, no un volcado.
 */
function describeDbError(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  const code = String(error.code)
  const constraint = 'constraint' in error ? String((error as { constraint: unknown }).constraint) : ''
  if (code === '23P01') {
    return constraint.includes('cost_rate')
      ? 'Ya hay una tarifa que cubre parte de esas fechas. Borra la anterior o ajusta el periodo.'
      : 'Ya hay un periodo de disponibilidad que se solapa con esas fechas. Borra el anterior o ajusta el periodo.'
  }
  if (code === '23505') return 'Ya existe un recurso con ese código.'
  if (code === '23514') return 'Las fechas o los valores están fuera de lo permitido (revisa que «hasta» no sea anterior a «desde»).'
  if (code === '23503') return 'El calendario indicado no existe.'
  return null
}

export function registerResourceRoutes(app: FastifyInstance, pool: Pool): void {
  /**
   * Envuelve una escritura: traduce el error de base de datos si lo hay y, si
   * todo va bien, recalcula. Devolver el `runId` nuevo es parte del contrato:
   * quien llama sabe con qué ejecución mirar el resultado de su cambio.
   */
  const write = async (
    reply: FastifyReply,
    comment: string,
    reason: string,
    handler: Parameters<typeof withTransaction<void>>[1],
  ): Promise<unknown> => {
    try {
      await withTransaction(pool, handler, { comment })
    } catch (error) {
      const message = describeDbError(error)
      if (message === null) throw error
      return reply.status(422).send({ error: message })
    }
    const scenarioId = await withTransaction(pool, (db) => defaultScenarioId(db))
    return { run: await calculate(pool, scenarioId, reason) }
  }

  app.get('/api/resources', { config: { permission: 'equipo.ver' } }, async (request) =>
    withTransaction(pool, async (db) => {
      const resources = await readResourceDetails(db)
      // La ficha del equipo se ve entera menos las tarifas: quien no puede ver
      // costes recibe la lista vacía, no una lista con ceros.
      const conCostes = puede(request, 'costes.ver')
      return {
        resources: conCostes ? resources : resources.map((resource) => ({ ...resource, costRates: [] })),
        calendars: await readCalendars(db),
        costsHidden: !conCostes,
      }
    }),
  )

  app.post('/api/resources', { config: { permission: 'equipo.editar' } }, async (request, reply) => {
    const body = z
      .object({
        code: z.string().min(1).max(60),
        displayName: z.string().min(1).max(200),
        calendarId: z.string().uuid().nullable().optional(),
        maxUnitsBp: z.number().int().min(0).max(20_000).optional(),
        activeFrom: isoDate.nullable().optional(),
        activeTo: isoDate.nullable().optional(),
      })
      .parse(request.body)
    return write(reply, `alta de ${body.displayName}`, `alta del recurso ${body.code}`, async (db) => {
      await createResource(db, body)
    })
  })

  app.patch('/api/resources/:resourceId', { config: { permission: 'equipo.editar' } }, async (request, reply) => {
    const { resourceId } = z.object({ resourceId: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        code: z.string().min(1).max(60).optional(),
        displayName: z.string().min(1).max(200).optional(),
        calendarId: z.string().uuid().nullable().optional(),
        maxUnitsBp: z.number().int().min(0).max(20_000).optional(),
        activeFrom: isoDate.nullable().optional(),
        activeTo: isoDate.nullable().optional(),
      })
      .parse(request.body)
    if (Object.keys(body).length === 0) return reply.status(400).send({ error: 'No hay nada que cambiar' })
    return write(reply, 'edición de la ficha del recurso', `edición del recurso ${resourceId}`, async (db) => {
      await updateResource(db, resourceId, body)
    })
  })

  app.delete('/api/resources/:resourceId', { config: { permission: 'equipo.editar' } }, async (request, reply) => {
    const { resourceId } = z.object({ resourceId: z.string().uuid() }).parse(request.params)
    return write(reply, 'baja del recurso', `baja del recurso ${resourceId}`, async (db) => {
      await softDeleteResource(db, resourceId)
    })
  })

  app.post('/api/resources/:resourceId/availability', { config: { permission: 'ausencias.editar' } }, async (request, reply) => {
    const { resourceId } = z.object({ resourceId: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        from: isoDate,
        to: isoDate,
        unitsBp: z.number().int().min(0).max(20_000),
        reason: z.string().max(200).nullable().optional(),
      })
      .parse(request.body)
    return write(reply, 'nueva disponibilidad', 'cambio de disponibilidad', async (db) => {
      await addAvailability(db, resourceId, body)
    })
  })

  app.delete('/api/availability/:id', { config: { permission: 'ausencias.editar' } }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    return write(reply, 'disponibilidad retirada', 'cambio de disponibilidad', async (db) => {
      await deleteAvailability(db, id)
    })
  })

  app.post('/api/resources/:resourceId/absences', { config: { permission: 'ausencias.editar' } }, async (request, reply) => {
    const { resourceId } = z.object({ resourceId: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        kind: absenceKind,
        from: isoDate,
        to: isoDate,
        minutesPerDay: z.number().int().min(0).max(1440).nullable().optional(),
        note: z.string().max(200).nullable().optional(),
      })
      .parse(request.body)
    return write(reply, 'nueva ausencia', 'cambio de ausencias', async (db) => {
      await addAbsence(db, resourceId, body)
    })
  })

  app.delete('/api/absences/:id', { config: { permission: 'ausencias.editar' } }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    return write(reply, 'ausencia retirada', 'cambio de ausencias', async (db) => {
      await deleteAbsence(db, id)
    })
  })

  app.post('/api/resources/:resourceId/rates', { config: { permission: 'tarifas.editar' } }, async (request, reply) => {
    const { resourceId } = z.object({ resourceId: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        from: isoDate,
        to: isoDate,
        standardCentsHour: z.number().int().min(0),
        currency: z.string().length(3).optional(),
      })
      .parse(request.body)
    return write(reply, 'nueva tarifa', 'cambio de tarifas', async (db) => {
      await addCostRate(db, resourceId, body)
    })
  })

  app.delete('/api/rates/:id', { config: { permission: 'tarifas.editar' } }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    return write(reply, 'tarifa retirada', 'cambio de tarifas', async (db) => {
      await deleteCostRate(db, id)
    })
  })
}
