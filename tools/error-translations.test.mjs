import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseDictionaryKeys } from './finding-translations.mjs'
import {
  checkErrorTranslations,
  loadErrorSources,
  parseErrorCodes,
  parseRawErrorSends,
} from './error-translations.mjs'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('la regla: ningún error sin traducir', () => {
  it('el workspace la cumple', async () => {
    const { codigos, claves, sueltos } = await loadErrorSources(rootDir, parseDictionaryKeys)
    expect(checkErrorTranslations(codigos, claves, sueltos)).toEqual([])
    // Y se leyó el catálogo de verdad.
    expect(codigos).toContain('SIN_PERMISO')
    expect(codigos).toContain('PERIODO_INVERTIDO')
  })

  it('caza un código nuevo sin frase', () => {
    const problemas = checkErrorTranslations(['ALGO_NUEVO'], [])
    expect(problemas.map((p) => p.kind)).toEqual(['falta-la-frase'])
    expect(problemas[0]?.detail).toContain('error.ALGO_NUEVO')
  })

  it('las variantes valen como frase, igual que en los hallazgos', () => {
    const problemas = checkErrorTranslations(
      ['SIN_PERMISO'],
      ['error.SIN_PERMISO.este-proyecto', 'error.SIN_PERMISO.sin-mas'],
    )
    expect(problemas).toEqual([])
  })

  it('caza lo que sobra, que es como se lee una errata', () => {
    const problemas = checkErrorTranslations(['UNO'], ['error.UNO', 'error.UNOO'])
    expect(problemas.map((p) => p.kind)).toEqual(['frase-huerfana'])
    expect(problemas[0]?.detail).toContain('"UNOO"')
  })

  it('el texto de la interfaz no se confunde con un código del servidor', () => {
    // `error.local.*` es lo que se dice cuando no hubo respuesta que traiga
    // código. No es huérfano: no hay código al que pertenecer.
    const problemas = checkErrorTranslations(['UNO'], ['error.UNO', 'error.local.guardar'])
    expect(problemas).toEqual([])
  })

  it('caza una ruta que se escribe su propia frase', () => {
    const sueltos = parseRawErrorSends(
      'algo-routes.ts',
      ["app.get('/x', async (request, reply) => {", "  return reply.status(422).send({ error: 'Nop.' })", '})'].join(
        '\n',
      ),
    )
    expect(sueltos).toHaveLength(1)
    expect(sueltos[0]?.linea).toBe(2)

    const problemas = checkErrorTranslations([], [], sueltos)
    expect(problemas.map((p) => p.kind)).toEqual(['error-sin-codigo'])
    expect(problemas[0]?.detail).toContain('algo-routes.ts:2')
    expect(problemas[0]?.detail).toContain('fallar(')
  })

  it('la caza cruza líneas, que es como estaban escritos los que había', () => {
    const sueltos = parseRawErrorSends(
      'algo-routes.ts',
      ['return reply.status(422).send({', "  error: 'Nop.',", '  rows: [],', '})'].join('\n'),
    )
    expect(sueltos).toHaveLength(1)
  })

  it('un `send` de una respuesta buena no es un error suelto', () => {
    const sueltos = parseRawErrorSends('algo-routes.ts', "return reply.send({ ok: true, errores: 0 })")
    expect(sueltos).toEqual([])
  })

  it('los dos ficheros exentos lo están, y sólo ellos', () => {
    const fuente = "reply.status(500).send({ error: 'x' })"
    expect(parseRawErrorSends('errors.ts', fuente)).toEqual([])
    expect(parseRawErrorSends('build-server.ts', fuente)).toEqual([])
    expect(parseRawErrorSends('routes.ts', fuente)).toHaveLength(1)
  })

  it('si el parseo se rompe, se entera en vez de dar verde', () => {
    expect(() => parseErrorCodes('export const OTRA = []')).toThrow(/ERROR_CODES/)
    expect(() => parseErrorCodes("export const ERROR_CODES = [\n  'UNO',\n] as const")).toThrow(/parseo/)
  })
})
