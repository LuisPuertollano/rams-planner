/** Hallazgos: todo lo que el motor quiere decirte, con código estable. */

import type { CalendarDate } from './units.js'

export type FindingSeverity = 'blocking' | 'error' | 'warning' | 'info'

export type FindingCode =
  | 'DEPENDENCY_CYCLE'
  | 'CONSTRAINT_CONFLICT'
  | 'RESOURCE_OVERALLOCATED'
  | 'RESOURCE_NO_CAPACITY'
  | 'DEADLINE_MISSED'
  | 'BUDGET_EXCEEDED'
  | 'TASK_UNASSIGNED'
  | 'SKILL_MISSING'
  | 'SKILL_BELOW_LEVEL'
  | 'TASK_NO_WORK'
  | 'ORPHAN_TASK'
  | 'CONTOUR_MISMATCH'
  | 'LEVELING_IMPOSSIBLE'
  | 'LEVELING_DELAYED'
  | 'REBALANCE_NO_CANDIDATE'

export interface Finding {
  readonly severity: FindingSeverity
  readonly code: FindingCode
  readonly entityType: string
  readonly entityId: string
  readonly occursOn?: CalendarDate
  readonly message: string
  readonly payload?: Readonly<Record<string, string | number | boolean | null>>
}

const ORDER: Record<FindingSeverity, number> = { blocking: 0, error: 1, warning: 2, info: 3 }

/** Ordena por gravedad y, a igualdad, por código y entidad: salida estable (P2). */
export function sortFindings(findings: readonly Finding[]): readonly Finding[] {
  return [...findings].sort(
    (left, right) =>
      ORDER[left.severity] - ORDER[right.severity] ||
      left.code.localeCompare(right.code) ||
      (left.occursOn ?? '').localeCompare(right.occursOn ?? '') ||
      left.entityId.localeCompare(right.entityId),
  )
}
