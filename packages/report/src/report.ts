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
  readonly capacityMinutes: number
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
  readonly message: string
  readonly occursOn: string | null
}

export interface ReportInput {
  readonly runId: string
  readonly period: ReportPeriod
  /** Hoy, para poder decir qué debería estar terminado y no lo está. */
  readonly asOf: string
  readonly projects: readonly ReportProject[]
  readonly tasks: readonly ReportTask[]
  readonly load: readonly ReportLoadCell[]
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
  | 'avance'
  | 'coste'
  | 'sobrecarga'
  | 'riesgo'
  | 'hallazgos'
  | 'sin-fechas'

export interface MonthLine {
  readonly period: string
  readonly plannedMinutes: number
  readonly capacityMinutes: number
  readonly utilizationBp: number | null
  readonly costCents: number
}

export interface ProjectLine {
  readonly projectId: string
  readonly code: string
  readonly name: string
  readonly plannedMinutes: number
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

export interface PersonLine {
  readonly resourceId: string
  readonly code: string
  readonly displayName: string
  readonly plannedMinutes: number
  readonly capacityMinutes: number
  readonly utilizationBp: number | null
  /** El peor mes del periodo y cuánto. Un promedio esconde justo esto. */
  readonly worstPeriod: string | null
  readonly worstUtilizationBp: number | null
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

export interface ReportTotals {
  readonly projectCount: number
  readonly tasksInPeriod: number
  readonly tasksTotal: number
  readonly tasksWithoutDates: number
  readonly plannedMinutes: number
  readonly capacityMinutes: number
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
  readonly tldr: readonly Highlight[]
  readonly totals: ReportTotals
  readonly months: readonly MonthLine[]
  readonly projects: readonly ProjectLine[]
  readonly people: readonly PersonLine[]
  readonly risks: readonly RiskLine[]
  readonly findings: readonly ReportFinding[]
}

const COMPLETO = 10_000

/** Por encima de esto se considera que alguien va pasado del 100 %. */
const SOBRECARGA_BP = 10_000

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

  const personas = input.peopleHidden ? [] : lineasDePersona(input, carga, capacidad, meses)
  const sobrecargadas = personas.filter(
    (p) => p.worstUtilizationBp !== null && p.worstUtilizationBp > SOBRECARGA_BP,
  )
  const peor = sobrecargadas.reduce<PersonLine | null>(
    (mayor, actual) =>
      mayor === null || (actual.worstUtilizationBp ?? 0) > (mayor.worstUtilizationBp ?? 0) ? actual : mayor,
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
    capacityMinutes: totalCapacidad,
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
    tldr: resumen(input, totals, meses, peor, riesgos),
    totals,
    months: lineasDeMes(meses, carga, capacidadPorMes),
    projects: lineasDeProyecto(proyectos, tareas, enPeriodo, carga, riesgos, hallazgos),
    people: personas,
    risks: riesgos,
    findings: hallazgos,
  }
}

// ---------------------------------------------------------------------------
// El resumen
// ---------------------------------------------------------------------------

/**
 * Lo que habría que leer si sólo se leyeran cinco líneas.
 *
 * El orden es fijo —alcance, trabajo, avance, coste, y después lo que va mal—
 * porque un resumen que cambia de forma según los datos no se lee de un
 * vistazo, que es justo para lo que está.
 */
function resumen(
  input: ReportInput,
  totals: ReportTotals,
  meses: ReadonlySet<string>,
  peor: PersonLine | null,
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

  if (totals.overloadedPeople > 0) {
    puntos.push({
      kind: 'sobrecarga',
      severity: (peor?.worstUtilizationBp ?? 0) >= 13_000 ? 'error' : 'warning',
      numbers: {
        people: totals.overloadedPeople,
        worstUtilizationBp: peor?.worstUtilizationBp ?? 0,
      },
      labels: peor === null ? [] : [peor.displayName, peor.worstPeriod ?? ''],
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
  capacidadPorMes: ReadonlyMap<string, number>,
): readonly MonthLine[] {
  const planificado = agrupa(carga, (c) => c.period, (c) => c.plannedMinutes)
  const coste = agrupa(carga, (c) => c.period, (c) => c.costCents)
  return [...meses].sort().map((period) => {
    const plannedMinutes = planificado.get(period) ?? 0
    const capacityMinutes = capacidadPorMes.get(period) ?? 0
    return {
      period,
      plannedMinutes,
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
  riesgos: readonly RiskLine[],
  hallazgos: readonly ReportFinding[],
): readonly ProjectLine[] {
  const planificado = agrupa(carga, (c) => c.projectId, (c) => c.plannedMinutes)
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
  input: ReportInput,
  carga: readonly ReportLoadCell[],
  capacidad: readonly ReportCapacityCell[],
  meses: ReadonlySet<string>,
): readonly PersonLine[] {
  const porCodigo = new Map(input.projects.map((p) => [p.id, p.code]))
  const conTrabajo = new Set(carga.map((c) => c.resourceId))

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
      let worstPeriod: string | null = null
      let worstUtilizationBp: number | null = null
      for (const mes of [...meses].sort()) {
        const suMes = capacidad
          .filter((c) => c.resourceId === recurso.id && c.period === mes)
          .reduce((total, c) => total + c.capacityMinutes, 0)
        if (suMes === 0) continue
        const uso = ratioBp(planificadoPorMes.get(mes) ?? 0, suMes)
        if (worstUtilizationBp === null || uso > worstUtilizationBp) {
          worstUtilizationBp = uso
          worstPeriod = mes
        }
      }

      return {
        resourceId: recurso.id,
        code: recurso.code,
        displayName: recurso.displayName,
        plannedMinutes,
        capacityMinutes,
        utilizationBp: capacityMinutes === 0 ? null : ratioBp(plannedMinutes, capacityMinutes),
        worstPeriod,
        worstUtilizationBp,
        projects: [...new Set(suya.map((c) => porCodigo.get(c.projectId) ?? c.projectId))].sort(),
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
  const porCodigo = new Map(proyectos.map((p) => [p.id, p.code]))
  const riesgos: RiskLine[] = []

  for (const tarea of [...enPeriodo].sort((a, b) => a.path.localeCompare(b.path))) {
    const comun = {
      nodeId: tarea.nodeId,
      projectId: tarea.projectId,
      projectCode: porCodigo.get(tarea.projectId) ?? '',
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

  // Lo peor arriba: primero el tipo, después cuánto.
  const peso: Readonly<Record<RiskKind, number>> = {
    'fecha-limite': 0,
    'holgura-negativa': 1,
    retraso: 2,
  }
  return riesgos.sort((a, b) =>
    peso[a.kind] === peso[b.kind] ? b.amount - a.amount : peso[a.kind] - peso[b.kind],
  )
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
