/**
 * Borde de presentación. Es el único sitio del cliente donde aparecen decimales:
 * todo lo que llega del servidor son minutos, céntimos y puntos base enteros.
 */

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export function hours(minutes: number, decimals = 0): string {
  if (minutes === 0) return '—'
  return (minutes / 60).toFixed(decimals).replace('.', ',')
}

export function percent(basisPoints: number | null): string {
  if (basisPoints === null) return '—'
  return `${String(Math.round(basisPoints / 100))} %`
}

export function euros(cents: number): string {
  if (cents === 0) return '—'
  return `${(cents / 100).toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`
}

/**
 * Una tarifa por hora se muestra con sus dos decimales: redondear 72,50 €/h a
 * 73 €/h cambiaría el coste de un proyecto entero por una comodidad tipográfica.
 * Y un cero aquí es un cero, no un guion: significa «sin coste», que es un dato.
 */
export function euroRate(cents: number): string {
  return `${(cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

export function monthLabel(period: string): string {
  const [year, month] = period.split('-')
  const index = Number(month) - 1
  return `${MONTHS[index] ?? month ?? ''} ${(year ?? '').slice(2)}`
}

export function days(minutes: number | null): string {
  if (minutes === null || minutes === 0) return '—'
  return `${(minutes / 480).toFixed(1).replace('.', ',')} d`
}

export function shortDate(iso: string | null): string {
  if (iso === null) return '—'
  const date = iso.slice(0, 10)
  const [, month, day] = date.split('-')
  return `${day ?? ''} ${MONTHS[Number(month) - 1] ?? ''}`
}

export function fullDate(iso: string | null): string {
  if (iso === null) return '—'
  return iso.slice(0, 10).split('-').reverse().join('/')
}

export function utilizationClass(basisPoints: number | null): string {
  if (basisPoints === null) return 'util-idle'
  if (basisPoints === 0) return 'util-idle'
  if (basisPoints < 6_000) return 'util-low'
  if (basisPoints < 9_500) return 'util-ok'
  if (basisPoints <= 10_500) return 'util-full'
  if (basisPoints <= 13_000) return 'util-over'
  return 'util-critical'
}

export function utilizationColor(basisPoints: number | null): string {
  return `var(--${utilizationClass(basisPoints)})`
}
