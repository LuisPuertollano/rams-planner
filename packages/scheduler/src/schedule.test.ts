import { calendarDate } from '@planner/domain'
import { createDerivationCollector } from '@planner/explain'
import { describe, expect, it } from 'vitest'
import { formatInstant } from './instant.js'
import { schedulePlan } from './schedule.js'
import { PlanBuilder } from './__fixtures__/plan.js'
import type { ScheduleOutput } from './plan.js'

const d = calendarDate

const run = (snapshot: Parameters<typeof schedulePlan>[0]): ScheduleOutput => schedulePlan(snapshot)

const span = (output: ScheduleOutput, nodeId: string): string => {
  const result = output.taskResults.find((item) => item.nodeId === nodeId)
  if (result === undefined) throw new Error(`No hay resultado para ${nodeId}`)
  return `${formatInstant(result.scheduledStart)} → ${formatInstant(result.scheduledFinish)}`
}

const get = (output: ScheduleOutput, nodeId: string) => {
  const result = output.taskResults.find((item) => item.nodeId === nodeId)
  if (result === undefined) throw new Error(`No hay resultado para ${nodeId}`)
  return result
}

describe('cadena simple', () => {
  it('encadena dos tareas de un día con un enlace fin-inicio', () => {
    // El proyecto arranca el lunes 2026-03-02.
    const output = run(new PlanBuilder().task('a').task('b').link('a', 'b').build())
    expect(span(output, 'a')).toBe('2026-03-02 08:00 → 2026-03-02 17:00')
    expect(span(output, 'b')).toBe('2026-03-03 08:00 → 2026-03-03 17:00')
  })

  it('salta el fin de semana', () => {
    const builder = new PlanBuilder()
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) builder.task(id)
    for (const [from, to] of [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e'], ['e', 'f']]) {
      builder.link(from ?? '', to ?? '')
    }
    const output = run(builder.build())
    // Lunes a viernes son a..e; la sexta cae el lunes siguiente.
    expect(span(output, 'e')).toBe('2026-03-06 08:00 → 2026-03-06 17:00')
    expect(span(output, 'f')).toBe('2026-03-09 08:00 → 2026-03-09 17:00')
  })
})

describe('tipos de enlace', () => {
  it('SS alinea los inicios', () => {
    const output = run(new PlanBuilder().task('a', { durationMinutes: 960 }).task('b').link('a', 'b', 'SS').build())
    expect(span(output, 'b')).toBe('2026-03-02 08:00 → 2026-03-02 17:00')
  })

  it('FF alinea los finales', () => {
    const output = run(
      new PlanBuilder().task('a', { durationMinutes: 960 }).task('b', { durationMinutes: 480 }).link('a', 'b', 'FF').build(),
    )
    // a acaba el martes a las 17:00; b dura un día y acaba a la vez.
    expect(span(output, 'a')).toBe('2026-03-02 08:00 → 2026-03-03 17:00')
    expect(span(output, 'b')).toBe('2026-03-03 08:00 → 2026-03-03 17:00')
  })

  it('SF: el sucesor no puede terminar antes de que empiece el predecesor', () => {
    const output = run(
      new PlanBuilder()
        .task('a', { constraintKind: 'start_no_earlier_than', constraintDate: d('2026-03-10') })
        .task('b', { durationMinutes: 480 })
        .link('a', 'b', 'SF')
        .build(),
    )
    // b acaba justo cuando empieza a. Las 17:00 del lunes y las 08:00 del martes
    // son el mismo punto medido en minutos laborables; el motor devuelve la
    // forma de INICIO, que es la que tiene sentido como fecha.
    expect(span(output, 'b')).toBe('2026-03-09 08:00 → 2026-03-09 17:00')
  })

  it('el desfase positivo se mide en minutos laborables', () => {
    const output = run(new PlanBuilder().task('a').task('b').link('a', 'b', 'FS', 480).build())
    // Un día laborable de desfase: b empieza el miércoles, no el martes.
    expect(span(output, 'b')).toBe('2026-03-04 08:00 → 2026-03-04 17:00')
  })

  it('el desfase negativo solapa las tareas', () => {
    const output = run(
      new PlanBuilder().task('a', { durationMinutes: 960 }).task('b').link('a', 'b', 'FS', -480).build(),
    )
    // a acaba el martes 17:00; con -1 día, b empieza el martes.
    expect(span(output, 'b')).toBe('2026-03-03 08:00 → 2026-03-03 17:00')
  })

  it('un desfase negativo que se sale del horizonte no rompe el cálculo', () => {
    const output = run(
      new PlanBuilder().task('a', { durationMinutes: 480 }).task('b').link('a', 'b', 'FS', -960).build(),
    )
    // El candidato cae antes del horizonte; pierde contra el arranque del
    // proyecto, que es lo correcto, en vez de reventar el cálculo.
    expect(span(output, 'b')).toBe('2026-03-02 08:00 → 2026-03-02 17:00')
  })
})

describe('restricciones', () => {
  it('SNET empuja hacia adelante', () => {
    const output = run(
      new PlanBuilder()
        .task('a', { constraintKind: 'start_no_earlier_than', constraintDate: d('2026-03-10') })
        .build(),
    )
    expect(span(output, 'a')).toBe('2026-03-10 08:00 → 2026-03-10 17:00')
  })

  it('FNET retrasa el fin y arrastra el inicio', () => {
    const output = run(
      new PlanBuilder()
        .task('a', { constraintKind: 'finish_no_earlier_than', constraintDate: d('2026-03-10') })
        .build(),
    )
    expect(span(output, 'a')).toBe('2026-03-10 08:00 → 2026-03-10 17:00')
  })

  it('MSO gana sobre la dependencia y deja el conflicto visible', () => {
    const output = run(
      new PlanBuilder()
        .task('a', { durationMinutes: 2400 })
        .task('b', {
          name: 'Montar el Safety Case',
          constraintKind: 'must_start_on',
          constraintDate: d('2026-03-03'),
        })
        .link('a', 'b')
        .build(),
    )
    expect(span(output, 'b')).toBe('2026-03-03 08:00 → 2026-03-03 17:00')
    const conflict = output.findings.find((finding) => finding.code === 'CONSTRAINT_CONFLICT')
    expect(conflict?.severity).toBe('error')
    expect(conflict?.entityId).toBe('b')
    // El hallazgo habla de la tarea por su nombre, no por su identificador: un
    // ««2a7bcc2b-de40…» tiene que empezar el…» no lo lee nadie.
    expect(conflict?.message).toContain('Montar el Safety Case')
    expect(conflict?.message).not.toContain('b»')
    // Y lleva de qué clase de restricción habla, que es lo que distingue las
    // cuatro frases que este código puede decir.
    expect(conflict?.payload?.['variant']).toBe('must_start_on')
    expect(conflict?.payload?.['task']).toBe('Montar el Safety Case')
  })

  it('SNLT y FNLT no mueven nada, sólo avisan', () => {
    const output = run(
      new PlanBuilder()
        .task('a', { durationMinutes: 2400 })
        .task('b', { constraintKind: 'start_no_later_than', constraintDate: d('2026-03-03') })
        .task('c', { constraintKind: 'finish_no_later_than', constraintDate: d('2026-03-03'), durationMinutes: 4800 })
        .link('a', 'b')
        .build(),
    )
    expect(span(output, 'b')).toBe('2026-03-09 08:00 → 2026-03-09 17:00')
    expect(output.findings.filter((finding) => finding.code === 'CONSTRAINT_CONFLICT')).toHaveLength(2)
  })

  it('MFO ancla el final y calcula el inicio hacia atrás', () => {
    const output = run(
      new PlanBuilder()
        .task('a', { constraintKind: 'must_finish_on', constraintDate: d('2026-03-10'), durationMinutes: 960 })
        .build(),
    )
    expect(span(output, 'a')).toBe('2026-03-09 08:00 → 2026-03-10 17:00')
  })

  it('ALAP planifica lo más tarde posible sin retrasar el plan', () => {
    const output = run(
      new PlanBuilder()
        .task('largo', { durationMinutes: 2400 })
        .task('corto', { constraintKind: 'alap' })
        .build(),
    )
    // El plan acaba el viernes; la tarea corta se pega al final.
    expect(span(output, 'largo')).toBe('2026-03-02 08:00 → 2026-03-06 17:00')
    expect(span(output, 'corto')).toBe('2026-03-06 08:00 → 2026-03-06 17:00')
  })

  it('el deadline no mueve nada: sólo genera un hallazgo', () => {
    const output = run(
      new PlanBuilder().task('a', { durationMinutes: 2400, deadline: d('2026-03-03') }).build(),
    )
    expect(span(output, 'a')).toBe('2026-03-02 08:00 → 2026-03-06 17:00')
    const finding = output.findings.find((item) => item.code === 'DEADLINE_MISSED')
    expect(finding?.severity).toBe('warning')
    expect(finding?.occursOn).toBe('2026-03-03')
  })
})

describe('ciclos', () => {
  it('detiene el cálculo y enumera el ciclo completo', () => {
    const output = run(
      new PlanBuilder().task('a').task('b').task('c').link('a', 'b').link('b', 'c').link('c', 'a').build(),
    )
    expect(output.completed).toBe(false)
    expect(output.taskResults).toHaveLength(0)
    const finding = output.findings[0]
    expect(finding?.code).toBe('DEPENDENCY_CYCLE')
    expect(finding?.severity).toBe('blocking')
    expect(String(finding?.payload?.['cycle'])).toContain('→')
  })

  it('detecta también un ciclo de dos nodos', () => {
    const output = run(new PlanBuilder().task('a').task('b').link('a', 'b').link('b', 'a').build())
    expect(output.completed).toBe(false)
  })
})

describe('enlaces fuera del plan', () => {
  it('avisa de la predecesora que falta, y el cálculo sigue', () => {
    // Es el caso de archivar un proyecto del que otro dependía. Antes el enlace
    // se saltaba en silencio y la sucesora se adelantaba sola.
    const output = run(
      new PlanBuilder()
        .task('a')
        .danglingLink('a', { nodeName: 'Revisión de concepto', otherName: 'Plan RAMS', otherProjectCode: 'VIEJO' })
        .build(),
    )

    expect(output.completed).toBe(true)
    const finding = output.findings.find((item) => item.code === 'DEPENDENCY_OUT_OF_PLAN')
    expect(finding?.severity).toBe('warning')
    expect(finding?.entityType).toBe('dependency')
    expect(finding?.payload?.['variant']).toBe('falta-la-predecesora')
    expect(finding?.payload?.['task']).toBe('Revisión de concepto')
    expect(finding?.payload?.['other']).toBe('Plan RAMS')
    expect(finding?.payload?.['project']).toBe('VIEJO')
    expect(finding?.payload?.['reason']).toBe('archivado')
    // La tarea que se nombra es la que sí está en el plan: es la que alguien va
    // a mirar cuando sus fechas cambien.
    expect(finding?.message).toContain('«Revisión de concepto» espera a «Plan RAMS»')
  })

  it('avisa también cuando lo que falta es la sucesora', () => {
    const output = run(
      new PlanBuilder()
        .task('a')
        .danglingLink('a', { missingIsPredecessor: false, reason: 'inactivo' })
        .build(),
    )
    const finding = output.findings.find((item) => item.code === 'DEPENDENCY_OUT_OF_PLAN')
    expect(finding?.payload?.['variant']).toBe('falta-la-sucesora')
    expect(finding?.payload?.['reason']).toBe('inactivo')
    expect(finding?.message).toContain('es predecesora de')
  })

  it('una plantilla se nombra como plantilla, no como proyecto en pausa', () => {
    const output = run(new PlanBuilder().task('a').danglingLink('a', { reason: 'plantilla' }).build())
    const finding = output.findings.find((item) => item.code === 'DEPENDENCY_OUT_OF_PLAN')
    expect(finding?.message).toContain('guardado como plantilla')
  })

  it('sin enlaces sueltos no dice nada', () => {
    const output = run(new PlanBuilder().task('a').task('b').link('a', 'b').build())
    expect(output.findings.filter((item) => item.code === 'DEPENDENCY_OUT_OF_PLAN')).toEqual([])
  })
})

describe('holgura y camino crítico', () => {
  it('la cadena larga es crítica y la corta tiene holgura', () => {
    const output = run(
      new PlanBuilder()
        .task('inicio')
        .task('largo', { durationMinutes: 1440 })
        .task('corto', { durationMinutes: 480 })
        .task('fin')
        .link('inicio', 'largo')
        .link('inicio', 'corto')
        .link('largo', 'fin')
        .link('corto', 'fin')
        .build(),
    )
    expect(get(output, 'largo').isCritical).toBe(true)
    expect(get(output, 'largo').totalSlackMinutes).toBe(0)
    expect(get(output, 'corto').isCritical).toBe(false)
    expect(get(output, 'corto').totalSlackMinutes).toBe(960)
    expect(get(output, 'corto').freeSlackMinutes).toBe(960)
  })

  it('el umbral de criticidad es configurable', () => {
    const snapshot = new PlanBuilder()
      .task('inicio')
      .task('largo', { durationMinutes: 960 })
      .task('corto', { durationMinutes: 480 })
      .task('fin')
      .link('inicio', 'largo')
      .link('inicio', 'corto')
      .link('largo', 'fin')
      .link('corto', 'fin')
      .build()
    expect(schedulePlan(snapshot, { criticalSlackMinutes: 480 }).taskResults.find((r) => r.nodeId === 'corto')?.isCritical).toBe(true)
  })
})

describe('hitos', () => {
  it('un hito no dura nada y hereda la fecha de su predecesor', () => {
    const output = run(new PlanBuilder().task('a').milestone('hito').link('a', 'hito').build())
    const hito = get(output, 'hito')
    expect(hito.durationMinutes).toBe(0)
    expect(hito.workMinutes).toBe(0)
    expect(formatInstant(hito.scheduledStart)).toBe(formatInstant(hito.scheduledFinish))
    expect(span(output, 'hito')).toBe('2026-03-03 08:00 → 2026-03-03 08:00')
  })

  it('un hito con varios predecesores espera al último', () => {
    const output = run(
      new PlanBuilder()
        .task('a', { durationMinutes: 480 })
        .task('b', { durationMinutes: 1440 })
        .milestone('hito')
        .link('a', 'hito')
        .link('b', 'hito')
        .build(),
    )
    expect(span(output, 'hito')).toBe('2026-03-05 08:00 → 2026-03-05 08:00')
  })
})

describe('contenedores', () => {
  it('agrega fechas, trabajo y avance ponderado desde las hojas', () => {
    const output = run(
      new PlanBuilder()
        .container('wp')
        .task('a', { parentId: 'wp', durationMinutes: 480, percentCompleteBp: 10_000 })
        .task('b', { parentId: 'wp', durationMinutes: 1440, percentCompleteBp: 0 })
        .link('a', 'b')
        .resource('ana')
        .assign('a', 'ana')
        .assign('b', 'ana')
        .build(),
    )
    const wp = get(output, 'wp')
    expect(wp.isContainer).toBe(true)
    expect(span(output, 'wp')).toBe('2026-03-02 08:00 → 2026-03-05 17:00')
    expect(wp.workMinutes).toBe(1920)
    // 480 al 100 % y 1440 al 0 % -> 25 %, no 50 %.
    expect(wp.percentCompleteBp).toBe(2500)
  })

  it('un enlace desde un contenedor equivale a un enlace desde cada una de sus hojas', () => {
    const output = run(
      new PlanBuilder()
        .container('wp')
        .task('a', { parentId: 'wp' })
        .task('b', { parentId: 'wp', durationMinutes: 960 })
        .task('siguiente')
        .link('wp', 'siguiente')
        .build(),
    )
    // La última hoja del paquete acaba el martes; «siguiente» arranca el miércoles.
    expect(span(output, 'siguiente')).toBe('2026-03-04 08:00 → 2026-03-04 17:00')
  })

  it('un contenedor vacío no aparece en los resultados', () => {
    const output = run(new PlanBuilder().container('vacio').task('a').build())
    expect(output.taskResults.find((item) => item.nodeId === 'vacio')).toBeUndefined()
  })
})

describe('calendarios distintos', () => {
  it('usa el calendario del único recurso asignado', () => {
    const output = run(
      new PlanBuilder()
        .resource('marc', { calendarId: 'cal-35h' })
        .task('a', { durationMinutes: 840 })
        .assign('a', 'marc')
        .build(),
    )
    expect(get(output, 'a').calendarUsedId).toBe('cal-35h')
    // 840 minutos a 420/día = dos días exactos.
    expect(span(output, 'a')).toBe('2026-03-02 08:00 → 2026-03-03 16:00')
  })

  it('con varios recursos usa el del proyecto', () => {
    const output = run(
      new PlanBuilder()
        .resource('ana')
        .resource('marc', { calendarId: 'cal-35h' })
        .task('a')
        .assign('a', 'ana')
        .assign('a', 'marc')
        .build(),
    )
    expect(get(output, 'a').calendarUsedId).toBe('cal-40h')
  })
})

describe('ecuación de la tarea', () => {
  it('fixed_duration deriva el trabajo de la duración y las unidades', () => {
    const output = run(
      new PlanBuilder().resource('ana').task('a', { durationMinutes: 480 }).assign('a', 'ana', { unitsBp: 5_000 }).build(),
    )
    expect(get(output, 'a').workMinutes).toBe(240)
  })

  it('fixed_work deriva la duración del trabajo, y lo deja explicado', () => {
    const collector = createDerivationCollector()
    const snapshot = new PlanBuilder()
      .resource('ana')
      .resource('marc')
      .task('a', { taskType: 'fixed_work', workDeclaredMinutes: 960, durationMinutes: 960 })
      .assign('a', 'ana')
      .assign('a', 'marc')
      .build()
    const output = schedulePlan(snapshot, { derivations: collector.sink })
    // 960 minutos de trabajo entre dos personas a jornada completa = 480 de duración.
    expect(get(output, 'a').durationMinutes).toBe(480)
    expect(collector.derivations.some((item) => item.rule === 'TASK_EQUATION_FIXED_WORK')).toBe(true)
  })

  it('fixed_units deriva la duración cuando hay trabajo declarado', () => {
    const output = run(
      new PlanBuilder()
        .resource('ana')
        .task('a', { taskType: 'fixed_units', workDeclaredMinutes: 240 })
        .assign('a', 'ana', { unitsBp: 5_000 })
        .build(),
    )
    expect(get(output, 'a').durationMinutes).toBe(480)
  })
})

describe('competencias', () => {
  it('avisa cuando quien hace la tarea no tiene la competencia que pide', () => {
    const output = run(
      new PlanBuilder()
        .resource('ana', { skills: [{ skillId: 'fmeca', level: 4 }] })
        .resource('jan', { skills: [] })
        .task('analisis', { durationMinutes: 480 })
        .requireSkill('analisis', 'fmeca', 3, 'FMECA')
        .assign('analisis', 'ana')
        .assign('analisis', 'jan')
        .build(),
    )

    const faltan = output.findings.filter((finding) => finding.code === 'SKILL_MISSING')
    expect(faltan).toHaveLength(1)
    expect(faltan[0]?.message).toContain('FMECA')
    // Ana la tiene de sobra: el hallazgo es de jan y sólo de jan. Se mira el
    // payload y no el texto, que contiene «análisis» y daría un falso positivo.
    expect(faltan[0]?.payload?.['resource']).toBe('jan')
  })

  it('distingue no tener la competencia de tenerla por debajo del nivel', () => {
    const output = run(
      new PlanBuilder()
        .resource('novato', { skills: [{ skillId: 'sil', level: 1 }] })
        .task('asignacion-sil', { durationMinutes: 480 })
        .requireSkill('asignacion-sil', 'sil', 4, 'Asignación SIL')
        .assign('asignacion-sil', 'novato')
        .build(),
    )

    const codes = output.findings.map((finding) => finding.code)
    expect(codes).toContain('SKILL_BELOW_LEVEL')
    expect(codes).not.toContain('SKILL_MISSING')
    // Formar a alguien es una decisión legítima: informa, no alarma.
    const aviso = output.findings.find((finding) => finding.code === 'SKILL_BELOW_LEVEL')
    expect(aviso?.severity).toBe('info')
    expect(aviso?.message).toContain('nivel 1')
  })

  it('una tarea sin requisitos no genera ningún hallazgo de competencia', () => {
    const output = run(
      new PlanBuilder()
        .resource('cualquiera')
        .task('sin-requisitos', { durationMinutes: 480 })
        .assign('sin-requisitos', 'cualquiera')
        .build(),
    )
    expect(output.findings.filter((finding) => finding.code.startsWith('SKILL_'))).toEqual([])
  })
})

describe('hallazgos informativos', () => {
  it('avisa de tareas sin recurso, sin trabajo y por encima del esfuerzo estándar', () => {
    const output = run(
      new PlanBuilder()
        .resource('ana')
        .task('sin-recurso', { workDeclaredMinutes: 480, taskType: 'fixed_work' })
        .task('sin-trabajo', { taskType: 'fixed_work', workDeclaredMinutes: 0, durationMinutes: 480 })
        .task('pasada', { durationMinutes: 960, standardEffortMinutes: 480 })
        .assign('pasada', 'ana')
        .build(),
    )
    const codes = output.findings.map((finding) => finding.code)
    expect(codes).toContain('TASK_UNASSIGNED')
    expect(codes).toContain('TASK_NO_WORK')
    expect(codes).toContain('BUDGET_EXCEEDED')
  })
})

describe('derivaciones', () => {
  it('cada fecha de inicio explica qué regla la produjo', () => {
    const collector = createDerivationCollector()
    const snapshot = new PlanBuilder().task('a').task('b').link('a', 'b').build()
    schedulePlan(snapshot, { derivations: collector.sink })
    const start = collector.derivations.find(
      (item) => item.targetType === 'task.earlyStart' && item.targetId === 'b',
    )
    expect(start?.rule).toBe('FS_LINK')
    expect(start?.inputs['predecessor']).toBe('a')
    expect(start?.output).toBe('2026-03-03 08:00')
  })

  it('el resultado es idéntico ejecutando dos veces', () => {
    const snapshot = new PlanBuilder().task('a').task('b').task('c').link('a', 'b').link('a', 'c').build()
    expect(JSON.stringify(run(snapshot).taskResults)).toBe(JSON.stringify(run(snapshot).taskResults))
  })
})

describe('planes con varios proyectos', () => {
  it('cada proyecto tiene su propio camino crítico', () => {
    const output = run(
      new PlanBuilder()
        .project({ id: 'p2', code: 'P2' })
        .task('corta-a', { durationMinutes: 480 })
        .task('corta-b', { durationMinutes: 480 })
        .link('corta-a', 'corta-b')
        .task('larga', { projectId: 'p2', durationMinutes: 9600 })
        .build(),
    )
    // Con un fin de referencia global, las tareas del proyecto corto tendrían
    // semanas de holgura sólo porque otro proyecto acaba mucho más tarde.
    expect(get(output, 'corta-a').isCritical).toBe(true)
    expect(get(output, 'corta-b').isCritical).toBe(true)
    expect(get(output, 'corta-a').totalSlackMinutes).toBe(0)
    expect(get(output, 'larga').isCritical).toBe(true)
  })

  it('una rama corta dentro del mismo proyecto sí tiene holgura', () => {
    const output = run(
      new PlanBuilder()
        .task('inicio')
        .task('rama-larga', { durationMinutes: 2400 })
        .task('rama-corta', { durationMinutes: 480 })
        .task('fin')
        .link('inicio', 'rama-larga')
        .link('inicio', 'rama-corta')
        .link('rama-larga', 'fin')
        .link('rama-corta', 'fin')
        .build(),
    )
    expect(get(output, 'rama-larga').isCritical).toBe(true)
    expect(get(output, 'rama-corta').isCritical).toBe(false)
    expect(get(output, 'rama-corta').totalSlackMinutes).toBe(1920)
  })
})
