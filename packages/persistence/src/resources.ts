/**
 * Lectura y escritura de la ficha de un recurso.
 *
 * Todo lo que hay aquí es dato DECLARADO (P1): calendario, disponibilidad,
 * ausencias y tarifas. Nada de esto depende de una ejecución, y por eso ninguna
 * función de este módulo recibe un `runId`. Lo que sí hace es invalidar el plan
 * en pantalla: quien llame tiene que recalcular después.
 */

import type { Queryable } from './db.js'

export interface CalendarOption {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly parentCode: string | null
}

export interface AvailabilityPeriod {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly unitsBp: number
  readonly reason: string | null
}

export interface AbsencePeriod {
  readonly id: string
  readonly kind: string
  readonly from: string
  readonly to: string
  readonly minutesPerDay: number | null
  readonly note: string | null
}

export interface CostRatePeriod {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly currency: string
  readonly standardCentsHour: number
}

export interface ResourceDetail {
  readonly id: string
  readonly code: string
  readonly displayName: string
  readonly kind: string
  readonly calendarId: string | null
  readonly calendarCode: string | null
  readonly maxUnitsBp: number
  readonly activeFrom: string | null
  readonly activeTo: string | null
  readonly availability: readonly AvailabilityPeriod[]
  readonly absences: readonly AbsencePeriod[]
  readonly costRates: readonly CostRatePeriod[]
}

export async function readCalendars(db: Queryable): Promise<readonly CalendarOption[]> {
  const { rows } = await db.query<{ id: string; code: string; name: string; parent_code: string | null }>(
    `SELECT c.id, c.code, c.name, p.code AS parent_code
     FROM calendar c LEFT JOIN calendar p ON p.id = c.parent_id
     WHERE c.deleted_at IS NULL ORDER BY c.code`,
  )
  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, parentCode: row.parent_code }))
}

/** La ficha completa del equipo: una consulta por tabla, unidas en memoria. */
export async function readResourceDetails(db: Queryable): Promise<readonly ResourceDetail[]> {
  const resources = await db.query<{
    id: string
    code: string
    display_name: string
    resource_kind: string
    calendar_id: string | null
    calendar_code: string | null
    max_units_bp: number
    active_from: string | null
    active_to: string | null
  }>(
    `SELECT r.id, r.code, r.display_name, r.resource_kind, r.calendar_id, c.code AS calendar_code,
            r.max_units_bp, r.active_from::text, r.active_to::text
     FROM resource r LEFT JOIN calendar c ON c.id = r.calendar_id
     WHERE r.deleted_at IS NULL AND r.resource_kind IN ('person', 'team')
     ORDER BY r.display_name`,
  )

  const availability = await db.query<{
    id: string
    resource_id: string
    from: string
    to: string
    units_bp: number
    reason: string | null
  }>(
    `SELECT id, resource_id, lower(valid_period)::text AS from, (upper(valid_period) - 1)::text AS to,
            units_bp, reason
     FROM resource_availability ORDER BY lower(valid_period)`,
  )

  const absences = await db.query<{
    id: string
    resource_id: string
    absence_kind: string
    date_from: string
    date_to: string
    minutes_per_day: number | null
    note: string | null
  }>(
    `SELECT id, resource_id, absence_kind, date_from::text, date_to::text, minutes_per_day, note
     FROM absence ORDER BY date_from`,
  )

  const rates = await db.query<{
    id: string
    resource_id: string
    from: string
    to: string
    currency: string
    standard_cents_hour: number
  }>(
    `SELECT id, resource_id, lower(valid_period)::text AS from, (upper(valid_period) - 1)::text AS to,
            currency, standard_cents_hour
     FROM resource_cost_rate ORDER BY lower(valid_period)`,
  )

  const byResource = <T extends { resource_id: string }>(rows: readonly T[]): Map<string, T[]> => {
    const map = new Map<string, T[]>()
    for (const row of rows) {
      const bucket = map.get(row.resource_id)
      if (bucket === undefined) map.set(row.resource_id, [row])
      else bucket.push(row)
    }
    return map
  }

  const availabilityBy = byResource(availability.rows)
  const absencesBy = byResource(absences.rows)
  const ratesBy = byResource(rates.rows)

  return resources.rows.map((resource) => ({
    id: resource.id,
    code: resource.code,
    displayName: resource.display_name,
    kind: resource.resource_kind,
    calendarId: resource.calendar_id,
    calendarCode: resource.calendar_code,
    maxUnitsBp: resource.max_units_bp,
    activeFrom: resource.active_from,
    activeTo: resource.active_to,
    availability: (availabilityBy.get(resource.id) ?? []).map((row) => ({
      id: row.id,
      from: row.from,
      to: row.to,
      unitsBp: row.units_bp,
      reason: row.reason,
    })),
    absences: (absencesBy.get(resource.id) ?? []).map((row) => ({
      id: row.id,
      kind: row.absence_kind,
      from: row.date_from,
      to: row.date_to,
      minutesPerDay: row.minutes_per_day,
      note: row.note,
    })),
    costRates: (ratesBy.get(resource.id) ?? []).map((row) => ({
      id: row.id,
      from: row.from,
      to: row.to,
      currency: row.currency,
      standardCentsHour: row.standard_cents_hour,
    })),
  }))
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

export interface ResourceInput {
  readonly code: string
  readonly displayName: string
  readonly calendarId?: string | null | undefined
  readonly maxUnitsBp?: number | undefined
  readonly activeFrom?: string | null | undefined
  readonly activeTo?: string | null | undefined
}

export async function createResource(db: Queryable, input: ResourceInput): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO resource (code, display_name, resource_kind, calendar_id, max_units_bp, active_from, active_to)
     VALUES ($1, $2, 'person', $3, $4, $5, $6) RETURNING id`,
    [
      input.code,
      input.displayName,
      input.calendarId ?? null,
      input.maxUnitsBp ?? 10_000,
      input.activeFrom ?? null,
      input.activeTo ?? null,
    ],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('No se pudo crear el recurso')
  return id
}

/** Igual que `ResourceInput`, pero con todo opcional: un PATCH toca lo que toca. */
export interface ResourceChanges {
  readonly code?: string | undefined
  readonly displayName?: string | undefined
  readonly calendarId?: string | null | undefined
  readonly maxUnitsBp?: number | undefined
  readonly activeFrom?: string | null | undefined
  readonly activeTo?: string | null | undefined
}

export async function updateResource(
  db: Queryable,
  resourceId: string,
  changes: ResourceChanges,
): Promise<void> {
  const columns: string[] = []
  const values: unknown[] = [resourceId]
  const set = (column: string, value: unknown): void => {
    values.push(value)
    columns.push(`${column} = $${String(values.length)}`)
  }
  if (changes.code !== undefined) set('code', changes.code)
  if (changes.displayName !== undefined) set('display_name', changes.displayName)
  if (changes.calendarId !== undefined) set('calendar_id', changes.calendarId)
  if (changes.maxUnitsBp !== undefined) set('max_units_bp', changes.maxUnitsBp)
  if (changes.activeFrom !== undefined) set('active_from', changes.activeFrom)
  if (changes.activeTo !== undefined) set('active_to', changes.activeTo)
  if (columns.length === 0) throw new Error('No hay nada que cambiar')
  await db.query(`UPDATE resource SET ${columns.join(', ')} WHERE id = $1`, values)
}

/**
 * Baja lógica (P7): el recurso no se borra, se marca.
 *
 * Sus asignaciones se dan de baja **en la misma transacción**, a propósito. La
 * alternativa —dejarlas y que el motor las ignore porque su persona ya no está
 * en el snapshot— hace que la carga de un proyecto baje sin que nada lo diga y
 * sin que quede rastro de por qué. Así el cambio es explícito, sale en el
 * historial de cada asignación y la tarea se queda visiblemente sin nadie.
 */
export async function softDeleteResource(db: Queryable, resourceId: string): Promise<number> {
  await db.query('UPDATE resource SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [resourceId])
  const { rowCount } = await db.query(
    'UPDATE assignment SET deleted_at = now() WHERE resource_id = $1 AND deleted_at IS NULL',
    [resourceId],
  )
  return rowCount ?? 0
}

export async function addAvailability(
  db: Queryable,
  resourceId: string,
  period: {
    readonly from: string
    readonly to: string
    readonly unitsBp: number
    readonly reason?: string | null | undefined
  },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO resource_availability (resource_id, valid_period, units_bp, reason)
     VALUES ($1, daterange($2, $3, '[]'), $4, $5) RETURNING id`,
    [resourceId, period.from, period.to, period.unitsBp, period.reason ?? null],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('No se pudo guardar la disponibilidad')
  return id
}

export async function deleteAvailability(db: Queryable, id: string): Promise<void> {
  await db.query('DELETE FROM resource_availability WHERE id = $1', [id])
}

export async function addAbsence(
  db: Queryable,
  resourceId: string,
  absence: {
    readonly kind: string
    readonly from: string
    readonly to: string
    readonly minutesPerDay?: number | null | undefined
    readonly note?: string | null | undefined
  },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO absence (resource_id, absence_kind, date_from, date_to, minutes_per_day, note)
     VALUES ($1, $2::absence_kind, $3, $4, $5, $6) RETURNING id`,
    [resourceId, absence.kind, absence.from, absence.to, absence.minutesPerDay ?? null, absence.note ?? null],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('No se pudo guardar la ausencia')
  return id
}

export async function deleteAbsence(db: Queryable, id: string): Promise<void> {
  await db.query('DELETE FROM absence WHERE id = $1', [id])
}

export async function addCostRate(
  db: Queryable,
  resourceId: string,
  rate: {
    readonly from: string
    readonly to: string
    readonly standardCentsHour: number
    readonly currency?: string | undefined
  },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO resource_cost_rate (resource_id, valid_period, currency, standard_cents_hour)
     VALUES ($1, daterange($2, $3, '[]'), $4, $5) RETURNING id`,
    [resourceId, rate.from, rate.to, rate.currency ?? 'EUR', rate.standardCentsHour],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('No se pudo guardar la tarifa')
  return id
}

export async function deleteCostRate(db: Queryable, id: string): Promise<void> {
  await db.query('DELETE FROM resource_cost_rate WHERE id = $1', [id])
}
