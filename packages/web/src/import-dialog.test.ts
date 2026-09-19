/**
 * Que cada importación abra SU importador, y no el de al lado.
 *
 * Esto existe por una avería concreta. `ImportDialog` era una cadena de `if`
 * que terminaba en un `return` sin condición, así que al añadir la Checkliste a
 * `TipoDeCsv` sin su rama, elegirla abría el importador **del catálogo de
 * documentos** y mandaba el fichero a `/api/documents/import`. El mensaje que
 * salía —«falta la columna nombre»— era cierto sobre un formato que nadie había
 * elegido.
 *
 * El `switch` sin `default` ya hace que **faltar** una rama no compile
 * —comprobado: `TS2366, Function lacks ending return statement`—. Lo que el
 * compilador no puede ver es una rama que existe y pasa el `tipo` equivocado:
 * `case 'checklist'` pintando `tipo="documents"` compila igual de bien. Eso es
 * lo que mira esta prueba.
 *
 * Lee el fichero del disco, como las reglas de `tools/`, porque montar React en
 * una prueba para comprobar una constante cuesta más de lo que vale.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FUENTE = join(import.meta.dirname, 'components', 'ImportDialog.tsx')

/** Los tipos declarados en la unión `TipoDeCsv` de `api.ts`. */
async function tiposDeclarados(): Promise<readonly string[]> {
  const fuente = await readFile(join(import.meta.dirname, 'api.ts'), 'utf8')
  const union = /export type TipoDeCsv =([\s\S]*?)\n\n/.exec(fuente)
  expect(union, 'no se encontró la unión TipoDeCsv en api.ts').not.toBeNull()
  const tipos = [...(union?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((x) => x[1] ?? '')
  expect(tipos.length, 'el parseo de TipoDeCsv está roto').toBeGreaterThan(3)
  return tipos
}

describe('el diálogo de importación', () => {
  it('cada tipo tiene su rama, y la rama pinta SU tipo', async () => {
    const fuente = await readFile(FUENTE, 'utf8')
    for (const tipo of await tiposDeclarados()) {
      const rama = new RegExp(`case '${tipo}': \\{([\\s\\S]*?)\\n {2}\\}`, 'u').exec(fuente)
      expect(rama, `falta la rama de «${tipo}»`).not.toBeNull()
      // Lo que se le pasa al panel decide el contrato que se pide, la plantilla
      // que se descarga y el endpoint. Si no coincide con la rama, la pantalla
      // miente sobre lo que va a hacer.
      expect(rama?.[1], `la rama de «${tipo}» no pinta tipo="${tipo}"`).toContain(
        `tipo="${tipo}"`,
      )
    }
  })

  it('ninguna rama pinta el tipo de otra', async () => {
    const fuente = await readFile(FUENTE, 'utf8')
    const ramas = [...fuente.matchAll(/case '([a-z]+)': \{([\s\S]*?)\n {2}\}/gu)]
    for (const [, tipo, cuerpo] of ramas) {
      const pintados = [...(cuerpo ?? '').matchAll(/tipo="([a-z]+)"/g)].map((x) => x[1])
      expect(pintados, `la rama de «${String(tipo)}» pinta ${pintados.join(', ')}`).toEqual([tipo])
    }
  })

  it('el switch no tiene «default»: faltar una rama tiene que no compilar', async () => {
    const fuente = await readFile(FUENTE, 'utf8')
    // Un `default` devolvería algo para un tipo sin rama, y con eso vuelve
    // exactamente la avería que esta prueba vigila.
    expect(fuente).not.toMatch(/^\s*default:/mu)
  })
})
