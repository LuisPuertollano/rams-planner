/**
 * Repartir las horas reales entre las tareas, y decir lo que no cuadra.
 *
 * El sistema de fichaje no sabe contra qué **tarea** se trabajó. SAP CATS —y
 * cualquier otro— sabe «Ana imputó 40 h al proyecto CBTC en abril», y nada
 * más. La tarea no está en el dato y no se puede adivinar.
 *
 * Así que se declara: «de mis horas de abril en CBTC, el 60 % fue al FMECA y
 * el 40 % al Hazard Log». Multiplicar una cosa por la otra da las horas por
 * tarea, que es lo que el informe necesita para poner lo gastado al lado de lo
 * planificado.
 *
 * ## El invariante, que es de lo que va todo esto
 *
 * **Ningún minuto se pierde por el camino.** Cada minuto que entra o cae en una
 * tarea o sale nombrado en un descuadre, y las dos cifras se devuelven para que
 * se puedan comparar:
 *
 *     minutosQueEntran === minutosRepartidos + minutosSinRepartir
 *
 * De ahí sale la decisión que más se nota: **un reparto que no suma 100 % no se
 * aplica a medias**. Y el motivo no es el que parece. `distributeInteger`
 * reparte el total en PROPORCIÓN a los pesos, así que una declaración que sólo
 * cubre el 60 % no dejaría fuera el 40 %: le daría a esa tarea **las horas
 * enteras del mes**. El FMECA se llevaría también las horas que se fueron a
 * algo que nadie declaró, y el informe enseñaría más gasto del real en una
 * tarea y ninguno en otra, sin que nada lo dijera.
 *
 * Se queda fuera entero y se dice cuánto falta y cuánto se ha declarado.
 *
 * Es una función pura y no toca la base: recibe las dos listas y devuelve el
 * reparto y los descuadres.
 */

import { distributeInteger } from '@planner/domain'

const TOTAL_BP = 10_000

/** Lo que dice el sistema de fichaje: persona, proyecto, mes y horas. */
export interface MonthlyActual {
  readonly resourceId: string
  readonly projectId: string
  /** El mes, como `YYYY-MM`. */
  readonly period: string
  readonly minutes: number
}

/** Lo que declara la persona sobre ese mes. */
export interface ActualSplit {
  readonly resourceId: string
  readonly projectId: string
  readonly period: string
  readonly nodeId: string
  readonly shareBp: number
}

/** Una hora real ya puesta contra su tarea. Misma forma que una celda de carga. */
export interface AllocatedActual {
  readonly resourceId: string
  readonly projectId: string
  readonly nodeId: string
  readonly period: string
  readonly actualMinutes: number
}

/**
 * Por qué un mes no llegó a las tareas.
 *
 * Los cuatro son situaciones distintas con arreglos distintos, y por eso son
 * cuatro motivos y no un «hay un problema»:
 *
 * - `sin-declarar`   hay horas y nadie ha dicho en qué se fueron.
 * - `no-suma-cien`   hay declaración y no suma 100 %: sobra o falta.
 * - `sin-horas`      hay declaración de un mes en el que no se fichó nada.
 * - `dos-caminos`    ese mes tiene horas por las dos vías a la vez, la del
 *                    parte diario por tarea y la mensual por proyecto. Sumarlas
 *                    contaría el trabajo dos veces.
 */
export type MotivoDescuadre = 'sin-declarar' | 'no-suma-cien' | 'sin-horas' | 'dos-caminos'

export interface Descuadre {
  readonly resourceId: string
  readonly projectId: string
  readonly period: string
  readonly motivo: MotivoDescuadre
  /** Los minutos que se quedan fuera del reparto. Cero si no había horas. */
  readonly minutes: number
  /** Lo que suma la declaración, en puntos básicos. Cero si no hay ninguna. */
  readonly declaredBp: number
}

export interface Reparto {
  readonly allocated: readonly AllocatedActual[]
  readonly descuadres: readonly Descuadre[]
  /** Todo lo que traía el fichaje. */
  readonly minutesIn: number
  /** Lo que ha caído en una tarea. */
  readonly minutesAllocated: number
  /** Lo que se ha quedado fuera, con su motivo en `descuadres`. */
  readonly minutesUnallocated: number
}

/** La clave de un mes de una persona en un proyecto. */
const clave = (r: { resourceId: string; projectId: string; period: string }): string =>
  `${r.resourceId}|${r.projectId}|${r.period}`

export interface OpcionesReparto {
  /**
   * Las claves que además tienen parte diario por tarea (`actual_entry`).
   *
   * Vienen de fuera porque esta función no lee nada. Un mes que está en las dos
   * vías no se reparte: sus horas ya están contadas por la otra, y volver a
   * repartirlas las contaría dos veces.
   */
  readonly conParteDiario?: ReadonlySet<string>
}

export function repartirReales(
  meses: readonly MonthlyActual[],
  repartos: readonly ActualSplit[],
  opciones: OpcionesReparto = {},
): Reparto {
  const conParteDiario = opciones.conParteDiario ?? new Set<string>()

  // Las declaraciones, agrupadas por mes y **ordenadas por tarea**: el reparto
  // de un entero depende del orden de los pesos, así que sin un orden estable
  // dos ejecuciones podrían repartir el minuto que sobra a tareas distintas (P2).
  //
  // Cada entrada lleva su identidad al lado —persona, proyecto, mes— y no sólo
  // la lista. Guardar sólo la lista obligaba a sacar esos tres campos de su
  // primer elemento, y eso son dos comprobaciones de «y si no hay ninguno» que
  // no pueden ocurrir pero que hay que escribir igual.
  const porMes = new Map<string, { resourceId: string; projectId: string; period: string; filas: ActualSplit[] }>()
  for (const reparto of repartos) {
    const bolsa = porMes.get(clave(reparto)) ?? {
      resourceId: reparto.resourceId,
      projectId: reparto.projectId,
      period: reparto.period,
      filas: [],
    }
    bolsa.filas.push(reparto)
    porMes.set(clave(reparto), bolsa)
  }
  for (const bolsa of porMes.values()) {
    bolsa.filas.sort((izq, der) => izq.nodeId.localeCompare(der.nodeId))
  }

  const allocated: AllocatedActual[] = []
  const descuadres: Descuadre[] = []
  let minutesIn = 0
  let minutesAllocated = 0

  const mesesVistos = new Set<string>()
  for (const mes of [...meses].sort((izq, der) => clave(izq).localeCompare(clave(der)))) {
    const llave = clave(mes)
    mesesVistos.add(llave)
    minutesIn += mes.minutes

    const declaracion = porMes.get(llave)?.filas ?? []
    const suma = declaracion.reduce((total, fila) => total + fila.shareBp, 0)

    if (conParteDiario.has(llave)) {
      descuadres.push({ ...sinTarea(mes), motivo: 'dos-caminos', minutes: mes.minutes, declaredBp: suma })
      continue
    }
    if (declaracion.length === 0) {
      descuadres.push({ ...sinTarea(mes), motivo: 'sin-declarar', minutes: mes.minutes, declaredBp: 0 })
      continue
    }
    if (suma !== TOTAL_BP) {
      descuadres.push({ ...sinTarea(mes), motivo: 'no-suma-cien', minutes: mes.minutes, declaredBp: suma })
      continue
    }

    // El reparto exacto: la suma de las partes es el total, aunque no divida.
    const partes = distributeInteger(mes.minutes, declaracion.map((fila) => fila.shareBp))
    declaracion.forEach((fila, indice) => {
      const minutos = partes[indice] ?? 0
      if (minutos === 0) return
      allocated.push({
        resourceId: mes.resourceId,
        projectId: mes.projectId,
        nodeId: fila.nodeId,
        period: mes.period,
        actualMinutes: minutos,
      })
      minutesAllocated += minutos
    })
  }

  // Una declaración de un mes que nadie fichó. No pierde minutos —no los hay—
  // pero casi siempre es un mes o un proyecto equivocado, y callarlo deja a
  // alguien esperando unas horas que no van a aparecer nunca.
  for (const [llave, bolsa] of [...porMes.entries()].sort(([izq], [der]) => izq.localeCompare(der))) {
    if (mesesVistos.has(llave)) continue
    descuadres.push({
      resourceId: bolsa.resourceId,
      projectId: bolsa.projectId,
      period: bolsa.period,
      motivo: 'sin-horas',
      minutes: 0,
      declaredBp: bolsa.filas.reduce((total, fila) => total + fila.shareBp, 0),
    })
  }

  return {
    allocated,
    descuadres,
    minutesIn,
    minutesAllocated,
    minutesUnallocated: minutesIn - minutesAllocated,
  }
}

/** Los tres campos que identifican el mes, sin el resto. */
function sinTarea(mes: MonthlyActual): { resourceId: string; projectId: string; period: string } {
  return { resourceId: mes.resourceId, projectId: mes.projectId, period: mes.period }
}

/**
 * La matriz que se mira: una fila por persona, una columna por mes.
 *
 * Es el `Declaration_CHECK` del libro, y existe porque la lista de descuadres
 * no se lee. Treinta y cuatro proyectos por doce meses son cuatrocientas
 * casillas, y lo que alguien necesita ver de un vistazo es **en qué mes de
 * quién** hay que entrar, no una lista de cuatrocientas líneas ordenada por
 * nada que le importe.
 */
export interface CasillaConciliacion {
  readonly resourceId: string
  readonly period: string
  /** Los minutos que entraron ese mes para esa persona, de todos sus proyectos. */
  readonly minutes: number
  /** Los que llegaron a una tarea. */
  readonly allocated: number
  /** El peor motivo de los que haya, o `null` si todo cuadra. */
  readonly motivo: MotivoDescuadre | null
  /** Cuántos proyectos de esa persona y ese mes están descuadrados. */
  readonly proyectosConProblema: number
}

/**
 * De peor a menos malo. Una casilla enseña el peor, que es el que hay que
 * arreglar primero; el detalle está en la lista.
 */
const GRAVEDAD: readonly MotivoDescuadre[] = ['dos-caminos', 'no-suma-cien', 'sin-declarar', 'sin-horas']

export function matrizDeConciliacion(reparto: Reparto, meses: readonly MonthlyActual[]): readonly CasillaConciliacion[] {
  const casillas = new Map<string, {
    resourceId: string; period: string; minutes: number; allocated: number
    motivos: Set<MotivoDescuadre>; proyectos: Set<string>
  }>()
  const de = (resourceId: string, period: string) => {
    const llave = `${resourceId}|${period}`
    const actual = casillas.get(llave) ?? {
      resourceId, period, minutes: 0, allocated: 0,
      motivos: new Set<MotivoDescuadre>(), proyectos: new Set<string>(),
    }
    casillas.set(llave, actual)
    return actual
  }

  for (const mes of meses) de(mes.resourceId, mes.period).minutes += mes.minutes
  for (const fila of reparto.allocated) de(fila.resourceId, fila.period).allocated += fila.actualMinutes
  for (const descuadre of reparto.descuadres) {
    const casilla = de(descuadre.resourceId, descuadre.period)
    casilla.motivos.add(descuadre.motivo)
    casilla.proyectos.add(descuadre.projectId)
  }

  return [...casillas.values()]
    .map((casilla) => ({
      resourceId: casilla.resourceId,
      period: casilla.period,
      minutes: casilla.minutes,
      allocated: casilla.allocated,
      motivo: GRAVEDAD.find((motivo) => casilla.motivos.has(motivo)) ?? null,
      proyectosConProblema: casilla.proyectos.size,
    }))
    .sort((izq, der) => izq.resourceId.localeCompare(der.resourceId) || izq.period.localeCompare(der.period))
}
