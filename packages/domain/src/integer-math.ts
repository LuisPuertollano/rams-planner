/**
 * Aritmética entera exacta (principio P5).
 *
 * Las operaciones que podrían perder exactitud en coma flotante se hacen con
 * BigInt por dentro y devuelven `number`. Los valores del dominio (minutos de
 * un plan, céntimos de un presupuesto) están muy por debajo de
 * Number.MAX_SAFE_INTEGER, así que la conversión de vuelta siempre es exacta.
 */

import { BASIS_POINTS_ONE, UnitError, type BasisPoints } from './units.js'

/**
 * Multiplica un valor entero por un porcentaje en puntos base.
 *
 * Redondeo: **mitad hacia arriba en valor absoluto** (half away from zero), de
 * forma que el signo no cambie el comportamiento. Es el único redondeo que
 * existe en el núcleo, y está aquí para que haya un solo sitio donde mirarlo.
 */
export function applyBasisPoints(value: number, bp: BasisPoints): number {
  if (!Number.isSafeInteger(value)) {
    throw new UnitError(`applyBasisPoints espera un entero seguro, recibido ${String(value)}`)
  }
  const sign = value < 0 ? -1n : 1n
  const magnitude = BigInt(Math.abs(value)) * BigInt(bp)
  const divisor = BigInt(BASIS_POINTS_ONE)
  // (magnitude + divisor/2) / divisor == redondeo al entero más cercano,
  // con los empates hacia arriba.
  const rounded = (magnitude * 2n + divisor) / (divisor * 2n)
  return Number(sign * rounded)
}

/**
 * Reparte un total entero entre varios cubos según sus pesos, **sin perder ni
 * inventar ni una unidad**: se garantiza `suma(resultado) === total`.
 *
 * Método de los **restos mayores**, con desempate por **índice ascendente**.
 * El desempate explícito es lo que hace el reparto reproducible con
 * independencia del orden de iteración (principio P2): repartir 1000 minutos
 * entre 7 días da siempre exactamente el mismo vector.
 *
 * @param total   entero no negativo a repartir
 * @param weights pesos no negativos; su suma debe ser > 0 si total > 0
 */
export function distributeInteger(total: number, weights: readonly number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new UnitError(`distributeInteger espera un total entero no negativo, recibido ${String(total)}`)
  }
  for (const weight of weights) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new UnitError(`Los pesos deben ser finitos y no negativos, recibido ${String(weight)}`)
    }
  }
  if (weights.length === 0) {
    if (total !== 0) {
      throw new UnitError('No se puede repartir un total mayor que cero entre cero cubos')
    }
    return []
  }

  const scaled = weights.map(toScaledBigInt)
  const weightSum = scaled.reduce((accumulator, weight) => accumulator + weight, 0n)
  if (weightSum === 0n) {
    if (total !== 0) {
      throw new UnitError('No se puede repartir un total mayor que cero entre pesos que suman cero')
    }
    return weights.map(() => 0)
  }

  const totalBig = BigInt(total)
  const base: bigint[] = []
  const remainders: { index: number; remainder: bigint }[] = []
  let assigned = 0n

  for (const [index, weight] of scaled.entries()) {
    const exactNumerator = totalBig * weight
    const quotient = exactNumerator / weightSum
    base.push(quotient)
    remainders.push({ index, remainder: exactNumerator - quotient * weightSum })
    assigned += quotient
  }

  // Desempate determinista: resto mayor primero; a igual resto, índice menor.
  remainders.sort((left, right) =>
    left.remainder === right.remainder
      ? left.index - right.index
      : left.remainder > right.remainder
        ? -1
        : 1,
  )

  let leftover = totalBig - assigned
  const getsExtraUnit = new Set<number>()
  for (const entry of remainders) {
    if (leftover <= 0n) break
    getsExtraUnit.add(entry.index)
    leftover -= 1n
  }

  return base.map((value, index) => Number(getsExtraUnit.has(index) ? value + 1n : value))
}

/** Escala 6 decimales para admitir pesos fraccionarios sin usar coma flotante. */
const WEIGHT_SCALE = 1_000_000

function toScaledBigInt(weight: number): bigint {
  return BigInt(Math.round(weight * WEIGHT_SCALE))
}

/**
 * Inversa de `applyBasisPoints`: reparte un valor entre un porcentaje.
 *
 * `divideByBasisPoints(trabajo, unidades)` da la duración que ese trabajo ocupa
 * a esa dedicación. Mismo redondeo: mitad hacia arriba en valor absoluto.
 */
export function divideByBasisPoints(value: number, bp: BasisPoints): number {
  if (!Number.isSafeInteger(value)) {
    throw new UnitError(`divideByBasisPoints espera un entero seguro, recibido ${String(value)}`)
  }
  if (bp === 0) {
    throw new UnitError('No se puede dividir entre una dedicación del 0 %')
  }
  const sign = value < 0 ? -1n : 1n
  const numerator = BigInt(Math.abs(value)) * BigInt(BASIS_POINTS_ONE)
  const divisor = BigInt(bp)
  const rounded = (numerator * 2n + divisor) / (divisor * 2n)
  return Number(sign * rounded)
}
