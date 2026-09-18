import { describe, expect, it } from 'vitest'
import { checkRampa, contraste, croma, distancia, luminosidad, rampasDelCss } from './rampa.mjs'

/** La rampa que hay hoy, en claro. */
const NUEVA = ['#418ad1', '#88b1db', '#d3dae1', '#de9480', '#d35e52']

/** La que había antes, y que esta regla existe para no repetir. */
const VIEJA = ['#9ec3e6', '#7fc4a8', '#e8c98a', '#e59a72', '#cf6b5a']

const codigos = (problemas) => problemas.map((p) => p.kind).toSorted()

describe('la rampa divergente de saturación', () => {
  it('la de ahora pasa entera', () => {
    expect(checkRampa(NUEVA, 'nueva')).toEqual([])
  })

  it('la vieja NO pasa, y dice las dos razones', () => {
    // El ámbar del centro y el paso atrás de luminosidad son exactamente lo
    // que llevó a repintarla. Si esta prueba deja de fallar, la regla ya no
    // está midiendo nada.
    expect(codigos(checkRampa(VIEJA, 'vieja'))).toEqual(['centro-con-tono', 'luminosidad-torcida'])
  })

  it('caza un centro con tono aunque la luminosidad esté bien', () => {
    const conAmbar = ['#418ad1', '#88b1db', '#e8c98a', '#de9480', '#d35e52']
    expect(codigos(checkRampa(conAmbar, 'x'))).toEqual(['centro-con-tono'])
  })

  it('caza un paso atrás de luminosidad aunque el centro sea neutro', () => {
    // «por debajo» más claro que «bien»: la escala vuelve sobre sus pasos.
    const torcida = ['#b8c6d4', '#88b1db', '#d3dae1', '#de9480', '#d35e52']
    expect(codigos(checkRampa(torcida, 'x'))).toEqual(['luminosidad-torcida'])
  })

  it('caza dos polos que se parecen', () => {
    const polosJuntos = ['#c07068', '#d9a49e', '#e9e9ea', '#de9480', '#d35e52']
    expect(codigos(checkRampa(polosJuntos, 'x'))).toContain('polos-juntos')
  })

  it('un escalón que falta se dice y no se disimula', () => {
    const problemas = checkRampa(['#418ad1', null, '#d3dae1', '#de9480', '#d35e52'], 'x')
    expect(codigos(problemas)).toEqual(['escalon-que-falta'])
    expect(problemas[0]?.detail).toContain('--util-ok')
  })

  it('el centro de la rampa de ahora es neutro de verdad', () => {
    expect(croma('#d3dae1')).toBeLessThan(0.03)
  })

  it('los dos polos se separan de sobra', () => {
    expect(distancia('#418ad1', '#d35e52')).toBeGreaterThan(20)
  })

  it('la luminosidad sube hasta el centro y baja después', () => {
    const ls = NUEVA.map(luminosidad)
    expect(ls[0]).toBeLessThan(ls[1] ?? 0)
    expect(ls[1]).toBeLessThan(ls[2] ?? 0)
    expect(ls[2]).toBeGreaterThan(ls[3] ?? 1)
    expect(ls[3]).toBeGreaterThan(ls[4] ?? 1)
  })

  it('en oscuro vale al revés: el centro es el más oscuro', () => {
    const oscura = ['#2d6ca8', '#2f4e6e', '#2e3237', '#7b3d2e', '#b44238']
    expect(checkRampa(oscura, 'oscura')).toEqual([])
    const ls = oscura.map(luminosidad)
    expect(ls[2]).toBeLessThan(ls[0] ?? 1)
    expect(ls[2]).toBeLessThan(ls[4] ?? 1)
  })
})

describe('el número escrito dentro de la celda', () => {
  it('con la rampa de ahora y el texto de ahora, se lee', () => {
    expect(checkRampa(NUEVA, 'clara', '#16181d')).toEqual([])
    const oscura = ['#2d6ca8', '#2f4e6e', '#2e3237', '#7b3d2e', '#b44238']
    expect(checkRampa(oscura, 'oscura', '#e7eaf0')).toEqual([])
  })

  it('caza el escalón donde el número no se lee, y dice cuál', () => {
    // #c55247 era el «insostenible» de la primera versión: 3,95:1, por debajo
    // de 4,5. La celda que más urge leer era la que peor se leía.
    const flojo = ['#418ad1', '#88b1db', '#d3dae1', '#de9480', '#c55247']
    const problemas = checkRampa(flojo, 'x', '#16181d')
    expect(codigos(problemas)).toEqual(['numero-que-no-se-lee'])
    expect(problemas[0]?.detail).toContain('--util-critical')
  })

  it('sin color de texto no inventa un veredicto', () => {
    const flojo = ['#418ad1', '#88b1db', '#d3dae1', '#de9480', '#c55247']
    expect(codigos(checkRampa(flojo, 'x'))).toEqual([])
  })

  it('el contraste se cuenta como lo cuenta WCAG', () => {
    // Negro sobre blanco es 21:1 por definición; es la forma de saber que la
    // fórmula no se ha quedado a medias.
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contraste('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })
})

describe('sacar las rampas del CSS', () => {
  it('encuentra una rampa suelta', () => {
    const css = `:root {
      --util-low: #418ad1;
      --util-ok: #88b1db;
      --util-full: #d3dae1;
      --util-over: #de9480;
      --util-critical: #d35e52;
    }`
    expect(rampasDelCss(css)).toEqual([{ pasos: NUEVA, texto: null }])
  })

  it('encuentra las tres: el claro, el del sistema y el tema explícito', () => {
    const bloque = (low) => `
      --util-idle: #e9e9ea;
      --util-low: ${low};
      --util-ok: #88b1db;
      --util-full: #d3dae1;
      --util-over: #de9480;
      --util-critical: #c55247;`
    const css = `:root {${bloque('#418ad1')}}
      @media (prefers-color-scheme: dark) { :root {${bloque('#2d6ca8')}} }
      :root[data-theme="dark"] {${bloque('#111111')}}`
    const rampas = rampasDelCss(css)
    expect(rampas).toHaveLength(3)
    expect(rampas.map((r) => r.pasos[0])).toEqual(['#418ad1', '#2d6ca8', '#111111'])
  })

  it('un bloque al que le falta un escalón se devuelve con el hueco, no se salta', () => {
    const css = `:root { --util-low: #418ad1; --util-full: #d3dae1; }`
    expect(rampasDelCss(css)).toEqual([{ pasos: ['#418ad1', null, '#d3dae1', null, null], texto: null }])
  })

  it('sin rampa ninguna, devuelve nada', () => {
    expect(rampasDelCss(':root { --accent: #0f766e; }')).toEqual([])
  })
})
