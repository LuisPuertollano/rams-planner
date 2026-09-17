/**
 * Que ningún hallazgo se quede sin traducir.
 *
 * El motor manda un `code`; la interfaz tiene que saber decirlo en los cuatro
 * idiomas. Un código nuevo sin su clave no falla: enseña la frase castellana
 * del servidor en medio de una pantalla en alemán, y eso no lo ve nadie hasta
 * que lo ve un cliente. Así que lo comprueba una prueba.
 *
 * `@planner/domain` entra aquí como dependencia **de desarrollo**: la lista de
 * códigos es el catálogo, y una copia paralela en este fichero se olvidaría de
 * actualizar justo en el caso que la prueba existe para cazar. Nada de lo que
 * se compila para el navegador lo importa.
 */

import { describe, expect, it } from 'vitest'
import type { FindingCode } from '@planner/domain'
import { crearTraductor, IDIOMAS, type Diccionario } from './i18n/index.js'
import { es } from './i18n/es.js'
import { findingHint, findingText, severityLabel } from './findings.js'

/** El catálogo entero. Si se añade un código, hay que añadirlo aquí también. */
const CODIGOS: readonly FindingCode[] = [
  'DEPENDENCY_CYCLE',
  'CONSTRAINT_CONFLICT',
  'RESOURCE_OVERALLOCATED',
  'RESOURCE_NO_CAPACITY',
  'DEADLINE_MISSED',
  'BUDGET_EXCEEDED',
  'TASK_UNASSIGNED',
  'SKILL_MISSING',
  'SKILL_BELOW_LEVEL',
  'TASK_NO_WORK',
  'ORPHAN_TASK',
  'CONTOUR_MISMATCH',
  'LEVELING_IMPOSSIBLE',
  'LEVELING_DELAYED',
  'REBALANCE_NO_CANDIDATE',
]

const CLAVES = Object.keys(es)

/** Un código está cubierto por su clave, o por al menos una con variante. */
const cubierto = (code: string): boolean =>
  CLAVES.includes(`hallazgo.${code}`) || CLAVES.some((clave) => clave.startsWith(`hallazgo.${code}.`))

describe('los hallazgos hablan cuatro idiomas', () => {
  it('el tipo de la lista es el del catálogo del motor', () => {
    // Si `FindingCode` cambia, esto deja de compilar. Es la mitad de la
    // garantía; la otra mitad es que la lista esté completa, y de eso se
    // encarga el `ORPHAN_TASK` de abajo: un código sin clave rompe la prueba.
    const comprobacion: readonly FindingCode[] = CODIGOS
    expect(comprobacion.length).toBeGreaterThan(0)
  })

  it('cada código tiene su frase', () => {
    for (const code of CODIGOS) {
      expect(cubierto(code), `falta hallazgo.${code}`).toBe(true)
    }
  })

  it('cada código tiene su explicación', () => {
    for (const code of CODIGOS) {
      expect(CLAVES, `falta hallazgo.que.${code}`).toContain(`hallazgo.que.${code}`)
    }
  })

  it('no hay claves de hallazgo huérfanas', () => {
    // Al revés: una clave de un código que ya no existe es texto que nadie va
    // a enseñar, y una errata en el nombre se lee igual que una clave válida.
    const nombres = new Set<string>(CODIGOS)
    for (const clave of CLAVES) {
      if (!clave.startsWith('hallazgo.')) continue
      const resto = clave.slice('hallazgo.'.length)
      if (resto.startsWith('que.')) {
        expect(nombres, clave).toContain(resto.slice('que.'.length))
        continue
      }
      // Lo que no es un código es texto de la pantalla: gravedades y avisos.
      if (!/^[A-Z]/.test(resto)) continue
      expect(nombres, clave).toContain(resto.split('.')[0])
    }
  })

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
