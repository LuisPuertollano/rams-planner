/**
 * El informe: qué está pasando en unos proyectos, en un periodo.
 *
 * Es una función pura. Recibe lo que ya calculó el motor —una ejecución
 * concreta, con su `runId`— y lo resume; no vuelve a calcular nada ni inventa
 * un número que no venga de ahí (P1, P2). Dos informes del mismo `runId` y el
 * mismo periodo son idénticos byte a byte.
 *
 * El resumen **no trae frases hechas**. Cada punto del TLDR sale como un
 * `kind` y sus cifras, y quien lo enseña decide cómo se dice y en qué idioma.
 * Un servidor que devuelve prosa no se puede traducir ni volver a usar.
 */

import type { CommitmentLevel } from '@planner/domain'

export interface ReportPeriod {
  /** Inclusive, AAAA-MM-DD. */
  readonly from: string
  /** Inclusive. */
  readonly to: string
}

export interface ReportProject {
  readonly id: string
  readonly code: string
  readonly name: string
  /** Cuánto de esta demanda hay que servir de verdad. */
  readonly commitment: CommitmentLevel
}

export interface ReportTask {
  readonly nodeId: string
  readonly projectId: string
  /** `phase`, `work_package`, `task` o `milestone`. */
  readonly kind: string
  readonly name: string
  readonly path: string
  readonly scheduledStart: string | null
  readonly scheduledFinish: string | null
  readonly workMinutes: number | null
  readonly percentCompleteBp: number
  readonly totalSlackMinutes: number | null
  readonly isCritical: boolean | null
  readonly deadline: string | null
  readonly assignees: readonly string[]
}

/** Carga ya recortada al periodo por quien la leyó. El mes es `AAAA-MM`. */
export interface ReportLoadCell {
  readonly resourceId: string
  readonly projectId: string
  readonly period: string
  readonly plannedMinutes: number
  readonly costCents: number
}

export interface ReportCapacityCell {
  readonly resourceId: string
  readonly period: string
  /** Lo planificable. */
  readonly capacityMinutes: number
  /** Lo que daba el calendario. La diferencia es lo indirecto y la reserva. */
  readonly grossMinutes: number
}

/**
 * Una hora real, con el mismo corte que una celda de carga planificada.
 *
 * La misma forma a propósito: cruzar dos listas que se parecen es una suma, y
 * cruzar dos que no, un trabajo.
 */
export interface ReportActualCell {
  readonly resourceId: string
  readonly projectId: string
  readonly period: string
  readonly actualMinutes: number
}

export interface ReportResource {
  readonly id: string
  readonly code: string
  readonly displayName: string
}

export interface ReportFinding {
  readonly severity: string
  readonly code: string
  readonly projectId: string | null
  readonly entityName: string | null
  /** La frase del motor, en castellano. Quien lo enseña la traduce del resto. */
  readonly message: string
  readonly occursOn: string | null
  readonly payload?: Readonly<Record<string, string | number | boolean | null>>
}

export interface ReportInput {
  readonly runId: string
  readonly period: ReportPeriod
  /** Hoy, para poder decir qué debería estar terminado y no lo está. */
  readonly asOf: string
  readonly projects: readonly ReportProject[]
  readonly tasks: readonly ReportTask[]
  readonly load: readonly ReportLoadCell[]
  /**
   * Lo que se fichó de verdad. Vacío cuando quien pide el informe no tiene
   * permiso para verlo, o cuando todavía no se ha cargado ningún parte: las
   * dos cosas se distinguen con `actualsHidden`, porque «no puedes verlo» y
   * «no hay nada» son respuestas muy distintas.
   */
  readonly actuals: readonly ReportActualCell[]
  readonly capacity: readonly ReportCapacityCell[]
  readonly resources: readonly ReportResource[]
  readonly findings: readonly ReportFinding[]
  /**
   * Sin permiso de costes los importes llegan a cero. Hay que decirlo: «0 €»
   * se lee como «costó cero», que es otra cosa.
   */
  readonly costsHidden: boolean
  /**
   * Igual con el reparto por persona: sin él no se enseña quién va pasado, y
   * «0 personas sobrecargadas» sería una afirmación que nadie ha comprobado.
   * El informe lo omite y lo dice, en vez de dar un cero por respuesta.
   */
  readonly peopleHidden: boolean
  /** Las horas reales no han llegado: falta el permiso. No es que sean cero. */
  readonly actualsHidden: boolean
}

// ---------------------------------------------------------------------------

export type Severity = 'neutral' | 'warning' | 'error'

/**
 * Un punto del resumen. Sin texto: `kind` dice de qué habla, `numbers` trae
 * las cifras en su unidad de siempre (minutos, puntos básicos, céntimos) y
 * `labels` lo que las acompaña.
 */
export interface Highlight {
  readonly kind: HighlightKind
  readonly severity: Severity
  readonly numbers: Readonly<Record<string, number>>
  readonly labels: readonly string[]
}

export type HighlightKind =
  | 'alcance'
  | 'trabajo'
  | 'realidad'
  | 'trabajo-fuera-de-plan'
  | 'compromiso'
  | 'capacidad-reservada'
  | 'avance'
  | 'coste'
  | 'sobrecarga'
  | 'riesgo'
  | 'hallazgos'
  | 'sin-fechas'

export interface MonthLine {
  readonly period: string
  readonly plannedMinutes: number
  /** Lo fichado ese mes. Cero también cuando no se puede ver: mira `actualsHidden`. */
  readonly actualMinutes: number
  readonly capacityMinutes: number
  readonly utilizationBp: number | null
  readonly costCents: number
}

export interface ProjectLine {
  readonly projectId: string
  readonly code: string
  readonly name: string
  readonly plannedMinutes: number
  /** Lo fichado en este proyecto dentro del periodo. */
  readonly actualMinutes: number
  readonly costCents: number
  /** Tareas con fechas dentro del periodo, y tareas del proyecto entero. */
  readonly tasksInPeriod: number
  readonly tasksTotal: number
  /** Avance ponderado por trabajo declarado, no por número de tareas. */
  readonly percentCompleteBp: number
  readonly start: string | null
  readonly finish: string | null
  readonly criticalTasks: number
  readonly risks: number
  readonly blockingFindings: number
}

/**
 * El peor mes de alguien y cuánto. Van juntos o no van: un mes sin su cifra no
 * dice nada, y una cifra sin su mes tampoco.
 */
export interface WorstMonth {
  readonly period: string
  readonly utilizationBp: number
}

export interface PersonLine {
  readonly resourceId: string
  readonly code: string
  readonly displayName: string
  readonly plannedMinutes: number
  /** Lo que esta persona fichó dentro del periodo. */
  readonly actualMinutes: number
  readonly capacityMinutes: number
  readonly utilizationBp: number | null
  /** El peor mes del periodo. Un promedio esconde justo esto. */
  readonly worst: WorstMonth | null
  /** Códigos de los proyectos en los que trabaja dentro del periodo. */
  readonly projects: readonly string[]
}

/**
 * - `fecha-limite`: termina después de su fecha límite declarada.
 * - `holgura-negativa`: el camino no cabe; ya llega tarde a algo.
 * - `retraso`: debería estar terminada a día de hoy y no lo está.
 */
export type RiskKind = 'fecha-limite' | 'holgura-negativa' | 'retraso'

export interface RiskLine {
  readonly nodeId: string
  readonly projectId: string
  readonly projectCode: string
  readonly path: string
  readonly name: string
  readonly kind: RiskKind
  readonly scheduledFinish: string | null
  readonly deadline: string | null
  readonly percentCompleteBp: number
  /** Cuánto: días de retraso sobre el límite, o minutos de holgura negativa. */
  readonly amount: number
}

/**
 * El trabajo repartido por cuánto hay que servirlo de verdad.
 *
 * Es la cifra que convierte una suma en una decisión: mil horas de las que
 * novecientas están contratadas es un plan; mil de las que cuatrocientas son
 * ofertas es una apuesta, y el total es el mismo número.
 */
export interface CommitmentSplit {
  readonly firme: number
  readonly probable: number
  readonly posible: number
}

export interface ReportTotals {
  readonly projectCount: number
  readonly tasksInPeriod: number
  readonly tasksTotal: number
  readonly tasksWithoutDates: number
  readonly plannedMinutes: number
  /** Los mismos minutos, repartidos por nivel de compromiso del proyecto. */
  readonly plannedByCommitment: CommitmentSplit
  /**
   * Lo fichado dentro del periodo y del alcance.
   *
   * Comparar esto con `plannedMinutes` a secas es un error corriente y conviene
   * decirlo: el plan abarca el periodo entero y las horas sólo llegan hasta
   * donde alguien ha fichado. Para eso está `actualsThrough`.
   */
  readonly actualMinutes: number
  /**
   * El último mes con horas cargadas (`AAAA-MM`), o nulo si no hay ninguna.
   *
   * Es el dato que hace comparable la comparación: sin él, un plan de seis
   * meses frente a dos meses de partes parece un proyecto que va sobradísimo.
   */
  readonly actualsThrough: string | null
  /**
   * Horas fichadas en un proyecto del alcance donde **nadie planificó nada**
   * ese mes.
   *
   * Es la idea que merecía copiarse de PlaTo, que crea sola una línea de plan
   * con el entregable «Unplanned with Actuals» —setecientas nueve de sus tres
   * mil doscientas filas son eso—. Aquí no se crea nada: escribir plan en
   * nombre de nadie rompe P1. Se cuenta y se dice.
   */
  readonly unplannedActualMinutes: number
  readonly capacityMinutes: number
  /**
   * La capacidad antes de descontar lo indirecto y la reserva.
   *
   * Igual a `capacityMinutes` cuando nadie ha declarado factores. La diferencia
   * es lo que el equipo **tiene** y no puede comprometer, y merece salir: sin
   * ella, «vas al 105 %» parece un problema de este mes y no de la cuenta.
   */
  readonly grossCapacityMinutes: number
  readonly utilizationBp: number | null
  readonly costCents: number
  readonly completedTasks: number
  readonly inProgressTasks: number
  readonly notStartedTasks: number
  readonly percentCompleteBp: number
  readonly milestonesInPeriod: number
  readonly criticalTasks: number
  readonly overloadedPeople: number
  readonly blockingFindings: number
  readonly errorFindings: number
  readonly warningFindings: number
}

export interface Report {
  readonly runId: string
  readonly period: ReportPeriod
  readonly asOf: string
  readonly costsHidden: boolean
  readonly peopleHidden: boolean
  /** Las horas reales no han llegado: falta el permiso. No es que sean cero. */
  readonly actualsHidden: boolean
  readonly tldr: readonly Highlight[]
  readonly totals: ReportTotals
  readonly months: readonly MonthLine[]
  readonly projects: readonly ProjectLine[]
  readonly people: readonly PersonLine[]
  readonly risks: readonly RiskLine[]
  readonly findings: readonly ReportFinding[]
}

/** Alguien que va pasado, con su pico. Interno: no sale en la respuesta. */
interface Pico {
  readonly persona: PersonLine
  readonly worst: WorstMonth
}

const COMPLETO = 10_000

/** Por encima de esto se considera que alguien va pasado del 100 %. */
const SOBRECARGA_BP = 10_000

/** Y por encima de esto, el aviso deja de ser amarillo. */
const MUY_PASADO_BP = 13_000

export function buildReport(input: ReportInput): Report {
  const proyectos = [...input.projects].sort((a, b) => a.code.localeCompare(b.code))
  const enAlcance = new Set(proyectos.map((p) => p.id))

  const tareas = input.tasks.filter((t) => enAlcance.has(t.projectId))
  const enPeriodo = tareas.filter((t) => solapa(t, input.period))
  const sinFechas = tareas.filter((t) => t.scheduledStart === null || t.scheduledFinish === null)

  const carga = input.load.filter((c) => enAlcance.has(c.projectId))

  // La capacidad es la de **quien trabaja en estos proyectos**, no la del
  // equipo entero. Con el equipo entero, un informe de un solo proyecto diría
  // «el 1 % de la capacidad», que es cierto y no significa nada. Con esto dice
  // qué parte del tiempo de la gente implicada se lleva, que sí.
  const implicadas = new Set(carga.map((celda) => celda.resourceId))
  const capacidad = input.capacity.filter((celda) => implicadas.has(celda.resourceId))
  const meses = mesesDelPeriodo(carga, capacidad)

  const totalPlanificado = suma(carga, (c) => c.plannedMinutes)
  const totalCoste = suma(carga, (c) => c.costCents)
  const capacidadPorMes = agrupa(capacidad, (c) => c.period, (c) => c.capacityMinutes)
  const totalCapacidad = [...meses].reduce((acumulado, mes) => acumulado + (capacidadPorMes.get(mes) ?? 0), 0)
  const brutoPorMes = agrupa(capacidad, (c) => c.period, (c) => c.grossMinutes)
  const totalBruto = [...meses].reduce((acumulado, mes) => acumulado + (brutoPorMes.get(mes) ?? 0), 0)

  // El compromiso es del proyecto, y la carga sabe de qué proyecto es: basta
  // con cruzarlos. Se cuenta sobre la carga del periodo, no sobre el proyecto
  // entero, porque la pregunta es qué hay que servir **ahora**.
  const compromisoDe = new Map(proyectos.map((p) => [p.id, p.commitment]))
  const porCompromiso = repartoPorCompromiso(carga, compromisoDe)

  // Los reales, recortados al mismo alcance que la carga. Fuera del alcance no
  // son de este informe, igual que no lo es la carga de otro proyecto.
  const reales = input.actuals.filter((celda) => enAlcance.has(celda.projectId))
  const totalReal = suma(reales, (c) => c.actualMinutes)
  const hasta = ultimoMesConHoras(reales)

  // Horas en un mes y un proyecto donde nadie planificó nada. No se crea plan
  // por nadie (P1): se cuenta y se dice.
  const planificadoPorHueco = new Set(carga.map((c) => `${c.projectId}|${c.period}`))
  const fueraDePlan = suma(
    reales.filter((celda) => !planificadoPorHueco.has(`${celda.projectId}|${celda.period}`)),
    (c) => c.actualMinutes,
  )

  const personas = input.peopleHidden
    ? []
    : lineasDePersona(proyectos, carga, reales, capacidad, meses, input)
  const sobrecargadas = personas.flatMap((persona) =>
    persona.worst !== null && persona.worst.utilizationBp > SOBRECARGA_BP
      ? [{ persona, worst: persona.worst }]
      : [],
  )
  const peor = sobrecargadas.reduce<Pico | null>(
    (mayor, actual) => (mayor === null || actual.worst.utilizationBp > mayor.worst.utilizationBp ? actual : mayor),
    null,
  )

  const riesgos = riesgosDe(enPeriodo, proyectos, input.asOf)
  const hallazgos = input.findings.filter((f) => f.projectId === null || enAlcance.has(f.projectId))
  const cuenta = (severidad: string): number => hallazgos.filter((f) => f.severity === severidad).length

  const avance = avancePonderado(enPeriodo)
  const terminadas = enPeriodo.filter((t) => t.percentCompleteBp >= COMPLETO).length
  const enCurso = enPeriodo.filter((t) => t.percentCompleteBp > 0 && t.percentCompleteBp < COMPLETO).length

  const totals: ReportTotals = {
    projectCount: proyectos.length,
    tasksInPeriod: enPeriodo.length,
    tasksTotal: tareas.length,
    tasksWithoutDates: sinFechas.length,
    plannedMinutes: totalPlanificado,
    plannedByCommitment: porCompromiso,
    actualMinutes: totalReal,
    actualsThrough: hasta,
    unplannedActualMinutes: fueraDePlan,
    capacityMinutes: totalCapacidad,
    grossCapacityMinutes: totalBruto,
    utilizationBp: totalCapacidad === 0 ? null : ratioBp(totalPlanificado, totalCapacidad),
    costCents: totalCoste,
    completedTasks: terminadas,
    inProgressTasks: enCurso,
    notStartedTasks: enPeriodo.length - terminadas - enCurso,
    percentCompleteBp: avance,
    milestonesInPeriod: enPeriodo.filter((t) => t.kind === 'milestone').length,
    criticalTasks: enPeriodo.filter((t) => t.isCritical === true).length,
    overloadedPeople: sobrecargadas.length,
    blockingFindings: cuenta('blocking'),
    errorFindings: cuenta('error'),
    warningFindings: cuenta('warning'),
  }

  return {
    runId: input.runId,
    period: input.period,
    asOf: input.asOf,
    costsHidden: input.costsHidden,
    peopleHidden: input.peopleHidden,
    actualsHidden: input.actualsHidden,
    tldr: resumen(input, totals, meses, peor, riesgos),
    totals,
    months: lineasDeMes(meses, carga, reales, capacidadPorMes),
    projects: lineasDeProyecto(proyectos, tareas, enPeriodo, carga, reales, riesgos, hallazgos),
    people: personas,
    risks: riesgos,
    findings: hallazgos,
  }
}

/**
 * Los minutos del periodo, repartidos por compromiso.
 *
 * Una carga cuyo proyecto no esté en el alcance no llega aquí, pero si llegara
 * contaría como `firme`: es lo que el esquema pone por defecto, y callar un
 * trabajo es peor que contarlo de más.
 */
/**
 * El último mes del que hay horas, o nulo.
 *
 * Se devuelve el mes y no el día a propósito: el informe cuenta por meses, y un
 * «hasta el 14 de marzo» invita a comparar medio mes de horas con un mes entero
 * de plan.
 */
function ultimoMesConHoras(reales: readonly ReportActualCell[]): string | null {
  let ultimo: string | null = null
  for (const celda of reales) {
    if (celda.actualMinutes === 0) continue
    if (ultimo === null || celda.period > ultimo) ultimo = celda.period
  }
  return ultimo
}

function repartoPorCompromiso(
  carga: readonly ReportLoadCell[],
  compromisoDe: ReadonlyMap<string, CommitmentLevel>,
): CommitmentSplit {
  const reparto = { firme: 0, probable: 0, posible: 0 }
  for (const celda of carga) {
    reparto[compromisoDe.get(celda.projectId) ?? 'firme'] += celda.plannedMinutes
  }
  return reparto
}

// ---------------------------------------------------------------------------
// El resumen
// ---------------------------------------------------------------------------

/**
 * Lo que habría que leer si sólo se leyeran cinco líneas.
 *
 * El orden es fijo —alcance, trabajo, de qué está hecho ese trabajo, avance,
 * coste, y después lo que va mal— porque un resumen que cambia de forma según
 * los datos no se lee de un vistazo, que es justo para lo que está.
 */
function resumen(
  input: ReportInput,
  totals: ReportTotals,
  meses: ReadonlySet<string>,
  peor: Pico | null,
  riesgos: readonly RiskLine[],
): readonly Highlight[] {
  const puntos: Highlight[] = [
    {
      kind: 'alcance',
      severity: 'neutral',
      numbers: {
        projects: totals.projectCount,
        tasks: totals.tasksInPeriod,
        months: meses.size,
      },
      labels: [],
    },
  ]

  if (totals.plannedMinutes > 0 || totals.capacityMinutes > 0) {
    puntos.push({
      kind: 'trabajo',
      severity:
        totals.utilizationBp !== null && totals.utilizationBp > SOBRECARGA_BP ? 'warning' : 'neutral',
      numbers: {
        plannedMinutes: totals.plannedMinutes,
        capacityMinutes: totals.capacityMinutes,
        ...(totals.utilizationBp === null ? {} : { utilizationBp: totals.utilizationBp }),
      },
      labels: [],
    })
  }

  // Sólo cuando hay algo que no es firme. Decir «el 100 % está contratado» en
  // una instalación que no usa esto sería una línea de ruido en todos los
  // informes, y el resumen está para lo que hay que mirar.
  const noFirme = totals.plannedByCommitment.probable + totals.plannedByCommitment.posible
  if (noFirme > 0) {
    puntos.push({
      kind: 'compromiso',
      // Rojo cuando más de la mitad del trabajo del periodo depende de que
      // entre algo que todavía no ha entrado: el plan ya no describe lo que hay
      // que hacer, describe lo que podría haber que hacer.
      severity: noFirme * 2 > totals.plannedMinutes ? 'error' : 'warning',
      numbers: {
        firmMinutes: totals.plannedByCommitment.firme,
        likelyMinutes: totals.plannedByCommitment.probable,
        possibleMinutes: totals.plannedByCommitment.posible,
        notFirmBp: totals.plannedMinutes === 0 ? 0 : ratioBp(noFirme, totals.plannedMinutes),
      },
      labels: [],
    })
  }

  // Lo que el equipo tiene y no puede comprometer. Sin esto, «vas al 105 %»
  // parece un apuro de este mes en vez de la cuenta que ya no sale.
  if (totals.grossCapacityMinutes > totals.capacityMinutes) {
    const reservado = totals.grossCapacityMinutes - totals.capacityMinutes
    puntos.push({
      kind: 'capacidad-reservada',
      severity: 'neutral',
      numbers: {
        grossMinutes: totals.grossCapacityMinutes,
        plannableMinutes: totals.capacityMinutes,
        reservedMinutes: reservado,
        reservedBp: ratioBp(reservado, totals.grossCapacityMinutes),
      },
      labels: [],
    })
  }

  // Plan frente a realidad. Sólo cuando hay horas cargadas: sin partes, decir
  // «0 h fichadas» sería afirmar algo que nadie ha comprobado.
  if (!input.actualsHidden && totals.actualMinutes > 0) {
    puntos.push({
      kind: 'realidad',
      severity: 'neutral',
      numbers: {
        actualMinutes: totals.actualMinutes,
        plannedMinutes: totals.plannedMinutes,
      },
      // El mes hasta el que hay horas va como etiqueta y no como cifra, porque
      // es lo que hace comparable la comparación: sin él, un plan de seis meses
      // frente a dos de partes parece un proyecto que va sobradísimo.
      labels: totals.actualsThrough === null ? [] : [totals.actualsThrough],
    })
  }

  // Horas en un proyecto y un mes donde nadie planificó nada. Es la idea de
  // PlaTo, que crea sola la línea de plan; aquí no se inventa plan, se avisa.
  if (!input.actualsHidden && totals.unplannedActualMinutes > 0) {
    puntos.push({
      kind: 'trabajo-fuera-de-plan',
      // Amarillo siempre: no es un error, es trabajo que está pasando y que el
      // plan no conoce. Rojo cuando ya es la cuarta parte de lo fichado.
      severity: totals.unplannedActualMinutes * 4 > totals.actualMinutes ? 'error' : 'warning',
      numbers: {
        unplannedMinutes: totals.unplannedActualMinutes,
        actualMinutes: totals.actualMinutes,
        // El denominador no puede ser cero aquí: lo de fuera del plan es un
        // subconjunto de lo fichado y las horas no son negativas (lo garantiza
        // el CHECK de la tabla), así que si hay algo fuera, hay algo.
        shareBp: ratioBp(totals.unplannedActualMinutes, totals.actualMinutes),
      },
      labels: [],
    })
  }

  if (totals.tasksInPeriod > 0) {
    puntos.push({
      kind: 'avance',
      severity: 'neutral',
      numbers: {
        percentCompleteBp: totals.percentCompleteBp,
        completed: totals.completedTasks,
        inProgress: totals.inProgressTasks,
        notStarted: totals.notStartedTasks,
      },
      labels: [],
    })
  }

  if (!input.costsHidden && totals.costCents > 0) {
    puntos.push({ kind: 'coste', severity: 'neutral', numbers: { costCents: totals.costCents }, labels: [] })
  }

  // El guardián es «hay alguien pasado», que es lo mismo que «hay un peor».
  // Contarlo dos veces dejaría un caso imposible que habría que explicar.
  if (peor !== null) {
    puntos.push({
      kind: 'sobrecarga',
      severity: peor.worst.utilizationBp >= MUY_PASADO_BP ? 'error' : 'warning',
      numbers: {
        people: totals.overloadedPeople,
        worstUtilizationBp: peor.worst.utilizationBp,
      },
      labels: [peor.persona.displayName, peor.worst.period],
    })
  }

  if (riesgos.length > 0) {
    const porTipo = (kind: RiskKind): number => riesgos.filter((r) => r.kind === kind).length
    puntos.push({
      kind: 'riesgo',
      severity: porTipo('fecha-limite') > 0 || porTipo('holgura-negativa') > 0 ? 'error' : 'warning',
      numbers: {
        total: riesgos.length,
        deadline: porTipo('fecha-limite'),
        slack: porTipo('holgura-negativa'),
        late: porTipo('retraso'),
      },
      labels: riesgos.slice(0, 3).map((r) => `${r.projectCode} · ${r.name}`),
    })
  }

  if (totals.blockingFindings + totals.errorFindings + totals.warningFindings > 0) {
    puntos.push({
      kind: 'hallazgos',
      severity:
        totals.blockingFindings > 0 ? 'error' : totals.errorFindings > 0 ? 'warning' : 'neutral',
      numbers: {
        blocking: totals.blockingFindings,
        error: totals.errorFindings,
        warning: totals.warningFindings,
      },
      labels: [],
    })
  }

  // Una tarea sin fechas no sale en ningún total del periodo. Callarlo haría
  // que las sumas parecieran completas cuando no lo son.
  if (totals.tasksWithoutDates > 0) {
    puntos.push({
      kind: 'sin-fechas',
      severity: 'warning',
      numbers: { tasks: totals.tasksWithoutDates },
      labels: [],
    })
  }

  return puntos
}

// ---------------------------------------------------------------------------
// Las secciones
// ---------------------------------------------------------------------------

function lineasDeMes(
  meses: ReadonlySet<string>,
  carga: readonly ReportLoadCell[],
  reales: readonly ReportActualCell[],
  capacidadPorMes: ReadonlyMap<string, number>,
): readonly MonthLine[] {
  const planificado = agrupa(carga, (c) => c.period, (c) => c.plannedMinutes)
  const fichado = agrupa(reales, (c) => c.period, (c) => c.actualMinutes)
  const coste = agrupa(carga, (c) => c.period, (c) => c.costCents)
  return [...meses].sort().map((period) => {
    const plannedMinutes = planificado.get(period) ?? 0
    const capacityMinutes = capacidadPorMes.get(period) ?? 0
    return {
      period,
      plannedMinutes,
      actualMinutes: fichado.get(period) ?? 0,
      capacityMinutes,
      utilizationBp: capacityMinutes === 0 ? null : ratioBp(plannedMinutes, capacityMinutes),
      costCents: coste.get(period) ?? 0,
    }
  })
}

function lineasDeProyecto(
  proyectos: readonly ReportProject[],
  tareas: readonly ReportTask[],
  enPeriodo: readonly ReportTask[],
  carga: readonly ReportLoadCell[],
  reales: readonly ReportActualCell[],
  riesgos: readonly RiskLine[],
  hallazgos: readonly ReportFinding[],
): readonly ProjectLine[] {
  const planificado = agrupa(carga, (c) => c.projectId, (c) => c.plannedMinutes)
  const fichado = agrupa(reales, (c) => c.projectId, (c) => c.actualMinutes)
  const coste = agrupa(carga, (c) => c.projectId, (c) => c.costCents)

  return proyectos.map((proyecto) => {
    const suyas = enPeriodo.filter((t) => t.projectId === proyecto.id)
    const todas = tareas.filter((t) => t.projectId === proyecto.id)
    const inicios = todas.map((t) => t.scheduledStart).filter((d): d is string => d !== null)
    const finales = todas.map((t) => t.scheduledFinish).filter((d): d is string => d !== null)
    return {
      projectId: proyecto.id,
      code: proyecto.code,
      name: proyecto.name,
      plannedMinutes: planificado.get(proyecto.id) ?? 0,
      actualMinutes: fichado.get(proyecto.id) ?? 0,
      costCents: coste.get(proyecto.id) ?? 0,
      tasksInPeriod: suyas.length,
      tasksTotal: todas.length,
      percentCompleteBp: avancePonderado(suyas),
      start: inicios.length === 0 ? null : inicios.reduce((a, b) => (a < b ? a : b)),
      finish: finales.length === 0 ? null : finales.reduce((a, b) => (a > b ? a : b)),
      criticalTasks: suyas.filter((t) => t.isCritical === true).length,
      risks: riesgos.filter((r) => r.projectId === proyecto.id).length,
      blockingFindings: hallazgos.filter((f) => f.projectId === proyecto.id && f.severity === 'blocking')
        .length,
    }
  })
}

function lineasDePersona(
  proyectos: readonly ReportProject[],
  carga: readonly ReportLoadCell[],
  reales: readonly ReportActualCell[],
  capacidad: readonly ReportCapacityCell[],
  meses: ReadonlySet<string>,
  input: ReportInput,
): readonly PersonLine[] {
  const fichadoPorPersona = agrupa(reales, (c) => c.resourceId, (c) => c.actualMinutes)
  // Quien tiene carga planificada **o** horas fichadas: alguien que trabajó en
  // esto sin estar planificado es justo a quien hay que enseñar.
  const conTrabajo = new Set([
    ...carga.map((c) => c.resourceId),
    ...reales.map((c) => c.resourceId),
  ])

  const lineas = input.resources
    .filter((recurso) => conTrabajo.has(recurso.id))
    .map((recurso) => {
      const suya = carga.filter((c) => c.resourceId === recurso.id)
      const plannedMinutes = suma(suya, (c) => c.plannedMinutes)
      const capacityMinutes = capacidad
        .filter((c) => c.resourceId === recurso.id && meses.has(c.period))
        .reduce((total, c) => total + c.capacityMinutes, 0)

      // El peor mes, no el promedio: un 200 % en mayo y un 20 % en junio dan
      // un 110 % de media que no le pasa a nadie.
      const planificadoPorMes = agrupa(suya, (c) => c.period, (c) => c.plannedMinutes)
      let worst: WorstMonth | null = null
      for (const period of [...meses].sort()) {
        const suMes = capacidad
          .filter((c) => c.resourceId === recurso.id && c.period === period)
          .reduce((total, c) => total + c.capacityMinutes, 0)
        if (suMes === 0) continue
        const utilizationBp = ratioBp(planificadoPorMes.get(period) ?? 0, suMes)
        if (worst === null || utilizationBp > worst.utilizationBp) worst = { period, utilizationBp }
      }

      return {
        resourceId: recurso.id,
        code: recurso.code,
        displayName: recurso.displayName,
        plannedMinutes,
        actualMinutes: fichadoPorPersona.get(recurso.id) ?? 0,
        capacityMinutes,
        utilizationBp: capacityMinutes === 0 ? null : ratioBp(plannedMinutes, capacityMinutes),
        worst,
        // Se recorre la lista de proyectos, no la carga: así el código sale de
        // donde está declarado y no hace falta un «por si acaso» que no puede
        // pasar. De regalo, vienen ya ordenados.
        projects: proyectos
          .filter((proyecto) => suya.some((celda) => celda.projectId === proyecto.id))
          .map((proyecto) => proyecto.code),
      }
    })

  // Quien más carga lleva, primero; a igualdad, por nombre, para que dos
  // informes iguales salgan iguales.
  return lineas.sort((a, b) =>
    b.plannedMinutes === a.plannedMinutes
      ? a.displayName.localeCompare(b.displayName)
      : b.plannedMinutes - a.plannedMinutes,
  )
}

function riesgosDe(
  enPeriodo: readonly ReportTask[],
  proyectos: readonly ReportProject[],
  asOf: string,
): readonly RiskLine[] {
  const riesgos: RiskLine[] = []

  for (const proyecto of proyectos) {
    for (const tarea of enPeriodo.filter((t) => t.projectId === proyecto.id)) {
      const comun = {
        nodeId: tarea.nodeId,
        projectId: tarea.projectId,
        projectCode: proyecto.code,
        path: tarea.path,
        name: tarea.name,
        scheduledFinish: tarea.scheduledFinish,
        deadline: tarea.deadline,
        percentCompleteBp: tarea.percentCompleteBp,
      }

      if (tarea.deadline !== null && tarea.scheduledFinish !== null && tarea.scheduledFinish > tarea.deadline) {
        riesgos.push({ ...comun, kind: 'fecha-limite', amount: diasEntre(tarea.deadline, tarea.scheduledFinish) })
        continue
      }
      if (tarea.totalSlackMinutes !== null && tarea.totalSlackMinutes < 0) {
        riesgos.push({ ...comun, kind: 'holgura-negativa', amount: -tarea.totalSlackMinutes })
        continue
      }
      if (
        tarea.scheduledFinish !== null &&
        tarea.scheduledFinish < asOf &&
        tarea.percentCompleteBp < COMPLETO
      ) {
        riesgos.push({ ...comun, kind: 'retraso', amount: diasEntre(tarea.scheduledFinish, asOf) })
      }
    }
  }

  // Lo peor arriba: primero el tipo, después cuánto, y a igualdad por ruta,
  // para que dos informes de la misma ejecución salgan idénticos.
  const peso: Readonly<Record<RiskKind, number>> = {
    'fecha-limite': 0,
    'holgura-negativa': 1,
    retraso: 2,
  }
  return riesgos.sort((a, b) => {
    if (peso[a.kind] !== peso[b.kind]) return peso[a.kind] - peso[b.kind]
    if (b.amount !== a.amount) return b.amount - a.amount
    return a.path.localeCompare(b.path)
  })
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function solapa(tarea: ReportTask, periodo: ReportPeriod): boolean {
  if (tarea.scheduledStart === null || tarea.scheduledFinish === null) return false
  return tarea.scheduledStart <= periodo.to && tarea.scheduledFinish >= periodo.from
}

/**
 * Avance ponderado por trabajo declarado.
 *
 * Contar tareas daría que un proyecto con diez fichas de una hora terminadas y
 * una de mil horas sin empezar va al 91 %. Va al 1 %.
 */
function avancePonderado(tareas: readonly ReportTask[]): number {
  let trabajo = 0
  let hecho = 0
  for (const tarea of tareas) {
    const minutos = tarea.workMinutes ?? 0
    if (minutos <= 0) continue
    trabajo += minutos
    hecho += minutos * tarea.percentCompleteBp
  }
  if (trabajo === 0) return 0
  return Math.round(hecho / trabajo)
}

/** Puntos básicos, redondeados al entero: toda la aritmética es entera (P5). */
function ratioBp(parte: number, total: number): number {
  return Math.round((parte * COMPLETO) / total)
}

function suma<T>(filas: readonly T[], valor: (fila: T) => number): number {
  return filas.reduce((total, fila) => total + valor(fila), 0)
}

function agrupa<T>(
  filas: readonly T[],
  clave: (fila: T) => string,
  valor: (fila: T) => number,
): ReadonlyMap<string, number> {
  const mapa = new Map<string, number>()
  for (const fila of filas) mapa.set(clave(fila), (mapa.get(clave(fila)) ?? 0) + valor(fila))
  return mapa
}

/** Los meses que tocan: los que traen trabajo o capacidad dentro del periodo. */
function mesesDelPeriodo(
  carga: readonly ReportLoadCell[],
  capacidad: readonly ReportCapacityCell[],
): ReadonlySet<string> {
  const meses = new Set<string>()
  for (const celda of carga) meses.add(celda.period)
  for (const celda of capacidad) meses.add(celda.period)
  return meses
}

/** Días naturales entre dos fechas AAAA-MM-DD. Sin husos: son fechas, no instantes. */
function diasEntre(desde: string, hasta: string): number {
  const a = Date.UTC(
    Number(desde.slice(0, 4)),
    Number(desde.slice(5, 7)) - 1,
    Number(desde.slice(8, 10)),
  )
  const b = Date.UTC(
    Number(hasta.slice(0, 4)),
    Number(hasta.slice(5, 7)) - 1,
    Number(hasta.slice(8, 10)),
  )
  return Math.round((b - a) / 86_400_000)
}
