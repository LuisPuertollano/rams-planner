/**
 * La plantilla tiene que ser importable por el mismo parser que la explica.
 *
 * Es la prueba que sostiene toda la idea: si la plantilla se descarga, se le
 * quitan las almohadillas a los ejemplos y se vuelve a subir, tiene que
 * funcionar. Una plantilla que no pasa su propio importador es peor que no
 * tener plantilla, porque manda a alguien a buscar un error que no es suyo.
 */

import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv.js'
import { IMPORT_SPECS, plantillaCsv, type ImportSpec } from './import-specs.js'
import { parseActualsCsv } from './import-actuals.js'
import { parseDocumentsCsv } from './import-documents.js'

/**
 * El manual de la cabecera como un solo texto seguido.
 *
 * Hace falta porque las frases van envueltas a 76 caracteres para que quepan en
 * el bloc de notas: una regla partida en dos líneas ya no es una subcadena, y
 * buscarla tal cual daría un fallo que no lo es.
 */
const manualSeguido = (plantilla: string): string =>
  plantilla
    .split('\r\n')
    .filter((linea) => linea.replace(/^\uFEFF/, '').startsWith('#'))
    .map((linea) => linea.replace(/^\uFEFF/, '').replace(/^#\s*(·\s*)?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')

/** Lo que haría alguien con la plantilla: quitar la # de las filas de ejemplo. */
const descomentaLosEjemplos = (plantilla: string): string =>
  plantilla
    .split('\r\n')
    .map((linea) => (/^#[^\s#=]/.test(linea) ? linea.slice(1) : linea))
    .join('\r\n')

describe.each(IMPORT_SPECS.map((spec) => [spec.tipo, spec] as const))('la plantilla de %s', (_tipo, spec: ImportSpec) => {
  const plantilla = plantillaCsv(spec)

  it('trae la cabecera con todas las columnas y en su orden', () => {
    const cabecera = plantilla
      .split('\r\n')
      .find((linea) => !linea.startsWith('#') && !linea.startsWith('\uFEFF#'))
    expect(cabecera?.replace(/^\uFEFF/, '').split(';')).toEqual(spec.columnas.map((c) => c.nombre))
  })

  it('explica cada columna y cada regla dentro del propio fichero', () => {
    const manual = manualSeguido(plantilla)
    for (const columna of spec.columnas) {
      expect(manual, columna.nombre).toContain(columna.que)
      // Y dice si hace falta, que es la primera pregunta de quien la rellena.
      expect(plantilla).toMatch(new RegExp(`#\\s+${columna.nombre}\\s+(Sí|no)\\s`))
    }
    for (const regla of spec.reglas) expect(manual, regla.slice(0, 40)).toContain(regla)
  })

  it('tal cual se descarga, no importa nada: los ejemplos van comentados', () => {
    // Si las filas de ejemplo fueran filas normales, quien rellenara la
    // plantilla sin fijarse se encontraría con datos inventados dentro.
    expect(parseCsv(plantilla)).toEqual([])
  })

  it('quitando la almohadilla de los ejemplos, se lee entera', () => {
    const filas = parseCsv(descomentaLosEjemplos(plantilla))
    expect(filas).toHaveLength(spec.ejemplos.length)
    // Y los valores llegan donde tienen que llegar, no desplazados una columna.
    const primera = spec.ejemplos[0] ?? []
    for (const [indice, columna] of spec.columnas.entries()) {
      expect(filas[0]?.[columna.nombre], columna.nombre).toBe(primera[indice] ?? '')
    }
  })

  it('el manual de delante no confunde al detector de separador', () => {
    // Es la trampa de meter prosa antes de la cabecera: una línea sin puntos y
    // coma haría elegir la coma, y el fichero se leería como una sola columna.
    expect(plantilla.startsWith('\uFEFF#')).toBe(true)
    expect(parseCsv(descomentaLosEjemplos(plantilla))[0]).toHaveProperty(
      spec.columnas[0]?.nombre ?? '',
    )
  })

  it('cada columna obligatoria trae un valor en la primera fila de ejemplo', () => {
    // Un ejemplo con un hueco donde la columna es obligatoria enseña justo lo
    // contrario de lo que hay que hacer.
    const primera = spec.ejemplos[0] ?? []
    for (const [indice, columna] of spec.columnas.entries()) {
      if (columna.obligatoria) expect(primera[indice], columna.nombre).not.toBe('')
    }
  })
})

describe('los ejemplos pasan el importador de verdad', () => {
  it('el parte de horas', () => {
    const filas = parseActualsCsv(descomentaLosEjemplos(plantillaCsv(IMPORT_SPECS[1] as ImportSpec)))
    expect(filas).toHaveLength(3)
    expect(filas[0]?.minutes).toBe(450)
    // La tercera fila repite día y tarea de la segunda a propósito: es el caso
    // de «alguien paró a comer», y la plantilla lo enseña.
    expect(filas[1]?.workDate).toBe(filas[2]?.workDate)
    expect(filas[1]?.taskName).toBe(filas[2]?.taskName)
  })

  it('el catálogo de entregables', () => {
    const filas = parseDocumentsCsv(descomentaLosEjemplos(plantillaCsv(IMPORT_SPECS[2] as ImportSpec)))
    expect(filas.map((f) => f.code)).toEqual(['S-HAZLOG', 'S-SAP', 'S-FMECA', 'MST-IQA'])
    expect(filas[2]?.esperaA).toEqual(['S-HAZLOG', 'S-SAP'])
    // El hito con horas, que es la regla que el dato real corrigió.
    expect(filas[3]?.kind).toBe('hito')
    expect(filas[3]?.standardMinutes).toBe(960)
  })
})
