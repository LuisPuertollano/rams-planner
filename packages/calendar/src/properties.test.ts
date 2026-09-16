/**
 * Propiedades del calendario.
 *
 * Los casos concretos comprueban lo que se me ocurrió; estas propiedades
 * comprueban lo que no se me ocurrió. Es donde aparecen los bugs de verdad.
 */

import { addDays, daysBetween } from '@planner/domain'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  addWorkingMinutes,
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
import { ALL_CALENDARS, HORIZON } from './__fixtures__/calendars.js'
import type { CompiledCalendar, PlanInstant } from './types.js'

const CALENDARS = ['base-40h', 'festivos', 'reducida-35h', 'jornada-variable'].map((id) =>
  compileCalendar(ALL_CALENDARS, id, HORIZON),
)

const arbCalendar = fc.constantFrom(...CALENDARS)
const HORIZON_DAYS = daysBetween(HORIZON.from, HORIZON.to) + 1

const arbInstant = fc
  .tuple(fc.integer({ min: 0, max: HORIZON_DAYS - 1 }), fc.integer({ min: 0, max: 1439 }))
  .map(([dayOffset, minuteOfDay]) => planInstant(addDays(HORIZON.from, dayOffset), minuteOfDay))

const worked = (instant: PlanInstant, calendar: CompiledCalendar): number =>
  workingMinutesBetween(planInstant(HORIZON.from, 0), instant, calendar)

const remainingCapacity = (instant: PlanInstant, calendar: CompiledCalendar): number =>
  totalWorkingMinutes(calendar) - worked(instant, calendar)

const compare = (left: PlanInstant, right: PlanInstant, calendar: CompiledCalendar): number =>
  toAbsoluteMinute(left, calendar) - toAbsoluteMinute(right, calendar)

describe('propiedades de la aritmética de calendario', () => {
  it('P1 · ida y vuelta: lo que se suma es lo que luego se mide', () => {
    fc.assert(
      fc.property(arbCalendar, arbInstant, fc.nat(), (calendar, from, raw) => {
        const capacity = remainingCapacity(from, calendar)
        if (capacity === 0) return true
        const minutes = raw % capacity
        const to = addWorkingMinutes(from, minutes, calendar)
        return workingMinutesBetween(from, to, calendar) === minutes
      }),
      { numRuns: 500 },
    )
  })

  it('P2 · restar es la inversa de medir hacia atrás', () => {
    fc.assert(
      fc.property(arbCalendar, arbInstant, fc.nat(), (calendar, to, raw) => {
        const available = worked(to, calendar)
        if (available === 0) return true
        const minutes = raw % available
        const from = subtractWorkingMinutes(to, minutes, calendar)
        return workingMinutesBetween(from, to, calendar) === minutes
      }),
      { numRuns: 500 },
    )
  })

  it('P3 · sumar más minutos nunca devuelve un instante anterior', () => {
    fc.assert(
      fc.property(arbCalendar, arbInstant, fc.nat({ max: 5000 }), fc.nat({ max: 5000 }), (calendar, from, a, b) => {
        const capacity = remainingCapacity(from, calendar)
        if (capacity < 2) return true
        const [less, more] = [a % capacity, b % capacity].sort((x, y) => x - y)
        return compare(addWorkingMinutes(from, less ?? 0, calendar), addWorkingMinutes(from, more ?? 0, calendar), calendar) <= 0
      }),
      { numRuns: 500 },
    )
  })

  it('P4 · sumar cero no mueve el instante ni lo ajusta al horario', () => {
    fc.assert(
      fc.property(arbCalendar, arbInstant, (calendar, from) => {
        const result = addWorkingMinutes(from, 0, calendar)
        return result.date === from.date && result.minuteOfDay === from.minuteOfDay
      }),
      { numRuns: 300 },
    )
  })

  it('P5 · ajustar hacia adelante es idempotente', () => {
    fc.assert(
      fc.property(arbCalendar, arbInstant, (calendar, from) => {
        const once = snapToWorkingTime(from, calendar, 'forward')
        const twice = snapToWorkingTime(once, calendar, 'forward')
        return compare(once, twice, calendar) === 0
      }),
      { numRuns: 300 },
    )
  })

  it('P6 · ajustar hacia atrás es idempotente', () => {
    fc.assert(
      fc.property(arbCalendar, arbInstant, (calendar, from) => {
        const once = snapToWorkingTime(from, calendar, 'backward')
        const twice = snapToWorkingTime(once, calendar, 'backward')
        return compare(once, twice, calendar) === 0
      }),
      { numRuns: 300 },
    )
  })

  it('P7 · ajustar no cambia el trabajo acumulado, sólo el instante', () => {
    fc.assert(
      fc.property(arbCalendar, arbInstant, (calendar, from) => {
        const forward = snapToWorkingTime(from, calendar, 'forward')
        const backward = snapToWorkingTime(from, calendar, 'backward')
        return (
          compare(backward, from, calendar) <= 0 &&
          compare(forward, from, calendar) >= 0 &&
          worked(forward, calendar) === worked(from, calendar) &&
          worked(backward, calendar) === worked(from, calendar)
        )
      }),
      { numRuns: 300 },
    )
  })

  it('P8 · la duración es aditiva: A→B más B→C es A→C', () => {
    fc.assert(
      fc.property(arbCalendar, fc.array(arbInstant, { minLength: 3, maxLength: 3 }), (calendar, instants) => {
        const [a, b, c] = [...instants].sort((left, right) => compare(left, right, calendar))
        if (a === undefined || b === undefined || c === undefined) return true
        return (
          workingMinutesBetween(a, b, calendar) + workingMinutesBetween(b, c, calendar) ===
          workingMinutesBetween(a, c, calendar)
        )
      }),
      { numRuns: 500 },
    )
  })

  it('P9 · la compilación no depende del orden en que se declaren slots y excepciones', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 1, max: 50 }), (calendarIndex, seed) => {
        const target = ALL_CALENDARS[calendarIndex]
        if (target === undefined) return true
        const shuffled = ALL_CALENDARS.map((definition) => ({
          ...definition,
          weekSlots: rotate(definition.weekSlots, seed),
          exceptions: rotate(definition.exceptions, seed),
        }))
        const original = compileCalendar(ALL_CALENDARS, target.id, HORIZON)
        const reordered = compileCalendar(shuffled, target.id, HORIZON)
        return original.dayMinutes.every((minutes, index) => minutes === reordered.dayMinutes[index])
      }),
      { numRuns: 200 },
    )
  })

  it('P10 · la suma acumulada es coherente con los minutos de cada día', () => {
    fc.assert(
      fc.property(arbCalendar, (calendar) => {
        let running = 0
        for (let index = 0; index < calendar.dayCount; index += 1) {
          if (calendar.prefixSum[index] !== running) return false
          running += calendar.dayMinutes[index] ?? 0
        }
        return calendar.prefixSum[calendar.dayCount] === running && totalWorkingMinutes(calendar) === running
      }),
      { numRuns: 4 },
    )
  })

  it('P11 · un instante es laborable si y sólo si el minuto siguiente suma trabajo', () => {
    fc.assert(
      fc.property(arbCalendar, arbInstant, (calendar, instant) => {
        const next = fromAbsoluteMinute(toAbsoluteMinute(instant, calendar) + 1, calendar)
        const measured = workingMinutesBetween(instant, next, calendar)
        return isWorkingTime(instant, calendar) === (measured === 1)
      }),
      { numRuns: 500 },
    )
  })

  it('P12 · la suma de los días del horizonte es el total del horizonte', () => {
    for (const calendar of CALENDARS) {
      let sum = 0
      for (let index = 0; index < calendar.dayCount; index += 1) {
        sum += workingMinutesOnDay(addDays(HORIZON.from, index), calendar)
      }
      expect(sum).toBe(totalWorkingMinutes(calendar))
    }
  })
})

function rotate<T>(items: readonly T[], by: number): readonly T[] {
  if (items.length === 0) return items
  const offset = by % items.length
  return [...items.slice(offset), ...items.slice(0, offset)]
}
