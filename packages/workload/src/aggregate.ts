/**
 * Agregaciones sobre la tabla diaria.
 *
 * Todas parten de `TimephasedCell`, que es la única fuente. Por eso la vista
 * mensual, la trimestral y la de un proyecto concreto no pueden dar cifras
 * distintas: son el mismo `GROUP BY` con distinta clave.
 */

import type { CalendarDate } from '@planner/domain'
import type { CapacityIndex } from './capacity.js'
import type { TimephasedCell } from './timephase.js'

export type Bucket = 'day' | 'week' | 'month' | 'quarter'

export interface LoadRow {
  readonly resourceId: string
  readonly projectId: string
  readonly nodeId: string
  readonly period: string
  readonly plannedMinutes: number
  readonly costCents: number
}

export interface UtilizationRow {
  readonly resourceId: string
  readonly period: string
  readonly plannedMinutes: number
  readonly capacityMinutes: number
  readonly freeMinutes: number
  /** Puntos base; `null` cuando no hay capacidad y por tanto no hay porcentaje. */
  readonly utilizationBp: number | null
}

/** Etiqueta del periodo al que pertenece un día. */
export function periodOf(date: CalendarDate, bucket: Bucket): string {
  switch (bucket) {
    case 'day':
      return date
    case 'month':
      return date.slice(0, 7)
    case 'quarter': {
      const month = Number(date.slice(5, 7))
      return `${date.slice(0, 4)}-T${String(Math.floor((month - 1) / 3) + 1)}`
    }
    case 'week':
      return isoWeekLabel(date)
  }
}

export function aggregateLoad(
  cells: readonly TimephasedCell[],
  bucket: Bucket,
  keys: { readonly byProject?: boolean; readonly byNode?: boolean } = {},
): readonly LoadRow[] {
  const rows = new Map<string, LoadRow>()

  for (const cell of cells) {
    const projectId = keys.byProject === false ? '' : cell.projectId
    const nodeId = keys.byNode === true ? cell.nodeId : ''
    const period = periodOf(cell.date, bucket)
    const key = `${cell.resourceId}|${projectId}|${nodeId}|${period}`
    const current = rows.get(key)
    if (current === undefined) {
      rows.set(key, {
        resourceId: cell.resourceId,
        projectId,
        nodeId,
        period,
        plannedMinutes: cell.plannedMinutes,
        costCents: cell.costCents,
      })
    } else {
      rows.set(key, {
        ...current,
        plannedMinutes: current.plannedMinutes + cell.plannedMinutes,
        costCents: current.costCents + cell.costCents,
      })
    }
  }

  return [...rows.values()].sort(
    (left, right) =>
      left.resourceId.localeCompare(right.resourceId) ||
      left.period.localeCompare(right.period) ||
      left.projectId.localeCompare(right.projectId) ||
      left.nodeId.localeCompare(right.nodeId),
  )
}

export function aggregateUtilization(
  cells: readonly TimephasedCell[],
  capacity: CapacityIndex,
  bucket: Bucket,
): readonly UtilizationRow[] {
  const planned = new Map<string, number>()
  const available = new Map<string, number>()

  for (const cell of cells) {
    const key = `${cell.resourceId}|${periodOf(cell.date, bucket)}`
    planned.set(key, (planned.get(key) ?? 0) + cell.plannedMinutes)
  }
  for (const cell of capacity.cells) {
    const key = `${cell.resourceId}|${periodOf(cell.date, bucket)}`
    available.set(key, (available.get(key) ?? 0) + cell.capacityMinutes)
  }

  const rows: UtilizationRow[] = []
  for (const key of new Set([...planned.keys(), ...available.keys()])) {
    const [resourceId, period] = key.split('|') as [string, string]
    const plannedMinutes = planned.get(key) ?? 0
    const capacityMinutes = available.get(key) ?? 0
    rows.push({
      resourceId,
      period,
      plannedMinutes,
      capacityMinutes,
      freeMinutes: capacityMinutes - plannedMinutes,
      utilizationBp: capacityMinutes === 0 ? null : Math.round((plannedMinutes * 10_000) / capacityMinutes),
    })
  }

  return rows.sort(
    (left, right) => left.resourceId.localeCompare(right.resourceId) || left.period.localeCompare(right.period),
  )
}

/** Semana ISO-8601 (`2026-S12`), que empieza en lunes. */
function isoWeekLabel(date: CalendarDate): string {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const day = Number(date.slice(8, 10))
  const dayOfYear = daysBeforeMonth(year, month) + day
  const weekday = isoWeekdayOf(year, month, day)
  const week = Math.floor((dayOfYear - weekday + 10) / 7)
  if (week < 1) return `${String(year - 1)}-S${String(weeksInYear(year - 1))}`
  if (week > weeksInYear(year)) return `${String(year + 1)}-S01`
  return `${String(year)}-S${String(week).padStart(2, '0')}`
}

const CUMULATIVE_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

function daysBeforeMonth(year: number, month: number): number {
  const base = CUMULATIVE_DAYS[month - 1] ?? 0
  return base + (month > 2 && isLeap(year) ? 1 : 0)
}

function isLeap(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function isoWeekdayOf(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year
  const era = Math.floor(shiftedYear / 400)
  const yearOfEra = shiftedYear - era * 400
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear
  const epochDay = era * 146_097 + dayOfEra - 719_468
  return ((((epochDay + 3) % 7) + 7) % 7) + 1
}

function weeksInYear(year: number): number {
  const firstWeekday = isoWeekdayOf(year, 1, 1)
  return firstWeekday === 4 || (isLeap(year) && firstWeekday === 3) ? 53 : 52
}
