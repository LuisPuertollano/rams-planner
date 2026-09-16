/** Definiciones de calendario tal como entran al compilador. */

import type { CalendarDate, Weekday } from '@planner/domain'

/** Intervalo laborable dentro de un día, en minutos desde medianoche. */
export interface DaySlot {
  readonly startMinute: number
  readonly endMinute: number
}

/**
 * Intervalo del patrón semanal, **con vigencia**: la jornada puede cambiar en el
 * tiempo (una reducción a 35 h a partir de julio) sin perder el histórico.
 */
export interface WeekSlot extends DaySlot {
  readonly weekday: Weekday
  /** Inclusive. Si falta, vale desde siempre. */
  readonly validFrom?: CalendarDate
  /** Inclusive. Si falta, vale para siempre. */
  readonly validTo?: CalendarDate
}

/** Excepción: festivo, cierre, o jornada especial. */
export interface CalendarException {
  readonly name: string
  /** Inclusive. */
  readonly dateFrom: CalendarDate
  /** Inclusive. */
  readonly dateTo: CalendarDate
  /** `false` = no laborable. `true` = jornada especial definida por `slots`. */
  readonly isWorking: boolean
  readonly slots?: readonly DaySlot[]
  /** RFC 5545. Todavía no soportado: el compilador lo rechaza en vez de ignorarlo. */
  readonly recurrenceRule?: string
}

export interface CalendarDefinition {
  readonly id: string
  readonly code: string
  /** Calendario del que hereda. `null` o ausente = calendario raíz. */
  readonly parentId?: string | null
  readonly weekSlots: readonly WeekSlot[]
  readonly exceptions: readonly CalendarException[]
}

/** Ventana temporal del cálculo. Ambos extremos inclusive. */
export interface Horizon {
  readonly from: CalendarDate
  readonly to: CalendarDate
}

/** De dónde salió la jornada de un día concreto. Alimenta el panel «¿por qué?». */
export interface DaySource {
  /** Calendario de la cadena que aportó la jornada. */
  readonly calendarId: string
  /** Regla aplicada. */
  readonly kind: 'week-pattern' | 'exception' | 'no-pattern'
  /** Nombre de la excepción, cuando `kind` es `exception`. */
  readonly exceptionName?: string
}

/**
 * Calendario compilado sobre un horizonte: índice denso de minutos laborables
 * por día, con suma acumulada para que las tres primitivas sean O(log n).
 */
export interface CompiledCalendar {
  readonly calendarId: string
  readonly horizon: Horizon
  readonly dayCount: number
  /** Minutos laborables de cada día del horizonte. */
  readonly dayMinutes: Int32Array
  /** Intervalos laborables de cada día, ordenados y sin solapes. */
  readonly daySlots: readonly (readonly DaySlot[])[]
  /** `prefixSum[i]` = minutos laborables antes del día `i`. Longitud `dayCount + 1`. */
  readonly prefixSum: Int32Array
  /** Trazabilidad por día: qué calendario y qué regla produjeron la jornada. */
  readonly daySource: readonly DaySource[]
  /** Cadena de herencia, de la raíz a la hoja. */
  readonly chain: readonly string[]
}

/**
 * Un instante en **hora local del calendario**, no un instante UTC.
 * `minuteOfDay` va de 0 a 1439 en la forma normalizada; se admite 1440 a la
 * entrada (medianoche final) y se normaliza al día siguiente.
 */
export interface PlanInstant {
  readonly date: CalendarDate
  readonly minuteOfDay: number
}

export type SnapDirection = 'forward' | 'backward'
