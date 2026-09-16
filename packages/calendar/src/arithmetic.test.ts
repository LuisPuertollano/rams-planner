import { calendarDate } from '@planner/domain'
import { describe, expect, it } from 'vitest'
import {
  addWorkingMinutes,
  denseAt,
  fromAbsoluteMinute,
  isWorkingTime,
  planInstant,
  snapToWorkingTime,
  subtractWorkingMinutes,
  toAbsoluteMinute,
  totalWorkingMinutes,
  workingMinutesBetween,
  workingMinutesOnDay,
} from './arithmetic.js'
import { compileCalendar } from './compile.js'
import { CalendarError } from './errors.js'
import { ALL_CALENDARS, HORIZON } from './__fixtures__/calendars.js'

const d = calendarDate
const at = (date: string, minute: number) => planInstant(d(date), minute)
const base = compileCalendar(ALL_CALENDARS, 'base-40h', HORIZON)

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

describe('planInstant', () => {
  it('normaliza el minuto 1440 al día siguiente', () => {
    expect(planInstant(d('2026-03-16'), 1440)).toEqual({ date: '2026-03-17', minuteOfDay: 0 })
  })

  it('rechaza minutos fuera de rango o no enteros', () => {
    expectCode(() => planInstant(d('2026-03-16'), -1), 'INVALID_INSTANT')
    expectCode(() => planInstant(d('2026-03-16'), 1441), 'INVALID_INSTANT')
    expectCode(() => planInstant(d('2026-03-16'), 60.5), 'INVALID_INSTANT')
  })
})

describe('conversión a minuto absoluto', () => {
  it('es reversible', () => {
    const instant = at('2026-05-20', 615)
    expect(fromAbsoluteMinute(toAbsoluteMinute(instant, base), base)).toEqual(instant)
  })

  it('rechaza instantes fuera del horizonte por ambos lados', () => {
    expectCode(() => toAbsoluteMinute(at('2026-02-28', 480), base), 'OUT_OF_HORIZON')
    expectCode(() => toAbsoluteMinute(at('2027-02-02', 480), base), 'OUT_OF_HORIZON')
  })

  it('admite el instante final exacto del horizonte', () => {
    expect(toAbsoluteMinute(at('2027-02-01', 0), base)).toBe(base.dayCount * 1440)
  })
})

describe('workingMinutesBetween', () => {
  it('mide cero entre un instante y sí mismo', () => {
    expect(workingMinutesBetween(at('2026-03-16', 600), at('2026-03-16', 600), base)).toBe(0)
  })

  it('ignora el tiempo no laborable intermedio', () => {
    // Lunes 12:00 a lunes 14:00: una hora de pausa en medio.
    expect(workingMinutesBetween(at('2026-03-16', 720), at('2026-03-16', 840), base)).toBe(60)
  })

  it('exige que los instantes estén ordenados', () => {
    expectCode(() => workingMinutesBetween(at('2026-03-17', 480), at('2026-03-16', 480), base), 'NEGATIVE_DURATION')
  })

  it('mide una semana completa', () => {
    expect(workingMinutesBetween(at('2026-03-16', 0), at('2026-03-23', 0), base)).toBe(2400)
  })
})

describe('addWorkingMinutes y subtractWorkingMinutes', () => {
  it('rechazan minutos negativos o no enteros', () => {
    expectCode(() => addWorkingMinutes(at('2026-03-16', 480), -1, base), 'NEGATIVE_DURATION')
    expectCode(() => addWorkingMinutes(at('2026-03-16', 480), 1.5, base), 'NEGATIVE_DURATION')
    expectCode(() => subtractWorkingMinutes(at('2026-03-16', 480), -1, base), 'NEGATIVE_DURATION')
    expectCode(() => subtractWorkingMinutes(at('2026-03-16', 480), 2.5, base), 'NEGATIVE_DURATION')
  })

  it('restar cero no mueve el instante', () => {
    expect(subtractWorkingMinutes(at('2026-03-16', 900), 0, base)).toEqual({ date: '2026-03-16', minuteOfDay: 900 })
  })

  it('restar devuelve el inicio del trabajo, no el final del anterior', () => {
    // Lunes 08:01 menos 1 minuto: el minuto trabajado empieza el lunes a las
    // 08:00. Devolver el viernes a las 17:00 sería el mismo punto en trabajo
    // acumulado, pero como fecha de INICIO de una tarea sería absurdo.
    expect(subtractWorkingMinutes(at('2026-03-23', 481), 1, base)).toEqual({ date: '2026-03-23', minuteOfDay: 480 })
  })

  it('sumar y restar son inversas alrededor de un fin de semana', () => {
    const start = at('2026-03-23', 480)
    const finish = addWorkingMinutes(start, 1, base)
    expect(finish).toEqual({ date: '2026-03-23', minuteOfDay: 481 })
    expect(subtractWorkingMinutes(finish, 1, base)).toEqual(start)
  })

  it('avisa cuando el trabajo no cabe en el horizonte', () => {
    expectCode(() => addWorkingMinutes(at('2026-03-16', 480), 1_000_000, base), 'OUT_OF_HORIZON')
    expectCode(() => subtractWorkingMinutes(at('2026-03-16', 480), 1_000_000, base), 'OUT_OF_HORIZON')
  })

  it('llegar justo al final del horizonte es válido', () => {
    const total = totalWorkingMinutes(base)
    const start = at('2026-03-01', 0)
    expect(() => addWorkingMinutes(start, total, base)).not.toThrow()
  })

  it('restar todo el trabajo disponible lleva al primer minuto laborable', () => {
    const total = totalWorkingMinutes(base)
    const end = planInstant(d('2027-02-01'), 0)
    // El horizonte empieza el domingo 2026-03-01; el primer minuto laborable es
    // el lunes 2 a las 08:00.
    expect(subtractWorkingMinutes(end, total, base)).toEqual({ date: '2026-03-02', minuteOfDay: 480 })
  })
})

describe('snapToWorkingTime', () => {
  it('no mueve un instante que ya es laborable', () => {
    expect(snapToWorkingTime(at('2026-03-16', 600), base, 'forward')).toEqual({ date: '2026-03-16', minuteOfDay: 600 })
    expect(snapToWorkingTime(at('2026-03-16', 600), base, 'backward')).toEqual({ date: '2026-03-16', minuteOfDay: 600 })
  })

  it('salta la pausa de mediodía en ambos sentidos', () => {
    expect(snapToWorkingTime(at('2026-03-16', 750), base, 'forward')).toEqual({ date: '2026-03-16', minuteOfDay: 780 })
    expect(snapToWorkingTime(at('2026-03-16', 750), base, 'backward')).toEqual({ date: '2026-03-16', minuteOfDay: 720 })
  })

  it('devuelve el inicio del horizonte cuando no hay trabajo anterior', () => {
    expect(snapToWorkingTime(at('2026-03-01', 300), base, 'backward')).toEqual({ date: '2026-03-01', minuteOfDay: 0 })
  })
})

describe('isWorkingTime', () => {
  it('distingue dentro y fuera de la jornada', () => {
    expect(isWorkingTime(at('2026-03-16', 600), base)).toBe(true)
    expect(isWorkingTime(at('2026-03-16', 750), base)).toBe(false)
    expect(isWorkingTime(at('2026-03-16', 1020), base)).toBe(false) // el cierre ya no es laborable
    expect(isWorkingTime(at('2026-03-21', 600), base)).toBe(false) // sábado
  })

  it('el instante final del horizonte no es laborable', () => {
    expect(isWorkingTime(planInstant(d('2027-02-01'), 0), base)).toBe(false)
  })
})

describe('workingMinutesOnDay', () => {
  it('rechaza días fuera del horizonte', () => {
    expectCode(() => workingMinutesOnDay(d('2020-01-01'), base), 'OUT_OF_HORIZON')
    expectCode(() => workingMinutesOnDay(d('2030-01-01'), base), 'OUT_OF_HORIZON')
  })
})

describe('denseAt', () => {
  it('falla con un mensaje claro si se pide un índice imposible', () => {
    expectCode(() => denseAt(base.prefixSum, 99_999), 'INTERNAL')
    expectCode(() => denseAt([], 0), 'INTERNAL')
  })
})
