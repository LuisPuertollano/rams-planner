/**
 * Que la frase de cada hallazgo se construya bien, en los cuatro idiomas.
 *
 * Lo que aquí **no** se comprueba es que el catálogo esté cubierto: eso es una
 * regla entre el núcleo y la interfaz, y vive en `tools/`, leyendo los dos
 * ficheros del disco. La alternativa era que la interfaz importara
 * `@planner/domain` para conocer los códigos, y eso obliga a compilar el
 * núcleo antes de pasar el `lint` — que es justo lo que rompió CI la primera
 * vez que lo intenté.
 */

import { describe, expect, it } from 'vitest'
import { crearTraductor, IDIOMAS, type Diccionario } from './i18n/index.js'
import { es } from './i18n/es.js'
import { findingHint, findingText, severityLabel } from './findings.js'

const CLAVES = Object.keys(es)

describe('los hallazgos hablan cuatro idiomas', () => {
  it('ninguna frase deja un hueco sin rellenar, en ningún idioma', () => {
    // Un `%s` que sobrevive a la traducción es un dato que no llegó.
    const hallazgos: readonly { code: string; message: string; payload: Record<string, string | number> }[] = [
      { code: 'DEPENDENCY_CYCLE', message: 'x', payload: { cycle: 'A → B → A' } },
      {
        code: 'CONSTRAINT_CONFLICT',
        message: 'x',
        payload: { variant: 'must_start_on', task: 'T', constraintDate: '2026-04-06', dependencyStart: '2026-04-20' },
      },
      {
        code: 'RESOURCE_OVERALLOCATED',
        message: 'x',
        payload: { resource: 'Ana', days: 3, month: '2026-04', peakDate: '2026-04-17', peakUtilizationBp: 13_300 },
      },
      { code: 'RESOURCE_NO_CAPACITY', message: 'x', payload: { resource: 'Ana' } },
      { code: 'DEADLINE_MISSED', message: 'x', payload: { task: 'T', finish: '2026-05-02', deadline: '2026-04-30' } },
      { code: 'BUDGET_EXCEEDED', message: 'x', payload: { task: 'T', planned: 4_800, standard: 3_840 } },
      { code: 'TASK_UNASSIGNED', message: 'x', payload: { task: 'T' } },
      { code: 'TASK_NO_WORK', message: 'x', payload: { task: 'T', durationMinutes: 960 } },
      { code: 'ORPHAN_TASK', message: 'x', payload: {} },
      { code: 'SKILL_MISSING', message: 'x', payload: { resource: 'Ana', task: 'T', skill: 'FMECA' } },
      {
        code: 'SKILL_BELOW_LEVEL',
        message: 'x',
        payload: { resource: 'Ana', task: 'T', skill: 'FMECA', level: 2, required: 4 },
      },
      { code: 'CONTOUR_MISMATCH', message: 'x', payload: { resource: 'Ana', declared: 600, expected: 480 } },
      {
        code: 'LEVELING_IMPOSSIBLE',
        message: 'x',
        payload: {
          variant: 'no-cabe-en-la-jornada',
          resource: 'Ana',
          first: '2026-04-06',
          last: '2026-04-17',
          days: 4,
          peakDate: '2026-04-10',
          largestSingleMinutes: 720,
          capacityMinutes: 480,
        },
      },
      {
        code: 'LEVELING_IMPOSSIBLE',
        message: 'x',
        payload: { variant: 'iteraciones-agotadas', resource: 'Ana', date: '2026-04-10', iterations: 400 },
      },
      { code: 'LEVELING_DELAYED', message: 'x', payload: { task: 'T', delayMinutes: 1_440 } },
      { code: 'REBALANCE_NO_CANDIDATE', message: 'x', payload: { resource: 'Ana' } },
      {
        code: 'DEPENDENCY_OUT_OF_PLAN',
        message: 'x',
        payload: {
          variant: 'falta-la-predecesora',
          task: 'Revisión',
          other: 'Plan RAMS',
          project: 'VIEJO',
          reason: 'archivado',
        },
      },
      {
        code: 'DEPENDENCY_OUT_OF_PLAN',
        message: 'x',
        payload: {
          variant: 'falta-la-sucesora',
          task: 'Plan RAMS',
          other: 'Revisión',
          project: 'OTRO',
          reason: 'inactivo',
        },
      },
    ]

    for (const idioma of IDIOMAS) {
      const { t } = crearTraductor(idioma)
      for (const hallazgo of hallazgos) {
        const frase = findingText(t, hallazgo)
        expect(frase, `${idioma}/${hallazgo.code}`).not.toContain('%s')
        // Y no se ha caído al respaldo: eso significaría que falta un caso.
        expect(frase, `${idioma}/${hallazgo.code}`).not.toBe('x')
        expect(frase, `${idioma}/${hallazgo.code}`).not.toContain('—')
      }
    }
  })

  it('el motivo de estar fuera del plan se dice en el idioma, no en crudo', () => {
    const enPausa = {
      code: 'DEPENDENCY_OUT_OF_PLAN',
      message: 'x',
      payload: {
        variant: 'falta-la-predecesora',
        task: 'T',
        other: 'O',
        project: 'P',
        reason: 'inactivo',
      },
    }
    expect(findingText(crearTraductor('es').t, enPausa)).toContain('su proyecto está en pausa')
    expect(findingText(crearTraductor('de').t, enPausa)).toContain('das Projekt ist pausiert')
    // Un motivo que el diccionario no conozca sale tal cual, no vacío.
    const raro = { ...enPausa, payload: { ...enPausa.payload, reason: 'vete-a-saber' } }
    expect(findingText(crearTraductor('es').t, raro)).toContain('vete-a-saber')
  })

  it('un código desconocido se cae al respaldo en vez de romperse', () => {
    const { t } = crearTraductor('de')
    const frase = findingText(t, { code: 'CODIGO_DE_HACE_DOS_AÑOS', message: 'lo que dijo el motor' })
    expect(frase).toBe('lo que dijo el motor')
    expect(findingHint(t, 'CODIGO_DE_HACE_DOS_AÑOS')).toBe('')
  })

  it('las gravedades se dicen en el idioma activo', () => {
    expect(severityLabel(crearTraductor('es').t, 'blocking')).toBe('bloqueante')
    expect(severityLabel(crearTraductor('de').t, 'blocking')).toBe('blockierend')
    // Una gravedad que no está en el catálogo sale tal cual, no vacía.
    expect(severityLabel(crearTraductor('de').t, 'raro')).toBe('raro')
  })

  it('«sin capacidad ese día» no se confunde con un cero por ciento', () => {
    const { t } = crearTraductor('es')
    const sinCapacidad = findingText(t, {
      code: 'RESOURCE_OVERALLOCATED',
      message: 'x',
      payload: { resource: 'Ana', days: 1, month: '2026-04', peakDate: '2026-04-17', peakUtilizationBp: -1 },
    })
    expect(sinCapacidad).toContain('sin capacidad ese día')
    expect(sinCapacidad).not.toContain('0 %')
  })

  it('todas las claves de hallazgo son claves del diccionario', () => {
    // Redundante con el tipo, y a propósito: confirma que `es` es el catálogo
    // del que sale `hay()` en `findings.ts`.
    const claves: readonly (keyof Diccionario)[] = ['hallazgo.DEPENDENCY_CYCLE', 'hallazgo.que.DEPENDENCY_CYCLE']
    for (const clave of claves) expect(CLAVES).toContain(clave)
  })
})
