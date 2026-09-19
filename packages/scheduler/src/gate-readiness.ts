/**
 * La puerta exige un conjunto, y el plan dice si llega.
 *
 * ## Por qué hace falta, si la fecha objetivo ya existe
 *
 * ADR-0042 puso la mitad del asunto: la puerta de un entregable le pone fecha
 * objetivo a la tarea que lo entrega, y el motor avisa con `DEADLINE_MISSED`
 * cuando el plan no llega. Eso mira **desde la tarea**: cada entrega sabe su
 * día. Lo que no existía es mirar **desde la puerta**, que es como lo mira una
 * revisión de certificación y como está escrita la Checkliste: «para entrar en
 * PGR tienen que estar estos documentos, en esta madurez».
 *
 * La diferencia no es de presentación. Mirando desde la tarea hay tres cosas
 * que no se pueden ver, y son justo las que una puerta suspende:
 *
 * 1. **Lo que falta.** Una entrega que nadie ha planificado no es una tarea que
 *    llega tarde: es una tarea que no está. No puede generar `DEADLINE_MISSED`
 *    porque no hay nada a lo que ponerle la fecha.
 * 2. **El conjunto.** Que doce entregas lleguen a PGR y una no, decide la
 *    puerta entera. Doce avisos sueltos en una lista de cuatrocientos no lo
 *    dicen.
 * 3. **La fecha objetivo puede no estar puesta.** `applyGateDeadlines` escribe
 *    sólo las tareas que alguien dejó marcadas (ADR-0042). Una entrega sin
 *    objetivo aplicado no avisa de nada, aunque su puerta sea el martes. Aquí
 *    se compara contra la fecha de la puerta directamente, sin depender de que
 *    nadie haya pulsado un botón.
 *
 * ## Qué se declara y qué se deriva (P1)
 *
 * **Nada nuevo se declara.** El conjunto que una puerta exige ya está dicho en
 * dos sitios: `document_gate` trae las entregas previas de cada documento —con
 * su puerta y su madurez, que es literalmente una fila de Checkliste— y
 * `document_type.gate` trae la final. Esta función recibe esas filas ya unidas
 * («las expectativas») y las cruza con lo que el plan tiene.
 *
 * Esto es deliberado y es la mitad barata de la opción C: declarar la
 * Checkliste en una tabla aparte, hoy, sería declarar por segunda vez lo que el
 * catálogo ya dice, y dos declaraciones de lo mismo divergen. Lo que la
 * Checkliste sí traerá y aquí no hay es **qué es obligatorio y qué es prueba
 * opcional**, y documentos que la puerta exige y el catálogo no coloca. Ese día
 * cambia de dónde salen las expectativas; esta función no se entera.
 *
 * ## El recorte que evita cuatrocientos avisos falsos
 *
 * Las expectativas son del catálogo, que es del departamento entero: 88
 * documentos. Un proyecto planifica los suyos. Sin recortar, cada proyecto
 * saldría con decenas de «te falta» que sólo dicen que ese documento no es de
 * este proyecto.
 *
 * Se recorta a **los documentos que este proyecto planifica**: si el plan
 * entrega el FMECA, la puerta puede exigir sus entregas; si no lo entrega, esa
 * fila no es de este proyecto y no se dice nada. Es una regla conservadora a
 * propósito —calla de más, no de menos— y se cae sola cuando llegue la
 * Checkliste, que sí sabe qué documentos aplican a qué proyecto.
 *
 * Como todo lo de esta capa: no escribe nada, devuelve lo que ve.
 */

import {
  addDays,
  calendarDate,
  daysBetween,
  normalizeGate,
  type CalendarDate,
  type Finding,
} from '@planner/domain'

/**
 * Una casilla de la Checkliste: esta puerta espera esta versión de este
 * documento.
 *
 * `maturity` es `null` en la entrega final, con el mismo criterio que
 * `node_delivery.maturity`: la final no tiene nombre de madurez porque es el
 * documento.
 */
export interface GateExpectation {
  readonly gate: string
  readonly documentTypeId: string
  readonly maturity: string | null
  readonly weeksBeforeGate: number | null
}

/** Una entrega que el plan sí tiene, con lo que el motor le calculó. */
export interface PlannedDelivery {
  readonly nodeId: string
  readonly name: string
  readonly path: string
  readonly documentTypeId: string
  /** `null` cuando la tarea entrega el documento sin partir: es la final. */
  readonly maturity: string | null
  /** AAAA-MM-DD, o `null` si esta ejecución no le dio fin. */
  readonly scheduledFinish: string | null
  readonly percentCompleteBp: number
}

/** El catálogo, en lo justo para poder nombrar una fila. */
export interface ReadinessDocument {
  readonly documentTypeId: string
  readonly code: string
  readonly name: string
}

export interface GateReadinessInput {
  /** Las puertas fechadas del proyecto. */
  readonly gates: readonly { gate: string; date: string }[]
  /** Lo que cada puerta exige, ya unido desde el catálogo. */
  readonly expectations: readonly GateExpectation[]
  readonly planned: readonly PlannedDelivery[]
  readonly documents: readonly ReadinessDocument[]
  /** Los documentos que este proyecto entrega. Fuera de aquí no se opina. */
  readonly documentsInPlan: readonly string[]
}

/**
 * En qué estado llega una entrega a su puerta.
 *
 * - `a-tiempo`: está planificada y termina el día límite o antes.
 * - `tarde`: está planificada y termina después. `daysLate` dice por cuánto.
 * - `sin-fecha`: está en el plan y esta ejecución no le calculó fin. No es que
 *   llegue mal: es que todavía no se sabe, y decir «a tiempo» sería inventar.
 * - `sin-partir`: el proyecto entrega el documento, pero no ESTA versión suya.
 *   La Checkliste pide el preliminar en PGR y el plan sólo tiene la final: la
 *   tarea no se ha partido en sus entregas (ADR-0047).
 * - `sin-fecha-de-puerta`: el proyecto no ha fechado la puerta. No se puede
 *   comparar con nada, y se dice en vez de dar por buena la entrega.
 */
export type GateEvidenceState =
  | 'a-tiempo'
  | 'tarde'
  | 'sin-fecha'
  | 'sin-partir'
  | 'sin-fecha-de-puerta'

/** Una fila de la puerta: qué se espera y cómo va. */
export interface GateEvidence {
  readonly documentTypeId: string
  readonly documentCode: string
  readonly documentName: string
  readonly maturity: string | null
  readonly state: GateEvidenceState
  /** El día en que tiene que estar: la puerta menos las semanas. */
  readonly dueOn: string | null
  /** Las semanas usadas. Cero es «el día de la puerta», como en ADR-0042. */
  readonly weeks: number | null
  readonly nodeId: string | null
  readonly taskName: string | null
  readonly finish: string | null
  /** Días de calendario entre el límite y el fin, cuando llega tarde. */
  readonly daysLate: number | null
  readonly percentCompleteBp: number | null
}

export interface GateReadinessRow {
  readonly gate: string
  /** `null` cuando el proyecto no la ha fechado. */
  readonly date: string | null
  readonly evidence: readonly GateEvidence[]
  readonly totals: GateTotals
}

export interface GateTotals {
  readonly esperadas: number
  readonly aTiempo: number
  readonly tarde: number
  readonly sinPartir: number
  readonly sinFecha: number
  readonly sinFechaDePuerta: number
}

export interface GateReadinessResult {
  /** Una fila por puerta que exige algo, por fecha y luego por nombre. */
  readonly gates: readonly GateReadinessRow[]
  readonly findings: readonly Finding[]
  readonly totals: GateTotals
}

const DIAS_POR_SEMANA = 7

/**
 * La madurez se escribe a mano en la Checkliste y en el catálogo, y «as
 * Designed» y «as designed» son la misma. Se comparan normalizadas por el
 * mismo motivo que las puertas, y la fila enseña el texto tal cual se escribió.
 */
function comoMadurez(maturity: string | null): string {
  return maturity === null ? '' : maturity.trim().toUpperCase()
}

function claveDe(documentTypeId: string, maturity: string | null): string {
  return `${documentTypeId}|${comoMadurez(maturity)}`
}

const CERO: GateTotals = {
  esperadas: 0,
  aTiempo: 0,
  tarde: 0,
  sinPartir: 0,
  sinFecha: 0,
  sinFechaDePuerta: 0,
}

function suma(totales: GateTotals, estado: GateEvidenceState): GateTotals {
  return {
    esperadas: totales.esperadas + 1,
    aTiempo: totales.aTiempo + (estado === 'a-tiempo' ? 1 : 0),
    tarde: totales.tarde + (estado === 'tarde' ? 1 : 0),
    sinPartir: totales.sinPartir + (estado === 'sin-partir' ? 1 : 0),
    sinFecha: totales.sinFecha + (estado === 'sin-fecha' ? 1 : 0),
    sinFechaDePuerta: totales.sinFechaDePuerta + (estado === 'sin-fecha-de-puerta' ? 1 : 0),
  }
}

function junta(izquierda: GateTotals, derecha: GateTotals): GateTotals {
  return {
    esperadas: izquierda.esperadas + derecha.esperadas,
    aTiempo: izquierda.aTiempo + derecha.aTiempo,
    tarde: izquierda.tarde + derecha.tarde,
    sinPartir: izquierda.sinPartir + derecha.sinPartir,
    sinFecha: izquierda.sinFecha + derecha.sinFecha,
    sinFechaDePuerta: izquierda.sinFechaDePuerta + derecha.sinFechaDePuerta,
  }
}

/** El día en que la entrega tiene que estar: la puerta menos las semanas. */
function limiteDe(gateDate: string, weeks: number): CalendarDate {
  return addDays(calendarDate(gateDate), -weeks * DIAS_POR_SEMANA)
}

/**
 * Cómo llega cada puerta del proyecto, fila a fila.
 *
 * Determinista y sin estado: la misma entrada da la misma salida, incluido el
 * orden (P2). Las puertas salen por fecha y las que no tienen, al final por
 * nombre; dentro de cada puerta, las filas por código de documento y luego por
 * madurez, que es como se lee una Checkliste.
 */
export function assessGateReadiness(input: GateReadinessInput): GateReadinessResult {
  const fechaDePuerta = new Map<string, string>()
  for (const puerta of input.gates) fechaDePuerta.set(normalizeGate(puerta.gate), puerta.date)

  const porDocumento = new Map<string, ReadinessDocument>()
  for (const documento of input.documents) porDocumento.set(documento.documentTypeId, documento)

  const enPlan = new Set(input.documentsInPlan)

  // Una entrega por (documento, madurez). Si el plan trae dos tareas para la
  // misma casilla —dos versiones preliminares del mismo informe—, manda la que
  // termina más tarde: la puerta la cierra la última, no la primera.
  const entregaPorClave = new Map<string, PlannedDelivery>()
  for (const entrega of input.planned) {
    const clave = claveDe(entrega.documentTypeId, entrega.maturity)
    const ya = entregaPorClave.get(clave)
    if (ya === undefined) {
      entregaPorClave.set(clave, entrega)
      continue
    }
    const anterior = ya.scheduledFinish
    const nueva = entrega.scheduledFinish
    // Sin fin no se puede comparar, y una entrega sin fecha no puede desbancar
    // a una que sí la tiene: se queda la que más dice.
    if (nueva !== null && (anterior === null || nueva > anterior)) {
      entregaPorClave.set(clave, entrega)
    }
  }

  const porPuerta = new Map<string, { gate: string; evidence: GateEvidence[] }>()
  const findings: Finding[] = []

  for (const esperada of input.expectations) {
    if (!enPlan.has(esperada.documentTypeId)) continue
    const documento = porDocumento.get(esperada.documentTypeId)
    if (documento === undefined) continue

    const puerta = normalizeGate(esperada.gate)
    const fecha = fechaDePuerta.get(puerta) ?? null
    const semanas = esperada.weeksBeforeGate ?? 0
    const limite = fecha === null ? null : limiteDe(fecha, semanas)
    const entrega = entregaPorClave.get(claveDe(esperada.documentTypeId, esperada.maturity)) ?? null

    const estado: GateEvidenceState =
      entrega === null
        ? 'sin-partir'
        : limite === null
          ? 'sin-fecha-de-puerta'
          : entrega.scheduledFinish === null
            ? 'sin-fecha'
            : entrega.scheduledFinish > limite
              ? 'tarde'
              : 'a-tiempo'

    const tarde =
      estado === 'tarde' && limite !== null && entrega?.scheduledFinish != null
        ? daysBetween(limite, calendarDate(entrega.scheduledFinish))
        : null

    const fila: GateEvidence = {
      documentTypeId: esperada.documentTypeId,
      documentCode: documento.code,
      documentName: documento.name,
      maturity: esperada.maturity,
      state: estado,
      dueOn: limite,
      weeks: fecha === null ? null : semanas,
      nodeId: entrega?.nodeId ?? null,
      taskName: entrega?.name ?? null,
      finish: entrega?.scheduledFinish ?? null,
      daysLate: tarde,
      percentCompleteBp: entrega?.percentCompleteBp ?? null,
    }

    const ya = porPuerta.get(puerta)
    if (ya === undefined) porPuerta.set(puerta, { gate: esperada.gate, evidence: [fila] })
    else ya.evidence.push(fila)

    // El hallazgo lleva los nombres ya resueltos, nunca un identificador donde
    // el lector espera un nombre: es el contrato de `FindingPayload`.
    const comoSeLlama = esperada.maturity === null ? documento.code : `${documento.code} · ${esperada.maturity}`
    if (estado === 'tarde' && limite !== null) {
      findings.push({
        severity: 'warning',
        code: 'GATE_EVIDENCE_LATE',
        entityType: 'document',
        entityId: esperada.documentTypeId,
        occursOn: limite,
        message:
          `«${comoSeLlama}» tiene que estar el ${limite} para la puerta ${esperada.gate}, ` +
          `y el plan lo termina el ${String(fila.finish)}: ${String(tarde)} día(s) tarde.`,
        payload: {
          documento: comoSeLlama,
          puerta: esperada.gate,
          limite,
          fin: fila.finish,
          dias: tarde,
        },
      })
    }
    if (estado === 'sin-partir') {
      findings.push({
        severity: 'warning',
        code: 'GATE_EVIDENCE_MISSING',
        entityType: 'document',
        entityId: esperada.documentTypeId,
        ...(limite === null ? {} : { occursOn: limite }),
        message:
          `La puerta ${esperada.gate} espera «${comoSeLlama}» y el plan no lo tiene: ` +
          `el proyecto entrega ${documento.code}, pero no esa versión.`,
        payload: {
          documento: comoSeLlama,
          puerta: esperada.gate,
          entregable: documento.code,
          madurez: esperada.maturity,
        },
      })
    }
  }

  const gates: GateReadinessRow[] = []
  for (const [clave, fila] of porPuerta) {
    const evidence = [...fila.evidence].sort(
      (izquierda, derecha) =>
        izquierda.documentCode.localeCompare(derecha.documentCode) ||
        (izquierda.maturity ?? '').localeCompare(derecha.maturity ?? ''),
    )
    gates.push({
      gate: fila.gate,
      date: fechaDePuerta.get(clave) ?? null,
      evidence,
      totals: evidence.reduce((acumulado, celda) => suma(acumulado, celda.state), CERO),
    })
  }

  // Sin fecha no hay sitio en la línea del tiempo: van al final, por nombre.
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
