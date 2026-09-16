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
