/**
 * La frase de un hallazgo, en el idioma activo.
 *
 * El motor no manda prosa traducible: manda un `code`, un `payload` con los
 * datos y —de respaldo— la frase castellana que escribió él. Aquí se construye
 * el texto a partir de los dos primeros, y sólo si falta la clave se cae al
 * respaldo. Esa caída es a propósito y es visible: un hallazgo de una ejecución
 * de hace dos años, con un código que ya no está en el catálogo, tiene que
 * seguir leyéndose.
 *
 * Que no falte ninguna clave lo comprueba una prueba sobre `FindingCode`, no la
 * buena voluntad.
 */

import { es } from './i18n/es.js'
import type { Diccionario } from './i18n/index.js'
import { fullDate, hours, monthLabel, percent } from './format.js'

/** Lo que hace falta de un hallazgo para poder decirlo. */
export interface DecibleComoHallazgo {
  readonly code: string
  readonly message: string
  readonly payload?: Readonly<Record<string, string | number | boolean | null>>
}

type Traductor = (clave: keyof Diccionario, ...valores: readonly (string | number)[]) => string

/** ¿Existe esa clave? `es` es el catálogo: define qué claves hay. */
function hay(clave: string): clave is keyof Diccionario {
  return clave in es
}

const texto = (payload: DecibleComoHallazgo['payload'], nombre: string): string => {
  const valor = payload?.[nombre]
  return valor === undefined || valor === null ? '—' : String(valor)
}

const numero = (payload: DecibleComoHallazgo['payload'], nombre: string): number => {
  const valor = payload?.[nombre]
  return typeof valor === 'number' ? valor : 0
}

/** Horas, desde los minutos laborables que viajan en el payload. */
const horas = (payload: DecibleComoHallazgo['payload'], nombre: string): string =>
  hours(numero(payload, nombre), 1)

const fecha = (payload: DecibleComoHallazgo['payload'], nombre: string): string => {
  const valor = payload?.[nombre]
  return typeof valor === 'string' && valor !== '' ? fullDate(valor) : '—'
}

/** Un mes `AAAA-MM` se dice como mes, no como código. */
const mes = (payload: DecibleComoHallazgo['payload'], nombre: string): string => {
  const valor = payload?.[nombre]
  return typeof valor === 'string' && valor !== '' ? monthLabel(valor) : '—'
}

/**
 * La frase del hallazgo.
 *
 * Cada caso nombra sus huecos en el orden del diccionario. Es repetitivo a
 * propósito: un bucle genérico sobre el payload ataría el orden de las palabras
 * al orden de las claves de un objeto, y entonces el alemán —que pone el verbo
 * donde le corresponde— no se podría traducir.
 */
export function findingText(t: Traductor, finding: DecibleComoHallazgo): string {
  const p = finding.payload
  const variante = texto(p, 'variant')
  const conVariante = `hallazgo.${finding.code}.${variante}`
  const clave = hay(conVariante) ? conVariante : `hallazgo.${finding.code}`
  if (!hay(clave)) return finding.message

  switch (clave) {
    case 'hallazgo.DEPENDENCY_CYCLE':
      return t(clave, texto(p, 'cycle'))

    // El motivo se dice en el idioma de quien mira, no como el dato crudo que
    // manda el servidor: «archivado» no es una frase.
    case 'hallazgo.DEPENDENCY_OUT_OF_PLAN.falta-la-predecesora':
    case 'hallazgo.DEPENDENCY_OUT_OF_PLAN.falta-la-sucesora': {
      const motivo = `hallazgo.fuera.${texto(p, 'reason')}`
      return t(
        clave,
        texto(p, 'task'),
        texto(p, 'other'),
        texto(p, 'project'),
        hay(motivo) ? t(motivo) : texto(p, 'reason'),
      )
    }

    case 'hallazgo.CONSTRAINT_CONFLICT.start_no_later_than':
    case 'hallazgo.CONSTRAINT_CONFLICT.must_start_on':
      return t(clave, texto(p, 'task'), fecha(p, 'constraintDate'), fecha(p, 'dependencyStart'))
    case 'hallazgo.CONSTRAINT_CONFLICT.finish_no_later_than':
      return t(clave, texto(p, 'task'), fecha(p, 'finish'), fecha(p, 'constraintDate'))
    case 'hallazgo.CONSTRAINT_CONFLICT.must_finish_on':
      return t(clave, texto(p, 'task'), fecha(p, 'constraintDate'), fecha(p, 'start'))

    case 'hallazgo.RESOURCE_OVERALLOCATED': {
      // -1 no es un 0 %: es que ese día no tenía capacidad ninguna.
      const pico = numero(p, 'peakUtilizationBp')
      return t(
        clave,
        texto(p, 'resource'),
        numero(p, 'days'),
        mes(p, 'month'),
        fecha(p, 'peakDate'),
        pico < 0 ? t('hallazgo.sinCapacidad') : percent(pico),
      )
    }
    case 'hallazgo.RESOURCE_NO_CAPACITY':
      return t(clave, texto(p, 'resource'))

    case 'hallazgo.DEADLINE_MISSED':
      return t(clave, texto(p, 'task'), fecha(p, 'finish'), fecha(p, 'deadline'))
    case 'hallazgo.BUDGET_EXCEEDED':
      return t(clave, texto(p, 'task'), horas(p, 'planned'), horas(p, 'standard'))
    case 'hallazgo.TASK_UNASSIGNED':
      return t(clave, texto(p, 'task'))
    case 'hallazgo.TASK_NO_WORK':
      return t(clave, texto(p, 'task'), horas(p, 'durationMinutes'))
    case 'hallazgo.ORPHAN_TASK':
      return t(clave)

    case 'hallazgo.SKILL_MISSING':
      return t(clave, texto(p, 'resource'), texto(p, 'task'), texto(p, 'skill'))
    case 'hallazgo.SKILL_BELOW_LEVEL':
      return t(
        clave,
        texto(p, 'resource'),
        texto(p, 'task'),
        texto(p, 'skill'),
        numero(p, 'level'),
        numero(p, 'required'),
      )

    case 'hallazgo.CONTOUR_MISMATCH':
      return t(clave, texto(p, 'resource'), horas(p, 'declared'), horas(p, 'expected'))

    case 'hallazgo.LEVELING_IMPOSSIBLE.no-cabe-en-la-jornada':
      return t(
        clave,
        numero(p, 'days'),
        fecha(p, 'first'),
        fecha(p, 'last'),
        texto(p, 'resource'),
        fecha(p, 'peakDate'),
        horas(p, 'largestSingleMinutes'),
        horas(p, 'capacityMinutes'),
      )
    case 'hallazgo.LEVELING_IMPOSSIBLE.restriccion-dura':
    case 'hallazgo.LEVELING_IMPOSSIBLE.fuera-del-horizonte':
      return t(clave, texto(p, 'resource'), fecha(p, 'date'))
    case 'hallazgo.LEVELING_IMPOSSIBLE.retraso-maximo':
      return t(clave, texto(p, 'resource'), fecha(p, 'date'), texto(p, 'task'))
    case 'hallazgo.LEVELING_IMPOSSIBLE.iteraciones-agotadas':
      return t(clave, texto(p, 'resource'), fecha(p, 'date'), numero(p, 'iterations'))

    case 'hallazgo.LEVELING_DELAYED':
      // El retraso viaja en minutos laborables; se dice en días de jornada.
      return t(clave, texto(p, 'task'), Math.round(numero(p, 'delayMinutes') / 480))
    case 'hallazgo.REBALANCE_NO_CANDIDATE':
      return t(clave, texto(p, 'resource'))

    default:
      // Una clave que existe pero que nadie sabe rellenar: el respaldo dice la
      // verdad, y la prueba de exhaustividad avisa de que falta un caso.
      return finding.message
  }
}

/** Qué significa el hallazgo, más allá de lo que ha pasado esta vez. */
export function findingHint(t: Traductor, code: string): string {
  const clave = `hallazgo.que.${code}`
  return hay(clave) ? t(clave) : ''
}

/** «bloqueante», «aviso»… en el idioma activo. */
export function severityLabel(t: Traductor, severity: string): string {
  const clave = `hallazgo.gravedad.${severity}`
  return hay(clave) ? t(clave) : severity
}
