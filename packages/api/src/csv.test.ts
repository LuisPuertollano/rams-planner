import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseCsv, parseNumber, toCsv } from './csv.js'

describe('detectDelimiter', () => {
  it('reconoce el punto y coma de Excel en español y en alemán', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
  })

  it('ante la duda, se queda con el punto y coma', () => {
    expect(detectDelimiter('a;b,c')).toBe(';')
  })
})

describe('parseCsv', () => {
  it('lee cabecera y filas, normalizando la cabecera a minúsculas', () => {
    expect(parseCsv('Proyecto;Tarea\nP1;Hazard Log')).toEqual([{ proyecto: 'P1', tarea: 'Hazard Log' }])
  })

  it('respeta los separadores y los saltos de línea dentro de comillas', () => {
    const rows = parseCsv('a;b\n"uno;dos";"con\nsalto"')
    expect(rows[0]?.['a']).toBe('uno;dos')
    expect(rows[0]?.['b']).toBe('con\nsalto')
  })

  it('entiende las comillas escapadas', () => {
    expect(parseCsv('a\n"dice ""hola"""')[0]?.['a']).toBe('dice "hola"')
  })

  it('se traga el BOM que mete Excel y los finales de línea de Windows', () => {
    expect(parseCsv('﻿a;b\r\n1;2')).toEqual([{ a: '1', b: '2' }])
  })

  it('ignora las filas vacías y un fichero sin datos', () => {
    expect(parseCsv('a;b\n1;2\n\n;\n')).toEqual([{ a: '1', b: '2' }])
    expect(parseCsv('')).toEqual([])
  })
})

describe('toCsv', () => {
  it('escribe con punto y coma, BOM y CRLF, que es lo que Excel espera', () => {
    const csv = toCsv([{ a: '1', b: 'x' }], ['a', 'b'])
    expect(csv.startsWith('﻿a;b\r\n')).toBe(true)
    expect(csv).toContain('1;x')
  })

  it('entrecomilla lo que haga falta', () => {
    expect(toCsv([{ a: 'uno;dos' }], ['a'])).toContain('"uno;dos"')
    expect(toCsv([{ a: 'dice "hola"' }], ['a'])).toContain('"dice ""hola"""')
  })

  it('una columna que falta sale vacía, no como undefined', () => {
    expect(toCsv([{ a: '1' }], ['a', 'b'])).toContain('1;\r\n')
  })
})

describe('parseNumber', () => {
  it('acepta la coma decimal y el punto', () => {
    expect(parseNumber('7,5')).toBe(7.5)
    expect(parseNumber('7.5')).toBe(7.5)
    expect(parseNumber(' 12 ')).toBe(12)
  })

  it('devuelve null para lo que no es un número', () => {
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('cinco')).toBeNull()
  })
})

describe('el modo literal, que es el de la copia de seguridad', () => {
  // Esta prueba existe por un defecto medido, no por completismo. El parser
  // recortaba los espacios de todo valor, que es lo correcto al importar un
  // fichero que ha tocado una persona y es CORROMPER EL DATO al restaurar una
  // copia: un proyecto llamado «Plan RAMS » volvía sin su espacio, y ni
  // siquiera fallaba. Se vio pasándole una fila con valores feos; todo lo demás
  // daba la vuelta bien.
  const FEOS = [
    { c: 'con;punto y coma', d: '1' },
    { c: 'con "comillas" dentro', d: '2' },
    { c: 'con\nsalto de línea', d: '3' },
    { c: '  espacios a los lados  ', d: '4' },
    { c: '#empieza por almohadilla', d: '5' },
    { c: 'acentos áéíóú ñ «» —', d: '6' },
    { c: '{"json": "con ; y \\"comillas\\""}', d: '7' },
    { c: '', d: '8' },
  ]

  it('devuelve cada valor tal cual entró', () => {
    const vuelta = parseCsv(toCsv(FEOS, ['c', 'd']), 'literal')
    expect(vuelta).toHaveLength(FEOS.length)
    for (const [indice, original] of FEOS.entries()) {
      expect(vuelta[indice]?.['c'], original.d).toBe(original.c)
      expect(vuelta[indice]?.['d'], original.d).toBe(original.d)
    }
  })

  it('el modo de importación sigue recortando, que es lo que allí se quiere', () => {
    const vuelta = parseCsv(toCsv([{ c: '  con espacios  ' }], ['c']))
    expect(vuelta[0]?.['c']).toBe('con espacios')
  })

  it('una fila que empieza por almohadilla no desaparece', () => {
    // En una importación `#` abre un comentario y la fila entera se descarta.
    // En una copia eso sería perder una tarea sin decir nada.
    const texto = toCsv([{ c: '#3 revisión de concepto', d: 'x' }], ['c', 'd'])
    expect(parseCsv(texto, 'literal')).toHaveLength(1)
    expect(parseCsv(texto)).toHaveLength(0)
  })

  it('una fila entera vacía se conserva', () => {
    // Una tabla puede tener una fila con todas sus columnas de texto vacías.
    // El modo de importación la descarta —allí es una línea en blanco—; aquí
    // descartarla sería perder una fila.
    const texto = toCsv([{ c: '', d: '' }], ['c', 'd'])
    expect(parseCsv(texto, 'literal')).toHaveLength(1)
    expect(parseCsv(texto)).toHaveLength(0)
  })
})
