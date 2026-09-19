/**
 * El zoom de la herramienta: cuánta información cabe en la pantalla.
 *
 * No es un ajuste de accesibilidad duplicando el del navegador. Es una decisión
 * de trabajo: la misma persona quiere la cartera entera de un vistazo un lunes
 * y quiere leer una fila sin forzar la vista un jueves. El navegador ya tiene
 * su zoom, pero se olvida al cambiar de máquina y se lleva por delante el resto
 * de pestañas; éste vive con la herramienta.
 *
 * ## Por qué `zoom` y no una escala de `rem`
 *
 * Lo ortodoxo sería declarar todos los tamaños en `rem` y mover el
 * `font-size` de la raíz. Aquí eso **dejaría media herramienta fuera**: el
 * cronograma calcula su geometría en píxeles desde JavaScript —el ancho de un
 * día, la posición de una barra, el alto de una fila— y esos píxeles no son
 * `rem` ni pueden serlo. Con la escala de `rem`, el Gantt se quedaría del
 * tamaño de siempre dentro de una pantalla encogida.
 *
 * `zoom` en la raíz escala el documento entero, píxeles calculados incluidos.
 * Y la duda que lo hacía sospechoso —qué pasa con lo que está en
 * `position: fixed`, que son los cajones y los fondos oscuros— se comprobó en
 * un navegador de verdad antes de elegirlo: a 1,25 y a 0,8, el fondo del cajón
 * sigue midiendo el viewport entero. Es lo mismo que hace el zoom del
 * navegador, porque es el mismo mecanismo.
 */

/**
 * Los cinco escalones, del más apretado al más holgado.
 *
 * Son cinco y no un deslizador continuo porque la escala tiene que ser la
 * misma en dos máquinas distintas para que dos personas vean lo mismo, y
 * porque un 1,07 no lo quiere nadie: se quiere «más» o «menos».
 */
export const ESCALAS = [0.8, 0.9, 1, 1.12, 1.25] as const

export type Escala = (typeof ESCALAS)[number]

export const ESCALA_NORMAL: Escala = 1

/** Dónde se guarda. Misma familia que `planner.theme`. */
const CLAVE = 'planner.escala'

/**
 * El escalón más cercano a un número cualquiera.
 *
 * Redondea en vez de descartar: un valor guardado por una versión anterior con
 * otros escalones —o escrito a mano— tiene que dar la pantalla más parecida
 * posible, no volver al 100 % sin decir nada.
 */
export function escalaMasCercana(valor: number): Escala {
  if (!Number.isFinite(valor)) return ESCALA_NORMAL
  let mejor: Escala = ESCALAS[0]
  for (const escalon of ESCALAS) {
    if (Math.abs(escalon - valor) < Math.abs(mejor - valor)) mejor = escalon
  }
  return mejor
}

/**
 * La escala guardada, o la normal.
 *
 * Todo lo que puede fallar falla en silencio y devuelve la normal: en una
 * ventana privada el almacenamiento lanza al leer, y una herramienta que se
 * niega a abrir porque no puede recordar un zoom es peor que una que se abre
 * al 100 %.
 */
export function leerEscala(almacen: Pick<Storage, 'getItem'> | null): Escala {
  if (almacen === null) return ESCALA_NORMAL
  try {
    const guardado = almacen.getItem(CLAVE)
    if (guardado === null) return ESCALA_NORMAL
    const numero = Number.parseFloat(guardado)
    if (!Number.isFinite(numero)) return ESCALA_NORMAL
    return escalaMasCercana(numero)
  } catch {
    return ESCALA_NORMAL
  }
}

/** Guarda la escala. Si no se puede, no pasa nada: es una comodidad. */
export function guardarEscala(almacen: Pick<Storage, 'setItem'> | null, escala: Escala): void {
  if (almacen === null) return
  try {
    almacen.setItem(CLAVE, String(escala))
  } catch {
    // Ventana privada o almacenamiento lleno. El zoom sigue aplicado en esta
    // sesión; sólo no sobrevive al cierre.
  }
}

/** El escalón siguiente o el anterior, sin salirse por los extremos. */
export function escalaVecina(escala: Escala, direccion: 1 | -1): Escala {
  const donde = ESCALAS.indexOf(escala)
  const siguiente = Math.min(ESCALAS.length - 1, Math.max(0, donde + direccion))
  return ESCALAS[siguiente] ?? ESCALA_NORMAL
}

/**
 * Cómo se dice una escala: «100 %», «125 %».
 *
 * Se redondea al entero porque 112,00000000000001 % es lo que sale de
 * multiplicar por cien un número en coma flotante, y nadie quiere leer eso.
 */
export function porcentajeDeEscala(escala: Escala): number {
  return Math.round(escala * 100)
}
