/**
 * Partir las tareas de un proyecto en la cadena de subactividades de su
 * entregable.
 *
 * ADR-0037 dejó el catálogo declarado y dijo lo que no hacía: partir la tarea.
 * Esto es eso, y como todo lo que toca un plan de verdad, **no escribe nada**:
 * devuelve lo que haría, con el motivo de cada descarte, para poder enseñarlo
 * antes de tocar nada. Es el mismo trato que `planDocumentDependencies`.
 *
 * ## Qué sale de partir una tarea
 *
 * La tarea «Redactar el FMECA» —40 h de alguien— se convierte en:
 *
 *     Redactar el FMECA            (paquete, ya no se estima: agrega)
 *       · Crear                    32 h   Ing. de seguridad 1
 *       · Revisar 1                 8 h   Ing. de seguridad 2
 *
 * con la cadena `Crear → Revisar 1` atada fin-comienzo. Y el siguiente
 * documento deja de esperar a que termine todo lo del FMECA para esperar a que
 * esté **revisado**, que es lo que hace el libro en 299 de sus enlaces.
 *
 * ## El total del proyecto no se mueve
 *
 * Esta es la decisión que más se nota y la que hay que poder defender: el
 * reparto usa la **proporción** del catálogo, no sus minutos absolutos. La
 * tarea traía 40 h porque alguien las estimó para este proyecto; el catálogo
 * dice que crear y revisar van cuatro a uno. Se reparten 40 h en 32 + 8.
 *
 * Usar los minutos del catálogo tal cual sería más simple y haría que partir
 * una tarea cambiara el esfuerzo del proyecto — la herramienta pisando la
 * estimación de una persona sin que nadie lo haya pedido.
 *
 * El reparto es entero y suma exacto: el resto de la división va al escalón más
 * grande, no se pierde ni un minuto (P5).
 */

import type { ActivityStep } from '@planner/domain'

/** Una tarea hoja del proyecto, con lo que hace falta para decidir. */
export interface SplitTask {
  readonly nodeId: string
  readonly name: string
  readonly path: string
  readonly kind: 'phase' | 'work_package' | 'task' | 'milestone'
  readonly workDeclaredMinutes: number
  /**
   * La duración declarada. Hace falta porque **no todas las tareas declaran
   * trabajo**: en este modelo lo normal es `fixed_duration`, donde el tamaño de
   * la tarea lo lleva la duración y el trabajo se deriva de ella. Mirar sólo el
   * trabajo declarado dejaba sin partir casi todo un plan de verdad.
   */
  readonly durationMinutes: number
  /** Si ya tiene horas fichadas. Una tarea con reales no se reestructura. */
  readonly hasActuals: boolean
  /** Si ya es el contenedor de una cadena. */
  readonly alreadyExpanded: boolean
  /** Si ella misma ES una subactividad nacida de partir otra tarea. */
  readonly isSubactivity: boolean
}

/** Qué entregable entrega cada tarea. */
export interface Delivery {
  readonly nodeId: string
  readonly documentTypeId: string
}

/** Una subactividad del catálogo, la que declara ADR-0037. */
export interface CatalogueActivity {
  readonly documentTypeId: string
  readonly step: ActivityStep
  readonly position: number
  readonly role: string
  readonly standardMinutes: number | null
}

/** Una asignación viva de la tarea, para saber a dónde se muda. */
export interface TaskAssignment {
  readonly nodeId: string
  readonly resourceId: string
}

/** Una dependencia del plan que toca alguna de estas tareas. */
export interface PlanLink {
  readonly id: string
  readonly predecessorNodeId: string
  readonly successorNodeId: string
}

/**
 * - `no-es-tarea`: es una fase, un paquete o un hito. Un hito es un instante y
 *   no se parte; un contenedor ya agrega.
 * - `sin-entregable`: la tarea no declara qué entrega, así que no hay catálogo
 *   del que sacar la cadena.
 * - `varios-entregables`: entrega dos o más. Cuál de las dos cadenas manda no
 *   lo puede decidir la herramienta.
 * - `sin-subactividades`: el entregable no declara ninguna, o declara una sola.
 *   Partir algo en un trozo es no partirlo.
 * - `catalogo-sin-minutos`: el catálogo no dice cuánto cuesta cada paso, así
 *   que no hay proporción con la que repartir. Se dice en vez de inventar un
 *   reparto a partes iguales, que sería una estimación de la herramienta.
 * - `sin-tamano`: la tarea no declara ni trabajo ni duración. No hay nada que
 *   repartir.
 * - `con-horas-reales`: ya tiene horas fichadas contra ella. Convertirla en
 *   contenedor dejaría esas horas en un nodo que el informe por tarea ya no
 *   mira, y desaparecerían sin avisar.
 * - `ya-partida`: ya es el contenedor de una cadena. Volver a partirla partiría
 *   los trozos.
 * - `es-subactividad`: ella misma nació de partir otra tarea. Y hereda el
 *   entregable —la puerta que cierra es la que lo entrega—, así que sin esto se
 *   propondría partir «Revisar 1» en su propio «Crear» y «Revisar 1», y otra
 *   vez, sin fondo. Partir una subactividad en las subactividades del mismo
 *   entregable no significa nada.
 */
export type SplitSkipReason =
  | 'no-es-tarea'
  | 'sin-entregable'
  | 'varios-entregables'
  | 'sin-subactividades'
  | 'catalogo-sin-minutos'
  | 'sin-tamano'
  | 'con-horas-reales'
  | 'ya-partida'
  | 'es-subactividad'

/**
 * Qué magnitud se reparte. No es un detalle: una tarea `fixed_work` lleva su
 * tamaño en el trabajo declarado y una `fixed_duration` lo lleva en la
 * duración, y repartir la que no es dejaría la tarea en cero.
 */
export type SplitMagnitude = 'trabajo' | 'duracion'

/** Un hijo propuesto: una subactividad con su trozo de las horas. */
export interface ProposedChild {
  readonly step: ActivityStep
  readonly position: number
  readonly role: string
  /** El trozo que le toca, en minutos, de la magnitud que se reparte. */
  readonly minutes: number
  /** Orden dentro de la cadena, empezando en 0. El soporte va al final. */
  readonly order: number
  /** Si es la puerta por la que entra el trabajo del entregable. */
  readonly isEntry: boolean
  /** Si es la puerta que lo cierra de cara a los demás. */
  readonly isGate: boolean
  /** Si aquí se mudan las asignaciones que tenía la tarea. */
  readonly takesAssignments: boolean
}

export interface ProposedSplit {
  readonly nodeId: string
  readonly name: string
  readonly path: string
  readonly documentTypeId: string
  /** Qué se reparte: el trabajo declarado, o la duración si no hay trabajo. */
  readonly magnitude: SplitMagnitude
  readonly children: readonly ProposedChild[]
  /** Los pares de la cadena interna, por orden: `de` va antes que `a`. */
  readonly chain: readonly (readonly [number, number])[]
  /** Dependencias existentes que dejan de apuntar a la tarea y a dónde van. */
  readonly relinked: readonly RelinkedDependency[]
  /** Personas cuya asignación se muda, para poder enseñarlo. */
  readonly movedResourceIds: readonly string[]
}

export interface RelinkedDependency {
  readonly dependencyId: string
  /** `entrada` si la tarea era la sucesora; `salida` si era la predecesora. */
  readonly side: 'entrada' | 'salida'
  /** El orden del hijo al que pasa a apuntar. */
  readonly toOrder: number
}

export interface SkippedSplit {
  readonly nodeId: string
  readonly name: string
  readonly path: string
  readonly reason: SplitSkipReason
  /** Cuántos entregables entrega, sólo en `varios-entregables`. */
  readonly count?: number
}

export interface SubactivityPlanResult {
  readonly split: readonly ProposedSplit[]
  readonly skipped: readonly SkippedSplit[]
  /** Cuántas tareas quedarían y cuánto trabajo, para poder comprobar la suma. */
  readonly totals: SplitTotals
}

export interface SplitTotals {
  readonly tasksBefore: number
  readonly tasksAfter: number
  readonly minutesBefore: number
  readonly minutesAfter: number
}

export interface SubactivityPlanInput {
  readonly tasks: readonly SplitTask[]
  readonly deliveries: readonly Delivery[]
  readonly activities: readonly CatalogueActivity[]
  readonly assignments: readonly TaskAssignment[]
  readonly links: readonly PlanLink[]
}

/** El orden de la cadena. El soporte va aparte: no encadena con nadie. */
const CADENA: readonly ActivityStep[] = ['create', 'review_1', 'review_2', 'review_3']

const rango = (paso: ActivityStep): number => {
  const i = CADENA.indexOf(paso)
  return i === -1 ? CADENA.length : i
}

/**
 * Reparte `total` en la proporción de `pesos`, en enteros y sin perder nada.
 *
 * El resto de la división va a los escalones más grandes, uno a uno, de mayor a
 * menor peso. Con empate manda el orden de la cadena, para que el reparto sea
 * el mismo siempre (P2). Es lo que hace que 100 minutos entre 3 y 1 salgan 75 y
 * 25, y que 10 entre 3 y 1 salgan 8 y 2 y no 7 y 2.
 */
export function repartir(total: number, pesos: readonly number[]): readonly number[] {
  const suma = pesos.reduce((a, b) => a + b, 0)
  if (suma <= 0 || total <= 0) return pesos.map(() => 0)

  const exactos = pesos.map((peso) => (total * peso) / suma)
  const enteros = exactos.map((x) => Math.floor(x))
  let resto = total - enteros.reduce((a, b) => a + b, 0)

  // A quién le toca el resto: primero al que más parte decimal perdió; con
  // empate, al de más peso; con empate otra vez, al que va antes en la cadena.
  const orden = pesos
    .map((peso, i) => ({ i, sobra: (exactos[i] ?? 0) - (enteros[i] ?? 0), peso }))
    .toSorted((a, b) => b.sobra - a.sobra || b.peso - a.peso || a.i - b.i)

  for (const { i } of orden) {
    if (resto <= 0) break
    enteros[i] = (enteros[i] ?? 0) + 1
    resto -= 1
  }
  return enteros
}

export function planSubactivities(input: SubactivityPlanInput): SubactivityPlanResult {
  const entregaDe = new Map<string, string[]>()
  for (const entrega of input.deliveries) {
    const lista = entregaDe.get(entrega.nodeId) ?? []
    if (!lista.includes(entrega.documentTypeId)) lista.push(entrega.documentTypeId)
    entregaDe.set(entrega.nodeId, lista)
  }
  for (const lista of entregaDe.values()) lista.sort()

  const catalogoDe = new Map<string, CatalogueActivity[]>()
  for (const actividad of input.activities) {
    const lista = catalogoDe.get(actividad.documentTypeId) ?? []
    lista.push(actividad)
    catalogoDe.set(actividad.documentTypeId, lista)
  }

  const asignacionesDe = new Map<string, string[]>()
  for (const asignacion of input.assignments) {
    const lista = asignacionesDe.get(asignacion.nodeId) ?? []
    if (!lista.includes(asignacion.resourceId)) lista.push(asignacion.resourceId)
    asignacionesDe.set(asignacion.nodeId, lista)
  }
  for (const lista of asignacionesDe.values()) lista.sort()

  const split: ProposedSplit[] = []
  const skipped: SkippedSplit[] = []

  // Orden determinista: el mismo plan da siempre la misma propuesta (P2).
  for (const tarea of [...input.tasks].toSorted((a, b) => a.path.localeCompare(b.path))) {
    const donde = { nodeId: tarea.nodeId, name: tarea.name, path: tarea.path }
    const descarta = (reason: SplitSkipReason, count?: number): void => {
      skipped.push(count === undefined ? { ...donde, reason } : { ...donde, reason, count })
    }

    if (tarea.alreadyExpanded) {
      descarta('ya-partida')
      continue
    }
    if (tarea.isSubactivity) {
      descarta('es-subactividad')
      continue
    }
    if (tarea.kind !== 'task') {
      descarta('no-es-tarea')
      continue
    }
    if (tarea.hasActuals) {
      descarta('con-horas-reales')
      continue
    }

    const entregables = entregaDe.get(tarea.nodeId) ?? []
    if (entregables.length === 0) {
      descarta('sin-entregable')
      continue
    }
    if (entregables.length > 1) {
      descarta('varios-entregables', entregables.length)
      continue
    }
    const documentTypeId = entregables[0]
    if (documentTypeId === undefined) continue

    const catalogo = (catalogoDe.get(documentTypeId) ?? []).toSorted(
      (a, b) => rango(a.step) - rango(b.step) || a.position - b.position,
    )
    if (catalogo.length < 2) {
      descarta('sin-subactividades')
      continue
    }
    // La magnitud que lleva el tamaño de esta tarea. El trabajo declarado
    // manda cuando lo hay; si no, la duración, que es lo que tienen las tareas
    // `fixed_duration` — que es lo normal en un plan de verdad.
    const magnitude: SplitMagnitude = tarea.workDeclaredMinutes > 0 ? 'trabajo' : 'duracion'
    const aRepartir = magnitude === 'trabajo' ? tarea.workDeclaredMinutes : tarea.durationMinutes
    if (aRepartir <= 0) {
      descarta('sin-tamano')
      continue
    }
    const pesos = catalogo.map((actividad) => actividad.standardMinutes ?? 0)
    if (pesos.every((peso) => peso <= 0)) {
      descarta('catalogo-sin-minutos')
      continue
    }

    const trozos = repartir(aRepartir, pesos)
    const enCadena = catalogo.filter((actividad) => actividad.step !== 'support')
    const entrada = enCadena[0]
    const cierra = enCadena[enCadena.length - 1]

    const children: ProposedChild[] = catalogo.map((actividad, i) => ({
      step: actividad.step,
      position: actividad.position,
      role: actividad.role,
      minutes: trozos[i] ?? 0,
      order: i,
      isEntry: actividad === entrada,
      isGate: actividad === cierra,
      // Quien estuviera asignado a la tarea estaba haciéndola: se muda a la
      // puerta de entrada. A los demás pasos no se les inventa una persona —el
      // catálogo dice un rol, y un rol no es nadie— y se quedan sin asignar,
      // que es lo que la pantalla tiene que enseñar para que alguien lo mire.
      takesAssignments: actividad === entrada,
    }))

    const ordenDe = (actividad: CatalogueActivity | undefined): number =>
      actividad === undefined ? 0 : catalogo.indexOf(actividad)

    const chain: (readonly [number, number])[] = []
    for (let i = 1; i < enCadena.length; i += 1) {
      chain.push([ordenDe(enCadena[i - 1]), ordenDe(enCadena[i])])
    }

    const relinked: RelinkedDependency[] = []
    for (const link of [...input.links].toSorted((a, b) => a.id.localeCompare(b.id))) {
      if (link.successorNodeId === tarea.nodeId) {
        relinked.push({ dependencyId: link.id, side: 'entrada', toOrder: ordenDe(entrada) })
      }
      if (link.predecessorNodeId === tarea.nodeId) {
        relinked.push({ dependencyId: link.id, side: 'salida', toOrder: ordenDe(cierra) })
      }
    }

    split.push({
      nodeId: tarea.nodeId,
      name: tarea.name,
      path: tarea.path,
      documentTypeId,
      magnitude,
      children,
      chain,
      relinked,
      movedResourceIds: asignacionesDe.get(tarea.nodeId) ?? [],
    })
  }

  const partidas = new Set(split.map((propuesta) => propuesta.nodeId))
  const hojas = input.tasks.filter((tarea) => tarea.kind === 'task' || tarea.kind === 'milestone')
  const nacen = split.reduce((total, propuesta) => total + propuesta.children.length, 0)

  // La cuenta que hay que poder comprobar de un vistazo: lo que se va a repartir
  // y lo que sale del reparto. Se mide sólo sobre las tareas que se parten,
  // porque el resto del plan no se toca y meterlo en la suma sólo la haría más
  // difícil de cuadrar.
  const antes = split.reduce((total, propuesta) => {
    const tarea = input.tasks.find((t) => t.nodeId === propuesta.nodeId)
    if (tarea === undefined) return total
    return total + (propuesta.magnitude === 'trabajo' ? tarea.workDeclaredMinutes : tarea.durationMinutes)
  }, 0)
  const despues = split.reduce(
    (total, propuesta) => total + propuesta.children.reduce((suma, hijo) => suma + hijo.minutes, 0),
    0,
  )

  return {
    split,
    skipped,
    totals: {
      tasksBefore: hojas.length,
      tasksAfter: hojas.length - partidas.size + nacen,
      // El total no se mueve: el reparto es proporcional y suma exacto. Se
      // devuelven los dos para que la pantalla pueda enseñarlo y para que una
      // prueba lo compruebe en vez de fiarse del comentario.
      minutesBefore: antes,
      minutesAfter: despues,
    },
  }
}
