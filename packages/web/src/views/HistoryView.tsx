import { useEffect, useMemo, useState } from 'react'
import { fetchRecentChanges, type ChangeEvent, type Project } from '../api.js'
import { dateTime } from '../format.js'
import { errorText } from '../errors.js'
import { useT } from '../i18n/index.js'
import { Cambios, entidad, operacion, SIN_NOMBRE } from './history-shared.js'

interface Props {
  readonly projects: readonly Project[]
}

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
  const { t } = useT()
  const [events, setEvents] = useState<readonly ChangeEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')

  useEffect(() => {
    fetchRecentChanges()
      .then(setEvents)
      .catch((cause: unknown) => {
        setError(errorText(t, cause, 'error.local.registro'))
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
      [event.actorName, event.entityName, event.comment, entidad(t, event.entityType)]
        .filter((campo): campo is string => campo !== null)
        .some((campo) => campo.toLowerCase().includes(texto)),
    )
  }, [events, filtro])

  if (error !== null) return <div className="empty"><h3>{error}</h3></div>
  if (events === null) return <div className="empty"><h3>{t('registro.cargando')}</h3></div>
  if (events.length === 0) {
    return (
      <div className="empty">
        <h3>{t('registro.vacio')}</h3>
        <p style={{ maxWidth: '52ch', margin: '0 auto' }}>{t('registro.vacioDetalle')}</p>
      </div>
    )
  }

  return (
    <>
      <div className="toolbar">
        <input
          className="input"
          placeholder={t('registro.filtrar')}
          value={filtro}
          onChange={(event) => { setFiltro(event.target.value) }}
          style={{ minWidth: 320 }}
        />
        <span className="faint">
          {visibles.length === events.length
            ? t('registro.cuantos', events.length)
            : t('registro.cuantosDe', visibles.length, events.length)}
        </span>
      </div>

      <table className="grid grid--historial">
        <thead>
          <tr>
            <th style={{ minWidth: 150 }}>{t('col.cuando')}</th>
            <th style={{ minWidth: 140 }}>{t('col.quien')}</th>
            <th style={{ minWidth: 90 }}>{t('col.que')}</th>
            <th style={{ minWidth: 220 }}>{t('col.sobre')}</th>
            <th>{t('col.queCambio')}</th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((event) => (
            <tr key={event.id}>
              <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                {dateTime(event.occurredAt)}
              </td>
              <td>
                {event.actorName ?? <span className="faint">{t('registro.sinSesionLargo')}</span>}
              </td>
              <td>
                {operacion(t, event.operation)} {t('registro.de')} {entidad(t, event.entityType)}
              </td>
              <td style={{ whiteSpace: 'normal' }}>
                {event.entityName ?? (
                  <span className="faint">
                    {SIN_NOMBRE.has(event.entityType) ? t('registro.sinNombre') : t('registro.yaNoExiste')}
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
