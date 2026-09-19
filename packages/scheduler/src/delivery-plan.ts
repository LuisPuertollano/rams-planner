/**
 * Partir la tarea de un entregable en las entregas que pide la Checkliste.
 *
 * ADR-0046 dejó la Checkliste declarada y dijo lo que no hacía: mover fechas.
 * Esto es eso. Una tarea que entrega el FMECA, con la Checkliste pidiéndolo
 * preliminar en PGR y final en CGR, se convierte en:
 *
 *     Redactar el FMECA                    (paquete, ya no se estima: agrega)
 *       · FMECA preliminar    30 %   → PGR
 *       · FMECA               70 %   → CGR
 *
 * con `preliminar → final` atadas fin-comienzo.
 *
 * ## Dónde encaja respecto a partir en subactividades
 *
 * **Las entregas van primero, y las subactividades dentro de cada una.** No es
 * una preferencia: partir primero en Crear y Revisar 1 y después cada trozo en
 * preliminar y final daría «crear el preliminar» y «crear el final» como dos
 * cosas sueltas, cuando lo que hay son dos entregas y cada una se crea y se
 * revisa. La madurez está por encima de la cadena, no dentro.
 *
 * Por eso una tarea que ya se partió en subactividades **no** se parte aquí: si
 * hubiera que hacer las dos cosas, el orden es éste y ya es tarde.
 *
 * ## El total no se mueve
 *
 * Cada entrega se lleva la parte que declara la Checkliste, y la final lo que
 * las previas no se llevan. Es el mismo trato que ADR-0039: la tarea traía su
 * tamaño porque alguien lo estimó para este proyecto, y declarar una Checkliste
 * no puede cambiarlo. El reparto es entero y suma exacto (P5).
 *
 * No escribe nada: devuelve lo que haría, con el motivo de cada descarte.
 */

import { repartir } from './subactivity-plan.js'

/** Una entrega previa del catálogo, tal y como la declara la Checkliste. */
export interface CatalogueDelivery {
  readonly documentTypeId: string
  readonly position: number
  readonly gate: string
  readonly maturity: string
  readonly weeksBeforeGate: number | null
  readonly shareBp: number
}

/** La ficha del entregable, en lo que toca a su entrega final. */
export interface DeliveryDocument {
  readonly documentTypeId: string
  readonly code: string
  readonly name: string
  readonly gate: string | null
  readonly weeksBeforeGate: number | null
}

/** Una tarea hoja del proyecto, con lo que hace falta para decidir. */
export interface DeliveryTask {
  readonly nodeId: string
  readonly name: string
  readonly path: string
  readonly kind: 'phase' | 'work_package' | 'task' | 'milestone'
  readonly workDeclaredMinutes: number
  readonly durationMinutes: number
  readonly hasActuals: boolean
  /** Si ya la partió alguien, por entregas o por subactividades. */
  readonly alreadySplit: boolean
  /** Si ella misma nació de partir otra tarea. */
  readonly isPiece: boolean
}

export interface DeliveryLink {
  readonly id: string
  readonly predecessorNodeId: string
  readonly successorNodeId: string
}

/**
 * - `no-es-tarea`: una fase, un paquete o un hito. Un hito es un instante.
 * - `sin-entregable`: no declara qué entrega, así que no hay Checkliste.
 * - `varios-entregables`: entrega dos o más y sus Checklisten pueden no
 *   coincidir. Elegir una sería inventar.
 * - `sin-entregas-previas`: la Checkliste no pide este documento antes. Partir
 *   en un trozo es no partir, y es el caso normal en un catálogo a medio
 *   declarar.
 * - `sin-tamano`: no declara ni trabajo ni duración. No hay nada que repartir.
 * - `con-horas-reales`: ya tiene horas fichadas. Convertirla en contenedor las
 *   dejaría donde el informe por tarea ya no mira.
 * - `ya-partida`: ya es el contenedor de algo, por entregas o por
 *   subactividades. Las entregas van antes que la cadena, así que aquí ya es
 *   tarde.
 * - `es-un-trozo`: ella misma nació de partir otra tarea.
 * - `reparto-completo`: las entregas previas se llevan el 100 % y la final se
 *   quedaría en cero. Lo avisa el catálogo (ADR-0046) y aquí se respeta.
 */
export type DeliverySkipReason =
  | 'no-es-tarea'
  | 'sin-entregable'
  | 'varios-entregables'
  | 'sin-entregas-previas'
  | 'sin-tamano'
  | 'con-horas-reales'
  | 'ya-partida'
  | 'es-un-trozo'
  | 'reparto-completo'

/** Qué magnitud se reparte, igual que al partir en subactividades. */
export type DeliveryMagnitude = 'trabajo' | 'duracion'

/** Una entrega propuesta: el mismo documento, con su madurez y su trozo. */
export interface ProposedDelivery {
  /** 0 es la más temprana; la última es la final. */
  readonly order: number
  readonly gate: string
  /** `null` en la final: la final no tiene nombre de madurez, es el documento. */
  readonly maturity: string | null
  readonly weeksBeforeGate: number | null
  readonly minutes: number
  readonly shareBp: number
  /** Si es la entrega definitiva: la que hereda el entregable y cierra. */
  readonly isFinal: boolean
}

export interface RelinkedDelivery {
  readonly dependencyId: string
  readonly side: 'entrada' | 'salida'
  readonly toOrder: number
}

export interface ProposedDeliverySplit {
  readonly nodeId: string
  readonly name: string
  readonly path: string
  readonly documentTypeId: string
  readonly documentCode: string
  readonly magnitude: DeliveryMagnitude
  readonly deliveries: readonly ProposedDelivery[]
  /** Los pares encadenados, por orden: `de` va antes que `a`. */
  readonly chain: readonly (readonly [number, number])[]
  readonly relinked: readonly RelinkedDelivery[]
  /**
   * Quién estaba asignado a la tarea. Se COPIA a todas las entregas, no se muda
   * a la primera como en la cadena de subactividades: allí los otros pasos son
   * otros papeles, y aquí el borrador y la versión final son el mismo trabajo
   * de la misma persona en dos momentos.
   */
  readonly copiedResourceIds: readonly string[]
}

export interface SkippedDeliverySplit {
  readonly nodeId: string
  readonly name: string
  readonly path: string
  readonly reason: DeliverySkipReason
}

export interface DeliveryPlanTotals {
  readonly tasksBefore: number
  readonly tasksAfter: number
  readonly minutesBefore: number
  readonly minutesAfter: number
}

export interface DeliveryPlanResult {
  readonly split: readonly ProposedDeliverySplit[]
  readonly skipped: readonly SkippedDeliverySplit[]
  readonly totals: DeliveryPlanTotals
}

export interface DeliveryPlanInput {
  readonly tasks: readonly DeliveryTask[]
  readonly deliveries: readonly { nodeId: string; documentTypeId: string }[]
  readonly documents: readonly DeliveryDocument[]
  readonly checkliste: readonly CatalogueDelivery[]
  readonly assignments: readonly { nodeId: string; resourceId: string }[]
  readonly links: readonly DeliveryLink[]
}

const TOTAL_BP = 10_000

export function planDeliveries(input: DeliveryPlanInput): DeliveryPlanResult {
  const porDocumento = new Map<string, DeliveryDocument>()
  for (const documento of input.documents) porDocumento.set(documento.documentTypeId, documento)

  const previasDe = new Map<string, CatalogueDelivery[]>()
  for (const entrega of input.checkliste) {
    const lista = previasDe.get(entrega.documentTypeId) ?? []
    lista.push(entrega)
    previasDe.set(entrega.documentTypeId, lista)
  }

  const entregaPorNodo = new Map<string, string[]>()
  for (const entrega of input.deliveries) {
    const lista = entregaPorNodo.get(entrega.nodeId) ?? []
    lista.push(entrega.documentTypeId)
    entregaPorNodo.set(entrega.nodeId, lista)
  }

  const asignacionesPorNodo = new Map<string, string[]>()
  for (const asignacion of input.assignments) {
    const lista = asignacionesPorNodo.get(asignacion.nodeId) ?? []
    lista.push(asignacion.resourceId)
    asignacionesPorNodo.set(asignacion.nodeId, lista)
  }

  const split: ProposedDeliverySplit[] = []
  const skipped: SkippedDeliverySplit[] = []

  for (const tarea of input.tasks) {
    const descarta = (reason: DeliverySkipReason): void => {
      skipped.push({ nodeId: tarea.nodeId, name: tarea.name, path: tarea.path, reason })
    }

    if (tarea.kind !== 'task') { descarta('no-es-tarea'); continue }
    if (tarea.isPiece) { descarta('es-un-trozo'); continue }
    if (tarea.alreadySplit) { descarta('ya-partida'); continue }
    if (tarea.hasActuals) { descarta('con-horas-reales'); continue }

    const entregables = entregaPorNodo.get(tarea.nodeId) ?? []
    if (entregables.length === 0) { descarta('sin-entregable'); continue }
    if (entregables.length > 1) { descarta('varios-entregables'); continue }

    const documentTypeId = entregables[0] ?? ''
    const documento = porDocumento.get(documentTypeId)
    if (documento === undefined) { descarta('sin-entregable'); continue }

    const previas = [...(previasDe.get(documentTypeId) ?? [])].sort((a, b) => a.position - b.position)
    if (previas.length === 0) { descarta('sin-entregas-previas'); continue }

    const repartoPrevio = previas.reduce((suma, entrega) => suma + entrega.shareBp, 0)
    if (repartoPrevio >= TOTAL_BP) { descarta('reparto-completo'); continue }

    // La misma decisión que al partir en subactividades, y por el mismo motivo:
    // una `fixed_duration` lleva su tamaño en la duración, no en el trabajo.
    const magnitude: DeliveryMagnitude = tarea.workDeclaredMinutes > 0 ? 'trabajo' : 'duracion'
    const total = magnitude === 'trabajo' ? tarea.workDeclaredMinutes : tarea.durationMinutes
    if (total <= 0) { descarta('sin-tamano'); continue }

    const pesos = [...previas.map((entrega) => entrega.shareBp), TOTAL_BP - repartoPrevio]
    const trozos = repartir(total, pesos)

    const deliveries: ProposedDelivery[] = previas.map((entrega, i) => ({
      order: i,
      gate: entrega.gate,
      maturity: entrega.maturity,
      weeksBeforeGate: entrega.weeksBeforeGate,
      minutes: trozos[i] ?? 0,
      shareBp: entrega.shareBp,
      isFinal: false,
    }))
    deliveries.push({
      order: previas.length,
      gate: documento.gate ?? '',
      maturity: null,
      weeksBeforeGate: documento.weeksBeforeGate,
      minutes: trozos[previas.length] ?? 0,
      shareBp: TOTAL_BP - repartoPrevio,
      isFinal: true,
    })

    const chain = deliveries.slice(0, -1).map((entrega, i) => [entrega.order, i + 1] as const)

    // Lo que esperaba a la tarea espera a la PRIMERA entrega; lo que esperaba
    // por ella, a la FINAL. Misma convención que ADR-0039, y la que hace que
    // encadenar dos documentos siga significando lo mismo.
    const ultima = deliveries.length - 1
    const relinked: RelinkedDelivery[] = []
    for (const enlace of input.links) {
      if (enlace.successorNodeId === tarea.nodeId) {
        relinked.push({ dependencyId: enlace.id, side: 'entrada', toOrder: 0 })
      } else if (enlace.predecessorNodeId === tarea.nodeId) {
        relinked.push({ dependencyId: enlace.id, side: 'salida', toOrder: ultima })
      }
    }

    split.push({
      nodeId: tarea.nodeId,
      name: tarea.name,
      path: tarea.path,
      documentTypeId,
      documentCode: documento.code,
      magnitude,
      deliveries,
      chain,
      relinked,
      copiedResourceIds: asignacionesPorNodo.get(tarea.nodeId) ?? [],
    })
  }

  const minutosDe = (tarea: DeliveryTask): number =>
    tarea.workDeclaredMinutes > 0 ? tarea.workDeclaredMinutes : tarea.durationMinutes
  const partidas = new Set(split.map((propuesta) => propuesta.nodeId))
  const minutesBefore = input.tasks
    .filter((tarea) => partidas.has(tarea.nodeId))
    .reduce((suma, tarea) => suma + minutosDe(tarea), 0)
  const minutesAfter = split.reduce(
    (suma, propuesta) => suma + propuesta.deliveries.reduce((s, e) => s + e.minutes, 0),
    0,
  )

  return {
    split,
    skipped,
    totals: {
      tasksBefore: input.tasks.length,
      tasksAfter:
        input.tasks.length + split.reduce((suma, p) => suma + p.deliveries.length, 0) - split.length,
      minutesBefore,
      minutesAfter,
    },
  }
}
