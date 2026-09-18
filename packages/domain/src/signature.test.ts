import { describe, expect, it } from 'vitest'
import { checkSignatureCycle, signatureMinutes, type Signature } from './signature.js'

function firma(
  step: Signature['step'],
  role: string,
  position = 1,
  standardMinutes: number | null = null,
): Signature {
  return { step, role, position, standardMinutes }
}

/** El ciclo del «Plan RAM» tal y como lo trae la tabla 3 del procedimiento. */
const PLAN_RAM: readonly Signature[] = [
  firma('author', 'RAMS Engineer'),
  firma('verifier', 'System Engineer', 1),
  firma('verifier', 'RAMS Manager', 2),
  firma('approver', 'PrEM'),
  firma('reviewer', 'Quality'),
]

describe('checkSignatureCycle', () => {
  it('un ciclo completo y bien repartido no da ningún problema', () => {
    expect(checkSignatureCycle('documento', PLAN_RAM)).toEqual([])
  })

  it('sin ninguna firma no dice nada: está sin rellenar, no mal rellenado', () => {
    expect(checkSignatureCycle('documento', [])).toEqual([])
  })

  it('con firmas pero sin aprobador, avisa', () => {
    const problemas = checkSignatureCycle('documento', [
      firma('author', 'RAMS Engineer'),
      firma('verifier', 'System Engineer'),
    ])
    expect(problemas.map((p) => p.code)).toEqual(['SIGNATURE_NO_APPROVER'])
    expect(problemas[0]?.payload['declared']).toBe(2)
  })

  it('con verificador pero sin autor, avisa: alguien revisa lo que nadie escribe', () => {
    const problemas = checkSignatureCycle('documento', [
      firma('verifier', 'System Engineer'),
      firma('approver', 'PrEM'),
    ])
    expect(problemas.map((p) => p.code)).toEqual(['SIGNATURE_NO_AUTHOR'])
  })

  it('el verificador que es el autor no es independiente', () => {
    const problemas = checkSignatureCycle('documento', [
      firma('author', 'RAMS Engineer'),
      firma('verifier', 'RAMS Engineer'),
      firma('approver', 'PrEM'),
    ])
    expect(problemas.map((p) => p.code)).toEqual(['SIGNATURE_NOT_INDEPENDENT'])
    expect(problemas[0]?.payload['step']).toBe('verifier')
  })

  it('el aprobador que es el autor tampoco: firma su propio trabajo', () => {
    const problemas = checkSignatureCycle('documento', [
      firma('author', 'RAMS Manager'),
      firma('verifier', 'System Engineer'),
      firma('approver', 'RAMS Manager'),
    ])
    expect(problemas.map((p) => p.code)).toEqual(['SIGNATURE_NOT_INDEPENDENT'])
    expect(problemas[0]?.payload['step']).toBe('approver')
  })

  it('«RAMS Engineer 1» y «RAMS Engineer 2» SON independientes: así lo escribe el procedimiento', () => {
    const problemas = checkSignatureCycle('documento', [
      firma('author', 'RAMS Engineer 1'),
      firma('verifier', 'RAMS Engineer 2', 1),
      firma('verifier', 'System Engineer', 2),
      firma('approver', 'PrEM'),
    ])
    expect(problemas).toEqual([])
  })

  it('la independencia ignora mayúsculas y espacios de sobra', () => {
    const problemas = checkSignatureCycle('documento', [
      firma('author', 'RAMS  Engineer'),
      firma('verifier', 'rams engineer'),
      firma('approver', 'PrEM'),
    ])
    expect(problemas.map((p) => p.code)).toEqual(['SIGNATURE_NOT_INDEPENDENT'])
  })

  it('dos verificadores con el mismo rol son una verificación escrita dos veces', () => {
    const problemas = checkSignatureCycle('documento', [
      firma('author', 'RAMS Engineer'),
      firma('verifier', 'System Engineer', 1),
      firma('verifier', 'System Engineer', 2),
      firma('approver', 'PrEM'),
    ])
    expect(problemas.map((p) => p.code)).toEqual(['SIGNATURE_ROLE_REPEATED'])
    expect(problemas[0]?.payload['position']).toBe(2)
  })

  it('el mismo rol como verificador y como revisor no se repite: son pasos distintos', () => {
    const problemas = checkSignatureCycle('documento', [
      firma('author', 'RAMS Engineer'),
      firma('verifier', 'Quality'),
      firma('approver', 'PrEM'),
      firma('reviewer', 'Quality'),
    ])
    expect(problemas).toEqual([])
  })

  it('una fase o un hito con ciclo de firma es una fila mal tipada', () => {
    for (const kind of ['fase', 'hito'] as const) {
      const problemas = checkSignatureCycle(kind, [firma('author', 'RAMS Engineer')])
      expect(problemas.map((p) => p.code)).toEqual(['SIGNATURE_ON_CONTAINER'])
      expect(problemas[0]?.payload['kind']).toBe(kind)
    }
  })

  it('una fase sin firmas no dice nada: es lo normal', () => {
    expect(checkSignatureCycle('fase', [])).toEqual([])
  })

  it('acumula varios problemas y siempre en el mismo orden', () => {
    const roto: readonly Signature[] = [
      firma('verifier', 'System Engineer', 1),
      firma('verifier', 'System Engineer', 2),
    ]
    const primera = checkSignatureCycle('documento', roto)
    const segunda = checkSignatureCycle('documento', [...roto].toReversed())
    expect(primera.map((p) => p.code)).toEqual([
      'SIGNATURE_NO_AUTHOR',
      'SIGNATURE_NO_APPROVER',
      'SIGNATURE_ROLE_REPEATED',
    ])
    // El orden de la entrada no cambia el de la salida (P2).
    expect(segunda.map((p) => p.code)).toEqual(primera.map((p) => p.code))
  })
})

describe('signatureMinutes', () => {
  it('suma lo declarado y trata lo no declarado como cero', () => {
    expect(
      signatureMinutes([
        firma('author', 'RAMS Engineer', 1, 480),
        firma('verifier', 'System Engineer', 1, 120),
        firma('approver', 'PrEM', 1, null),
      ]),
    ).toBe(600)
  })

  it('sin firmas son cero minutos, no un hueco', () => {
    expect(signatureMinutes([])).toBe(0)
  })
})
