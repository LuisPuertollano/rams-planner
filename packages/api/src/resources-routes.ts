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
import { puedeEnTodaLaHerramienta } from './auth-routes.js'
import { describeDbError, fallar } from './errors.js'
import { calculate, defaultScenarioId } from './engine.js'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe ser AAAA-MM-DD')

const absenceKind = z.enum(['vacation', 'sick', 'training', 'parental', 'public_holiday', 'other'])

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
      const fallo = describeDbError(error, 'equipo')
      if (fallo === null) throw error
      return fallar(reply, 422, fallo.code, fallo.mensaje)
    }
    const scenarioId = await withTransaction(pool, (db) => defaultScenarioId(db))
    return { run: await calculate(pool, scenarioId, reason) }
  }

  app.get('/api/resources', { config: { permission: 'equipo.ver' } }, async (request) =>
    withTransaction(pool, async (db) => {
      const resources = await readResourceDetails(db)
      // La ficha del equipo se ve entera menos las tarifas: quien no puede ver
      // costes recibe la lista vacía, no una lista con ceros.
      //
      // Y hace falta `costes.ver` **en toda la herramienta**: la tarifa es de
      // una persona, no de un proyecto, así que poder ver los importes del
      // proyecto A no da derecho a saber lo que cobra alguien.
      const conCostes = puedeEnTodaLaHerramienta(request, 'costes.ver')
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
    if (Object.keys(body).length === 0) return fallar(reply, 400, 'NADA_QUE_CAMBIAR', 'No hay nada que cambiar.')
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
