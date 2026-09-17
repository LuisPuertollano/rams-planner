/**
 * Aplicar la matriz de documentos a un proyecto.
 *
 * La matriz dice qué documento es condición necesaria de cuál. `node_document`
 * dice qué tarea entrega qué documento. Cruzando las dos cosas salen las
 * dependencias del proyecto sin teclear ninguna: si la tarea A entrega el
 * *Análisis de riesgos* y la tarea B entrega el *Informe de seguridad*, y la
 * matriz dice que el primero es condición del segundo, entonces A precede a B.
 *
 * Esta función **no escribe nada**. Devuelve lo que haría, con el motivo de
 * cada descarte, para poder enseñarlo antes de tocar el plan. Un aplicador que
 * inventa veinte dependencias sin avisar es peor que no tenerlo.
 */

export interface DocumentPlanTask {
  readonly nodeId: string
  readonly name: string
  readonly path: string
}

export interface DocumentDelivery {
  readonly nodeId: string
  readonly documentTypeId: string
}

/** La fila es condición necesaria de la columna. */
export interface DocumentPrecedenceRule {
  readonly predecessorId: string
  readonly successorId: string
}

/** Dependencia ya existente en el plan. Sólo importan los dos extremos. */
export interface ExistingLink {
  readonly predecessorNodeId: string
  readonly successorNodeId: string
}

/**
 * - `ya-existe`: el plan ya ata esas dos tareas, o ya la propone otra pareja
 *   de documentos de esta misma ejecución.
 * - `misma-tarea`: la misma tarea entrega los dos documentos. No hay nada que
 *   ordenar.
 * - `crearia-un-ciclo`: la tarea sucesora ya alcanza a la predecesora. Se
 *   descarta y se dice por dónde, en vez de romper enlaces en silencio.
 */
export type SkipReason = 'ya-existe' | 'misma-tarea' | 'crearia-un-ciclo'

export interface ProposedDependency {
  readonly predecessorNodeId: string
  readonly successorNodeId: string
  /** Qué casilla de la matriz la justifica. Es la explicación (P4). */
  readonly documentPredecessorId: string
  readonly documentSuccessorId: string
}

export interface SkippedDependency extends ProposedDependency {
  readonly reason: SkipReason
  /** Sólo en `crearia-un-ciclo`: el camino que ya existe, del sucesor al predecesor. */
  readonly path?: readonly string[]
}

export interface DocumentPlanResult {
  readonly create: readonly ProposedDependency[]
  readonly skipped: readonly SkippedDependency[]
  /**
   * Documentos que la matriz nombra y que ninguna tarea del proyecto entrega.
   * No es un error: es el hueco que hay que mirar antes de fiarse del plan.
   */
  readonly missingDocuments: readonly string[]
}

export interface DocumentPlanInput {
  readonly tasks: readonly DocumentPlanTask[]
  readonly deliveries: readonly DocumentDelivery[]
  readonly precedences: readonly DocumentPrecedenceRule[]
  readonly existing: readonly ExistingLink[]
}

const SEPARADOR = '>'

export function planDocumentDependencies(input: DocumentPlanInput): DocumentPlanResult {
  const tasks = new Set(input.tasks.map((task) => task.nodeId))

  // Quién entrega cada documento, sólo dentro del proyecto que se aplica.
  const byDocument = new Map<string, string[]>()
  for (const delivery of input.deliveries) {
    if (!tasks.has(delivery.nodeId)) continue
    const nodes = byDocument.get(delivery.documentTypeId)
    if (nodes === undefined) byDocument.set(delivery.documentTypeId, [delivery.nodeId])
    else if (!nodes.includes(delivery.nodeId)) nodes.push(delivery.nodeId)
  }
  for (const nodes of byDocument.values()) nodes.sort()

  // Aristas vigentes: las del plan más las que vayamos aceptando. La detección
  // de ciclos pregunta siempre sobre este grafo, no sobre el de partida.
  const successors = new Map<string, Set<string>>()
  const pairs = new Set<string>()
  const link = (predecessor: string, successor: string): void => {
    pairs.add(predecessor + SEPARADOR + successor)
    const set = successors.get(predecessor)
    if (set === undefined) successors.set(predecessor, new Set([successor]))
    else set.add(successor)
  }
  // Una dependencia que cruza proyectos cuenta igual: si ata una tarea de este
  // proyecto, puede cerrar un ciclo por fuera.
  for (const existing of input.existing) link(existing.predecessorNodeId, existing.successorNodeId)

  const create: ProposedDependency[] = []
  const skipped: SkippedDependency[] = []
  const missing = new Set<string>()

  // Orden determinista: mismas entradas, misma propuesta, siempre (P2).
  const rules = [...input.precedences].sort((a, b) =>
    a.predecessorId === b.predecessorId
      ? a.successorId.localeCompare(b.successorId)
      : a.predecessorId.localeCompare(b.predecessorId),
  )

  for (const rule of rules) {
    const predecessorTasks = byDocument.get(rule.predecessorId) ?? []
    const successorTasks = byDocument.get(rule.successorId) ?? []
    if (predecessorTasks.length === 0) missing.add(rule.predecessorId)
    if (successorTasks.length === 0) missing.add(rule.successorId)

    for (const predecessorNodeId of predecessorTasks) {
      for (const successorNodeId of successorTasks) {
        const candidate: ProposedDependency = {
          predecessorNodeId,
          successorNodeId,
          documentPredecessorId: rule.predecessorId,
          documentSuccessorId: rule.successorId,
        }

        if (predecessorNodeId === successorNodeId) {
          skipped.push({ ...candidate, reason: 'misma-tarea' })
          continue
        }
        if (pairs.has(predecessorNodeId + SEPARADOR + successorNodeId)) {
          skipped.push({ ...candidate, reason: 'ya-existe' })
          continue
        }
        const vuelta = pathBetween(successors, successorNodeId, predecessorNodeId)
        if (vuelta !== undefined) {
          skipped.push({ ...candidate, reason: 'crearia-un-ciclo', path: vuelta })
          continue
        }

        link(predecessorNodeId, successorNodeId)
        create.push(candidate)
      }
    }
  }

  return { create, skipped, missingDocuments: [...missing].sort() }
}

/**
 * Camino de `from` a `to` si lo hay, `undefined` si no. Se explora en orden de
 * id para que el camino que se enseña sea siempre el mismo.
 */
function pathBetween(
  successors: ReadonlyMap<string, Set<string>>,
  from: string,
  to: string,
): readonly string[] | undefined {
  if (from === to) return [from]
  const previous = new Map<string, string>()
  const seen = new Set<string>([from])
  const queue: string[] = [from]

  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) break
    for (const next of [...(successors.get(current) ?? [])].sort()) {
      if (seen.has(next)) continue
      seen.add(next)
      previous.set(next, current)
      if (next === to) return rebuildPath(previous, from, to)
      queue.push(next)
    }
  }
  return undefined
}

function rebuildPath(previous: ReadonlyMap<string, string>, from: string, to: string): readonly string[] {
  const path = [to]
  let step = to
  while (step !== from) {
    const before = previous.get(step)
    if (before === undefined) break
    path.unshift(before)
    step = before
  }
  return path
}
