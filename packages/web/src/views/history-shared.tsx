/**
 * Lo que el registro de cambios y la ficha de una tarea tienen que decir igual.
 *
 * Están en dos pantallas distintas y enseñan lo mismo. Si cada una tradujera
 * los nombres de tabla por su cuenta, acabarían discrepando sobre el mismo
 * cambio, y entonces una de las dos miente.
 */

import type { ChangeEvent } from '../api.js'

/** Los valores son los del enum `audit_operation`, en minúscula. */
export const OPERACION: Readonly<Record<string, string>> = {
  insert: 'alta',
  update: 'cambio',
  delete: 'baja',
  restore: 'restauración',
}

/**
 * Los nombres de tabla, dichos como los diría una persona. Lo que no esté aquí
 * sale con su nombre técnico, que es feo pero no miente.
 */
export const ENTIDAD: Readonly<Record<string, string>> = {
  wbs_node: 'tarea',
  // `wbs_node` es la rama del árbol y `task` lo que lleva dentro —duración,
  // avance, restricciones—. Son dos filas porque son dos tablas, y decirlo
  // distingue «se creó la tarea» de «se le puso duración».
  task: 'datos de una tarea',
  project: 'proyecto',
  assignment: 'asignación',
  dependency: 'dependencia',
  resource: 'persona',
  resource_availability: 'dedicación',
  absence: 'ausencia',
  resource_absence: 'ausencia',
  resource_cost_rate: 'tarifa',
  resource_skill: 'competencia de una persona',
  node_skill_requirement: 'competencia que pide una tarea',
  skill: 'competencia',
  field_value: 'campo personalizado',
  field_definition: 'campo personalizado',
  baseline: 'línea base',
  calendar: 'calendario',
  calendar_exception: 'festivo o excepción del calendario',
  calendar_week_slot: 'jornada semanal de un calendario',
  scenario: 'escenario',
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
  const antes = comoObjeto(event.before)
  const despues = comoObjeto(event.after)

  if (antes === null && despues !== null) {
    return <span className="faint">creado</span>
  }
  if (despues === null) {
    return <span className="faint">dado de baja</span>
  }
  if (antes === null) return <span className="faint">—</span>

  const campos = [...new Set([...Object.keys(antes), ...Object.keys(despues)])]
    // El sello de tiempo cambia en cada escritura y no dice nada.
    .filter((campo) => campo !== 'updated_at' && campo !== 'created_at')
    .filter((campo) => JSON.stringify(antes[campo]) !== JSON.stringify(despues[campo]))

  if (campos.length === 0) return <span className="faint">nada visible</span>

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
