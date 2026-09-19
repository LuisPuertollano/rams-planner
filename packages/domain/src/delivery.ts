/**
 * Las entregas previas de un documento.
 *
 * Las Checklisten oficiales piden el mismo entregable varias veces: una versión
 * preliminar en una puerta temprana como prueba de madurez, y la definitiva en
 * la suya. Esto comprueba lo que se puede comprobar de esa declaración **sin
 * mirar ningún proyecto**: la puerta final vive en la ficha del entregable y
 * las previas aquí, con su parte del esfuerzo.
 *
 * Como todo en este catálogo: **avisa, no impide**. Una Checkliste a medio
 * declarar es el estado normal el primer día, y una herramienta que se niega a
 * guardarla es una herramienta que no se usa.
 */

/** Una entrega previa declarada: el mismo documento, más verde, antes. */
export interface PreviousDelivery {
  /** 1 es la primera y más temprana. */
  readonly position: number
  readonly gate: string
  /** Cómo la llama la Checkliste: «preliminar», «as designed»… */
  readonly maturity: string
  readonly weeksBeforeGate: number | null
  /** Parte del esfuerzo del documento, en puntos básicos. */
  readonly shareBp: number
}

export type DeliveryProblemCode =
  /** Las entregas previas se llevan todo el esfuerzo y no queda nada para la final. */
  | 'DELIVERY_SHARE_FULL'
  /** Se declara una entrega previa y el documento no dice a qué puerta va al final. */
  | 'DELIVERY_WITHOUT_FINAL_GATE'
  /** Una entrega previa va a la misma puerta que la final. */
  | 'DELIVERY_SAME_AS_FINAL'
  /** Un hito o una fase no se entrega en borrador: es un instante, o agrupa. */
  | 'DELIVERY_ON_CONTAINER'

export interface DeliveryProblem {
  readonly code: DeliveryProblemCode
  readonly payload: Readonly<Record<string, string | number>>
}

const TOTAL_BP = 10_000

/** Igual que la puerta del catálogo: «cgr» y «CGR» son la misma. */
function comoPuerta(nombre: string): string {
  return nombre.trim().toUpperCase()
}

/**
 * Lo que está mal en las entregas previas de un entregable.
 *
 * No comprueba que las puertas existan en un proyecto concreto: el catálogo es
 * de todos los proyectos y cada uno fecha las suyas. Eso lo dice el descarte
 * `puerta-sin-fecha` cuando se calculan las fechas objetivo (ADR-0042).
 */
export function checkDeliveries(
  entregas: readonly PreviousDelivery[],
  kind: 'documento' | 'hito' | 'fase',
  finalGate: string | null,
): readonly DeliveryProblem[] {
  if (entregas.length === 0) return []

  if (kind !== 'documento') {
    return [{ code: 'DELIVERY_ON_CONTAINER', payload: { kind, count: entregas.length } }]
  }

  const problemas: DeliveryProblem[] = []

  // Sin puerta final, una entrega «previa» no es previa a nada.
  if (finalGate === null || finalGate.trim() === '') {
    problemas.push({ code: 'DELIVERY_WITHOUT_FINAL_GATE', payload: { count: entregas.length } })
  } else {
    const final = comoPuerta(finalGate)
    for (const entrega of entregas) {
      if (comoPuerta(entrega.gate) === final) {
        problemas.push({ code: 'DELIVERY_SAME_AS_FINAL', payload: { gate: entrega.gate } })
      }
    }
  }

  // El reparto es del documento entero: lo que no se llevan las previas es lo
  // que cuesta la final. Si se lo llevan todo, la final sale gratis, que es
  // otra forma de decir que el reparto está mal.
  const reparto = entregas.reduce((suma, entrega) => suma + entrega.shareBp, 0)
  if (reparto >= TOTAL_BP) {
    problemas.push({
      code: 'DELIVERY_SHARE_FULL',
      payload: { sharePercent: Math.round(reparto / 100), count: entregas.length },
    })
  }

  return problemas
}

/**
 * Los minutos de cada entrega, y los que quedan para la final.
 *
 * El reparto es entero y suma exacto: el resto de la división va a la entrega
 * final, que es la que más pesa. Ni un minuto se pierde (P5).
 */
export function deliveryMinutes(
  standardMinutes: number,
  entregas: readonly PreviousDelivery[],
): { readonly previous: readonly number[]; readonly final: number } {
  const previous = entregas.map((entrega) =>
    Math.round((standardMinutes * entrega.shareBp) / TOTAL_BP),
  )
  const repartido = previous.reduce((suma, minutos) => suma + minutos, 0)
  return { previous, final: Math.max(0, standardMinutes - repartido) }
}
