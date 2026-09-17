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

/**
 * Los datos del hallazgo, no su frase.
 *
 * El contrato es: **el `payload` lleva todo lo que la frase necesita**, con los
 * nombres ya resueltos —nunca un identificador donde el lector espera un
 * nombre—. De ahí sale el texto traducido, sin volver a preguntar a nadie.
 *
 * Cuando un mismo `code` describe varias situaciones distintas, el `payload`
 * trae una clave **`variant`** que dice cuál. Se hace así, y no partiendo el
 * código en cinco, porque los códigos están guardados en la base de datos y en
 * los informes de hace dos años: añadir uno es barato, cambiar uno no.
 */
export type FindingPayload = Readonly<Record<string, string | number | boolean | null>>

export interface Finding {
  readonly severity: FindingSeverity
  readonly code: FindingCode
  readonly entityType: string
  readonly entityId: string
  readonly occursOn?: CalendarDate
  /**
   * La frase en castellano, tal y como la escribió el motor.
   *
   * Es el **respaldo**, no la fuente: la interfaz construye el texto desde
   * `code` y `payload`, y usa esto sólo si un código todavía no tiene
   * traducción. Se guarda igualmente, porque un hallazgo de una ejecución de
   * hace dos años tiene que poder leerse aunque el catálogo haya cambiado.
   */
  readonly message: string
  readonly payload?: FindingPayload
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
