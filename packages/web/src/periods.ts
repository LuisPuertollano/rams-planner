/**
 * La escala del tiempo: en qué se agrupan las columnas.
 *
 * El horizonte del cálculo son años y el trabajo ocupa unos pocos meses, así
 * que el rango que se enseña es el continuo que va del primer al último
 * periodo con trabajo: cuarenta columnas vacías no informan de nada.
 *
 * ## Por qué hace falta más de una escala
 *
 * La cartera real son 34 proyectos de 2026 a 2031. En meses eso son setenta y
 * dos columnas, y una matriz de setenta y dos columnas no se lee: no se puede
 * comparar un año con otro porque no caben dos a la vista. El libro del equipo
 * lo resuelve con 182 columnas de 2020 a 2033 y la vista por año al lado.
 *
 * ## El reparto se agrupa aquí, no en el servidor
 *
 * Las celdas llegan por mes y se suman en el navegador. No es un atajo: un año
 * ES la suma de sus meses, así que agrupar aquí da exactamente lo mismo que
 * volver a preguntar, sin una segunda petición y sin dos implementaciones de
 * la misma cuenta que puedan separarse.
 *
 * Con una excepción que es justo la que hay que tener cuidado de no hacer mal:
 * **la saturación no se suma, se recalcula**. La saturación de un año no es la
 * media de las de sus meses —eso pesaría igual un agosto de vacaciones que un
 * marzo entero—, es el trabajo del año dividido entre la capacidad del año.
 */

import type { LoadCell, UtilizationCell } from './api.js'

export const ESCALAS = ['mes', 'trimestre', 'anio'] as const

export type Escala = (typeof ESCALAS)[number]

/**
 * El periodo al que pertenece un mes, en la escala pedida.
 *
 * El trimestre se escribe como lo escribe PostgreSQL en `to_char(…, 'YYYY-"T"Q')`,
 * para que la exportación del servidor y esta pantalla hablen igual.
 */
export function claveDe(mes: string, escala: Escala): string {
  if (escala === 'mes') return mes
  const [anio, numero] = mes.split('-')
  if (escala === 'anio') return anio ?? mes
  const trimestre = Math.floor((Number(numero) - 1) / 3) + 1
  return Number.isNaN(trimestre) ? mes : `${anio ?? ''}-T${String(trimestre)}`
}

/**
 * El rango continuo de periodos que merece la pena enseñar, sin huecos.
 *
 * Recibe los meses con trabajo —que es como llegan las celdas— y devuelve los
 * periodos de la escala pedida. Los huecos se rellenan: un año sin trabajo en
 * medio de dos que sí tienen es una columna vacía que hay que ver, porque el
 * hueco es el dato.
 */
export function periodosActivos(mesesConTrabajo: readonly string[], escala: Escala = 'mes'): readonly string[] {
  if (mesesConTrabajo.length === 0) return []
  const ordenados = [...new Set(mesesConTrabajo)].sort()
  const primero = ordenados[0]
  const ultimo = ordenados[ordenados.length - 1]
  if (primero === undefined || ultimo === undefined) return []

  const hasta = claveDe(ultimo, escala)
  const encontrados: string[] = []
  let [anio, mes] = primero.split('-').map(Number) as [number, number]
  // El tope existe porque el bucle avanza hasta alcanzar el último periodo, y
  // un dato absurdo —un mes 99— no puede dejarlo girando para siempre.
  for (let guarda = 0; guarda < 6_000; guarda += 1) {
    const periodo = claveDe(`${String(anio)}-${String(mes).padStart(2, '0')}`, escala)
    if (encontrados[encontrados.length - 1] !== periodo) encontrados.push(periodo)
    if (periodo === hasta) break
    mes += 1
    if (mes > 12) {
      mes = 1
      anio += 1
    }
  }
  return encontrados
}

/** Lo que sigue valiendo para quien sólo quiere meses. */
export function activePeriods(mesesConTrabajo: readonly string[]): readonly string[] {
  return periodosActivos(mesesConTrabajo, 'mes')
}

/**
 * Junta las celdas de varios meses en el periodo de la escala.
 *
 * `clave` dice qué distingue una celda de otra **sin contar el periodo** —la
 * persona, el proyecto, la tarea—, y `junta` dice cómo se acumulan dos celdas
 * del mismo grupo. La aritmética la pone quien llama a propósito: sumar horas
 * y recalcular una saturación no son la misma operación, y esconderlas las dos
 * detrás de un «suma» sería justo el error que esto viene a evitar.
 */
export function agrupar<T extends { readonly period: string }>(
  celdas: readonly T[],
  escala: Escala,
  clave: (celda: T) => string,
  junta: (acumulado: T, celda: T) => T,
): readonly T[] {
  if (escala === 'mes') return celdas
  const grupos = new Map<string, T>()
  for (const celda of celdas) {
    const periodo = claveDe(celda.period, escala)
    const llave = `${clave(celda)}\u0000${periodo}`
    const anterior = grupos.get(llave)
    grupos.set(llave, anterior === undefined ? { ...celda, period: periodo } : junta(anterior, celda))
  }
  return [...grupos.values()]
}

/**
 * Las dos aritméticas que hacen falta, escritas una sola vez.
 *
 * Están aquí y no en cada pantalla porque las tres tienen que dar el mismo
 * número: una matriz de carga y un mapa de saturación que no cuadren entre sí
 * son peores que no tener ni uno ni otro.
 */
export function sumaCarga(acumulado: LoadCell, celda: LoadCell): LoadCell {
  return {
    ...acumulado,
    plannedMinutes: acumulado.plannedMinutes + celda.plannedMinutes,
    costCents: acumulado.costCents + celda.costCents,
  }
}

/** La saturación se RECALCULA: trabajo del periodo entre capacidad del periodo. */
export function sumaSaturacion(acumulado: UtilizationCell, celda: UtilizationCell): UtilizationCell {
  const trabajo = acumulado.plannedMinutes + celda.plannedMinutes
  const capacidad = acumulado.capacityMinutes + celda.capacityMinutes
  return {
    ...acumulado,
    plannedMinutes: trabajo,
    capacityMinutes: capacidad,
    utilizationBp: capacidad === 0 ? null : Math.round((trabajo * 10_000) / capacidad),
  }
}

/** La carga de una persona en un proyecto y una tarea. El periodo no entra. */
export const claveDeCarga = (celda: LoadCell): string =>
  `${celda.resourceId}|${celda.projectId}|${celda.nodeId}`
