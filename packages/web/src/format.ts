/**
 * Borde de presentación. Es el único sitio del cliente donde aparecen decimales:
 * todo lo que llega del servidor son minutos, céntimos y puntos base enteros.
 *
 * Todo lo que se formatea aquí depende del idioma elegido. No es cosmética:
 * `1.234,5` y `1,234.5` son el mismo número escrito de dos formas que se leen
 * mal cruzadas, y una fecha `03/04` es marzo o abril según quién la mire.
 *
 * El idioma vive en una variable de módulo y no en un parámetro que atraviese
 * treinta componentes. Normalmente eso sería un atajo malo, pero aquí es lo que
 * es: **el idioma es un único hecho de la página**, no algo que cambie de una
 * tabla a otra. Pasarlo a mano por cada `hours()` no daría ni una garantía más
 * y se olvidaría en la mitad de los sitios, que es como se acaba con un número
 * en alemán y el de al lado en castellano.
 */

const AHORA = new Date()

let localeActivo = 'es-ES'

/** La llama la aplicación cuando cambia el idioma. Nadie más. */
export function fijarLocale(locale: string): void {
  localeActivo = locale
}

/** El mes abreviado en el idioma que toque, sin tablas escritas a mano. */
function mesCorto(locale: string, indice: number): string {
  const fecha = new Date(Date.UTC(AHORA.getUTCFullYear(), indice, 1))
  return fecha.toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' }).replace('.', '')
}

export function hours(minutes: number, decimals = 0, locale = localeActivo): string {
  if (minutes === 0) return '—'
  return (minutes / 60).toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function percent(basisPoints: number | null): string {
  if (basisPoints === null) return '—'
  return `${String(Math.round(basisPoints / 100))} %`
}

export function euros(cents: number, locale = localeActivo): string {
  if (cents === 0) return '—'
  return (cents / 100).toLocaleString(locale, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  })
}

/**
 * Una tarifa por hora se muestra con sus dos decimales: redondear 72,50 €/h a
 * 73 €/h cambiaría el coste de un proyecto entero por una comodidad tipográfica.
 * Y un cero aquí es un cero, no un guion: significa «sin coste», que es un dato.
 */
export function euroRate(cents: number, locale = localeActivo): string {
  return (cents / 100).toLocaleString(locale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function monthLabel(period: string, locale = localeActivo): string {
  const [year, month] = period.split('-')
  const index = Number(month) - 1
  return `${Number.isNaN(index) ? (month ?? '') : mesCorto(locale, index)} ${(year ?? '').slice(2)}`
}

/**
 * Cómo se lee un periodo, sea de la escala que sea.
 *
 * El trimestre llega como «2026-T2» porque así lo escribe PostgreSQL y así se
 * exporta; la T es de «trimestre» y en las otras tres lenguas no significa
 * nada, así que la letra se traduce al enseñarla y la clave se deja en paz.
 */
export function periodLabel(period: string, locale = localeActivo, letraTrimestre = 'T'): string {
  if (/^\d{4}$/.test(period)) return period
  const [year, resto] = period.split('-')
  if (resto?.startsWith('T') === true) {
    return `${letraTrimestre}${resto.slice(1)} ${(year ?? '').slice(2)}`
  }
  return monthLabel(period, locale)
}

export function days(minutes: number | null, locale = localeActivo): string {
  if (minutes === null || minutes === 0) return '—'
  return `${(minutes / 480).toLocaleString(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} d`
}

export function shortDate(iso: string | null, locale = localeActivo): string {
  if (iso === null) return '—'
  const [, month, day] = iso.slice(0, 10).split('-')
  return `${day ?? ''} ${mesCorto(locale, Number(month) - 1)}`
}

export function fullDate(iso: string | null, locale = localeActivo): string {
  if (iso === null) return '—'
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC' })
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

/** Un instante con su hora, en el idioma activo. Para el registro de cambios. */
export function dateTime(iso: string, locale = localeActivo): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
}
