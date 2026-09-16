/**
 * Rango de meses que merece la pena enseñar.
 *
 * El horizonte del cálculo son cuatro años, pero el trabajo ocupa unos pocos
 * meses. Enseñar cuarenta columnas vacías no informa de nada: se toma el rango
 * continuo que va del primer al último mes con trabajo, sin huecos, para que la
 * línea temporal se lea de un vistazo.
 */

export function activePeriods(periodsWithWork: readonly string[]): readonly string[] {
  if (periodsWithWork.length === 0) return []
  const sorted = [...new Set(periodsWithWork)].sort()
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (first === undefined || last === undefined) return []

  const found: string[] = []
  let [year, month] = first.split('-').map(Number) as [number, number]
  for (let guard = 0; guard < 600; guard += 1) {
    const period = `${String(year)}-${String(month).padStart(2, '0')}`
    found.push(period)
    if (period === last) break
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return found
}
