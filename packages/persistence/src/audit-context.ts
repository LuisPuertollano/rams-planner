/**
 * Quién está haciendo esto, para que el historial lo pueda decir.
 *
 * El trigger de auditoría lleva desde el primer día leyendo `app.actor_id` de
 * la sesión de PostgreSQL, y `withTransaction` sabe fijarlo. Lo que faltaba era
 * que alguien se lo dijera, y ahí había dos maneras:
 *
 *   1. Pasar el usuario por parámetro a las cuarenta llamadas que escriben.
 *   2. Guardarlo en el contexto de la petición y que la transacción lo recoja.
 *
 * La primera se olvida. Se olvida en la ruta nueva que alguien añade con prisa,
 * y el fallo no se ve: el cambio se guarda igual, sólo que sin nombre, y nadie
 * lo nota hasta que hace falta saber quién tocó algo hace tres meses. Por eso
 * es la segunda: `AsyncLocalStorage` mantiene el actor durante toda la petición
 * y **cualquier** escritura que ocurra dentro lo lleva, la escriba quien la
 * escriba.
 *
 * No es magia difusa: el contexto se pone en un único sitio —el `onRequest` de
 * la API— y se lee en otro único sitio, `withTransaction`. Un `actorId`
 * explícito, si alguien lo pasa, siempre gana.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Mutable a propósito, y esto merece explicación.
 *
 * `AsyncLocalStorage.enterWith()` sólo propaga hacia adelante desde el punto de
 * ejecución en el que se llama. En Fastify eso obliga a fijarlo en el primer
 * hook y **antes de cualquier `await`**: si se llama después de esperar a la
 * base de datos, el manejador ya no lo ve. Pero para saber quién eres hay que
 * consultar la sesión, que es justamente un `await`.
 *
 * La salida es guardar un objeto vacío al principio y rellenarlo cuando se
 * sepa. El almacén guarda la referencia, así que el manejador lee el valor ya
 * puesto. Es la diferencia entre que el historial tenga nombres o no.
 */
export interface AuditContext {
  /** El usuario de `app_user`. Sin sesión no hay actor, y se registra sin él. */
  actorId?: string | undefined
  /** El identificador de la petición, para poder agrupar los cambios de una. */
  requestId?: string | undefined
}

const almacen = new AsyncLocalStorage<AuditContext>()

/**
 * Fija el contexto para todo lo que ocurra a partir de aquí en esta cadena
 * asíncrona.
 *
 * Se llama una vez por petición, en el primer hook y **sin haber esperado a
 * nada**: ahí es donde Fastify garantiza una cadena propia por petición y
 * donde `enterWith` alcanza al manejador. Lo que se sepa más tarde se escribe
 * en el objeto que se pasó aquí.
 */
export function enterAuditContext(context: AuditContext): void {
  almacen.enterWith(context)
}

/** Ejecuta algo con un contexto concreto. Para tareas de fondo y para pruebas. */
export function runWithAuditContext<T>(context: AuditContext, handler: () => T): T {
  return almacen.run(context, handler)
}

/** El contexto en curso, si lo hay. */
export function currentAuditContext(): AuditContext | undefined {
  return almacen.getStore()
}
