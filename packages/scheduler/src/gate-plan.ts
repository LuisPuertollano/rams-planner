/**
 * La puerta del entregable le pone fecha objetivo a la tarea que lo entrega.
 *
 * ADR-0027 metió en la ficha del entregable a qué puerta de certificación va y
 * cuántas semanas antes tiene que estar terminado, y dejó escrito que el motor
 * **no** lo usaba todavía: «meter ya la regla de las semanas en el motor cambia
 * las fechas de todo». Esto es esa decisión, con la mitad del dato que faltaba
 * —cuándo cae cada puerta en cada proyecto— ya declarada.
 *
 * ## De dónde sale la regla
 *
 * El DocFlowChart del equipo coloca cada entregable a su distancia de la puerta,
 * y la hoja lo resuelve en una celda:
 *
 *     MIN(techo; MAX(fecha_de_la_puerta − 7 × semanas; suelo)) + suelo_del_predecesor
 *
 * De esa fórmula aquí entra **sólo el corazón**, `fecha_de_la_puerta − 7 ×
 * semanas`. Los tres términos restantes existen porque una celda de Excel tiene
 * que dar un día sí o sí: no hay nadie detrás que programe, así que la celda se
 * recorta sola para no salirse del proyecto y se suma a su predecesora para no
 * adelantarla.
 *
 * Aquí sí hay alguien detrás. El `+ suelo_del_predecesor` es el trabajo del
 * motor, que ya empuja por las dependencias; y el recorte se sustituye por
 * decirlo: si la fecha cae antes de que el proyecto arranque, eso no se
 * disimula moviéndola al arranque, se enseña y no se pone (`antes-del-arranque`).
 * Un objetivo recortado es un objetivo que se cumple siempre y no avisa de nada.
 *
 * ## Objetivo, no empujón
 *
 * Lo que se escribe es `task.deadline`, que en este modelo es **blando**: no
 * mueve la tarea, genera el hallazgo `DEADLINE_MISSED` cuando el plan no llega.
 * Es exactamente lo que dice una puerta de certificación —«esto tiene que estar
 * el día 14»— y deja que el motor siga siendo quien decide cuándo cabe.
 *
 * Nada de esto escribe: devuelve lo que haría, con el motivo de cada descarte,
 * igual que `planSubactivities` y `planDocumentDependencies`.
 */

import { addDays, calendarDate, type CalendarDate } from '@planner/domain'

/** Una tarea hoja del proyecto, con el objetivo que ya tuviera. */
export interface GateTask {
  readonly nodeId: string
  readonly name: string
  readonly path: string
  readonly kind: 'phase' | 'work_package' | 'task' | 'milestone'
  /** El objetivo declarado hoy, si alguien puso uno. */
  readonly deadline: string | null
}

/** Qué entregable entrega cada tarea. */
export interface GateDelivery {
  readonly nodeId: string
  readonly documentTypeId: string
}

/** La ficha del entregable, en lo que toca a la puerta. */
export interface GateDocument {
  readonly documentTypeId: string
  readonly code: string
  readonly name: string
  readonly gate: string | null
  readonly weeksBeforeGate: number | null
}

/** Cuándo cae una puerta en ESTE proyecto. */
export interface ProjectGate {
  readonly gate: string
  readonly date: string
}

export interface GatePlanInput {
  readonly tasks: readonly GateTask[]
  readonly deliveries: readonly GateDelivery[]
  readonly documents: readonly GateDocument[]
  readonly gates: readonly ProjectGate[]
  /** El arranque del proyecto: el suelo por debajo del cual no se pone nada. */
  readonly projectStart: string
}

/**
 * - `no-es-tarea`: una fase o un paquete no se entrega, agrega. Un hito sí
 *   puede llevar objetivo, y de hecho una puerta de revisión suele ser uno.
 * - `sin-entregable`: la tarea no declara ningún documento, así que no hay
 *   puerta de la que sacar fecha.
 * - `varios-entregables`: declara más de uno y sus puertas podrían no coincidir.
 *   Elegir una sería inventar; se enseña y decide una persona.
 * - `sin-puerta`: el entregable no declara `gate`. Es opcional a propósito.
 * - `puerta-sin-fecha`: el entregable va a una puerta que este proyecto no ha
 *   fechado. Es el descarte que más se va a ver el primer día, y se arregla
 *   escribiendo la fecha, no tocando el catálogo.
 * - `antes-del-arranque`: la cuenta da un día anterior al arranque del proyecto.
 * - `ya-puesta`: la tarea ya tiene exactamente ese objetivo. No es un problema.
 */
export type GateSkipReason =
  | 'no-es-tarea'
  | 'sin-entregable'
  | 'varios-entregables'
  | 'sin-puerta'
  | 'puerta-sin-fecha'
  | 'antes-del-arranque'
  | 'ya-puesta'

/** Un objetivo que se pondría, con toda la cuenta a la vista (P4). */
export interface ProposedDeadline {
  readonly nodeId: string
  readonly name: string
  readonly path: string
  readonly documentTypeId: string
  readonly documentCode: string
  readonly gate: string
  readonly gateDate: string
  /** Las semanas usadas. Cero significa «en la puerta» — ver abajo. */
  readonly weeks: number
  /** El día que sale de la cuenta. */
  readonly deadline: string
  /** Lo que había antes, para que un cambio se vea como cambio. */
  readonly previous: string | null
}

export interface SkippedDeadline {
  readonly nodeId: string
  readonly name: string
  readonly path: string
  readonly reason: GateSkipReason
  /** La puerta implicada, cuando el motivo la tiene. */
  readonly gate: string | null
  /** El día que habría salido, cuando se llegó a calcular. */
  readonly deadline: string | null
}

export interface GatePlanResult {
  readonly set: readonly ProposedDeadline[]
  readonly skipped: readonly SkippedDeadline[]
  readonly totals: {
    readonly candidatas: number
    readonly nuevas: number
    readonly cambiadas: number
    readonly descartadas: number
    /** Las puertas que el catálogo pide y este proyecto no ha fechado. */
    readonly puertasSinFecha: readonly string[]
  }
}

const DIAS_POR_SEMANA = 7

/**
 * Las puertas casan por su nombre, y «cgr» y «CGR» son la misma puerta escrita
 * por dos personas. Se normaliza igual que el índice único de la tabla.
 */
function comoPuerta(nombre: string): string {
  return nombre.trim().toUpperCase()
}

/**
 * Qué objetivo le tocaría a cada tarea por la puerta de su entregable.
 *
 * ## Una decisión pequeña que conviene no esconder
 *
 * `weeksBeforeGate` puede venir sin declarar, y el catálogo extraído del
 * DocFlowChart viene así entero: las cajas del diagrama dicen a qué puerta va
 * cada entregable, y no cuántas semanas antes. Sin declarar se lee como
 * **cero**, es decir, el día de la puerta.
 *
 * Es una lectura, no un dato, y por eso las semanas usadas viajan en la
 * propuesta: quien la mira ve el cero y puede corregir la ficha. La alternativa
 * —descartar todo lo que no trae semanas— dejaba la regla sin usar el día que
 * se enchufa el catálogo de verdad, que es justo cuando tiene que servir.
 */
export function planGateDeadlines(input: GatePlanInput): GatePlanResult {
  const porPuerta = new Map<string, string>()
  for (const puerta of input.gates) porPuerta.set(comoPuerta(puerta.gate), puerta.date)

  const porDocumento = new Map<string, GateDocument>()
  for (const documento of input.documents) porDocumento.set(documento.documentTypeId, documento)

  const entregaPorNodo = new Map<string, string[]>()
  for (const entrega of input.deliveries) {
    const ya = entregaPorNodo.get(entrega.nodeId)
    if (ya === undefined) entregaPorNodo.set(entrega.nodeId, [entrega.documentTypeId])
    else ya.push(entrega.documentTypeId)
  }

  const arranque = calendarDate(input.projectStart)
  const set: ProposedDeadline[] = []
  const skipped: SkippedDeadline[] = []
  const puertasSinFecha = new Set<string>()

  for (const tarea of input.tasks) {
    const descarta = (reason: GateSkipReason, gate: string | null, deadline: string | null): void => {
      skipped.push({
        nodeId: tarea.nodeId,
        name: tarea.name,
        path: tarea.path,
        reason,
        gate,
        deadline,
      })
    }

    if (tarea.kind !== 'task' && tarea.kind !== 'milestone') {
      descarta('no-es-tarea', null, null)
      continue
    }

    const entregables = entregaPorNodo.get(tarea.nodeId) ?? []
    if (entregables.length === 0) {
      descarta('sin-entregable', null, null)
      continue
    }
    if (entregables.length > 1) {
      descarta('varios-entregables', null, null)
      continue
    }

    const documentTypeId = entregables[0] ?? ''
    const documento = porDocumento.get(documentTypeId)
    const puerta = documento?.gate ?? null
    if (documento === undefined || puerta === null || puerta.trim() === '') {
      descarta('sin-puerta', null, null)
      continue
    }

    const fechaPuerta = porPuerta.get(comoPuerta(puerta))
    if (fechaPuerta === undefined) {
      puertasSinFecha.add(comoPuerta(puerta))
      descarta('puerta-sin-fecha', puerta, null)
      continue
    }

    const semanas = documento.weeksBeforeGate ?? 0
    const objetivo: CalendarDate = addDays(
      calendarDate(fechaPuerta),
      -(semanas * DIAS_POR_SEMANA),
    )

    if (objetivo < arranque) {
      descarta('antes-del-arranque', puerta, objetivo)
      continue
    }
    if (tarea.deadline === objetivo) {
      descarta('ya-puesta', puerta, objetivo)
      continue
    }

    set.push({
      nodeId: tarea.nodeId,
      name: tarea.name,
      path: tarea.path,
      documentTypeId,
      documentCode: documento.code,
      gate: puerta,
      gateDate: fechaPuerta,
      weeks: semanas,
      deadline: objetivo,
      previous: tarea.deadline,
    })
  }

  return {
    set,
    skipped,
    totals: {
      candidatas: input.tasks.length,
      nuevas: set.filter((propuesta) => propuesta.previous === null).length,
      cambiadas: set.filter((propuesta) => propuesta.previous !== null).length,
      descartadas: skipped.length,
      puertasSinFecha: [...puertasSinFecha].sort((a, b) => (a < b ? -1 : 1)),
    },
  }
}
