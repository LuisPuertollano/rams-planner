/** Errores del calendario. Cada uno lleva un código estable para la interfaz. */

export type CalendarErrorCode =
  | 'DUPLICATE_CALENDAR_ID'
  | 'CALENDAR_NOT_FOUND'
  | 'CALENDAR_CYCLE'
  | 'INVALID_SLOT'
  | 'OVERLAPPING_SLOTS'
  | 'INVALID_EXCEPTION'
  | 'RECURRENCE_NOT_SUPPORTED'
  | 'INVALID_HORIZON'
  | 'OUT_OF_HORIZON'
  | 'INVALID_INSTANT'
  | 'NEGATIVE_DURATION'
  | 'INTERNAL'

export class CalendarError extends Error {
  readonly code: CalendarErrorCode

  constructor(code: CalendarErrorCode, message: string) {
    super(message)
    this.name = 'CalendarError'
    this.code = code
  }
}
