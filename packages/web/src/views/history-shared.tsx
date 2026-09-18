/**
 * Lo que el registro de cambios y la ficha de una tarea tienen que decir igual.
 *
 * Están en dos pantallas distintas y enseñan lo mismo. Si cada una tradujera
 * los nombres de tabla por su cuenta, acabarían discrepando sobre el mismo
 * cambio, y entonces una de las dos miente.
 */

import type { ChangeEvent } from '../api.js'
import { existeClave, useT, type Traductor } from '../i18n/index.js'

/**
 * Cómo se dice una operación y una tabla, en el idioma de quien mira.
 *
 * Antes eran dos mapas en castellano aquí mismo. Mismo trato que los hallazgos
 * y los errores: el valor del enum —`insert`, `wbs_node`— es el contrato, y la
 * frase la escribe el diccionario. Lo que no esté traducido sale con su nombre
 * técnico, que es feo pero no miente; y una tabla nueva aparece con el suyo en
 * vez de desaparecer.
 */
export function operacion(t: Traductor['t'], valor: string): string {
  const clave = `registro.operacion.${valor}`
  return existeClave(clave) ? t(clave) : valor.toLowerCase()
}

export function entidad(t: Traductor['t'], tabla: string): string {
  const clave = `registro.entidad.${tabla}`
  return existeClave(clave) ? t(clave) : tabla
}

/**
 * Cosas que nunca tuvieron nombre. Decir de ellas «ya no existe» sería mentir:
 * es que no había nada que enseñar.
 */
export const SIN_NOMBRE = new Set([
  'scenario',
  'calendar_week_slot',
  'calendar_exception',
  'resource_availability',
  'absence',
  'resource_absence',
  'resource_cost_rate',
  'field_definition',
])

/** Sólo los campos que se movieron. Un volcado entero no lo lee nadie. */
export function Cambios({ event }: { readonly event: ChangeEvent }): React.JSX.Element {
  const { t } = useT()
  const antes = comoObjeto(event.before)
  const despues = comoObjeto(event.after)

  if (antes === null && despues !== null) {
    return <span className="faint">{t('registro.creado')}</span>
  }
  if (despues === null) {
    return <span className="faint">{t('registro.baja')}</span>
  }
  if (antes === null) return <span className="faint">—</span>

  const campos = [...new Set([...Object.keys(antes), ...Object.keys(despues)])]
    // El sello de tiempo cambia en cada escritura y no dice nada.
    .filter((campo) => campo !== 'updated_at' && campo !== 'created_at')
    .filter((campo) => JSON.stringify(antes[campo]) !== JSON.stringify(despues[campo]))

  if (campos.length === 0) return <span className="faint">{t('registro.nadaVisible')}</span>

  return (
    <>
      {campos.map((campo) => (
        <div key={campo}>
          <b>{campo}</b>: <span className="muted">{comoTexto(antes[campo])}</span> →{' '}
          {comoTexto(despues[campo])}
        </div>
      ))}
    </>
  )
}

function comoObjeto(valor: unknown): Record<string, unknown> | null {
  return typeof valor === 'object' && valor !== null ? (valor as Record<string, unknown>) : null
}

function comoTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return '—'
  if (typeof valor === 'object') return JSON.stringify(valor)
  return String(valor)
}
