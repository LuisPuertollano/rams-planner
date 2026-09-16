/**
 * Propuesta de reparto de trabajo.
 *
 * Lo que hace y lo que NO hace, porque la diferencia es el diseño entero:
 *
 * - **No reasigna nada.** Devuelve una lista ordenada de movimientos posibles,
 *   con lo que costaría cada uno y lo que arreglaría. Aplicarlos es una acción
 *   del usuario, una por una.
 * - **No inventa capacidad ni competencias.** Un candidato lo es porque tiene la
 *   competencia que la tarea pide, al nivel que la pide, y porque le queda hueco
 *   en los días exactos en que hay que hacer el trabajo.
 * - **Es pura y determinista** (P2), como el resto del núcleo: los empates se
 *   rompen hasta el identificador, así que la misma entrada da siempre la misma
 *   lista en el mismo orden.
 *
 * La razón de que sea una propuesta y no una decisión: la herramienta ve horas
 * y competencias declaradas. No ve que alguien acaba de entrar, que a otro le
 * toca formarse en eso, o que ese cliente exige que firme una persona concreta.
 * Quien planifica sí. Una herramienta que reasigna sola acaba desobedecida.
 */

import type { Finding } from '@planner/domain'
import type { PlanSnapshot } from '@planner/scheduler'
import type { CapacityIndex } from './capacity.js'
import type { TimephasedCell } from './timephase.js'

export interface RebalanceProposal {
  readonly assignmentId: string
  readonly nodeId: string
  readonly taskName: string
  readonly projectId: string
  readonly fromResourceId: string
  readonly fromResourceName: string
  readonly toResourceId: string
  readonly toResourceName: string
  /** Minutos que se moverían: todo el trabajo de esa asignación. */
  readonly minutes: number
  /** Días en los que hay trabajo, para saber de qué periodo hablamos. */
  readonly firstDay: string
  readonly lastDay: string
  /** Saturación de quien suelta, antes y después, en puntos base. */
  readonly fromBeforeBp: number
  readonly fromAfterBp: number
  /** Saturación de quien recoge, antes y después. */
  readonly toBeforeBp: number
  readonly toAfterBp: number
  /** Minutos de sobrecarga que este movimiento quita del plan. Ordena la lista. */
  readonly relievedMinutes: number
  readonly reason: string
}

export interface RebalanceOptions {
  /** Saturación por encima de la cual alguien está sobrecargado. 10000 = 100 %. */
  readonly thresholdBp?: number
  /** Cuántas propuestas devolver como mucho. */
  readonly limit?: number
}

interface Bucket {
  planned: number
  capacity: number
}

const clave = (resourceId: string, period: string): string => `${resourceId}|${period}`
const mes = (date: string): string => date.slice(0, 7)

/**
 * Propone movimientos que quitan sobrecarga sin crearla en otro sitio.
 *
 * El criterio es deliberadamente conservador: sólo se propone mover una
 * asignación entera cuando quien la recoge **no queda sobrecargado**. Repartir
 * media asignación o dejar al de al lado al 110 % son cosas que un humano puede
 * decidir mirando el contexto; proponerlas automáticamente llenaría la lista de
 * ruido y haría que se dejara de mirar.
 */
export function proposeRebalance(
  snapshot: PlanSnapshot,
  timephased: readonly TimephasedCell[],
  capacity: CapacityIndex,
  options: RebalanceOptions = {},
): { readonly proposals: readonly RebalanceProposal[]; readonly findings: readonly Finding[] } {
  const threshold = options.thresholdBp ?? 10_000
  const limit = options.limit ?? 20
  const findings: Finding[] = []

  // Carga y capacidad por persona y mes. El mes es el grano en el que se decide
  // esto: nadie reasigna trabajo por un día suelto de pico.
  const buckets = new Map<string, Bucket>()
  const add = (resourceId: string, period: string, planned: number, capacityMinutes: number): void => {
    const actual = buckets.get(clave(resourceId, period)) ?? { planned: 0, capacity: 0 }
    actual.planned += planned
    actual.capacity += capacityMinutes
    buckets.set(clave(resourceId, period), actual)
  }
  for (const cell of timephased) add(cell.resourceId, mes(cell.date), cell.plannedMinutes, 0)
  for (const cell of capacity.cells) add(cell.resourceId, mes(cell.date), 0, cell.capacityMinutes)

  const saturacion = (resourceId: string, period: string): number => {
    const bucket = buckets.get(clave(resourceId, period))
    if (bucket === undefined || bucket.capacity === 0) return 0
    return Math.round((bucket.planned * 10_000) / bucket.capacity)
  }

  // Lo que cada asignación aporta, por mes y en total.
  const porAsignacion = new Map<string, { minutes: number; days: string[]; byMonth: Map<string, number> }>()
  for (const cell of timephased) {
    if (cell.plannedMinutes === 0) continue
    const actual = porAsignacion.get(cell.assignmentId) ?? {
      minutes: 0,
      days: [] as string[],
      byMonth: new Map<string, number>(),
    }
    actual.minutes += cell.plannedMinutes
    actual.days.push(cell.date)
    actual.byMonth.set(mes(cell.date), (actual.byMonth.get(mes(cell.date)) ?? 0) + cell.plannedMinutes)
    porAsignacion.set(cell.assignmentId, actual)
  }

  const nombreDe = new Map(snapshot.resources.map((resource) => [resource.id, resource.displayName]))
  const nodoDe = new Map(snapshot.nodes.map((node) => [node.id, node]))
  const requisitosDe = new Map<string, { skillId: string; minLevel: number }[]>()
  for (const requisito of snapshot.skillRequirements) {
    const lista = requisitosDe.get(requisito.nodeId) ?? []
    lista.push({ skillId: requisito.skillId, minLevel: requisito.minLevel })
    requisitosDe.set(requisito.nodeId, lista)
  }

  const propuestas: RebalanceProposal[] = []

  // Orden estable de entrada: el resultado no puede depender del orden en que
  // un Map devuelva sus claves.
  const asignaciones = [...snapshot.assignments].sort((left, right) => left.id.localeCompare(right.id))

  for (const asignacion of asignaciones) {
    const carga = porAsignacion.get(asignacion.id)
    if (carga === undefined || carga.minutes === 0) continue

    const meses = [...carga.byMonth.keys()].sort()
    // Sólo interesan las asignaciones que caen en un mes sobrecargado de su dueño.
    const mesesTensos = meses.filter((period) => saturacion(asignacion.resourceId, period) > threshold)
    if (mesesTensos.length === 0) continue

    const nodo = nodoDe.get(asignacion.nodeId)
    if (nodo === undefined) continue
    const requisitos = requisitosDe.get(asignacion.nodeId) ?? []

    const candidatos = snapshot.resources
      .filter((resource) => resource.id !== asignacion.resourceId && resource.kind === 'person')
      .filter((resource) =>
        requisitos.every((requisito) => {
          const propia = resource.skills.find((item) => item.skillId === requisito.skillId)
          return propia !== undefined && propia.level >= requisito.minLevel
        }),
      )
      // Ya asignado a esa misma tarea: moverlo ahí no es mover nada.
      .filter(
        (resource) =>
          !snapshot.assignments.some(
            (item) => item.nodeId === asignacion.nodeId && item.resourceId === resource.id,
          ),
      )
      .filter((resource) =>
        // Nadie recoge trabajo para quedarse sobrecargado: eso es mover el
        // problema de sitio, no resolverlo.
        meses.every((period) => {
          const bucket = buckets.get(clave(resource.id, period))
          if (bucket === undefined || bucket.capacity === 0) return false
          const minutos = carga.byMonth.get(period) ?? 0
          return Math.round(((bucket.planned + minutos) * 10_000) / bucket.capacity) <= threshold
        }),
      )

    if (candidatos.length === 0) continue

    // El mejor candidato es el que queda más holgado después; a igualdad, el de
    // identificador menor, para que la lista no baile entre ejecuciones.
    const puntuado = candidatos
      .map((resource) => {
        const peor = Math.max(
          ...meses.map((period) => {
            const bucket = buckets.get(clave(resource.id, period))
            if (bucket === undefined || bucket.capacity === 0) return 10_000
            const minutos = carga.byMonth.get(period) ?? 0
            return Math.round(((bucket.planned + minutos) * 10_000) / bucket.capacity)
          }),
        )
        return { resource, peor }
      })
      .sort((left, right) => left.peor - right.peor || left.resource.id.localeCompare(right.resource.id))

    const elegido = puntuado[0]
    if (elegido === undefined) continue

    const mesTenso = mesTensoPrincipal(mesesTensos, carga.byMonth)
    const minutosEnEseMes = carga.byMonth.get(mesTenso) ?? 0
    const bucketOrigen = buckets.get(clave(asignacion.resourceId, mesTenso))
    const capacidadOrigen = bucketOrigen?.capacity ?? 0
    const sobrecargaMinutos =
      bucketOrigen === undefined ? 0 : Math.max(0, bucketOrigen.planned - bucketOrigen.capacity)

    const dias = [...carga.days].sort()
    const fromBefore = saturacion(asignacion.resourceId, mesTenso)
    const fromAfter =
      capacidadOrigen === 0
        ? 0
        : Math.round((((bucketOrigen?.planned ?? 0) - minutosEnEseMes) * 10_000) / capacidadOrigen)
    const bucketDestino = buckets.get(clave(elegido.resource.id, mesTenso))
    const toBefore = saturacion(elegido.resource.id, mesTenso)
    const toAfter =
      bucketDestino === undefined || bucketDestino.capacity === 0
        ? 0
        : Math.round(((bucketDestino.planned + minutosEnEseMes) * 10_000) / bucketDestino.capacity)

    propuestas.push({
      assignmentId: asignacion.id,
      nodeId: asignacion.nodeId,
      taskName: nodo.name,
      projectId: nodo.projectId,
      fromResourceId: asignacion.resourceId,
      fromResourceName: nombreDe.get(asignacion.resourceId) ?? asignacion.resourceId,
      toResourceId: elegido.resource.id,
      toResourceName: elegido.resource.displayName,
      minutes: carga.minutes,
      firstDay: dias[0] ?? '',
      lastDay: dias[dias.length - 1] ?? '',
      fromBeforeBp: fromBefore,
      fromAfterBp: fromAfter,
      toBeforeBp: toBefore,
      toAfterBp: toAfter,
      relievedMinutes: Math.min(minutosEnEseMes, sobrecargaMinutos),
      reason:
        requisitos.length === 0
          ? `${elegido.resource.displayName} tiene hueco en ${mesTenso} y la tarea no pide ninguna competencia concreta.`
          : `${elegido.resource.displayName} cumple las competencias que pide «${nodo.name}» y tiene hueco en ${mesTenso}.`,
    })
  }

  // Primero lo que más sobrecarga quita; a igualdad, orden estable por asignación.
  const ordenadas = propuestas
    .sort(
      (left, right) =>
        right.relievedMinutes - left.relievedMinutes || left.assignmentId.localeCompare(right.assignmentId),
    )
    .slice(0, limit)

  const sobrecargados = new Set(
    [...buckets.entries()]
      .filter(([, bucket]) => bucket.capacity > 0 && bucket.planned > bucket.capacity)
      .map(([key]) => key.split('|')[0] ?? ''),
  )
  const aliviados = new Set(ordenadas.map((propuesta) => propuesta.fromResourceId))
  for (const resourceId of [...sobrecargados].sort()) {
    if (aliviados.has(resourceId)) continue
    findings.push({
      severity: 'info',
      code: 'REBALANCE_NO_CANDIDATE',
      entityType: 'resource',
      entityId: resourceId,
      message:
        `«${nombreDe.get(resourceId) ?? resourceId}» está sobrecargado y no hay nadie que pueda ` +
        'recoger su trabajo: o falta la competencia, o el resto tampoco tiene hueco.',
    })
  }

  return { proposals: ordenadas, findings }
}

/** El mes que más pesa de los tensos: es del que hay que hablar. */
function mesTensoPrincipal(meses: readonly string[], byMonth: ReadonlyMap<string, number>): string {
  return [...meses].sort(
    (left, right) => (byMonth.get(right) ?? 0) - (byMonth.get(left) ?? 0) || left.localeCompare(right),
  )[0] ?? (meses[0] ?? '')
}
