/**
 * Las cuentas del panel de capacidad.
 *
 * Están fuera de la vista porque son puras: entra una ejecución y un corte,
 * sale un número. Así se prueban sin montar React y sin una base de datos, que
 * es lo que permite fijar por escrito las dos decisiones que más se discuten —
 * qué meses cuentan y qué pasa con la capacidad cuando se filtra por proyecto.
 */

import type { LoadCell, RunData } from './api.js'
import { activePeriods } from './periods.js'

/** Los dos umbrales, los mismos que el libro TrRAMS: <80 % y >100 %. */
export const POR_DEBAJO = 8_000
export const POR_ENCIMA = 10_000

/** La ventana de «lo que viene», en días. */
export const VENTANA = 15

export interface Mes {
  readonly period: string
  readonly capacidad: number
  readonly demanda: number
}

export interface Persona {
  readonly resourceId: string
  readonly capacidad: number
  readonly demanda: number
  readonly ocupacionBp: number | null
  readonly proyectos: readonly string[]
}

export interface Cifras {
  readonly capacidad: number
  readonly demanda: number
  readonly ocupacionBp: number | null
  readonly hueco: number
  readonly huecoPorPersona: number
  readonly porEncima: number
  readonly porDebajo: number
  readonly meses: readonly Mes[]
  readonly gente: readonly Persona[]
}

export interface Proxima {
  readonly nodeId: string
  readonly projectId: string
  readonly name: string
  readonly finish: string
  readonly minutos: number
  readonly equipo: readonly string[]
}

/** Sin capacidad no hay proporción: `null` es «no se sabe», no es cero. */
export function proporcion(demanda: number, capacidad: number): number | null {
  return capacidad === 0 ? null : Math.round((demanda * 10_000) / capacidad)
}

/**
 * Las seis cifras de cabecera y sus dos desgloses.
 *
 * Dos decisiones que no son obvias y que conviene leer antes de tocar esto:
 *
 * **Qué meses cuentan.** Sólo aquellos en los que hay trabajo. Repartir la
 * ocupación sobre los cuatro años del horizonte daría un 4 % que no significa
 * nada, y es la misma regla que usan las tarjetas de la cabecera.
 *
 * **Qué pasa al filtrar por proyecto.** La demanda se recorta y la capacidad
 * **no**, porque la capacidad es de la persona y no del proyecto. Recortarla
 * daría una ocupación del 20 % que sólo dice que ese proyecto no es el único
 * que tiene esa persona. La pantalla lo avisa cuando hay filtro puesto.
 */
export function cifrasDelPanel(
  data: Pick<RunData, 'load' | 'utilization'>,
  proyecto: string,
  visibles: ReadonlySet<string>,
): Cifras {
  const cuenta = (celda: LoadCell): boolean =>
    (proyecto === '' || celda.projectId === proyecto) && visibles.has(celda.projectId)

  const demandaPorPersona = new Map<string, number>()
  const demandaPorMes = new Map<string, number>()
  const proyectosDe = new Map<string, Set<string>>()
  let demanda = 0
  for (const celda of data.load) {
    if (!cuenta(celda)) continue
    demanda += celda.plannedMinutes
    demandaPorPersona.set(celda.resourceId, (demandaPorPersona.get(celda.resourceId) ?? 0) + celda.plannedMinutes)
    demandaPorMes.set(celda.period, (demandaPorMes.get(celda.period) ?? 0) + celda.plannedMinutes)
    if (celda.plannedMinutes > 0) {
      const suyos = proyectosDe.get(celda.resourceId) ?? new Set<string>()
      suyos.add(celda.projectId)
      proyectosDe.set(celda.resourceId, suyos)
    }
  }

  const activos = new Set(
    activePeriods([...demandaPorMes.entries()].filter(([, m]) => m > 0).map(([p]) => p)),
  )
  const capacidadPorPersona = new Map<string, number>()
  const capacidadPorMes = new Map<string, number>()
  let capacidad = 0
  for (const celda of data.utilization) {
    if (!activos.has(celda.period)) continue
    capacidad += celda.capacityMinutes
    capacidadPorPersona.set(celda.resourceId, (capacidadPorPersona.get(celda.resourceId) ?? 0) + celda.capacityMinutes)
    capacidadPorMes.set(celda.period, (capacidadPorMes.get(celda.period) ?? 0) + celda.capacityMinutes)
  }

  const gente: Persona[] = [...new Set([...demandaPorPersona.keys(), ...capacidadPorPersona.keys()])]
    .map((resourceId) => {
      const suCapacidad = capacidadPorPersona.get(resourceId) ?? 0
      const suDemanda = demandaPorPersona.get(resourceId) ?? 0
      return {
        resourceId,
        capacidad: suCapacidad,
        demanda: suDemanda,
        ocupacionBp: proporcion(suDemanda, suCapacidad),
        proyectos: [...(proyectosDe.get(resourceId) ?? new Set<string>())].sort(),
      }
    })
    .sort((a, b) => (b.ocupacionBp ?? -1) - (a.ocupacionBp ?? -1))

  const conCapacidad = gente.filter((p) => p.ocupacionBp !== null)
  const meses = [...activos].sort().map((period) => ({
    period,
    capacidad: capacidadPorMes.get(period) ?? 0,
    demanda: demandaPorMes.get(period) ?? 0,
  }))

  return {
    capacidad,
    demanda,
    ocupacionBp: proporcion(demanda, capacidad),
    hueco: capacidad - demanda,
    huecoPorPersona: conCapacidad.length === 0 ? 0 : Math.round((capacidad - demanda) / conCapacidad.length),
    porEncima: conCapacidad.filter((p) => (p.ocupacionBp ?? 0) > POR_ENCIMA).length,
    porDebajo: conCapacidad.filter((p) => (p.ocupacionBp ?? 0) < POR_DEBAJO).length,
    meses,
    gente,
  }
}

/**
 * Lo que termina dentro de la ventana, lo más cercano primero.
 *
 * Los contenedores se quedan fuera: una fase «termina» cuando termina su
 * última hija, así que enseñarla sería contar dos veces lo mismo.
 */
export function loQueViene(
  data: Pick<RunData, 'tasks'>,
  proyecto: string,
  visibles: ReadonlySet<string>,
  hoy: string,
): readonly Proxima[] {
  const limite = new Date(Date.parse(`${hoy}T00:00:00Z`) + VENTANA * 86_400_000)
    .toISOString()
    .slice(0, 10)
  return data.tasks
    .filter((tarea) => {
      const fin = tarea.scheduledFinish?.slice(0, 10)
      return (
        tarea.kind !== 'phase' &&
        tarea.kind !== 'work_package' &&
        fin !== undefined &&
        fin >= hoy &&
        fin <= limite &&
        (proyecto === '' || tarea.projectId === proyecto) &&
        visibles.has(tarea.projectId)
      )
    })
    .map((tarea) => ({
      nodeId: tarea.nodeId,
      projectId: tarea.projectId,
      name: tarea.name,
      finish: tarea.scheduledFinish ?? '',
      minutos: tarea.workMinutes ?? 0,
      equipo: tarea.assignees,
    }))
    .sort((a, b) => a.finish.localeCompare(b.finish))
}
