import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  checkFindingTranslations,
  loadFindingSources,
  parseDictionaryKeys,
  parseFindingCodes,
} from './finding-translations.mjs'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('la regla: ningún hallazgo sin traducir', () => {
  it('el workspace la cumple', async () => {
    const { codigos, claves } = await loadFindingSources(rootDir)
    expect(checkFindingTranslations(codigos, claves)).toEqual([])
    // Y se leyó el catálogo de verdad, no una lista vacía que pasaría sola.
    expect(codigos).toContain('DEPENDENCY_CYCLE')
    expect(codigos).toContain('REBALANCE_NO_CANDIDATE')
  })

  it('caza un código nuevo sin frase', () => {
    const problemas = checkFindingTranslations(
      ['VIEJO', 'NUEVO'],
      ['hallazgo.VIEJO', 'hallazgo.que.VIEJO', 'hallazgo.que.NUEVO'],
    )
    expect(problemas.map((p) => p.kind)).toEqual(['falta-la-frase'])
    expect(problemas[0]?.detail).toContain('NUEVO')
  })

  it('caza un código nuevo sin explicación', () => {
    const problemas = checkFindingTranslations(['UNO'], ['hallazgo.UNO'])
    expect(problemas.map((p) => p.kind)).toEqual(['falta-la-explicacion'])
  })

  it('una frase con variante vale como frase', () => {
    expect(
      checkFindingTranslations(['UNO'], ['hallazgo.UNO.una-variante', 'hallazgo.que.UNO']),
    ).toEqual([])
  })

  it('caza la clave que sobra, que es como se lee una errata', () => {
    const problemas = checkFindingTranslations(
      ['UNO'],
      ['hallazgo.UNO', 'hallazgo.que.UNO', 'hallazgo.DDOS', 'hallazgo.que.UN0'],
    )
    expect(problemas.map((p) => p.kind).sort()).toEqual(['explicacion-huerfana', 'frase-huerfana'])
  })

  it('el texto de pantalla no se confunde con un código', () => {
    // Las gravedades y el estado vacío empiezan en minúscula a propósito.
    expect(
      checkFindingTranslations(
        ['UNO'],
        ['hallazgo.UNO', 'hallazgo.que.UNO', 'hallazgo.gravedad.error', 'hallazgo.vacio.titulo'],
      ),
    ).toEqual([])
  })

  it('si el parseo se rompe, se entera en vez de dar verde', () => {
    expect(() => parseFindingCodes('export type Otra = string')).toThrow(/FindingCode/)
    expect(() => parseFindingCodes("export type FindingCode =\n  | 'A'\n  | 'B'\n\n")).toThrow(/parseo/)
    expect(() => parseDictionaryKeys("export const es = {\n  'una': 'sola',\n}")).toThrow(/parseo/)
  })
})
