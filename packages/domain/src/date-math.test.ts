import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { addDays, compareDates, daysBetween, fromEpochDay, isoWeekday, toEpochDay } from './date-math.js'
import { calendarDate, UnitError } from './units.js'

const d = calendarDate

describe('toEpochDay / fromEpochDay', () => {
  it('ancla el origen en 1970-01-01', () => {
    expect(toEpochDay(d('1970-01-01'))).toBe(0)
    expect(fromEpochDay(0)).toBe('1970-01-01')
  })

  it('cuenta bien los años bisiestos, incluidos los de siglo', () => {
    expect(daysBetween(d('2024-02-28'), d('2024-03-01'))).toBe(2) // 2024 es bisiesto
    expect(daysBetween(d('2100-02-28'), d('2100-03-01'))).toBe(1) // 2100 no lo es
    expect(daysBetween(d('2000-02-28'), d('2000-03-01'))).toBe(2) // 2000 sí lo es
  })

  it('funciona con fechas anteriores al origen', () => {
    expect(toEpochDay(d('1969-12-31'))).toBe(-1)
    expect(fromEpochDay(-1)).toBe('1969-12-31')
    expect(fromEpochDay(-719_468)).toBe('0000-03-01')
  })

  it('rechaza un día que no es entero', () => {
    expect(() => fromEpochDay(1.5)).toThrow(UnitError)
  })

  it('propiedad: fromEpochDay(toEpochDay(f)) === f', () => {
    fc.assert(
      fc.property(fc.integer({ min: -25_000, max: 60_000 }), (epochDay) => {
        const date = fromEpochDay(epochDay)
        return toEpochDay(date) === epochDay
      }),
      { numRuns: 1000 },
    )
  })
})

describe('isoWeekday', () => {
  it('sitúa correctamente los días conocidos', () => {
    expect(isoWeekday(d('1970-01-01'))).toBe(4) // jueves
    expect(isoWeekday(d('2026-09-14'))).toBe(1) // lunes
    expect(isoWeekday(d('2026-09-20'))).toBe(7) // domingo
  })

  it('propiedad: siete días después es el mismo día de la semana', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40_000 }), (epochDay) => {
        const date = fromEpochDay(epochDay)
        return isoWeekday(date) === isoWeekday(addDays(date, 7))
      }),
      { numRuns: 500 },
    )
  })

  it('propiedad: el día de la semana siempre está en 1..7', () => {
    fc.assert(
      fc.property(fc.integer({ min: -20_000, max: 40_000 }), (epochDay) => {
        const weekday = isoWeekday(fromEpochDay(epochDay))
        return weekday >= 1 && weekday <= 7
      }),
      { numRuns: 500 },
    )
  })
})

describe('addDays y daysBetween', () => {
  it('cruza fines de mes y de año', () => {
    expect(addDays(d('2026-12-31'), 1)).toBe('2027-01-01')
    expect(addDays(d('2026-03-01'), -1)).toBe('2026-02-28')
    expect(addDays(d('2028-03-01'), -1)).toBe('2028-02-29')
  })

  it('rechaza desplazamientos que no son enteros', () => {
    expect(() => addDays(d('2026-01-01'), 0.5)).toThrow(UnitError)
  })

  it('propiedad: addDays y daysBetween son inversas', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 40_000 }),
        fc.integer({ min: -5000, max: 5000 }),
        (epochDay, offset) => {
          const from = fromEpochDay(epochDay)
          return daysBetween(from, addDays(from, offset)) === offset
        },
      ),
      { numRuns: 1000 },
    )
  })
})

describe('compareDates', () => {
  it('ordena como se espera', () => {
    expect(compareDates(d('2026-01-01'), d('2026-01-02'))).toBe(-1)
    expect(compareDates(d('2026-01-02'), d('2026-01-01'))).toBe(1)
    expect(compareDates(d('2026-01-01'), d('2026-01-01'))).toBe(0)
  })
})
