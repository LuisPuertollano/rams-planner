/**
 * El zip, escrito y leído por el mismo código.
 *
 * Una prueba de ida y vuelta contra uno mismo demuestra poco: si el escritor y
 * el lector comparten un error, pasan los dos. Por eso además se comprueba lo
 * que el formato exige de verdad —la firma, la marca de UTF-8, el CRC— y que
 * `unzip` del sistema lo abre, que es la prueba que importa: el zip tiene que
 * abrirse **sin la herramienta**.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { crc32, crearZip, leerZip, ZipError } from './zip.js'

const INSTANTE = new Date('2026-09-20T10:30:00Z')
const texto = (s: string): Buffer => Buffer.from(s, 'utf8')

describe('el zip', () => {
  it('da la vuelta entera: lo que entra es lo que sale', () => {
    const entradas = [
      { path: 'LEEME.txt', data: texto('Copia de seguridad\n') },
      { path: 'tablas/calendar.csv', data: texto('código;nombre\nBW;Baden-Württemberg\n') },
      { path: 'tablas/wbs_node.csv', data: texto('id;name\n'.repeat(200)) },
    ]
    const leido = leerZip(crearZip(entradas, INSTANTE))
    expect([...leido.keys()]).toEqual(entradas.map((e) => e.path))
    for (const entrada of entradas) {
      expect(leido.get(entrada.path)?.toString('utf8')).toBe(entrada.data.toString('utf8'))
    }
  })

  it('empieza por la firma y marca el nombre como UTF-8', () => {
    const zip = crearZip([{ path: 'líneas-base.csv', data: texto('x') }], INSTANTE)
    expect(zip.readUInt32LE(0)).toBe(0x04034b50)
    // Bit 11: sin él, Windows abre «líneas-base.csv» con la eñe rota.
    expect(zip.readUInt16LE(6) & 0x0800).toBe(0x0800)
    expect([...leerZip(zip).keys()]).toEqual(['líneas-base.csv'])
  })

  it('no engorda un fichero por comprimirlo', () => {
    // Un CSV de dos líneas sale más grande comprimido que en crudo, y entonces
    // se guarda en crudo. Se comprueba mirando el método declarado.
    const zip = crearZip([{ path: 'a.csv', data: texto('a;b\n1;2\n') }], INSTANTE)
    expect(zip.readUInt16LE(8)).toBe(0)
    const grande = crearZip([{ path: 'a.csv', data: texto('a;b\n1;2\n'.repeat(500)) }], INSTANTE)
    expect(grande.readUInt16LE(8)).toBe(8)
  })

  it('el mismo dato y el mismo instante dan el mismo zip, byte a byte', () => {
    // Es lo que permite comprobar que exportar es determinista (P2): dos copias
    // de una base que no ha cambiado tienen que ser el mismo fichero.
    const entradas = [{ path: 'a.csv', data: texto('hola\n') }]
    expect(crearZip(entradas, INSTANTE).equals(crearZip(entradas, INSTANTE))).toBe(true)
  })

  it('un zip tocado por dentro no se abre', () => {
    const zip = crearZip([{ path: 'a.csv', data: texto('a;b\n1;2\n'.repeat(500)) }], INSTANTE)
    // Un byte del cuerpo comprimido, no de las cabeceras.
    const roto = Buffer.from(zip)
    roto.writeUInt8(roto.readUInt8(60) ^ 0xff, 60)
    expect(() => leerZip(roto)).toThrow()
  })

  it('lo que no es un zip se dice claro', () => {
    expect(() => leerZip(texto('esto no es un zip'))).toThrow(ZipError)
  })

  it('el CRC-32 es el de PKZIP', () => {
    // El valor de «123456789» es la constante con la que se comprueba este CRC
    // en todas partes. Si esto cambia, el zip deja de abrirse fuera de aquí.
    expect(crc32(texto('123456789'))).toBe(0xcbf43926)
    expect(crc32(Buffer.alloc(0))).toBe(0)
  })

  it('propiedad: cualquier juego de ficheros da la vuelta', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            path: fc.stringMatching(/^[a-z0-9-]{1,12}(\/[a-z0-9-]{1,12})?\.csv$/),
            data: fc.string({ maxLength: 400 }),
          }),
          { maxLength: 8 },
        ),
        (crudas) => {
          // Dos entradas con la misma ruta no son un caso legal del zip.
          const porRuta = new Map(crudas.map((e) => [e.path, e.data]))
          const entradas = [...porRuta].map(([path, data]) => ({ path, data: texto(data) }))
          const leido = leerZip(crearZip(entradas, INSTANTE))
          return entradas.every((e) => leido.get(e.path)?.toString('utf8') === e.data.toString('utf8'))
        },
      ),
      { numRuns: 200 },
    )
  })

  it('`unzip` del sistema lo abre, que es de lo que se trata', () => {
    // La prueba que de verdad importa: el zip tiene que poder auditarse SIN la
    // herramienta. Si `unzip` no lo abre, no sirve de copia de seguridad.
    const carpeta = mkdtempSync(join(tmpdir(), 'zip-'))
    const ruta = join(carpeta, 'copia.zip')
    writeFileSync(
      ruta,
      crearZip(
        [
          { path: 'LEEME.txt', data: texto('Copia de seguridad del plan\n') },
          { path: 'tablas/calendar.csv', data: texto('código;nombre\nBW;Bádenia\n') },
        ],
        INSTANTE,
      ),
    )
    execFileSync('unzip', ['-qq', '-o', ruta, '-d', carpeta])
    expect(readFileSync(join(carpeta, 'LEEME.txt'), 'utf8')).toBe('Copia de seguridad del plan\n')
    expect(readFileSync(join(carpeta, 'tablas/calendar.csv'), 'utf8')).toContain('Bádenia')
  })
})
