/** Acceso a PostgreSQL. SQL explícito, sin ORM (ADR-0003). */

import pg from 'pg'

export interface QueryResult<T> {
  readonly rows: T[]
  readonly rowCount: number | null
}

export interface Queryable {
  query<T>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>
}

export type Pool = pg.Pool

// Los BIGINT vuelven como string por defecto para no perder precisión. Aquí los
// valores que usamos (céntimos, minutos) caben de sobra en un number seguro.
pg.types.setTypeParser(20, (value) => Number(value))

// Una DATE es una fecha de calendario, no un instante: devolverla como `Date`
// la ata a una zona horaria que no tiene. Se queda como 'YYYY-MM-DD', que es
// exactamente el tipo CalendarDate del dominio.
pg.types.setTypeParser(1082, (value) => value)

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString, max: 10 })
}

/** Ejecuta una función dentro de una transacción, con el actor fijado para la auditoría. */
export async function withTransaction<T>(
  pool: Pool,
  handler: (db: Queryable) => Promise<T>,
  context: { readonly actorId?: string; readonly requestId?: string; readonly comment?: string } = {},
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Los parámetros de sesión que lee el trigger de auditoría (P7).
    await client.query('SELECT set_config($1, $2, true)', ['app.actor_id', context.actorId ?? ''])
    await client.query('SELECT set_config($1, $2, true)', ['app.request_id', context.requestId ?? ''])
    await client.query('SELECT set_config($1, $2, true)', ['app.change_comment', context.comment ?? ''])
    const result = await handler(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
