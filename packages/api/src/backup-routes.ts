/**
 * Sacar la copia y volver a meterla.
 *
 * Dos rutas, y la segunda es la que da miedo: restaurar **borra todo**. Por eso
 * pide un permiso propio que no tiene nadie por defecto, exige que el cuerpo
 * venga como zip de verdad, y comprueba la copia entera —sumas, manifiesto,
 * versión del esquema, tablas que faltan— **antes** de borrar la primera fila.
 *
 * Y por eso también existe la tercera, `comprobar`: enseña lo que haría sin
 * tocar nada. Mismo trato que partir en entregas o aplicar la matriz, y aquí
 * pesa más que en ninguna otra parte de la herramienta.
 */

import type { FastifyInstance } from 'fastify'
import { withTransaction, type Pool } from '@planner/persistence'
import { abrirCopia, CopiaInvalida, exportarCopia, importarCopia } from './backup.js'
import { fallar } from './errors.js'
import { calculate, defaultScenarioId } from './engine.js'

/**
 * Cuánto se admite de subida.
 *
 * Una cartera real de 34 proyectos sale en poco más de un megabyte comprimido,
 * así que cien es holgado de sobra y sigue sin ser una puerta abierta.
 */
const LIMITE_DE_SUBIDA = 100 * 1024 * 1024

/** El nombre del fichero que se descarga, con el instante dentro. */
export function nombreDeCopia(instante: Date): string {
  return `copia-planner-${instante.toISOString().replace(/[:T]/g, '-').slice(0, 19)}.zip`
}

function comoZip(cuerpo: unknown): Buffer | null {
  return Buffer.isBuffer(cuerpo) && cuerpo.length > 0 ? cuerpo : null
}

export function registerBackupRoutes(app: FastifyInstance, pool: Pool): void {
  /** Se lleva la base entera en un zip. No escribe nada. */
  app.get(
    '/api/copia',
    { config: { permission: 'copia.exportar' } },
    async (request, reply) => {
      const conDerivadas = (request.query as Record<string, unknown>)['derivadas'] === 'si'
      const instante = new Date()
      const copia = await withTransaction(pool, (db) =>
        exportarCopia(db, { instante, incluirDerivadas: conDerivadas }),
      )
      return reply
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="${nombreDeCopia(instante)}"`)
        .send(copia.zip)
    },
  )

  /** Qué traería la copia, sin tocar nada. Es el paso que hay que mirar. */
  app.post(
    '/api/copia/comprobar',
    { config: { permission: 'copia.restaurar' }, bodyLimit: LIMITE_DE_SUBIDA },
    async (request, reply) => {
      const zip = comoZip(request.body)
      if (zip === null) {
        return fallar(reply, 400, 'COPIA_VACIA', 'El cuerpo tiene que ser el zip de la copia.')
      }
      try {
        const copia = await withTransaction(pool, (db) => abrirCopia(db, zip))
        return {
          esquema: copia.esquema,
          tablas: copia.tablas.map((tabla) => ({
            tabla,
            filas: copia.datos.get(tabla)?.length ?? 0,
          })),
        }
      } catch (error) {
        if (error instanceof CopiaInvalida) {
          return fallar(reply, 422, error.code, error.message, { detalle: error.detalle ?? '' })
        }
        throw error
      }
    },
  )

  /**
   * Restaura. Borra lo que haya y pone lo que trae la copia.
   *
   * Recalcula al terminar y a propósito: la copia no trae la zona derivada, así
   * que hasta que no se recalcula la base está restaurada pero muda. Y el
   * cálculo devuelve su huella de entrada, que es con lo que se comprueba
   * —contra la que va escrita en el LEEME de la copia— que la vuelta fue fiel.
   */
  app.post(
    '/api/copia/restaurar',
    { config: { permission: 'copia.restaurar' }, bodyLimit: LIMITE_DE_SUBIDA },
    async (request, reply) => {
      const zip = comoZip(request.body)
      if (zip === null) {
        return fallar(reply, 400, 'COPIA_VACIA', 'El cuerpo tiene que ser el zip de la copia.')
      }
      const cuando = new Date().toISOString().slice(0, 19).replace('T', ' ')
      let resultado
      try {
        resultado = await withTransaction(
          pool,
          (db) => importarCopia(db, zip, `restauración de una copia de seguridad (${cuando})`),
          { comment: 'restauración de una copia de seguridad' },
        )
      } catch (error) {
        if (error instanceof CopiaInvalida) {
          return fallar(reply, 422, error.code, error.message, { detalle: error.detalle ?? '' })
        }
        throw error
      }
      const scenarioId = await withTransaction(pool, (db) => defaultScenarioId(db))
      return {
        ...resultado,
        run: await calculate(pool, scenarioId, 'restauración de una copia de seguridad'),
      }
    },
  )
}
