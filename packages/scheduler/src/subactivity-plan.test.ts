import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  planSubactivities,
  repartir,
  type CatalogueActivity,
  type SplitTask,
  type SubactivityPlanInput,
} from './subactivity-plan.js'

const DOC = 'doc-fmeca'

const tarea = (over: Partial<SplitTask> = {}): SplitTask => ({
  nodeId: 'n1',
  name: 'Redactar el FMECA',
  path: '001.01',
  kind: 'task',
  workDeclaredMinutes: 2400,
  durationMinutes: 0,
  hasActuals: false,
  alreadyExpanded: false,
  isSubactivity: false,
  ...over,
})

const paso = (
  step: CatalogueActivity['step'],
  role: string,
  minutes: number | null,
  position = 1,
): CatalogueActivity => ({ documentTypeId: DOC, step, position, role, standardMinutes: minutes })

/** El caso normal del libro: crear y revisar, cuatro a uno. */
const CATALOGO = [paso('create', 'S-Eng', 2400), paso('review_1', 'TL RAMS', 600)]

const entrada = (over: Partial<SubactivityPlanInput> = {}): SubactivityPlanInput => ({
  tasks: [tarea()],
  deliveries: [{ nodeId: 'n1', documentTypeId: DOC }],
  activities: CATALOGO,
  assignments: [],
  links: [],
  ...over,
})

const motivos = (r: ReturnType<typeof planSubactivities>): string[] =>
  r.skipped.map((s) => s.reason)

describe('repartir minutos en la proporción del catálogo', () => {
  it('cuatro a uno: 40 h salen 32 y 8', () => {
    expect(repartir(2400, [2400, 600])).toEqual([1920, 480])
  })

  it('el resto no se pierde: va al escalón más grande', () => {
    // 10 entre 3 y 1 da 7,5 y 2,5. Sin cuidado saldrían 7 y 2 y faltaría 1.
    expect(repartir(10, [3, 1])).toEqual([8, 2])
    expect(repartir(10, [3, 1]).reduce((a, b) => a + b, 0)).toBe(10)
  })

  it('un peso de cero no se lleva nada', () => {
    expect(repartir(100, [1, 0, 1])).toEqual([50, 0, 50])
  })

  it('sin pesos o sin total, todo a cero y sin dividir por cero', () => {
    expect(repartir(100, [0, 0])).toEqual([0, 0])
    expect(repartir(0, [3, 1])).toEqual([0, 0])
  })

  it('el reparto es el mismo siempre, con los mismos números', () => {
    expect(repartir(7, [1, 1, 1])).toEqual(repartir(7, [1, 1, 1]))
    expect(repartir(7, [1, 1, 1])).toEqual([3, 2, 2])
  })

  it('para cualquier total y cualquier peso, la suma es exacta', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 6 }),
        (total, pesos) => {
          const trozos = repartir(total, pesos)
          const suma = trozos.reduce((a, b) => a + b, 0)
          const hayPeso = pesos.some((p) => p > 0)
          expect(suma).toBe(hayPeso ? total : 0)
          expect(trozos.every((t) => t >= 0)).toBe(true)
          expect(trozos).toHaveLength(pesos.length)
        },
      ),
    )
  })
})

describe('partir una tarea en su cadena', () => {
  it('el caso normal: crear y revisar, con las horas repartidas', () => {
    const r = planSubactivities(entrada())
    expect(r.skipped).toEqual([])
    expect(r.split).toHaveLength(1)
    const propuesta = r.split[0]
    expect(propuesta?.children.map((h) => [h.step, h.role, h.minutes])).toEqual([
      ['create', 'S-Eng', 1920],
      ['review_1', 'TL RAMS', 480],
    ])
  })

  it('el total del proyecto no se mueve ni un minuto', () => {
    // Es la decisión que más se nota: la proporción sale del catálogo, los
    // minutos salen de la estimación que ya había. Partir no re-estima.
    const r = planSubactivities(entrada())
    expect(r.totals.minutesAfter).toBe(r.totals.minutesBefore)
    expect(r.totals.minutesBefore).toBe(2400)
  })

  it('la cadena ata crear con revisar, y en ese orden', () => {
    const r = planSubactivities(entrada())
    expect(r.split[0]?.chain).toEqual([[0, 1]])
  })

  it('el soporte nace, cuesta, y no entra en la cadena', () => {
    const r = planSubactivities(
      entrada({ activities: [...CATALOGO, paso('support', 'TL RAMS', 600)] }),
    )
    const propuesta = r.split[0]
    expect(propuesta?.children.map((h) => h.step)).toEqual(['create', 'review_1', 'support'])
    // Tres trozos que suman el total, y la cadena sigue siendo de dos eslabones.
    expect(propuesta?.children.reduce((a, h) => a + h.minutes, 0)).toBe(2400)
    expect(propuesta?.chain).toEqual([[0, 1]])
    expect(propuesta?.children[2]?.isGate).toBe(false)
  })

  it('la puerta que cierra es la última revisión, no la creación', () => {
    // Es lo que hace que el siguiente documento empiece antes: espera a que
    // éste esté REVISADO, no a que termine todo lo suyo.
    const r = planSubactivities(
      entrada({ activities: [...CATALOGO, paso('review_2', 'SYS', 240)] }),
    )
    const hijos = r.split[0]?.children ?? []
    expect(hijos.find((h) => h.isEntry)?.step).toBe('create')
    expect(hijos.find((h) => h.isGate)?.step).toBe('review_2')
  })

  it('un entregable que sólo se revisa entra por la revisión', () => {
    const r = planSubactivities(
      entrada({ activities: [paso('review_2', 'S-Eng', 240), paso('support', 'SYS', 360)] }),
    )
    const hijos = r.split[0]?.children ?? []
    expect(hijos.find((h) => h.isEntry)?.step).toBe('review_2')
    expect(hijos.find((h) => h.isGate)?.step).toBe('review_2')
  })

  it('las dependencias se re-enganchan a las puertas, no al contenedor', () => {
    const r = planSubactivities(
      entrada({
        links: [
          { id: 'd1', predecessorNodeId: 'otro', successorNodeId: 'n1' },
          { id: 'd2', predecessorNodeId: 'n1', successorNodeId: 'siguiente' },
        ],
      }),
    )
    expect(r.split[0]?.relinked).toEqual([
      { dependencyId: 'd1', side: 'entrada', toOrder: 0 },
      { dependencyId: 'd2', side: 'salida', toOrder: 1 },
    ])
  })

  it('las personas asignadas se mudan a la entrada y no se inventan las demás', () => {
    const r = planSubactivities(
      entrada({ assignments: [{ nodeId: 'n1', resourceId: 'ana' }] }),
    )
    const propuesta = r.split[0]
    expect(propuesta?.movedResourceIds).toEqual(['ana'])
    expect(propuesta?.children.map((h) => h.takesAssignments)).toEqual([true, false])
  })

  it('la cuenta de tareas cuadra', () => {
    const r = planSubactivities(entrada())
    expect(r.totals.tasksBefore).toBe(1)
    expect(r.totals.tasksAfter).toBe(2)
  })
})

describe('lo que no se parte, y por qué', () => {
  it('un hito es un instante', () => {
    expect(motivos(planSubactivities(entrada({ tasks: [tarea({ kind: 'milestone' })] })))).toEqual([
      'no-es-tarea',
    ])
  })

  it('un contenedor ya agrega', () => {
    expect(motivos(planSubactivities(entrada({ tasks: [tarea({ kind: 'work_package' })] })))).toEqual([
      'no-es-tarea',
    ])
  })

  it('una tarea con horas fichadas NO se reestructura', () => {
    // La razón es concreta: `actual_entry` apunta al nodo, y convertirlo en
    // contenedor dejaría esas horas donde el informe por tarea ya no mira.
    // Desaparecerían sin avisar, que es lo único que no se puede hacer.
    expect(motivos(planSubactivities(entrada({ tasks: [tarea({ hasActuals: true })] })))).toEqual([
      'con-horas-reales',
    ])
  })

  it('una tarea que ya se partió no se vuelve a partir', () => {
    expect(
      motivos(planSubactivities(entrada({ tasks: [tarea({ alreadyExpanded: true })] }))),
    ).toEqual(['ya-partida'])
  })

  it('una subactividad no se parte en subactividades de su propio entregable', () => {
    // Sin esto la cosa no tiene fondo: la puerta que cierra hereda el
    // entregable, así que «Revisar 1» se propondría partir en su propio
    // «Crear» y «Revisar 1», y ésos otra vez. Lo cazó la prueba de que
    // aplicar dos veces no hace nada.
    expect(
      motivos(planSubactivities(entrada({ tasks: [tarea({ isSubactivity: true })] }))),
    ).toEqual(['es-subactividad'])
  })

  it('sin entregable no hay catálogo del que sacar la cadena', () => {
    expect(motivos(planSubactivities(entrada({ deliveries: [] })))).toEqual(['sin-entregable'])
  })

  it('con dos entregables, cuál manda no lo decide la herramienta', () => {
    const r = planSubactivities(
      entrada({
        deliveries: [
          { nodeId: 'n1', documentTypeId: DOC },
          { nodeId: 'n1', documentTypeId: 'doc-sc' },
        ],
      }),
    )
    expect(motivos(r)).toEqual(['varios-entregables'])
    expect(r.skipped[0]?.count).toBe(2)
  })

  it('partir en un trozo es no partir', () => {
    expect(motivos(planSubactivities(entrada({ activities: [paso('create', 'S-Eng', 2400)] })))).toEqual(
      ['sin-subactividades'],
    )
    expect(motivos(planSubactivities(entrada({ activities: [] })))).toEqual(['sin-subactividades'])
  })

  it('sin minutos en el catálogo no hay proporción, y no se inventa una', () => {
    // Repartir a partes iguales sería la herramienta estimando por su cuenta.
    const r = planSubactivities(
      entrada({ activities: [paso('create', 'S-Eng', null), paso('review_1', 'TL RAMS', null)] }),
    )
    expect(motivos(r)).toEqual(['catalogo-sin-minutos'])
  })

  it('una tarea que no declara ni trabajo ni duración no tiene nada que repartir', () => {
    expect(
      motivos(
        planSubactivities(entrada({ tasks: [tarea({ workDeclaredMinutes: 0, durationMinutes: 0 })] })),
      ),
    ).toEqual(['sin-tamano'])
  })

  it('una tarea que sólo declara DURACIÓN sí se parte, y se reparte la duración', () => {
    // Lo encontró mirar la pantalla: en este modelo lo normal es
    // `fixed_duration`, y mirar sólo el trabajo declarado dejaba sin partir
    // prácticamente todo un plan de verdad.
    const r = planSubactivities(
      entrada({ tasks: [tarea({ workDeclaredMinutes: 0, durationMinutes: 4800 })] }),
    )
    expect(r.skipped).toEqual([])
    expect(r.split[0]?.magnitude).toBe('duracion')
    expect(r.split[0]?.children.map((h) => h.minutes)).toEqual([3840, 960])
    expect(r.totals.minutesAfter).toBe(r.totals.minutesBefore)
    expect(r.totals.minutesBefore).toBe(4800)
  })

  it('con trabajo declarado manda el trabajo, no la duración', () => {
    const r = planSubactivities(
      entrada({ tasks: [tarea({ workDeclaredMinutes: 2400, durationMinutes: 99_999 })] }),
    )
    expect(r.split[0]?.magnitude).toBe('trabajo')
    expect(r.totals.minutesBefore).toBe(2400)
  })

  it('el orden de los descartes es el del plan, no el de la entrada', () => {
    const r = planSubactivities(
      entrada({
        tasks: [
          tarea({ nodeId: 'c', path: '003', kind: 'milestone' }),
          tarea({ nodeId: 'a', path: '001', hasActuals: true }),
          tarea({ nodeId: 'b', path: '002', alreadyExpanded: true }),
        ],
        deliveries: [],
      }),
    )
    expect(r.skipped.map((s) => s.path)).toEqual(['001', '002', '003'])
  })
})

describe('varias tareas a la vez', () => {
  it('se parten las que se pueden y se dice de las demás', () => {
    const r = planSubactivities(
      entrada({
        tasks: [
          tarea({ nodeId: 'n1', path: '001' }),
          tarea({ nodeId: 'n2', path: '002', workDeclaredMinutes: 1000 }),
          tarea({ nodeId: 'n3', path: '003', hasActuals: true }),
        ],
        deliveries: [
          { nodeId: 'n1', documentTypeId: DOC },
          { nodeId: 'n2', documentTypeId: DOC },
          { nodeId: 'n3', documentTypeId: DOC },
        ],
      }),
    )
    expect(r.split.map((p) => p.nodeId)).toEqual(['n1', 'n2'])
    expect(motivos(r)).toEqual(['con-horas-reales'])
    // Se mide sobre lo que se parte: 2400 + 1000. La tercera no se toca.
    expect(r.totals.minutesAfter).toBe(r.totals.minutesBefore)
    expect(r.totals.minutesBefore).toBe(3400)
    expect(r.totals.tasksBefore).toBe(3)
    expect(r.totals.tasksAfter).toBe(5)
  })
})
