/**
 * Perfiles de reparto del trabajo a lo largo de una tarea.
 *
 * Devuelven un peso por día; el reparto real lo hace `distributeInteger`, que
 * garantiza que la suma es exactamente el trabajo total (P5). Los pesos se
 * multiplican por los minutos laborables disponibles de cada día, de modo que
 * un festivo o una media jornada nunca reciben trabajo que no cabe.
 */

import type { ContourKind } from '@planner/scheduler'

/** Peso relativo de cada posición, entre 0 y 1. */
export function contourWeights(kind: ContourKind, dayCount: number): readonly number[] {
  if (dayCount <= 0) return []
  if (dayCount === 1) return [1]

  const positions = Array.from({ length: dayCount }, (_, index) => index / (dayCount - 1))

  switch (kind) {
    case 'flat':
    case 'manual':
      return positions.map(() => 1)
    case 'front_loaded':
      return positions.map((position) => 1 - 0.6 * position)
    case 'back_loaded':
      return positions.map((position) => 0.4 + 0.6 * position)
    case 'bell':
      return positions.map((position) => 0.4 + 0.6 * Math.sin(Math.PI * position))
    case 'turtle':
      return positions.map((position) => {
        if (position < 0.2) return 0.4 + 3 * position
        if (position > 0.8) return 0.4 + 3 * (1 - position)
        return 1
      })
  }
}
