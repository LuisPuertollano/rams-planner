import { useEffect, useMemo, useState } from 'react'
import { fetchRecentChanges, type ChangeEvent, type Project } from '../api.js'

interface Props {
  readonly projects: readonly Project[]
}

/** Los valores son los del enum `audit_operation`, en minúscula. */
const OPERACION: Readonly<Record<string, string>> = {
  insert: 'alta',
  update: 'cambio',
  delete: 'baja',
  restore: 'restauración',
}

/**
 * Los nombres de tabla, dichos como los diría una persona. Lo que no esté aquí
 * sale con su nombre técnico, que es feo pero no miente.
 */
const ENTIDAD: Readonly<Record<string, string>> = {
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
const SIN_NOMBRE = new Set([
  'scenario',
  'calendar_week_slot',
  'calendar_exception',
  'resource_availability',
  'absence',
  'resource_absence',
  'resource_cost_rate',
  'field_definition',
])

/**
 * El registro de cambios: quién tocó qué y cuándo.
 *
 * Lo que hace útil esta pantalla no es la lista, es la columna de **qué
 * cambió**: un «cambio en Tarea 3.2» no le sirve a nadie, y «duración: 480 →
 * 960» sí. Por eso se compara el antes con el después y sólo se enseñan los
 * campos que de verdad se movieron.
 *
 * Las filas sin autor no son un fallo: son los cambios de la CLI y los
 * anteriores a que hubiera login. Se dicen tal cual en vez de inventar un
 * nombre.
 */
export function HistoryView({ projects }: Props): React.JSX.Element {
  const [events, setEvents] = useState<readonly ChangeEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')

  useEffect(() => {
    fetchRecentChanges()
      .then(setEvents)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'No se pudo leer el registro')
      })
  }, [])

  const codigoDeProyecto = useMemo(
    () => new Map(projects.map((project) => [project.id, project.code])),
    [projects],
  )

  const visibles = useMemo(() => {
    if (events === null) return []
    const texto = filtro.trim().toLowerCase()
    if (texto === '') return events
    return events.filter((event) =>
      [event.actorName, event.entityName, event.comment, ENTIDAD[event.entityType] ?? event.entityType]
        .filter((campo): campo is string => campo !== null)
        .some((campo) => campo.toLowerCase().includes(texto)),
    )
  }, [events, filtro])

  if (error !== null) return <div className="empty"><h3>{error}</h3></div>
  if (events === null) return <div className="empty"><h3>Cargando el registro…</h3></div>
  if (events.length === 0) {
    return (
      <div className="empty">
        <h3>Todavía no hay nada registrado</h3>
        <p style={{ maxWidth: '52ch', margin: '0 auto' }}>
          El registro se escribe solo con cada cambio. En cuanto alguien edite una tarea, mueva una
          asignación o dé de alta a una persona, aparecerá aquí con su nombre.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="toolbar">
        <input
          className="input"
          placeholder="Filtrar por persona, tarea o comentario"
          value={filtro}
          onChange={(event) => { setFiltro(event.target.value) }}
          style={{ minWidth: 320 }}
        />
        <span className="faint">
          {visibles.length === events.length
            ? `${events.length} cambios, del más reciente al más antiguo`
            : `${visibles.length} de ${events.length} cambios`}
        </span>
      </div>

      <table className="grid grid--historial">
        <thead>
          <tr>
            <th style={{ minWidth: 150 }}>Cuándo</th>
            <th style={{ minWidth: 140 }}>Quién</th>
            <th style={{ minWidth: 90 }}>Qué</th>
            <th style={{ minWidth: 220 }}>Sobre</th>
            <th>Qué cambió</th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((event) => (
            <tr key={event.id}>
              <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                {new Date(event.occurredAt).toLocaleString('es-ES', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </td>
              <td>
                {event.actorName ?? <span className="faint">sin sesión (CLI o importación)</span>}
              </td>
              <td>
                {OPERACION[event.operation] ?? event.operation.toLowerCase()} de{' '}
                {ENTIDAD[event.entityType] ?? event.entityType}
              </td>
              <td style={{ whiteSpace: 'normal' }}>
                {event.entityName ?? (
                  <span className="faint">
                    {SIN_NOMBRE.has(event.entityType) ? 'sin nombre propio' : 'ya no existe'}
                  </span>
                )}
                {event.projectId === null ? null : (
                  <span className="tag" style={{ marginLeft: 6 }}>
                    {codigoDeProyecto.get(event.projectId) ?? '?'}
                  </span>
                )}
                {event.comment === null || event.comment === '' ? null : (
                  <div className="funcion__detalle">«{event.comment}»</div>
                )}
              </td>
              <td style={{ textAlign: 'left', whiteSpace: 'normal' }}>
                <Cambios event={event} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

/** Sólo los campos que se movieron. Un volcado entero no lo lee nadie. */
function Cambios({ event }: { readonly event: ChangeEvent }): React.JSX.Element {
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
