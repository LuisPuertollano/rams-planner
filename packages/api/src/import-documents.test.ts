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
      subactividades: null,
      entregas: null,
      sortKey: 10,
      esperaA: ['S-HAZLOG'],
      // Sin ninguna de las cinco columnas de firma, el fichero no habla del
      // ciclo y no lo toca: null y no lista vacía, que significaría «bórralo».
      firmas: null,
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

// ---------------------------------------------------------------------------
// El ciclo de firma
// ---------------------------------------------------------------------------

const CABECERA_FIRMAS = `${CABECERA};autor;verificador_1;verificador_2;aprobador;revisores`
const conFirmas = (...filas: readonly string[]): string => [CABECERA_FIRMAS, ...filas].join('\n')

describe('el ciclo de firma que llega en el CSV', () => {
  it('lee las cinco casillas y las coloca en su paso y su posición', () => {
    const [fila] = parseDocumentsCsv(
      conFirmas('S-SAP;Safety Plan;;;;;;;;;Ing. RAMS;Ing. Sistemas;Jefe RAMS;PrEM;Calidad|Compras'),
    )
    expect(fila?.firmas).toEqual([
      { step: 'author', position: 1, role: 'Ing. RAMS', standardMinutes: null },
      { step: 'verifier', position: 1, role: 'Ing. Sistemas', standardMinutes: null },
      { step: 'verifier', position: 2, role: 'Jefe RAMS', standardMinutes: null },
      { step: 'approver', position: 1, role: 'PrEM', standardMinutes: null },
      { step: 'reviewer', position: 1, role: 'Calidad', standardMinutes: null },
      { step: 'reviewer', position: 2, role: 'Compras', standardMinutes: null },
    ])
  })

  it('las columnas presentes pero vacías dicen «no hay ciclo», y eso borra el que hubiera', () => {
    const [fila] = parseDocumentsCsv(conFirmas('S-SAP;Safety Plan;;;;;;;;;;;;;'))
    // Lista vacía, no null: la diferencia es la misma que en espera_a.
    expect(fila?.firmas).toEqual([])
  })

  it('sin las columnas, el fichero no habla del ciclo y no lo toca', () => {
    const [fila] = parseDocumentsCsv(fichero('S-SAP;Safety Plan;;;;;;;;'))
    expect(fila?.firmas).toBeNull()
  })

  it('basta con que venga una de las cinco columnas', () => {
    const texto = ['codigo;nombre;aprobador', 'S-SAP;Safety Plan;PrEM'].join('\n')
    const [fila] = parseDocumentsCsv(texto)
    expect(fila?.firmas).toEqual([
      { step: 'approver', position: 1, role: 'PrEM', standardMinutes: null },
    ])
  })

  it('un ciclo mal repartido no rechaza el fichero: se lee y se avisa después', () => {
    // El autor se verifica a sí mismo y no hay aprobador. El parser no protesta;
    // el aviso lo da la importación, como con los ciclos de la matriz.
    const [fila] = parseDocumentsCsv(
      conFirmas('S-SAP;Safety Plan;;;;;;;;;Ing. RAMS;Ing. RAMS;;;'),
    )
    expect(fila?.firmas).toHaveLength(2)
  })

  it('un rol con espacios de sobra entra limpio', () => {
    const [fila] = parseDocumentsCsv(conFirmas('S-SAP;Safety Plan;;;;;;;;;  Ing. RAMS  ;;;PrEM;'))
    expect(fila?.firmas?.map((firma) => firma.role)).toEqual(['Ing. RAMS', 'PrEM'])
  })
})

const CON_CADENA =
  'codigo;nombre;crear;revisar_1;revisar_2;revisar_3;soportar;autor;verificador_1'

const conCadena = (...filas: readonly string[]): string => [CON_CADENA, ...filas].join('\n')

describe('la cadena de subactividades que llega en el CSV', () => {
  it('lee rol y horas, y pasa las horas a minutos', () => {
    const [fila] = parseDocumentsCsv(conCadena('S-FMECA;FMECA;Ing. RAMS:30;Ing. Sistemas:4;;;Jefe RAMS:10;;'))
    expect(fila?.subactividades).toEqual([
      { step: 'create', position: 1, role: 'Ing. RAMS', standardMinutes: 1800, signature: null },
      { step: 'review_1', position: 1, role: 'Ing. Sistemas', standardMinutes: 240, signature: null },
      { step: 'support', position: 1, role: 'Jefe RAMS', standardMinutes: 600, signature: null },
    ])
  })

  it('el tercer trozo cita la firma que esa subactividad descarga', () => {
    // Es lo que permite avisar de una firma que cuesta minutos y que ninguna
    // subactividad hace, que si no se pierde sin que nadie lo note.
    const [fila] = parseDocumentsCsv(
      conCadena('S-FMECA;FMECA;Ing. RAMS:30:autor;Ing. Sistemas:4:verificador_1;;;;Ing. RAMS;Ing. Sistemas'),
    )
    expect(fila?.subactividades?.[0]?.signature).toEqual({ step: 'author', position: 1 })
    expect(fila?.subactividades?.[1]?.signature).toEqual({ step: 'verifier', position: 1 })
  })

  it('una casilla sin horas entra, porque un hito trae rol y no trae horas', () => {
    // La primera versión de esto las exigía, y el catálogo de verdad lo
    // desmintió a la primera: las doce puertas traen su rol y ninguna hora.
    // Que no sirva para partir se avisa al terminar; no se rechaza el fichero.
    const [fila] = parseDocumentsCsv(conCadena('S-FMECA;FMECA;Ing. RAMS;;;;;;'))
    expect(fila?.subactividades).toEqual([
      { step: 'create', position: 1, role: 'Ing. RAMS', standardMinutes: null, signature: null },
    ])
  })

  it('una firma que no existe como casilla se dice con los nombres que sí valen', () => {
    expect(falla(conCadena('S-FMECA;FMECA;Ing. RAMS:30:jefazo;;;;;;')).rows.join(' ')).toContain(
      'verificador_1',
    )
  })

  it('la columna ausente no dice nada de la cadena y no la toca', () => {
    // Misma distinción que `espera_a` y que las firmas: ausente no es vacía.
    const [sinColumnas] = parseDocumentsCsv(fichero('S-FMECA;FMECA;documento;;;;;;;'))
    expect(sinColumnas?.subactividades).toBeNull()
    const [conColumnasVacias] = parseDocumentsCsv(conCadena('S-FMECA;FMECA;;;;;;;'))
    expect(conColumnasVacias?.subactividades).toEqual([])
  })

  it('los niveles no son rondas: puede haber revisión 2 sin revisión 1', () => {
    const [fila] = parseDocumentsCsv(conCadena('S-FMECA;FMECA;Ing. RAMS:30;;Jefe RAMS:2;;;;'))
    expect(fila?.subactividades?.map((a) => a.step)).toEqual(['create', 'review_2'])
  })
})

const CON_ENTREGAS = 'codigo;nombre;puerta;entregas_previas'
const conEntregas = (...filas: readonly string[]): string => [CON_ENTREGAS, ...filas].join('\n')

describe('las entregas previas que pide la Checkliste', () => {
  it('lee puerta, madurez, porcentaje y semanas', () => {
    const [fila] = parseDocumentsCsv(
      conEntregas('S-FMECA;FMECA;CGR;PGR:preliminar:30:4|IGR:as designed:20:6'),
    )
    expect(fila?.entregas).toEqual([
      { position: 1, gate: 'PGR', maturity: 'preliminar', weeksBeforeGate: 4, shareBp: 3_000 },
      { position: 2, gate: 'IGR', maturity: 'as designed', weeksBeforeGate: 6, shareBp: 2_000 },
    ])
  })

  it('sin nombre de madurez la llama «preliminar», que es como la llaman casi todas', () => {
    const [fila] = parseDocumentsCsv(conEntregas('S-FMECA;FMECA;CGR;PGR::30'))
    expect(fila?.entregas?.[0]?.maturity).toBe('preliminar')
    expect(fila?.entregas?.[0]?.weeksBeforeGate).toBeNull()
  })

  it('sin porcentaje no entra: es la mitad del dato', () => {
    // Lo que no se llevan las previas es lo que cuesta la final. Sin el
    // porcentaje no hay reparto, y una entrega sin reparto no dice nada.
    expect(falla(conEntregas('S-FMECA;FMECA;CGR;PGR:preliminar')).rows.join(' ')).toContain('PORCENTAJE')
  })

  it('un porcentaje de 100 o más no entra: no dejaría nada para la final', () => {
    expect(falla(conEntregas('S-FMECA;FMECA;CGR;PGR:preliminar:100')).rows.join(' ')).toContain('entre 1 y 99')
    expect(falla(conEntregas('S-FMECA;FMECA;CGR;PGR:preliminar:0')).rows.join(' ')).toContain('entre 1 y 99')
  })

  it('la columna ausente no dice nada de la Checkliste y no la toca', () => {
    const [sinColumna] = parseDocumentsCsv(fichero('S-FMECA;FMECA;documento;;;;;;;'))
    expect(sinColumna?.entregas).toBeNull()
    const [vacia] = parseDocumentsCsv(conEntregas('S-FMECA;FMECA;CGR;'))
    expect(vacia?.entregas).toEqual([])
  })
})
