/**
 * Casos límite de la fase 1, con los valores esperados escritos a mano.
 *
 * No son snapshots: son el contrato. Si uno cambia, el diff se revisa a mano —
 * un cambio aquí significa que el motor ahora calcula fechas distintas.
 */

import { calendarDate } from '@planner/domain'
import { describe, expect, it } from 'vitest'
import {
  addWorkingMinutes,
  planInstant,
  snapToWorkingTime,
  subtractWorkingMinutes,
  workingMinutesBetween,
  workingMinutesOnDay,
} from './arithmetic.js'
import { compileCalendar } from './compile.js'
import { ALL_CALENDARS, HORIZON } from './__fixtures__/calendars.js'

const d = calendarDate
const at = (date: string, minute: number) => planInstant(d(date), minute)

const base = compileCalendar(ALL_CALENDARS, 'base-40h', HORIZON)
const festivos = compileCalendar(ALL_CALENDARS, 'festivos', HORIZON)
const reducida = compileCalendar(ALL_CALENDARS, 'reducida-35h', HORIZON)
const variable = compileCalendar(ALL_CALENDARS, 'jornada-variable', HORIZON)

describe('G1 · tarea de un minuto en un día parcial', () => {
  // 2026-12-24 (jueves) es media jornada: 08:00-12:00, 240 minutos.
  it('la media jornada tiene 240 minutos', () => {
    expect(workingMinutesOnDay(d('2026-12-24'), festivos)).toBe(240)
  })

  it('un minuto desde el inicio acaba a las 08:01', () => {
    expect(addWorkingMinutes(at('2026-12-24', 480), 1, festivos)).toEqual({ date: '2026-12-24', minuteOfDay: 481 })
  })

  it('un minuto que acaba justo al cierre se queda en el cierre, no salta al día siguiente', () => {
    expect(addWorkingMinutes(at('2026-12-24', 719), 1, festivos)).toEqual({ date: '2026-12-24', minuteOfDay: 720 })
  })
})

describe('G2 · tarea que arranca justo al cierre de la jornada', () => {
  // Lunes 2026-03-16 a las 17:00: la jornada ya ha terminado.
  it('sumar no ajusta: el trabajo se computa desde el siguiente minuto laborable', () => {
    expect(addWorkingMinutes(at('2026-03-16', 1020), 480, base)).toEqual({ date: '2026-03-17', minuteOfDay: 1020 })
  })

  it('ajustar hacia adelante da el inicio del martes', () => {
    expect(snapToWorkingTime(at('2026-03-16', 1020), base, 'forward')).toEqual({ date: '2026-03-17', minuteOfDay: 480 })
  })

  it('ajustar hacia atrás no mueve el cierre del lunes', () => {
    expect(snapToWorkingTime(at('2026-03-16', 1020), base, 'backward')).toEqual({ date: '2026-03-16', minuteOfDay: 1020 })
  })

  it('un fin de semana entero se salta de una vez', () => {
    // Viernes 2026-03-20 a las 17:00 + 1 minuto -> lunes 23 a las 08:01
    expect(addWorkingMinutes(at('2026-03-20', 1020), 1, base)).toEqual({ date: '2026-03-23', minuteOfDay: 481 })
  })
})

describe('G3 · tarea que cruza la Navidad', () => {
  // Miércoles 23 (480) + jueves 24 (240, media jornada) + viernes 25 festivo
  // + fin de semana + lunes 28 (480) = 1200 minutos.
  it('reparte 1200 minutos saltando el festivo y el fin de semana', () => {
    expect(addWorkingMinutes(at('2026-12-23', 480), 1200, festivos)).toEqual({ date: '2026-12-28', minuteOfDay: 1020 })
  })

  it('la duración medida hacia atrás coincide', () => {
    expect(workingMinutesBetween(at('2026-12-23', 480), at('2026-12-28', 1020), festivos)).toBe(1200)
  })

  it('restar desde el fin devuelve el inicio original', () => {
    expect(subtractWorkingMinutes(at('2026-12-28', 1020), 1200, festivos)).toEqual({ date: '2026-12-23', minuteOfDay: 480 })
  })

  it('el día de Navidad no tiene minutos laborables', () => {
    expect(workingMinutesOnDay(d('2026-12-25'), festivos)).toBe(0)
  })
})

describe('G4 · tarea que cruza un cambio de patrón semanal', () => {
  // La jornada baja de 480 a 420 minutos el 1 de julio de 2026.
  it('los días anteriores y posteriores al cambio miden distinto', () => {
    expect(workingMinutesOnDay(d('2026-06-30'), variable)).toBe(480)
    expect(workingMinutesOnDay(d('2026-07-01'), variable)).toBe(420)
  })

  it('1800 minutos desde el lunes 29 acaban el jueves 2 a las 16:00', () => {
    // 480 (lun 29) + 480 (mar 30) + 420 (mié 1) + 420 (jue 2) = 1800
    expect(addWorkingMinutes(at('2026-06-29', 480), 1800, variable)).toEqual({ date: '2026-07-02', minuteOfDay: 960 })
  })
})

describe('G5 · herencia de tres niveles', () => {
  it('el nieto sobrescribe la jornada del abuelo', () => {
    expect(workingMinutesOnDay(d('2026-03-16'), base)).toBe(480)
    expect(workingMinutesOnDay(d('2026-03-16'), reducida)).toBe(420)
  })

  it('y hereda los festivos del padre', () => {
    expect(workingMinutesOnDay(d('2026-12-25'), reducida)).toBe(0)
  })

  it('deja constancia de qué calendario y qué regla produjeron cada día', () => {
    const lunes = reducida.daySource[15] // 2026-03-16
    const navidad = reducida.daySource[299] // 2026-12-25
    expect(lunes).toEqual({ calendarId: 'reducida-35h', kind: 'week-pattern' })
    expect(navidad).toEqual({ calendarId: 'festivos', kind: 'exception', exceptionName: '1. Weihnachtstag' })
  })

  it('expone la cadena de herencia de la raíz a la hoja', () => {
    expect(reducida.chain).toEqual(['base-40h', 'festivos', 'reducida-35h'])
  })

  it('el sábado sigue sin ser laborable aunque el nieto redefina la jornada', () => {
    expect(workingMinutesOnDay(d('2026-03-21'), reducida)).toBe(0)
  })
})

describe('G6 · excepción con una jornada más larga de lo normal', () => {
  // Martes 2026-03-17: turno especial de 08:00 a 20:00 = 720 minutos.
  it('la jornada especial mide 720 minutos, más que la normal', () => {
    expect(workingMinutesOnDay(d('2026-03-17'), festivos)).toBe(720)
    expect(workingMinutesOnDay(d('2026-03-17'), base)).toBe(480)
  })

  it('720 minutos caben en ese único día', () => {
    expect(addWorkingMinutes(at('2026-03-17', 480), 720, festivos)).toEqual({ date: '2026-03-17', minuteOfDay: 1200 })
  })

  it('el mismo trabajo en el calendario normal se desborda al día siguiente', () => {
    expect(addWorkingMinutes(at('2026-03-17', 480), 720, base)).toEqual({ date: '2026-03-18', minuteOfDay: 720 })
  })
})
