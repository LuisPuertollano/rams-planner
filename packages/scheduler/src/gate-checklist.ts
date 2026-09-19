/**
 * El cuestionario de la puerta, contestado con lo que el plan ya sabe.
 *
 * ## Qué es esto y qué no
 *
 * ADR-0056 contesta «¿llega cada entrega a su puerta?». Esto contesta otra
 * pregunta, que es la que se hace de verdad en la sala: **«¿podemos entrar en
 * esta puerta?»**, y esa se hace consulta a consulta, con una lista que el
 * departamento tiene escrita.
 *
 * La Checkliste no es una lista de entregables —eso lo dice ella misma, y por
 * eso ADR-0056 no declaró ninguna tabla nueva—. Es un cuestionario: 51
 * preguntas, cada una exigida con una fuerza distinta en cada puerta, y cada
 * una con el texto de la prueba que hay que enseñar.
 *
 * ## El reparto que justifica todo esto
 *
 * De las 51 consultas de la hoja de seguridad, **27 nombran un entregable** y
 * 24 no. Ése es el reparto que esta función hace explícito:
 *
 * - Las 27 se pueden **contestar desde el plan**: la herramienta ya sabe si el
 *   FMECA está planificado, en qué versión y si llega a la puerta. Llegan a la
 *   revisión con su respuesta y su fecha puestas.
 * - Las 24 restantes las contesta **una persona**, y saberlo de antemano es lo
 *   que convierte una lista de 51 en una lista de 24.
 *
 * Hoy eso se hace entero a mano, en una hoja donde la puerta se elige en un
 * desplegable y cada fila hace un `VLOOKUP` con el número de columna calculado
 * a mano.
 *
 * ## El nivel decide la gravedad, y eso es dato, no criterio mío
 *
 * `M` es obligatoria, `HR` muy recomendada, `R` recomendada, `C` confirmar. Una
 * `M` sin contestar bloquea la puerta; una `R` no. Hasta ahora todos los avisos
 * de puerta pesaban lo mismo porque nada declaraba la importancia; ahora la
 * declara la Checkliste.
 *
 * No escribe nada y no recalcula: cruza lo declarado con lo que ya calculó el
 * motor.
 */

import type { Finding, FindingSeverity } from '@planner/domain'
import { calendarDate, normalizeGate } from '@planner/domain'
import type { GateEvidence, GateReadinessRow } from './gate-readiness.js'

/** Con cuánta fuerza se exige una consulta en una puerta. */
export const NIVELES = ['M', 'HR', 'R', 'C'] as const
export type NivelDeConsulta = (typeof NIVELES)[number]

/** Una consulta de la Checkliste, con lo que pide en una puerta concreta. */
export interface GateQuery {
  readonly id: string
  readonly discipline: string
  readonly chapter: string
  readonly chapterName: string | null
  readonly code: string
  readonly question: string
  readonly sortKey: number
  /** Lo que esta consulta exige en cada puerta. Donde no aparece, no se pregunta. */
  readonly gates: readonly {
    gate: string
    level: NivelDeConsulta
    proofRequest: string | null
  }[]
  /** Los entregables que la consulta nombra. Vacío en las que contesta una persona. */
  readonly documents: readonly { documentTypeId: string; maturity: string | null }[]
}

/**
 * En qué estado llega una consulta a su puerta.
 *
 * - `cumple`: nombra entregables y **todos** llegan a tiempo. La respuesta ya
 *   está, con su fecha.
 * - `no-cumple`: nombra entregables y alguno llega tarde o no está en el plan.
 * - `sin-saber`: nombra entregables y el plan no da fecha de alguno todavía.
 * - `la-contesta-una-persona`: no nombra ningún entregable. No es un problema:
 *   es media Checkliste, y decirlo por adelantado es el trabajo.
 * - `puerta-sin-fechar`: la Checkliste pregunta esto en una puerta que este
 *   proyecto no tiene declarada. Se dice en vez de callarlo, porque callarlo
 *   es lo que deja una puerta entera fuera del repaso sin que nadie lo note.
 */
export type EstadoDeConsulta =
  | 'cumple'
  | 'no-cumple'
  | 'sin-saber'
  | 'la-contesta-una-persona'
  | 'puerta-sin-fechar'

export interface ConsultaResuelta {
  readonly queryId: string
  readonly chapter: string
  readonly chapterName: string | null
  readonly code: string
  readonly question: string
  readonly level: NivelDeConsulta
  readonly proofRequest: string | null
  readonly state: EstadoDeConsulta
  /** Las entregas que contestan la consulta, con su estado ya resuelto. */
  readonly evidence: readonly GateEvidence[]
  /** Entregables que la consulta nombra y el proyecto no entrega. */
  readonly missing: readonly string[]
}

export interface PuertaResuelta {
  readonly gate: string
  readonly date: string | null
  readonly queries: readonly ConsultaResuelta[]
  readonly totals: TotalesDeConsultas
}

export interface TotalesDeConsultas {
  readonly consultas: number
  readonly cumplen: number
  readonly noCumplen: number
  readonly sinSaber: number
  readonly deUnaPersona: number
  /** De las que no cumplen, cuántas son obligatorias: las que paran la puerta. */
  readonly obligatoriasQueFallan: number
}

export interface GateChecklistResult {
  readonly gates: readonly PuertaResuelta[]
  readonly findings: readonly Finding[]
  readonly totals: TotalesDeConsultas
}

export interface GateChecklistInput {
  readonly queries: readonly GateQuery[]
  /** Lo que ya resolvió `assessGateReadiness`, puerta a puerta. */
  readonly readiness: readonly GateReadinessRow[]
  /** Las puertas que el proyecto ha fechado, para saber cuáles le faltan. */
  readonly gates: readonly { gate: string; date: string }[]
}

const CERO: TotalesDeConsultas = {
  consultas: 0,
  cumplen: 0,
  noCumplen: 0,
  sinSaber: 0,
  deUnaPersona: 0,
  obligatoriasQueFallan: 0,
}

function suma(
  totales: TotalesDeConsultas,
  estado: EstadoDeConsulta,
  nivel: NivelDeConsulta,
): TotalesDeConsultas {
  const falla = estado === 'no-cumple'
  return {
    consultas: totales.consultas + 1,
    cumplen: totales.cumplen + (estado === 'cumple' ? 1 : 0),
    noCumplen: totales.noCumplen + (falla ? 1 : 0),
    sinSaber: totales.sinSaber + (estado === 'sin-saber' ? 1 : 0),
    deUnaPersona: totales.deUnaPersona + (estado === 'la-contesta-una-persona' ? 1 : 0),
    obligatoriasQueFallan: totales.obligatoriasQueFallan + (falla && nivel === 'M' ? 1 : 0),
  }
}

function junta(izquierda: TotalesDeConsultas, derecha: TotalesDeConsultas): TotalesDeConsultas {
  return {
    consultas: izquierda.consultas + derecha.consultas,
    cumplen: izquierda.cumplen + derecha.cumplen,
    noCumplen: izquierda.noCumplen + derecha.noCumplen,
    sinSaber: izquierda.sinSaber + derecha.sinSaber,
    deUnaPersona: izquierda.deUnaPersona + derecha.deUnaPersona,
    obligatoriasQueFallan: izquierda.obligatoriasQueFallan + derecha.obligatoriasQueFallan,
  }
}

/**
 * La gravedad sale del nivel que declara la Checkliste, no de mi criterio.
 *
 * Una `M` sin cumplir es lo que suspende una puerta, así que es un error; una
 * `HR` avisa; una `R` y una `C` informan. Ninguna es bloqueante: bloqueante en
 * este modelo significa «el motor no puede calcular», y aquí sí puede — lo que
 * pasa es que la revisión no pasaría.
 */
const GRAVEDAD: Readonly<Record<NivelDeConsulta, FindingSeverity>> = {
  M: 'error',
  HR: 'warning',
  R: 'info',
  C: 'info',
}

function claveDeEntrega(documentTypeId: string, maturity: string | null): string {
  return `${documentTypeId}|${maturity === null ? '' : maturity.trim().toUpperCase()}`
}

/**
 * Resuelve el cuestionario de cada puerta con lo que el plan ya sabe.
 *
 * Determinista: mismo dato, misma salida e idéntico orden (P2). Las puertas
 * salen por fecha y las que el proyecto no ha fechado al final; dentro de cada
 * una, las consultas en el orden de la hoja, que es el orden en que se leen.
 */
export function answerGateChecklist(input: GateChecklistInput): GateChecklistResult {
  const fechaDePuerta = new Map<string, string>()
  for (const puerta of input.gates) fechaDePuerta.set(normalizeGate(puerta.gate), puerta.date)

  // Las entregas ya resueltas, indexadas por puerta y por (documento, madurez).
  const porPuerta = new Map<string, Map<string, GateEvidence>>()
  for (const fila of input.readiness) {
    const indice = new Map<string, GateEvidence>()
    for (const celda of fila.evidence) {
      indice.set(claveDeEntrega(celda.documentTypeId, celda.maturity), celda)
    }
    porPuerta.set(normalizeGate(fila.gate), indice)
  }

  // Las consultas, agrupadas por la puerta en la que se preguntan.
  const consultasDe = new Map<string, { gate: string; filas: ConsultaResuelta[] }>()
  const findings: Finding[] = []

  const ordenadas = [...input.queries].sort(
    (izquierda, derecha) =>
      izquierda.sortKey - derecha.sortKey || izquierda.code.localeCompare(derecha.code),
  )

  for (const consulta of ordenadas) {
    for (const enPuerta of consulta.gates) {
      const clave = normalizeGate(enPuerta.gate)
      const fecha = fechaDePuerta.get(clave) ?? null
      const entregas = porPuerta.get(clave)

      const evidence: GateEvidence[] = []
      const missing: string[] = []
      for (const nombrado of consulta.documents) {
        const celda = entregas?.get(claveDeEntrega(nombrado.documentTypeId, nombrado.maturity))
        if (celda === undefined) missing.push(nombrado.documentTypeId)
        else evidence.push(celda)
      }

      const estado: EstadoDeConsulta =
        fecha === null
          ? 'puerta-sin-fechar'
          : consulta.documents.length === 0
            ? 'la-contesta-una-persona'
            : missing.length > 0 || evidence.some((celda) => celda.state === 'tarde' || celda.state === 'sin-partir')
              ? 'no-cumple'
              : evidence.some((celda) => celda.state !== 'a-tiempo')
                ? 'sin-saber'
                : 'cumple'

      const fila: ConsultaResuelta = {
        queryId: consulta.id,
        chapter: consulta.chapter,
        chapterName: consulta.chapterName,
        code: consulta.code,
        question: consulta.question,
        level: enPuerta.level,
        proofRequest: enPuerta.proofRequest,
        state: estado,
        evidence,
        missing,
      }

      const ya = consultasDe.get(clave)
      if (ya === undefined) consultasDe.set(clave, { gate: enPuerta.gate, filas: [fila] })
      else ya.filas.push(fila)

      if (estado === 'no-cumple') {
        findings.push({
          severity: GRAVEDAD[enPuerta.level],
          code: 'GATE_QUERY_UNMET',
          entityType: 'gate_query',
          entityId: consulta.id,
          ...(fecha === null ? {} : { occursOn: calendarDate(fecha) }),
          message:
            `La consulta ${consulta.code} de ${enPuerta.gate} (${enPuerta.level}) ` +
            `no se cumple: ${consulta.question}`,
          payload: {
            consulta: consulta.code,
            puerta: enPuerta.gate,
            nivel: enPuerta.level,
            pregunta: consulta.question,
          },
        })
      }
    }
  }

  const gates: PuertaResuelta[] = []
  for (const [clave, fila] of consultasDe) {
    gates.push({
      gate: fila.gate,
      date: fechaDePuerta.get(clave) ?? null,
      queries: fila.filas,
      totals: fila.filas.reduce(
        (acumulado, consulta) => suma(acumulado, consulta.state, consulta.level),
        CERO,
      ),
    })
  }

  gates.sort(
    (izquierda, derecha) =>
      (izquierda.date === null ? 1 : 0) - (derecha.date === null ? 1 : 0) ||
      (izquierda.date ?? '').localeCompare(derecha.date ?? '') ||
      izquierda.gate.localeCompare(derecha.gate),
  )

  return {
    gates,
    findings,
    totals: gates.reduce((acumulado, puerta) => junta(acumulado, puerta.totals), CERO),
  }
}
