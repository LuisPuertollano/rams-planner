/**
 * El catálogo de entregables que llega en un CSV, sin base de datos.
 *
 * Lo que aquí se comprueba es lo que decide si el fichero de un equipo entra
 * entero o no entra: que los errores salgan todos de golpe con su número de
 * fila, que el orden del fichero sea el del ciclo de vida, y sobre todo la
 * diferencia entre **una columna `espera_a` vacía** —«no espera a nadie», y se
 * le borran los enlaces— y **la columna ausente** —«no digo nada de esto», y no
 * se le tocan—.
 */

import { describe, expect, it } from 'vitest'
import { parseDocumentsCsv } from './import-documents.js'
import { ImportError } from './import-plan.js'

const CABECERA = 'codigo;nombre;tipo;disciplina;puerta;semanas_antes;horas;codigo_tarea;descripcion;espera_a'

const fichero = (...filas: readonly string[]): string => [CABECERA, ...filas].join('\n')

const falla = (texto: string): ImportError => {
  try {
    parseDocumentsCsv(texto)
  } catch (error) {
    if (error instanceof ImportError) return error
    throw error
  }
  throw new Error('se esperaba un ImportError y no lo hubo')
}

describe('el catálogo de documentos que llega en un CSV', () => {
  it('lee una ficha entera y pasa las horas a minutos', () => {
    const [fila] = parseDocumentsCsv(
      fichero('S-FMECA;FMECA;documento;Safety;CGR;28;450;PWTDF-D800;Analisis de modos de fallo;S-HAZLOG'),
    )
    expect(fila).toEqual({
      line: 2,
      code: 'S-FMECA',
      name: 'FMECA',
      description: 'Analisis de modos de fallo',
      kind: 'documento',
      discipline: 'Safety',
      gate: 'CGR',
      weeksBeforeGate: 28,
      // 450 h son 27.000 minutos: el minuto es la unidad (P5).
      standardMinutes: 27_000,
      taskCode: 'PWTDF-D800',
      sortKey: 10,
      esperaA: ['S-HAZLOG'],
    })
  })

  it('el orden del fichero es el orden del ciclo de vida', () => {
    // Un catálogo RAMS viene ordenado por puertas y perder ese orden obliga a
    // reconstruirlo a ojo, así que la fila del fichero fija el sort_key.
    const filas = parseDocumentsCsv(fichero('A;Uno;;;;;;;;', 'B;Dos;;;;;;;;', 'C;Tres;;;;;;;;'))
    expect(filas.map((f) => f.sortKey)).toEqual([10, 20, 30])
  })

  it('sin tipo, es un documento', () => {
    expect(parseDocumentsCsv(fichero('A;Uno;;;;;;;;'))[0]?.kind).toBe('documento')
  })

  it('acepta el tipo en castellano y en inglés', () => {
    const filas = parseDocumentsCsv(
      fichero('A;Uno;hito;;;;;;;', 'B;Dos;milestone;;;;;;;', 'C;Tres;fase;;;;;;;', 'D;Cuatro;Phase;;;;;;;'),
    )
    expect(filas.map((f) => f.kind)).toEqual(['hito', 'hito', 'fase', 'fase'])
  })

  it('un tipo que no existe se rechaza diciendo los que hay', () => {
    const error = falla(fichero('A;Uno;entregable;;;;;;;'))
    expect(error.rows[0]).toContain('«entregable» no es un tipo')
    expect(error.rows[0]).toContain('documento, hito, fase')
  })

  it('un hito SÍ puede llevar horas', () => {
    // Parecía que no: un hito es un instante. El primer catálogo real que pasó
    // por aquí lo desmintió —sus nueve puertas de revisión traían 16 h cada
    // una, las de la propia reunión— y la regla inventada se retiró.
    expect(parseDocumentsCsv(fichero('MST-IQA;Puerta IQA;hito;;IQA;;16;;;'))[0]?.standardMinutes).toBe(960)
  })

  it('la columna vacía y la columna ausente no dicen lo mismo', () => {
    // Es la distinción que hace que un fichero parcial no borre media matriz.
    const conColumna = parseDocumentsCsv(fichero('A;Uno;;;;;;;;'))
    expect(conColumna[0]?.esperaA).toEqual([])

    const sinColumna = parseDocumentsCsv('codigo;nombre\nA;Uno')
    expect(sinColumna[0]?.esperaA).toBeNull()
  })

  it('separa los predecesores por barra o por coma', () => {
    const filas = parseDocumentsCsv(fichero('A;Uno;;;;;;;;X|Y| Z ', 'B;Dos;;;;;;;;X, Y'))
    expect(filas[0]?.esperaA).toEqual(['X', 'Y', 'Z'])
    expect(filas[1]?.esperaA).toEqual(['X', 'Y'])
  })

  it('dos filas con el mismo código se rechazan diciendo dónde está la otra', () => {
    // Sin esto, la segunda pisaría a la primera en silencio.
    const error = falla(fichero('A;Uno;;;;;;;;', 'B;Dos;;;;;;;;', 'a;Otra vez uno;;;;;;;;'))
    expect(error.rows).toEqual(['Fila 4: el código «a» ya está en la fila 2'])
  })

  it('junta los errores de todas las filas, con su número', () => {
    const error = falla(
      fichero(';Sin codigo;;;;;;;;', 'B;;;;;;;;;', 'C;Tres;;;;no;;;;', 'D;Cuatro;;;;;-5;;;'),
    )
    expect(error.rows).toEqual([
      'Fila 2: falta el código',
      'Fila 3: falta el nombre',
      'Fila 4: «semanas_antes» no es un número («no»)',
      'Fila 5: «horas» no puede ser negativo',
    ])
  })

  it('dice todas las columnas obligatorias que faltan', () => {
    expect(falla('tipo;puerta\ndocumento;IGR').rows).toEqual([
      'Falta la columna «codigo»',
      'Falta la columna «nombre»',
    ])
  })

  it('un fichero sin filas de datos no se carga', () => {
    expect(() => parseDocumentsCsv(CABECERA)).toThrow(ImportError)
    expect(() => parseDocumentsCsv('')).toThrow(ImportError)
  })

  it('las columnas de más se ignoran y las de menos son opcionales', () => {
    // El fichero que alguien exporta de otra herramienta trae columnas suyas;
    // rechazarlo por eso sería una tontería.
    const [fila] = parseDocumentsCsv('codigo;nombre;color\nA;Uno;azul')
    expect(fila?.code).toBe('A')
    expect(fila?.gate).toBeNull()
    expect(fila?.standardMinutes).toBeNull()
  })
})
