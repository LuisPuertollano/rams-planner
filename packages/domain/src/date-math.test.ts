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

  it('leer las cifras carácter a carácter da lo mismo que cortar la cadena', () => {
    // `toEpochDay` lee la fecha con `charCodeAt` en vez de `slice` + `Number`,
    // porque nivelar un portafolio grande llamaba ahí millones de veces y cada
    // corte era una cadena que barrer. Esta prueba fija que las dos formas de
    // leerla coinciden, día a día, en todo el rango en el que la herramienta
    // planifica de verdad: de 1900 a 2200 son 109.573 días, y se comprueban
    // todos, no una muestra.
    const comoSeHacia = (fecha: string): string =>
      [Number(fecha.slice(0, 4)), Number(fecha.slice(5, 7)), Number(fecha.slice(8, 10))].join('|')
    const comoSeHaceAhora = (fecha: string): string =>
      [
        (fecha.charCodeAt(0) - 48) * 1000 + (fecha.charCodeAt(1) - 48) * 100 +
          (fecha.charCodeAt(2) - 48) * 10 + (fecha.charCodeAt(3) - 48),
        (fecha.charCodeAt(5) - 48) * 10 + (fecha.charCodeAt(6) - 48),
        (fecha.charCodeAt(8) - 48) * 10 + (fecha.charCodeAt(9) - 48),
      ].join('|')

    const desde = toEpochDay(d('1900-01-01'))
    const hasta = toEpochDay(d('2200-01-01'))
    let dias = 0
    for (let epochDay = desde; epochDay <= hasta; epochDay += 1) {
      const fecha = fromEpochDay(epochDay)
      expect(comoSeHaceAhora(fecha), fecha).toBe(comoSeHacia(fecha))
      // Y que el resultado entero sigue siendo el que entró.
      expect(toEpochDay(fecha), fecha).toBe(epochDay)
      dias += 1
    }
    expect(dias).toBe(109_574)
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
