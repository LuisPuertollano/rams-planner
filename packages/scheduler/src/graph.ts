/**
 * El grafo de dependencias.
 *
 * Un ciclo **no se rompe automáticamente**: se enumera entero y se emite un
 * hallazgo bloqueante. Romper enlaces en silencio produce planes que nadie
 * puede explicar.
 */

import type { DependencyDefinition } from './plan.js'

export interface TopologicalOrder {
  readonly order: readonly string[]
  /** Ciclo completo si lo hay, en orden, con el primer nodo repetido al final. */
  readonly cycle?: readonly string[]
}

export function topologicalOrder(
  nodeIds: readonly string[],
  dependencies: readonly DependencyDefinition[],
): TopologicalOrder {
  const present = new Set(nodeIds)
  const successors = new Map<string, string[]>()
  const inDegree = new Map<string, number>()
  for (const id of nodeIds) {
    successors.set(id, [])
    inDegree.set(id, 0)
  }

  for (const dependency of dependencies) {
    if (!present.has(dependency.predecessorNodeId) || !present.has(dependency.successorNodeId)) continue
    successors.get(dependency.predecessorNodeId)?.push(dependency.successorNodeId)
    inDegree.set(dependency.successorNodeId, (inDegree.get(dependency.successorNodeId) ?? 0) + 1)
  }

  // Cola ordenada por id: el orden topológico es único y reproducible (P2).
  const ready = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0).sort()
  const order: string[] = []

  while (ready.length > 0) {
    const current = ready.shift()
    if (current === undefined) break
    order.push(current)
    for (const successor of [...(successors.get(current) ?? [])].sort()) {
      const remaining = (inDegree.get(successor) ?? 0) - 1
      inDegree.set(successor, remaining)
      if (remaining === 0) insertSorted(ready, successor)
    }
  }

  if (order.length === nodeIds.length) return { order }
  return { order, cycle: findCycle(nodeIds, successors, inDegree) }
}

function insertSorted(queue: string[], value: string): void {
  let low = 0
  let high = queue.length
  while (low < high) {
    const middle = (low + high) >> 1
    if ((queue[middle] ?? '') < value) low = middle + 1
    else high = middle
  }
  queue.splice(low, 0, value)
}

/** Busca un ciclo concreto entre los nodos que quedaron sin ordenar. */
function findCycle(
  nodeIds: readonly string[],
  successors: ReadonlyMap<string, string[]>,
  inDegree: ReadonlyMap<string, number>,
): readonly string[] {
  const stuck = new Set(nodeIds.filter((id) => (inDegree.get(id) ?? 0) > 0))
  const visited = new Set<string>()
  const path: string[] = []
  const onPath = new Set<string>()

  const walk = (current: string): readonly string[] | undefined => {
    visited.add(current)
    path.push(current)
    onPath.add(current)

    for (const successor of [...(successors.get(current) ?? [])].sort()) {
      if (!stuck.has(successor)) continue
      if (onPath.has(successor)) {
        const start = path.indexOf(successor)
        return [...path.slice(start), successor]
      }
      if (!visited.has(successor)) {
        const found = walk(successor)
        if (found !== undefined) return found
      }
    }

    path.pop()
    onPath.delete(current)
    return undefined
  }

  for (const id of [...stuck].sort()) {
    if (visited.has(id)) continue
    const found = walk(id)
    if (found !== undefined) return found
  }
  return [...stuck].sort()
}
