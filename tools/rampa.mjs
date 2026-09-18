/**
 * La rampa de saturación, medida en vez de mirada.
 *
 * `--util-low`, `--util-ok`, `--util-full`, `--util-over` y `--util-critical`
 * son una escala **divergente**: azul por debajo del 100 %, neutro en la raya,
 * rojo por encima. Una divergente bien construida cumple dos cosas, y las dos
 * se pueden medir:
 *
 *   1. **El centro es neutro.** Un tono en el centro compite con los dos polos
 *      por la atención, y el ojo deja de saber hacia dónde mirar. La rampa que
 *      había antes tenía ámbar en el centro.
 *   2. **La luminosidad es monótona hacia el centro.** El centro es el extremo
 *      —el más claro sobre papel, el más oscuro sobre fondo negro— y desde él
 *      la luminosidad cae hacia los dos polos sin volver atrás. La rampa vieja
 *      daba un paso atrás a la mitad: «en la raya» salía más claro que «por
 *      debajo», y la escala se leía torcida.
 *
 * Lo que aquí **no** se comprueba, y conviene decirlo: la separación ΔE ≥ 15
 * entre vecinos que exige el kit de visualización es para **paletas
 * categóricas** —series sin relación entre sí, donde confundir dos es
 * confundir dos cosas distintas—. Una rampa es lo contrario: los vecinos se
 * parecen **a propósito**, porque representan cantidades vecinas. Lo que sí se
 * exige es que los dos polos se distingan de sobra, y eso sí se mide.
 *
 * `--util-idle` queda fuera de la rampa a propósito: no es «poca saturación»,
 * es «ninguna» —cero o sin dato—, y por eso es gris y no azul.
 */

/** Los cinco escalones de la rampa, en el orden en que se leen. */
export const ESCALONES = ['--util-low', '--util-ok', '--util-full', '--util-over', '--util-critical']

/** Cuánto croma puede tener el centro antes de dejar de ser neutro. */
const CROMA_DEL_CENTRO = 0.03

/** Cuánto tienen que separarse los dos polos para no confundirse jamás. */
const POLOS = 20

/**
 * Contraste mínimo del número escrito dentro de la celda.
 *
 * 4,5:1 es el mínimo de WCAG AA para texto normal. No es un adorno: la celda
 * lleva el porcentaje escrito **porque el color no puede ser la única forma de
 * saber qué pone**, y un número que no se lee deja la celda en color a secas.
 * «Insostenible» —la que más urge leer— era la que peor estaba: 3,95.
 */
const CONTRASTE = 4.5

const canal = (hex, i) => parseInt(hex.slice(i, i + 2), 16) / 255
const lineal = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** sRGB a OKLab. La conversión de siempre, escrita aquí para no discutirla. */
export function oklab(hex) {
  const R = lineal(canal(hex, 1))
  const G = lineal(canal(hex, 3))
  const B = lineal(canal(hex, 5))
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export const luminosidad = (hex) => oklab(hex)[0]

export function croma(hex) {
  const [, a, b] = oklab(hex)
  return Math.hypot(a, b)
}

/** Luminancia relativa de WCAG, que no es la misma cantidad que la de OKLab. */
function relativa(hex) {
  const canales = [1, 3, 5].map((i) => {
    const c = canal(hex, i)
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * canales[0] + 0.7152 * canales[1] + 0.0722 * canales[2]
}

/** El contraste entre dos colores, como lo cuenta WCAG. */
export function contraste(uno, otro) {
  const [claro, oscuro] = [relativa(uno), relativa(otro)].toSorted((a, b) => b - a)
  return (claro + 0.05) / (oscuro + 0.05)
}

export function distancia(uno, otro) {
  const A = oklab(uno)
  const B = oklab(otro)
  return 100 * Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2])
}

/**
 * Saca las rampas del CSS: una por cada bloque que declare los cinco escalones.
 *
 * Son tres —el claro, el `prefers-color-scheme: dark` y el tema oscuro
 * explícito—, y las tres tienen que cumplir lo mismo. Que una se quede atrás
 * al repintar es exactamente lo que esta regla existe para cazar.
 */
export function rampasDelCss(css) {
  const rampas = []
  let actual = new Map()
  // El color del texto de cada bloque, para poder comprobar que el número
  // escrito dentro de la celda se lee. Va por posición: el último `--text` que
  // aparece antes de una rampa es el suyo.
  const textos = [...css.matchAll(/--text\s*:\s*(#[0-9a-fA-F]{6})/g)].map((m) => ({
    color: m[1].toLowerCase(),
    donde: m.index ?? 0,
  }))
  const donde = []
  const textoDe = (posicion) => {
    const antes = textos.filter((t) => t.donde < posicion)
    return antes.length === 0 ? null : (antes[antes.length - 1]?.color ?? null)
  }
  // Se recorre el fichero entero y no línea a línea: un CSS minificado mete
  // los cinco escalones en la misma línea, y un parser que sólo mira la
  // primera declaración de cada línea diría que falta lo que sí está.
  const declaraciones = css.matchAll(/(--util-(?:low|ok|full|over|critical))\s*:\s*(#[0-9a-fA-F]{6})/g)
  let inicio = 0
  for (const encontrado of declaraciones) {
    const [, nombre, color] = encontrado
    if (actual.has(nombre)) {
      rampas.push(actual)
      donde.push(inicio)
      actual = new Map()
    }
    if (actual.size === 0) inicio = encontrado.index ?? 0
    actual.set(nombre, color.toLowerCase())
  }
  if (actual.size > 0) {
    rampas.push(actual)
    donde.push(inicio)
  }
  return rampas.map((rampa, i) => ({
    pasos: ESCALONES.map((paso) => rampa.get(paso) ?? null),
    texto: textoDe(donde[i] ?? 0),
  }))
}

/** Lo que está mal en una rampa. Vacío si está bien. */
export function checkRampa(rampa, etiqueta, texto = null) {
  const problemas = []
  const falta = rampa.findIndex((color) => color === null)
  if (falta !== -1) {
    problemas.push({ kind: 'escalon-que-falta', detail: `${etiqueta}: falta ${ESCALONES[falta]}` })
    return problemas
  }

  const centro = rampa[2]
  const c = croma(centro)
  if (c >= CROMA_DEL_CENTRO) {
    problemas.push({
      kind: 'centro-con-tono',
      detail:
        `${etiqueta}: el centro (${centro}) tiene croma ${c.toFixed(3)} y una divergente lo quiere ` +
        `neutro (< ${String(CROMA_DEL_CENTRO)}). Un tono en el centro compite con los dos polos.`,
    })
  }

  const ls = rampa.map(luminosidad)
  const haciaArriba = ls[0] < ls[1] && ls[1] < ls[2] && ls[2] > ls[3] && ls[3] > ls[4]
  const haciaAbajo = ls[0] > ls[1] && ls[1] > ls[2] && ls[2] < ls[3] && ls[3] < ls[4]
  if (!haciaArriba && !haciaAbajo) {
    problemas.push({
      kind: 'luminosidad-torcida',
      detail:
        `${etiqueta}: la luminosidad no camina hacia el centro sin volver atrás ` +
        `(${ls.map((x) => x.toFixed(3)).join(' · ')}). El centro tiene que ser el extremo.`,
    })
  }

  if (texto !== null) {
    for (const [i, color] of rampa.entries()) {
      const r = contraste(color, texto)
      if (r >= CONTRASTE) continue
      problemas.push({
        kind: 'numero-que-no-se-lee',
        detail:
          `${etiqueta}: el número escrito sobre ${ESCALONES[i]} (${color}) contrasta ` +
          `${r.toFixed(2)}:1 con el texto ${texto}, y hacen falta ${String(CONTRASTE)}. ` +
          `La celda lleva la cifra porque el color no puede ser la única forma de leerla.`,
      })
    }
  }

  const entrePolos = distancia(rampa[0], rampa[4])
  if (entrePolos < POLOS) {
    problemas.push({
      kind: 'polos-juntos',
      detail:
        `${etiqueta}: «por debajo» y «muy por encima» se separan sólo ΔE ${entrePolos.toFixed(1)}, ` +
        `y hacen falta ${String(POLOS)}. Son los dos extremos: si se parecen, la rampa no dice nada.`,
    })
  }

  return problemas
}
