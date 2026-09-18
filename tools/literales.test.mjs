/**
 * La regla que caza las frases escritas a mano.
 *
 * Lo que se prueba no es que hoy no haya ninguna —eso lo comprueba CI sobre el
 * código de verdad—, sino que la regla distingue: que caza lo que tiene que
 * cazar y, sobre todo, que **no** caza lo que no. Una regla que avisa de
 * `Promise<void>` o de `a > b && c < d` se desactiva en una semana, y entonces
 * no hay regla.
 */

import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buscaEnLaInterfaz, buscaLiterales } from './literales.mjs'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')

const textos = (fuente) => buscaLiterales('prueba.tsx', fuente).map((hallado) => hallado.texto)

describe('la regla: ninguna frase a mano en la interfaz', () => {
  it('la interfaz la cumple', async () => {
    const { ficheros, literales } = await buscaEnLaInterfaz(rootDir)
    expect(ficheros).toBeGreaterThan(20)
    expect(literales).toEqual([])
  })

  it('caza una cabecera de tabla', () => {
    expect(textos('const A = () => <th>Recurso</th>')).toEqual(['Recurso'])
  })

  it('caza un title y un aria-label, que también se leen', () => {
    expect(textos('const A = () => <b title="Quitar de la tarea" />')).toEqual(['Quitar de la tarea'])
    expect(textos('const A = () => <b aria-label="Cerrar" />')).toEqual(['Cerrar'])
    expect(textos('const A = () => <input placeholder="opcional" />')).toEqual(['opcional'])
  })

  it('no caza un className ni un href: no son frases', () => {
    expect(textos('const A = () => <b className="card__title" href="/api/state" />')).toEqual([])
  })

  it('no caza un tipo genérico', () => {
    // `Promise<void>` tiene un `>` seguido de letras y luego un `<`. Con
    // expresiones regulares era un falso positivo garantizado.
    expect(textos('async function f(): Promise<void> { return undefined }')).toEqual([])
  })

  it('no caza una comparación', () => {
    expect(textos('const a = (x, y, z, w) => x > y && z < w')).toEqual([])
  })

  it('no caza símbolos ni cifras sueltas', () => {
    expect(textos('const A = () => <><span>·</span><span>—</span><span>42 %</span><span>h</span></>')).toEqual([])
  })

  it('no caza lo que va dentro de <code>: es técnico, no se traduce', () => {
    expect(textos('const A = () => <code>pnpm --filter @planner/api seed:demo</code>')).toEqual([])
  })

  it('perdona lo que lleva la coartada, en su línea o en la de arriba', () => {
    const arriba = [
      'const A = () => (',
      '  <div>',
      '    {/* texto-fijo: es el código del hallazgo, igual en los cuatro idiomas */}',
      '    <span>REBALANCE_NO_CANDIDATE</span>',
      '  </div>',
      ')',
    ].join('\n')
    expect(textos(arriba)).toEqual([])
  })

  it('no perdona una coartada sin razón escrita', () => {
    // La excepción sin motivo es la puerta por la que vuelve a entrar todo.
    const sinRazon = [
      'const A = () => (',
      '  <div>',
      '    {/* texto-fijo: */}',
      '    <span>Recurso</span>',
      '  </div>',
      ')',
    ].join('\n')
    expect(textos(sinRazon)).toEqual(['Recurso'])
  })

  it('dice dónde está lo que encuentra', () => {
    const fuente = ['const A = () => (', '  <th>Recurso</th>', ')'].join('\n')
    expect(buscaLiterales('vistas/X.tsx', fuente)).toEqual([
      { fichero: 'vistas/X.tsx', linea: 2, donde: 'texto', texto: 'Recurso' },
    ])
  })
})
