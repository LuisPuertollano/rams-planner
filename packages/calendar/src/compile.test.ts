import { calendarDate } from '@planner/domain'
import { describe, expect, it } from 'vitest'
import { compileCalendar } from './compile.js'
import { CalendarError } from './errors.js'
import { ALL_CALENDARS, BASE_40H, HORIZON, fullDayWeek } from './__fixtures__/calendars.js'
import type { CalendarDefinition } from './types.js'

const d = calendarDate
const definition = (overrides: Partial<CalendarDefinition>): CalendarDefinition => ({
  id: 'x',
  code: 'x',
  parentId: null,
  weekSlots: [],
  exceptions: [],
  ...overrides,
})

const compileOne = (def: CalendarDefinition, extra: CalendarDefinition[] = []) =>
  compileCalendar([def, ...extra], def.id, HORIZON)

const expectCode = (fn: () => unknown, code: string): void => {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(CalendarError)
    expect((error as CalendarError).code).toBe(code)
    return
  }
  throw new Error(`Se esperaba un CalendarError ${code} y no se lanzó ninguno`)
}

describe('resolución de la cadena de herencia', () => {
  it('rechaza dos calendarios con el mismo id', () => {
    expectCode(() => compileCalendar([BASE_40H, BASE_40H], BASE_40H.id, HORIZON), 'DUPLICATE_CALENDAR_ID')
  })

  it('rechaza un calendario que no existe', () => {
    expectCode(() => compileCalendar(ALL_CALENDARS, 'no-existe', HORIZON), 'CALENDAR_NOT_FOUND')
  })

  it('rechaza un padre que no existe, en vez de ignorarlo', () => {
    expectCode(() => compileOne(definition({ parentId: 'fantasma' })), 'CALENDAR_NOT_FOUND')
  })

  it('detecta un ciclo directo y lo describe', () => {
    const cyclic = definition({ id: 'a', parentId: 'a' })
    expectCode(() => compileOne(cyclic), 'CALENDAR_CYCLE')
  })

  it('detecta un ciclo largo', () => {
    const a = definition({ id: 'a', code: 'a', parentId: 'b' })
    const b = definition({ id: 'b', code: 'b', parentId: 'c' })
    const c = definition({ id: 'c', code: 'c', parentId: 'a' })
    expectCode(() => compileCalendar([a, b, c], 'a', HORIZON), 'CALENDAR_CYCLE')
  })
})

describe('validación de intervalos', () => {
  it('rechaza minutos que no son enteros', () => {
    expectCode(
      () => compileOne(definition({ weekSlots: [{ weekday: 1, startMinute: 480.5, endMinute: 720 }] })),
      'INVALID_SLOT',
    )
  })

  it('rechaza minutos fuera del día', () => {
    expectCode(
      () => compileOne(definition({ weekSlots: [{ weekday: 1, startMinute: -1, endMinute: 720 }] })),
      'INVALID_SLOT',
    )
    expectCode(
      () => compileOne(definition({ weekSlots: [{ weekday: 1, startMinute: 0, endMinute: 1441 }] })),
      'INVALID_SLOT',
    )
  })

  it('rechaza un intervalo que acaba antes de empezar', () => {
    expectCode(
      () => compileOne(definition({ weekSlots: [{ weekday: 1, startMinute: 720, endMinute: 480 }] })),
      'INVALID_SLOT',
    )
  })

  it('rechaza un día de la semana fuera de 1..7', () => {
    expectCode(
      () => compileOne(definition({ weekSlots: [{ weekday: 8 as 1, startMinute: 480, endMinute: 720 }] })),
      'INVALID_SLOT',
    )
  })

  it('rechaza una vigencia invertida', () => {
    expectCode(
      () =>
        compileOne(
          definition({
            weekSlots: [
              { weekday: 1, startMinute: 480, endMinute: 720, validFrom: d('2026-07-01'), validTo: d('2026-01-01') },
            ],
          }),
        ),
      'INVALID_SLOT',
    )
  })

  it('rechaza intervalos solapados dentro del mismo día', () => {
    expectCode(
      () =>
        compileOne(
          definition({
            weekSlots: [
              { weekday: 1, startMinute: 480, endMinute: 720 },
              { weekday: 1, startMinute: 700, endMinute: 900 },
            ],
          }),
        ),
      'OVERLAPPING_SLOTS',
    )
  })

  it('fusiona los intervalos contiguos en vez de contarlos dos veces', () => {
    const merged = compileOne(
      definition({
        weekSlots: [
          { weekday: 1, startMinute: 480, endMinute: 720 },
          { weekday: 1, startMinute: 720, endMinute: 1020 },
        ],
      }),
    )
    expect(merged.daySlots[15]).toEqual([{ startMinute: 480, endMinute: 1020 }])
    expect(merged.dayMinutes[15]).toBe(540)
  })
})

describe('validación de excepciones', () => {
  it('rechaza la recurrencia en vez de inventarse las fechas', () => {
    expectCode(
      () =>
        compileOne(
          definition({
            exceptions: [
              { name: 'Festivo anual', dateFrom: d('2026-05-01'), dateTo: d('2026-05-01'), isWorking: false, recurrenceRule: 'FREQ=YEARLY' },
            ],
          }),
        ),
      'RECURRENCE_NOT_SUPPORTED',
    )
  })

  it('rechaza un rango invertido', () => {
    expectCode(
      () =>
        compileOne(
          definition({
            exceptions: [{ name: 'Cierre', dateFrom: d('2026-08-31'), dateTo: d('2026-08-01'), isWorking: false }],
          }),
        ),
      'INVALID_EXCEPTION',
    )
  })

  it('rechaza una jornada especial sin horario', () => {
    expectCode(
      () =>
        compileOne(
          definition({
            exceptions: [{ name: 'Puente', dateFrom: d('2026-05-01'), dateTo: d('2026-05-01'), isWorking: true }],
          }),
        ),
      'INVALID_EXCEPTION',
    )
    expectCode(
      () =>
        compileOne(
          definition({
            exceptions: [{ name: 'Puente', dateFrom: d('2026-05-01'), dateTo: d('2026-05-01'), isWorking: true, slots: [] }],
          }),
        ),
      'INVALID_EXCEPTION',
    )
  })

  it('valida también los intervalos de una excepción', () => {
    expectCode(
      () =>
        compileOne(
          definition({
            exceptions: [
              { name: 'Turno', dateFrom: d('2026-05-01'), dateTo: d('2026-05-01'), isWorking: true, slots: [{ startMinute: 900, endMinute: 600 }] },
            ],
          }),
        ),
      'INVALID_SLOT',
    )
  })

  it('entre excepciones que se pisan, gana la de rango más corto', () => {
    // Un festivo de un día dentro de un cierre de verano sigue siendo el festivo.
    const calendar = compileOne(
      definition({
        weekSlots: fullDayWeek(),
        exceptions: [
          { name: 'Cierre de verano', dateFrom: d('2026-08-01'), dateTo: d('2026-08-31'), isWorking: false },
          { name: 'Guardia', dateFrom: d('2026-08-12'), dateTo: d('2026-08-12'), isWorking: true, slots: [{ startMinute: 540, endMinute: 780 }] },
        ],
      }),
    )
    const guardia = calendar.daySource[164] // 2026-08-12
    expect(guardia?.exceptionName).toBe('Guardia')
    expect(calendar.dayMinutes[164]).toBe(240)
    expect(calendar.dayMinutes[163]).toBe(0) // 2026-08-11, dentro del cierre
  })

  it('una excepción cubre todo su rango', () => {
    const calendar = compileOne(
      definition({
        weekSlots: fullDayWeek(),
        exceptions: [{ name: 'Cierre', dateFrom: d('2026-08-03'), dateTo: d('2026-08-07'), isWorking: false }],
      }),
    )
    for (let index = 155; index <= 159; index += 1) expect(calendar.dayMinutes[index]).toBe(0)
  })
})

describe('validación del horizonte', () => {
  it('rechaza un horizonte invertido', () => {
    expectCode(
      () => compileCalendar(ALL_CALENDARS, 'base-40h', { from: d('2026-12-31'), to: d('2026-01-01') }),
      'INVALID_HORIZON',
    )
  })

  it('rechaza un horizonte absurdo, que casi siempre es un error de datos', () => {
    expectCode(
      () => compileCalendar(ALL_CALENDARS, 'base-40h', { from: d('1900-01-01'), to: d('2200-01-01') }),
      'INVALID_HORIZON',
    )
  })

  it('admite un horizonte de un solo día', () => {
    const oneDay = compileCalendar(ALL_CALENDARS, 'base-40h', { from: d('2026-03-16'), to: d('2026-03-16') })
    expect(oneDay.dayCount).toBe(1)
    expect(oneDay.dayMinutes[0]).toBe(480)
  })
})

describe('calendario sin ningún patrón', () => {
  it('produce un horizonte entero no laborable y lo deja anotado', () => {
    const empty = compileOne(definition({ id: 'vacio', code: 'vacio' }))
    expect(empty.prefixSum[empty.dayCount]).toBe(0)
    expect(empty.daySource[0]).toEqual({ calendarId: 'vacio', kind: 'no-pattern' })
  })
})
