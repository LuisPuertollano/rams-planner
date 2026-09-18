/**
 * El equipo que llega en un CSV, sin base de datos.
 *
 * Lo que aquí se comprueba es lo que decide si el fichero de un departamento
 * entra entero: que los porcentajes se escriban en porcentaje y no en puntos
 * básicos, que un nivel de competencia inventado no cuele, y sobre todo la
 * diferencia entre **la columna `competencias` vacía** —«no sabe nada», y se le
 * borran— y **la columna ausente** —«no digo nada de esto», y no se le tocan—.
 */

import { describe, expect, it } from 'vitest'
import { parseTeamCsv, traeTarifas } from './import-team.js'
import { ImportError } from './import-plan.js'

const CABECERA =
  'codigo;nombre;calendario;jornada;indirecto;reserva;alta;baja;competencias;tarifa;tarifa_desde;tarifa_hasta'

const fichero = (...filas: readonly string[]): string => [CABECERA, ...filas].join('\n')

const falla = (texto: string): ImportError => {
  try {
    parseTeamCsv(texto)
  } catch (error) {
    if (error instanceof ImportError) return error
    throw error
  }
  throw new Error('se esperaba un ImportError y no lo hubo')
}

describe('el equipo que llega en un CSV', () => {
  it('lee una ficha entera', () => {
    const [fila] = parseTeamCsv(
      fichero('RAMS-01;Ana Muller;BW;80;15;10;2026-01-01;;FMECA:4|Hazard Log:3;78,50;2026-01-01;2026-12-31'),
    )
    expect(fila).toEqual({
      line: 2,
      codigo: 'RAMS-01',
      nombre: 'Ana Muller',
      calendario: 'BW',
      // 80 % son 8000 puntos básicos: el fichero habla en porcentaje.
      jornadaBp: 8_000,
      indirectoBp: 1_500,
      reservaBp: 1_000,
      alta: '2026-01-01',
      baja: null,
      competencias: [
        { nombre: 'FMECA', nivel: 4 },
        { nombre: 'Hazard Log', nivel: 3 },
      ],
      tarifa: { centimosHora: 7_850, desde: '2026-01-01', hasta: '2026-12-31' },
    })
  })

  it('la columna de competencias vacía no es lo mismo que la columna ausente', () => {
    // Vacía dice «no sabe nada»: la lista completa es la lista vacía.
    const [conColumna] = parseTeamCsv(fichero('RAMS-01;Ana Muller;;;;;;;;;;'))
    expect(conColumna?.competencias).toEqual([])
    // Ausente no dice nada de las competencias, y entonces no se tocan.
    const [sinColumna] = parseTeamCsv(['codigo;nombre', 'RAMS-01;Ana Muller'].join('\n'))
    expect(sinColumna?.competencias).toBeNull()
  })

  it('un nivel de competencia fuera de 1 a 5 no cuela', () => {
    expect(falla(fichero('RAMS-01;Ana Muller;;;;;;;FMECA:9;;;')).message).toContain('de 1 a 5')
    expect(falla(fichero('RAMS-01;Ana Muller;;;;;;;FMECA:dos;;;')).message).toContain('de 1 a 5')
  })

  it('una competencia sin nivel se rechaza en vez de ponerle uno', () => {
    // Inventar un nivel sería la herramienta opinando sobre lo que alguien sabe
    // hacer, que es justo el dato que se estaba importando.
    expect(falla(fichero('RAMS-01;Ana Muller;;;;;;;FMECA;;;')).message).toContain('no dice el nivel')
  })

  it('el factor indirecto y la reserva no pasan de media jornada', () => {
    expect(falla(fichero('RAMS-01;Ana Muller;;;80;;;;;;;')).message).toContain('indirecto')
    expect(falla(fichero('RAMS-01;Ana Muller;;;;60;;;;;;')).message).toContain('reserva')
  })

  it('una tarifa sin tramo no entra', () => {
    // Una tarifa sin fechas no se puede cobrar a nada, así que no es una tarifa.
    expect(falla(fichero('RAMS-01;Ana Muller;;;;;;;;78,50;;')).message).toContain('tarifa_desde')
    expect(falla(fichero('RAMS-01;Ana Muller;;;;;;;;78,50;2026-12-31;2026-01-01')).message).toContain(
      'después',
    )
  })

  it('admite coma y punto decimal, porque Excel escribe de las dos formas', () => {
    const [conComa] = parseTeamCsv(fichero('RAMS-01;A;;;;;;;;78,50;2026-01-01;2026-12-31'))
    const [conPunto] = parseTeamCsv(fichero('RAMS-02;B;;;;;;;;78.50;2026-01-01;2026-12-31'))
    expect(conComa?.tarifa?.centimosHora).toBe(7_850)
    expect(conPunto?.tarifa?.centimosHora).toBe(7_850)
  })

  it('el mismo código dos veces en el fichero es un error, no un duplicado', () => {
    expect(
      falla(fichero('RAMS-01;Ana Muller;;;;;;;;;;', 'rams-01;Otra persona;;;;;;;;;;')).message,
    ).toContain('sale dos veces')
  })

  it('sin código o sin nombre no hay fila', () => {
    expect(falla(fichero(';Ana Muller;;;;;;;;;;')).message).toContain('falta el código')
    expect(falla(fichero('RAMS-01;;;;;;;;;;;')).message).toContain('falta el nombre')
  })

  it('un fichero sin las columnas obligatorias se rechaza entero', () => {
    expect(falla('nombre;jornada\nAna Muller;100').message).toContain('codigo')
  })

  it('una fecha que no es AAAA-MM-DD se dice con su columna', () => {
    expect(falla(fichero('RAMS-01;A;;;;;01/01/2026;;;;;')).message).toContain('alta')
  })

  it('sabe si el fichero trae tarifas, que es lo que decide el permiso', () => {
    // La ruta lo pregunta antes de dejar pasar: traer tarifas pide otro permiso.
    expect(traeTarifas(fichero('RAMS-01;A;;;;;;;;78,50;2026-01-01;2026-12-31'))).toBe(true)
    expect(traeTarifas(fichero('RAMS-01;A;;;;;;;;;;'))).toBe(false)
    expect(traeTarifas(['codigo;nombre', 'RAMS-01;Ana Muller'].join('\n'))).toBe(false)
  })

  it('las líneas de comentario no son datos', () => {
    const filas = parseTeamCsv(fichero('# esto es una nota', 'RAMS-01;Ana Muller;;;;;;;;;;'))
    expect(filas).toHaveLength(1)
  })
})
