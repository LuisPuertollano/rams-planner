import { useEffect, useState } from 'react'
import { fetchEntityHistory, type ChangeEvent } from '../api.js'
import { dateTime } from '../format.js'
import { useT } from '../i18n/index.js'
import { Cambios, operacion } from '../views/history-shared.js'

interface Props {
  readonly entityId: string
  /** Cuántos cambios enseñar. Los demás están en la pestaña Registro. */
  readonly limit?: number
}

/**
 * Los últimos cambios de una cosa, donde se edita esa cosa.
 *
 * La pestaña Registro contesta «¿qué ha pasado?»; esto contesta «¿quién tocó
 * *esto*?», que es la pregunta que se hace con la ficha delante y sin ganas de
 * irse a buscarla a otra pantalla.
 *
 * Si quien mira no tiene permiso para ver el registro, no aparece nada. Un
 * aviso de «te falta un permiso» en medio de una ficha de edición es ruido
 * sobre algo que esa persona no pidió y no puede arreglar.
 */
export function EntityHistory({ entityId, limit = 6 }: Props): React.JSX.Element | null {
  const { t } = useT()
  const [events, setEvents] = useState<readonly ChangeEvent[] | null>(null)
  const [denegado, setDenegado] = useState(false)

  useEffect(() => {
    let vigente = true
    setEvents(null)
    setDenegado(false)
    fetchEntityHistory(entityId)
      .then((lista) => { if (vigente) setEvents(lista) })
      .catch(() => { if (vigente) setDenegado(true) })
    return () => { vigente = false }
  }, [entityId])

  if (denegado) return null
  if (events !== null && events.length === 0) return null

  return (
    <div className="card">
      <h3 className="card__title">{t('registro.ultimos')}</h3>
      <p className="card__note">{t('registro.ultimosNota', t('tab.registro'))}</p>
      {events === null ? (
        <p className="faint" style={{ margin: '8px 0 0' }}>{t('app.cargando')}</p>
      ) : (
        <table className="grid grid--inline">
          <thead>
            <tr><th>{t('col.cuando')}</th><th>{t('col.quien')}</th><th>{t('col.queCambio')}</th></tr>
          </thead>
          <tbody>
            {events.slice(0, limit).map((event) => (
              <tr key={event.id}>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                  {dateTime(event.occurredAt)}
                </td>
                <td>{event.actorName ?? <span className="faint">{t('registro.sinSesion')}</span>}</td>
                <td style={{ whiteSpace: 'normal' }}>
                  {event.operation === 'update' ? (
                    <Cambios event={event} />
                  ) : (
                    <span className="faint">{operacion(t, event.operation)}</span>
                  )}
                  {event.comment === null || event.comment === '' ? null : (
                    <div className="funcion__detalle">«{event.comment}»</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {events !== null && events.length > limit ? (
        <p className="faint" style={{ margin: '8px 0 0' }}>
          {t('registro.yMas', events.length - limit, t('tab.registro'))}
        </p>
      ) : null}
    </div>
  )
}
