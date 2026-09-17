import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseDictionaryKeys } from './finding-translations.mjs'
import {
  checkPermissionTranslations,
  loadPermissionSources,
  parsePermissionCatalogue,
} from './permission-translations.mjs'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalogo = (codigos, pantallas = ['Carga']) => ({ codigos, pantallas })

describe('la regla: ninguna función sin traducir', () => {
  it('el workspace la cumple', async () => {
    const { catalogo: leido, claves } = await loadPermissionSources(rootDir, parseDictionaryKeys)
    expect(checkPermissionTranslations(leido, claves)).toEqual([])
    // Y se leyó el catálogo de verdad.
    expect(leido.codigos).toContain('roles.gestionar')
    expect(leido.codigos).toContain('costes.ver')
    expect(leido.pantallas).toContain('Administración')
  })

  it('caza una función nueva sin etiqueta y sin detalle', () => {
    const problemas = checkPermissionTranslations(
      catalogo(['nueva.funcion']),
      ['pantalla.Carga'],
    )
    expect(problemas.map((p) => p.kind)).toEqual(['falta-la-etiqueta', 'falta-el-detalle'])
    expect(problemas[0]?.detail).toContain('nueva.funcion')
  })

  it('una etiqueta sin su detalle no basta', () => {
    const problemas = checkPermissionTranslations(
      catalogo(['una.funcion']),
      ['permiso.una.funcion', 'pantalla.Carga'],
    )
    expect(problemas.map((p) => p.kind)).toEqual(['falta-el-detalle'])
  })

  it('caza una pantalla nueva sin nombre', () => {
    const problemas = checkPermissionTranslations(
      catalogo(['una.funcion'], ['Carga', 'Nueva']),
      ['permiso.una.funcion', 'permiso.una.funcion.detalle', 'pantalla.Carga'],
    )
    expect(problemas.map((p) => p.kind)).toEqual(['falta-la-pantalla'])
  })

  it('caza lo que sobra, que es como se lee una errata', () => {
    const problemas = checkPermissionTranslations(
      catalogo(['una.funcion']),
      [
        'permiso.una.funcion',
        'permiso.una.funcion.detalle',
        'pantalla.Carga',
        'permiso.una.funcionn',
        'pantalla.Cargaa',
      ],
    )
    expect(problemas.map((p) => p.kind).sort()).toEqual(['pantalla-huerfana', 'permiso-huerfano'])
  })

  it('un detalle huérfano se caza por su código, no por el sufijo', () => {
    const problemas = checkPermissionTranslations(
      catalogo(['una.funcion']),
      ['permiso.una.funcion', 'permiso.una.funcion.detalle', 'pantalla.Carga', 'permiso.retirada.detalle'],
    )
    expect(problemas.map((p) => p.kind)).toEqual(['permiso-huerfano'])
    expect(problemas[0]?.detail).toContain('"retirada"')
  })

  it('si el parseo se rompe, se entera en vez de dar verde', () => {
    expect(() => parsePermissionCatalogue('export const OTRA = []')).toThrow(/SCREENS/)
    expect(() =>
      parsePermissionCatalogue("export const SCREENS = [\n  'Carga',\n] as const"),
    ).toThrow(/pantallas/)
  })
})
