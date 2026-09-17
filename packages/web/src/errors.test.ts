/**
 * Que la frase de cada error se construya bien, en los cuatro idiomas, y que
 * los tres escalones de respaldo funcionen de verdad.
 *
 * Lo que aquí **no** se comprueba es que el catálogo de la API esté cubierto:
 * eso es una regla entre dos paquetes y vive en `tools/`, leyendo los ficheros
 * del disco. La interfaz habla con la API por HTTP, no por tipos.
 */

import { describe, expect, it } from 'vitest'
import { ErrorDeLaApi } from './api.js'
import { errorRows, errorText } from './errors.js'
import { crearTraductor, IDIOMAS } from './i18n/index.js'

const deLaApi = (code: string | null, datos: Record<string, unknown> = {}, mensaje = 'lo que dijo el servidor') =>
  new ErrorDeLaApi(mensaje, code, datos)

describe('los errores de la API hablan cuatro idiomas', () => {
  it('ninguna frase deja un hueco sin rellenar, en ningún idioma', () => {
    // Un `%s` que sobrevive a la traducción es un dato que no llegó.
    const errores = [
      deLaApi('SIN_SESION'),
      deLaApi('SIN_PERMISO', { permiso: 'costes.ver', etiqueta: 'Ver costes', donde: 'toda-la-herramienta' }),
      deLaApi('SIN_PERMISO', { permiso: 'plan.estructura', etiqueta: 'Editar', donde: 'este-proyecto' }),
      deLaApi('SIN_PERMISO', { permiso: 'nivelar', etiqueta: 'Nivelar', donde: 'sin-mas' }),
      deLaApi('FUNCION_SIN_CONFIGURAR'),
      deLaApi('CREDENCIALES_INVALIDAS'),
      deLaApi('FUNCIONES_DESCONOCIDAS', { funciones: ['una.cosa', 'otra.cosa'] }),
      deLaApi('ROL_DE_SISTEMA_NO_SE_EDITA', { rol: 'Superadministración' }),
      deLaApi('CSV_INVALIDO', { detalle: 'falta la columna «duración» en la fila 4', rows: ['fila 4'] }),
      deLaApi('ESCRITURA_RECHAZADA', { detalle: 'duplicate key value violates unique constraint' }),
      deLaApi('PERIODO_INVERTIDO'),
      deLaApi('TARIFA_SOLAPADA'),
    ]

    for (const idioma of IDIOMAS) {
      const { t } = crearTraductor(idioma)
      for (const error of errores) {
        const frase = errorText(t, error, 'error.local.guardar')
        const donde = `${idioma}/${String(error.code)}`
        expect(frase, donde).not.toContain('%s')
        // Y no se ha caído a ninguno de los dos respaldos: eso significaría
        // que falta un caso o una clave.
        expect(frase, donde).not.toBe('lo que dijo el servidor')
        expect(frase, donde).not.toBe(t('error.local.guardar'))
        expect(frase, donde).not.toContain('—')
      }
    }
  })

  it('el permiso que falta se dice con su etiqueta traducida, no con su código', () => {
    const alemán = errorText(
      crearTraductor('de').t,
      deLaApi('SIN_PERMISO', { permiso: 'costes.ver', etiqueta: 'Ver costes y tarifas', donde: 'este-proyecto' }),
      'error.local.guardar',
    )
    expect(alemán).toContain('Kosten und Sätze sehen')
    expect(alemán).not.toContain('costes.ver')
    expect(alemán).not.toContain('Ver costes')
  })

  it('las tres frases de un permiso denegado son tres frases distintas', () => {
    const { t } = crearTraductor('es')
    const frase = (donde: string) =>
      errorText(t, deLaApi('SIN_PERMISO', { permiso: 'nivelar', etiqueta: 'Nivelar', donde }), 'error.local.guardar')
    expect(frase('toda-la-herramienta')).toContain('en toda la herramienta')
    expect(frase('este-proyecto')).toContain('en este proyecto')
    expect(frase('sin-mas')).toBe('Te falta el permiso «Nivelar».')
  })

  it('un permiso que la interfaz no conoce se dice con la etiqueta del servidor', () => {
    const frase = errorText(
      crearTraductor('de').t,
      deLaApi('SIN_PERMISO', { permiso: 'funcion.de.mañana', etiqueta: 'Función de mañana', donde: 'sin-mas' }),
      'error.local.guardar',
    )
    expect(frase).toContain('Función de mañana')
  })

  // --- Los tres escalones del respaldo ---------------------------------------

  it('un código que esta versión no conoce enseña la frase del servidor', () => {
    const frase = errorText(
      crearTraductor('de').t,
      deLaApi('ERROR_DE_UNA_VERSION_MAS_NUEVA', {}, 'lo que dijo el servidor'),
      'error.local.guardar',
    )
    expect(frase).toBe('lo que dijo el servidor')
  })

  it('un error sin código enseña la frase del servidor', () => {
    const frase = errorText(crearTraductor('de').t, deLaApi(null, {}, 'un 502 con texto'), 'error.local.guardar')
    expect(frase).toBe('un 502 con texto')
  })

  it('lo que no viene de la API usa el respaldo traducido, no el texto del navegador', () => {
    // Es lo que importa del tercer escalón: `Failed to fetch` es inglés del
    // navegador y no dice nada a quien mira.
    const { t } = crearTraductor('de')
    expect(errorText(t, new TypeError('Failed to fetch'), 'error.local.guardar')).toBe(
      t('error.local.guardar'),
    )
    expect(errorText(t, 'ni siquiera un error', 'error.local.cargar')).toBe(t('error.local.cargar'))
  })

  // --- Las filas del CSV -----------------------------------------------------

  it('las filas que rechazó la importación llegan a la pantalla', () => {
    expect(errorRows(deLaApi('CSV_INVALIDO', { rows: ['fila 4: sin duración', 'fila 9: código repetido'] }))).toEqual([
      'fila 4: sin duración',
      'fila 9: código repetido',
    ])
  })

  it('sin filas, una lista vacía y no un fallo', () => {
    expect(errorRows(deLaApi('CSV_VACIO'))).toEqual([])
    expect(errorRows(deLaApi('CSV_INVALIDO', { rows: 'no es una lista' }))).toEqual([])
    expect(errorRows(new TypeError('Failed to fetch'))).toEqual([])
  })
})
