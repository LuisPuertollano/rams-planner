/**
 * El parseo del parte de horas, sin base de datos.
 *
 * Lo que se puede comprobar sin ella se comprueba sin ella: que las horas sean
 * minutos enteros, que una fecha imposible se rechace, y sobre todo que los
 * errores salgan **todos de golpe y con su número de fila**. Corregir un parte
 * de trescientas líneas de error en error es inaceptable, y es lo que pasa si
 * la validación se rinde en el primer fallo.
 */

import { describe, expect, it } from 'vitest'
import { parseActualsCsv } from './import-actuals.js'
import { ImportError } from './import-plan.js'

const CABECERA = 'proyecto;tarea;persona;fecha;horas'

const fichero = (...filas: readonly string[]): string => [CABECERA, ...filas].join('\n')

/** El `ImportError` que lanzó, para poder mirarle las filas. */
const falla = (texto: string): ImportError => {
  try {
    parseActualsCsv(texto)
  } catch (error) {
    if (error instanceof ImportError) return error
    throw error
  }
  throw new Error('se esperaba un ImportError y no lo hubo')
}

describe('el parte de horas que llega en un CSV', () => {
  it('lee una fila y la deja en minutos enteros', () => {
    const [fila] = parseActualsCsv(fichero('P-1;Plan RAMS;Ana Müller;2026-03-02;7,5'))
    expect(fila).toEqual({
      line: 2,
      projectCode: 'P-1',
      taskName: 'Plan RAMS',
      personName: 'Ana Müller',
      workDate: '2026-03-02',
      // 7,5 h son 450 minutos, no 7,5 de nada: el minuto es la unidad (P5).
      minutes: 450,
      source: 'timesheet',
      externalRef: null,
    })
  })

  it('acepta la coma y el punto decimal, porque Excel escribe las dos', () => {
    const filas = parseActualsCsv(fichero('P-1;T;Ana;2026-03-02;1,25', 'P-1;T;Ana;2026-03-03;1.25'))
    expect(filas.map((fila) => fila.minutes)).toEqual([75, 75])
  })

  it('el origen por defecto es el parte, y se puede decir en castellano', () => {
    const texto = [
      `${CABECERA};origen`,
      'P-1;T;Ana;2026-03-02;1;',
      'P-1;T;Ana;2026-03-03;1;parte',
      'P-1;T;Ana;2026-03-04;1;estimado',
      'P-1;T;Ana;2026-03-05;1;manual',
    ].join('\n')
    expect(parseActualsCsv(texto).map((fila) => fila.source)).toEqual([
      'timesheet',
      'timesheet',
      'estimate',
      'manual',
    ])
  })

  it('un origen que no existe se rechaza diciendo los que hay', () => {
    const error = falla([`${CABECERA};origen`, 'P-1;T;Ana;2026-03-02;1;inventado'].join('\n'))
    expect(error.rows[0]).toContain('«inventado» no es un origen')
    expect(error.rows[0]).toContain('timesheet')
  })

  it('dice todas las columnas que faltan, no la primera', () => {
    const error = falla('proyecto;tarea\nP-1;T')
    expect(error.rows).toEqual([
      'Falta la columna «persona»',
      'Falta la columna «fecha»',
      'Falta la columna «horas»',
    ])
  })

  it('un fichero sin filas de datos no es un fichero vacío que se cargue', () => {
    expect(() => parseActualsCsv(CABECERA)).toThrow(ImportError)
    expect(() => parseActualsCsv('')).toThrow(ImportError)
  })

  it('junta los errores de todas las filas, con su número', () => {
    const error = falla(
      fichero(
        'P-1;T;Ana;2026-03-02;7,5',
        ';T;Ana;2026-03-03;1',
        'P-1;;Ana;2026-03-04;1',
        'P-1;T;;2026-03-05;1',
        'P-1;T;Ana;2026-03-06;no',
      ),
    )
    expect(error.rows).toEqual([
      'Fila 3: falta el proyecto',
      'Fila 4: falta la tarea',
      'Fila 5: falta la persona',
      'Fila 6: «horas» no es un número',
    ])
  })

  it('una fecha con forma de fecha que no existe se rechaza', () => {
    // Lo que el patrón AAAA-MM-DD deja pasar y el calendario no.
    const error = falla(fichero('P-1;T;Ana;2026-02-30;1', 'P-1;T;Ana;02/03/2026;1'))
    expect(error.rows).toEqual([
      'Fila 2: «2026-02-30» no es una fecha (AAAA-MM-DD)',
      'Fila 3: «02/03/2026» no es una fecha (AAAA-MM-DD)',
    ])
  })

  it('más de veinticuatro horas en una fila es la columna equivocada', () => {
    // Una persona, una tarea, un día. 450 en el hueco de las horas son minutos
    // puestos donde no iban, y cargarlo dejaría el mes con 7.500 h.
    const error = falla(fichero('P-1;T;Ana;2026-03-02;450'))
    expect(error.rows[0]).toContain('en un solo día')
    // Y veinticuatro justas sí se cargan: es raro, no es imposible.
    expect(parseActualsCsv(fichero('P-1;T;Ana;2026-03-02;24'))[0]?.minutes).toBe(1440)
  })

  it('las horas negativas no se cargan', () => {
    expect(falla(fichero('P-1;T;Ana;2026-03-02;-1')).rows[0]).toContain('no pueden ser negativas')
  })

  it('la referencia del fichero viaja con la fila, para poder rastrearla', () => {
    const texto = [`${CABECERA};referencia`, 'P-1;T;Ana;2026-03-02;1;TS-1024', 'P-1;T;Ana;2026-03-03;1;'].join('\n')
    expect(parseActualsCsv(texto).map((fila) => fila.externalRef)).toEqual(['TS-1024', null])
  })
})
