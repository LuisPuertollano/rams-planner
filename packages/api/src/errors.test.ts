/**
 * Lo que rechaza PostgreSQL, traducido a un código y una frase.
 *
 * Merece prueba propia porque es la única parte de `errors.ts` con decisiones:
 * el mismo código de PostgreSQL significa cosas distintas según lo que se
 * estuviera escribiendo, y antes eran dos funciones casi iguales en dos
 * ficheros —lo que hacía fácil arreglar una y olvidar la otra.
 */

import { describe, expect, it } from 'vitest'
import { ERROR_CODES, describeDbError } from './errors.js'

/** Un error de `pg` tal como llega: un código y, a veces, la restricción. */
const dePostgres = (code: string, constraint?: string) =>
  constraint === undefined ? { code } : { code, constraint }

describe('los errores de escritura', () => {
  it('el mismo código de PostgreSQL dice cosas distintas según el ámbito', () => {
    // 23503, una referencia que no existe. Al guardar una tarea es cualquier
    // cosa; al guardar una persona es siempre el calendario.
    expect(describeDbError(dePostgres('23503'), 'plan')?.code).toBe('REFERENCIA_PERDIDA')
    expect(describeDbError(dePostgres('23503'), 'equipo')?.code).toBe('CALENDARIO_NO_EXISTE')
    expect(describeDbError(dePostgres('23505'), 'plan')?.code).toBe('REGISTRO_YA_EXISTE')
    expect(describeDbError(dePostgres('23505'), 'equipo')?.code).toBe('RECURSO_YA_EXISTE')
    expect(describeDbError(dePostgres('23514'), 'plan')?.code).toBe('DATOS_FUERA_DE_REGLA')
    expect(describeDbError(dePostgres('23514'), 'equipo')?.code).toBe('FECHAS_FUERA_DE_RANGO')
  })

  it('un duplicado del plan se nombra por su restricción', () => {
    const conCode = (constraint: string) => describeDbError(dePostgres('23505', constraint), 'plan')?.code
    expect(conCode('project_code_key')).toBe('PROYECTO_YA_EXISTE')
    expect(conCode('assignment_node_resource_key')).toBe('ASIGNACION_YA_EXISTE')
    expect(conCode('dependency_pred_succ_key')).toBe('DEPENDENCIA_YA_EXISTE')
    // Sin restricción reconocible, el genérico. Vale más que un volcado.
    expect(conCode('otra_cosa')).toBe('REGISTRO_YA_EXISTE')
  })

  it('un solape distingue la tarifa de la disponibilidad', () => {
    // R1 haciendo su trabajo: son las dos invariantes de exclusión del equipo y
    // la frase tiene que decir cuál, porque se arreglan en pantallas distintas.
    expect(describeDbError(dePostgres('23P01', 'cost_rate_no_overlap'), 'equipo')?.code).toBe('TARIFA_SOLAPADA')
    expect(describeDbError(dePostgres('23P01', 'availability_no_overlap'), 'equipo')?.code).toBe(
      'DISPONIBILIDAD_SOLAPADA',
    )
    // En el plan no hay exclusiones: un 23P01 ahí no es cosa del usuario y sube.
    expect(describeDbError(dePostgres('23P01'), 'plan')).toBeNull()
  })

  it('lo que no es un error del esquema devuelve nulo, para que suba', () => {
    // Nulo significa «esto no lo provocó quien escribió»: quien llama lo
    // relanza en vez de convertirlo en un 422 con una frase inventada.
    expect(describeDbError(new Error('boom'), 'plan')).toBeNull()
    expect(describeDbError(dePostgres('42P01'), 'plan')).toBeNull()
    expect(describeDbError(null, 'plan')).toBeNull()
    expect(describeDbError('un texto', 'equipo')).toBeNull()
  })

  it('todos los códigos que devuelve están en el catálogo', () => {
    // Un código que no esté no lo puede traducir la interfaz, y `check:errores`
    // no lo caza: sólo lee el catálogo, no lo que devuelve esta función.
    const catalogo: readonly string[] = ERROR_CODES
    const casos = [
      ['23503', undefined],
      ['23505', 'project_code_key'],
      ['23505', 'assignment_x'],
      ['23505', 'dependency_x'],
      ['23505', undefined],
      ['23514', undefined],
      ['23P01', 'cost_rate_x'],
      ['23P01', undefined],
    ] as const

    for (const ambito of ['plan', 'equipo'] as const) {
      for (const [code, constraint] of casos) {
        const fallo = describeDbError(dePostgres(code, constraint), ambito)
        if (fallo === null) continue
        expect(catalogo, `${ambito}/${code}`).toContain(fallo.code)
        expect(fallo.mensaje, `${ambito}/${code}`).not.toBe('')
      }
    }
  })

  it('ningún código del catálogo está repetido', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
  })
})
