import { describe, expect, it } from 'vitest'
import {
  activityChain,
  activityMinutes,
  checkActivities,
  firstGate,
  lastGate,
  signatureMinutesCovered,
  type DeclaredSignature,
  type DocumentActivity,
} from './activity.js'

const sub = (
  step: DocumentActivity['step'],
  role: string,
  minutes: number | null = null,
  extra: Partial<DocumentActivity> = {},
): DocumentActivity => ({
  step,
  position: 1,
  role,
  standardMinutes: minutes,
  signature: null,
  ...extra,
})

const codigos = (problemas: readonly { code: string }[]): string[] =>
  problemas.map((p) => p.code).toSorted()

describe('la cadena de subactividades', () => {
  it('lo normal: se crea y después se revisa', () => {
    // 479 de los ~650 entregables del libro son exactamente esto: C y R1.
    const cadena = activityChain([sub('create', 'S-Eng', 2400), sub('review_1', 'TL RAMS', 600)])
    expect(cadena).toEqual([{ from: 'create', fromPosition: 1, to: 'review_1', toPosition: 1 }])
  })

  it('los niveles que faltan no rompen la cadena, se saltan', () => {
    // En el libro hay entregables con C + R3 y sin R2. Un nivel que no existe
    // no puede esperar a nadie.
    const cadena = activityChain([sub('create', 'R-Eng'), sub('review_3', 'ISA')])
    expect(cadena).toEqual([{ from: 'create', fromPosition: 1, to: 'review_3', toPosition: 1 }])
  })

  it('un entregable que sólo revisamos empieza por la revisión', () => {
    // Lo escribe otro departamento; aquí sólo se revisa en segundo nivel.
    const solo = [sub('review_2', 'S-Eng', 240)]
    expect(activityChain(solo)).toEqual([])
    expect(firstGate(solo)?.step).toBe('review_2')
    expect(lastGate(solo)?.step).toBe('review_2')
  })

  it('dos revisores del mismo nivel revisan a la vez, no en fila', () => {
    const cadena = activityChain([
      sub('create', 'S-Eng'),
      sub('review_1', 'TL RAMS'),
      sub('review_1', 'SYS', null, { position: 2 }),
    ])
    expect(cadena).toEqual([
      { from: 'create', fromPosition: 1, to: 'review_1', toPosition: 1 },
      { from: 'create', fromPosition: 1, to: 'review_1', toPosition: 2 },
    ])
  })

  it('el soporte no encadena con nadie', () => {
    const cadena = activityChain([
      sub('create', 'S-Eng'),
      sub('support', 'TL RAMS', 12_000),
      sub('review_1', 'TL RAMS'),
    ])
    expect(cadena).toEqual([{ from: 'create', fromPosition: 1, to: 'review_1', toPosition: 1 }])
  })

  it('un entregable sin nada declarado no tiene cadena ni puertas', () => {
    expect(activityChain([])).toEqual([])
    expect(firstGate([])).toBeUndefined()
    expect(lastGate([])).toBeUndefined()
  })

  it('el orden de entrada no cambia la cadena', () => {
    const desordenado = [sub('review_2', 'SYS'), sub('create', 'S-Eng'), sub('review_1', 'TL RAMS')]
    expect(activityChain(desordenado)).toEqual([
      { from: 'create', fromPosition: 1, to: 'review_1', toPosition: 1 },
      { from: 'review_1', fromPosition: 1, to: 'review_2', toPosition: 1 },
    ])
  })
})

describe('la puerta que cierra el entregable', () => {
  it('es la revisión de nivel más alto, no la creación', () => {
    // Es lo que decide el plan: el siguiente documento espera a que éste esté
    // REVISADO, no a que se haya terminado todo lo suyo.
    const actividades = [
      sub('create', 'S-Eng'),
      sub('review_1', 'TL RAMS'),
      sub('review_2', 'SYS'),
    ]
    expect(lastGate(actividades)?.step).toBe('review_2')
    expect(firstGate(actividades)?.step).toBe('create')
  })

  it('sin revisiones, cierra la creación', () => {
    expect(lastGate([sub('create', 'S-Eng')])?.step).toBe('create')
  })

  it('el soporte no cierra nada, aunque sea lo único que hay', () => {
    expect(lastGate([sub('support', 'TL RAMS', 60_000)])).toBeUndefined()
  })

  it('el soporte tampoco cierra cuando acompaña a una creación', () => {
    const actividades = [sub('create', 'S-Eng'), sub('support', 'TL RAMS', 60_000)]
    expect(lastGate(actividades)?.step).toBe('create')
  })
})

describe('lo que puede estar mal', () => {
  it('un entregable sin subactividades no está mal, está sin rellenar', () => {
    expect(checkActivities('documento', [])).toEqual([])
  })

  it('el caso más común del libro no da ningún aviso', () => {
    // C: S-Eng, R1: S-Eng. Mismo rol, y está bien: lo ocupan varias personas.
    // Si esto avisara, avisaría de casi todo el catálogo.
    expect(
      checkActivities('documento', [sub('create', 'S-Eng', 2400), sub('review_1', 'S-Eng', 600)]),
    ).toEqual([])
  })

  it('una revisión sin creación no es un error', () => {
    expect(checkActivities('documento', [sub('review_2', 'S-Eng', 240)])).toEqual([])
  })

  it('subactividades en una fase o en un hito: la fila está mal tipada', () => {
    const actividades = [sub('create', 'S-Eng')]
    expect(codigos(checkActivities('fase', actividades))).toEqual(['ACTIVITY_ON_CONTAINER'])
    expect(codigos(checkActivities('hito', actividades))).toEqual(['ACTIVITY_ON_CONTAINER'])
    expect(checkActivities('hito', actividades)[0]?.payload).toEqual({ kind: 'hito', count: 1 })
  })

  it('el soporte no firma', () => {
    const problemas = checkActivities('documento', [
      sub('support', 'TL RAMS', 6000, { signature: { step: 'approver', position: 1 } }),
    ])
    expect(codigos(problemas)).toEqual(['ACTIVITY_SUPPORT_SIGNS'])
    expect(problemas[0]?.payload['role']).toBe('TL RAMS')
  })

  it('dos subactividades no pueden descargar la misma firma', () => {
    const firma = { step: 'verifier', position: 1 } as const
    const problemas = checkActivities('documento', [
      sub('review_1', 'TL RAMS', 600, { signature: firma }),
      sub('review_2', 'SYS', 240, { signature: firma }),
    ])
    expect(codigos(problemas)).toEqual(['ACTIVITY_SIGNATURE_TWICE'])
    expect(problemas[0]?.payload['count']).toBe(2)
    expect(problemas[0]?.payload['steps']).toBe('review_1, review_2')
  })

  it('una firma con minutos que nadie hace se queda fuera del plan, y se dice', () => {
    // Es el hueco que ADR-0032 dejó escrito. Sin este aviso, esos 180 minutos
    // no aparecen en la carga de nadie y nadie se entera.
    const firmas: DeclaredSignature[] = [
      { step: 'author', position: 1, standardMinutes: 2400 },
      { step: 'approver', position: 1, standardMinutes: 180 },
    ]
    const problemas = checkActivities(
      'documento',
      [sub('create', 'S-Eng', 2400, { signature: { step: 'author', position: 1 } })],
      firmas,
    )
    expect(codigos(problemas)).toEqual(['ACTIVITY_SIGNATURE_ORPHAN'])
    expect(problemas[0]?.payload).toEqual({
      signatureStep: 'approver',
      signaturePosition: 1,
      minutes: 180,
    })
  })

  it('una firma sin minutos declarados no se avisa: no se pierde nada', () => {
    const firmas: DeclaredSignature[] = [
      { step: 'approver', position: 1, standardMinutes: null },
      { step: 'reviewer', position: 1, standardMinutes: 0 },
    ]
    expect(checkActivities('documento', [sub('create', 'S-Eng', 2400)], firmas)).toEqual([])
  })

  it('el mismo catálogo da siempre la misma lista, en el mismo orden', () => {
    const firmas: DeclaredSignature[] = [
      { step: 'verifier', position: 2, standardMinutes: 60 },
      { step: 'approver', position: 1, standardMinutes: 180 },
      { step: 'verifier', position: 1, standardMinutes: 60 },
    ]
    const uno = checkActivities('documento', [sub('create', 'S-Eng', 2400)], firmas)
    const otro = checkActivities('documento', [sub('create', 'S-Eng', 2400)], firmas.toReversed())
    expect(uno).toEqual(otro)
    expect(uno.map((p) => [p.payload['signatureStep'], p.payload['signaturePosition']])).toEqual([
      ['approver', 1],
      ['verifier', 1],
      ['verifier', 2],
    ])
  })
})

describe('lo que cuesta un entregable', () => {
  it('suma lo declarado y no inventa lo que falta', () => {
    expect(
      activityMinutes([sub('create', 'S-Eng', 2400), sub('review_1', 'TL RAMS', null)]),
    ).toBe(2400)
  })

  it('la proporción del libro: 40 h creando, 10 h revisando', () => {
    const actividades = [sub('create', 'S-Eng', 2400), sub('review_1', 'TL RAMS', 600)]
    expect(activityMinutes(actividades)).toBe(3000)
  })

  it('dice cuántos de esos minutos son ya de firma, para no contarlos dos veces', () => {
    const actividades = [
      sub('create', 'S-Eng', 2400, { signature: { step: 'author', position: 1 } }),
      sub('review_1', 'TL RAMS', 600, { signature: { step: 'verifier', position: 1 } }),
      sub('support', 'TL RAMS', 6000),
    ]
    expect(activityMinutes(actividades)).toBe(9000)
    expect(signatureMinutesCovered(actividades)).toBe(3000)
  })

  it('sin nada declarado, cuesta cero y no falla', () => {
    expect(activityMinutes([])).toBe(0)
    expect(signatureMinutesCovered([])).toBe(0)
  })
})
