import { useMemo, useState } from 'react'
import {
  applyDeliveries,
  fetchDeliveryPlan,
  type DeliveryPlan,
  type DeliverySkipReason,
  type Project,
} from '../api.js'
import { errorText } from '../errors.js'
import { hours } from '../format.js'
import { useT, type Diccionario } from '../i18n/index.js'

interface Props {
  readonly projects: readonly Project[]
  /** Si esta persona puede cambiar la estructura del plan. Sin eso, sólo mira. */
  readonly canApply: boolean
  readonly locale: string
  readonly onApplied: () => void
}

const motivoDe = (razon: DeliverySkipReason): keyof Diccionario =>
  `entregas.motivo.${razon}` as keyof Diccionario

/**
 * Partir las tareas en las entregas que pide la Checkliste.
 *
 * Es la hermana mayor de «partir en subactividades» y va antes que ella: aquí
 * una tarea se convierte en las versiones del documento que piden las puertas,
 * y cada una de esas versiones se puede partir después en crear y revisar.
 *
 * Lo que hay que mirar antes de aceptar, y por eso va arriba y en grande: **el
 * tamaño total no cambia**. Cada entrega se lleva la parte que declara la
 * Checkliste y la final lo que las previas no se llevan. Si esas dos cifras no
 * coinciden, algo va mal y no hay que aplicar.
 */
export function SplitDeliveriesPanel({ projects, canApply, locale, onApplied }: Props): React.JSX.Element {
  const { t } = useT()
  const aplicables = useMemo(() => projects.filter((p) => !p.isTemplate), [projects])
  const [projectId, setProjectId] = useState<string>(aplicables[0]?.id ?? '')
  const [plan, setPlan] = useState<DeliveryPlan | null>(null)
  const [excluidas, setExcluidas] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)

  const previsualizar = (): void => {
    if (projectId === '') return
    setBusy(true)
    setError(null)
    setHecho(null)
    fetchDeliveryPlan(projectId)
      .then((resultado) => {
        setPlan(resultado)
        setExcluidas(new Set())
      })
      .catch((cause: unknown) => {
        setPlan(null)
        setError(errorText(t, cause, 'error.local.entregasProponer'))
      })
      .finally(() => { setBusy(false) })
  }

  const aplicar = (): void => {
    if (plan === null) return
    const aPartir = plan.split.filter((propuesta) => !excluidas.has(propuesta.nodeId))
    if (aPartir.length === 0) return
    if (!window.confirm(t('entregas.confirma', aPartir.length))) return
    setBusy(true)
    setError(null)
    applyDeliveries(projectId, [...excluidas])
      .then((resultado) => {
        setHecho(
          t('entregas.hecho', resultado.result.tasksSplit, resultado.result.deliveriesCreated,
            resultado.result.relinked),
        )
        setPlan(null)
        onApplied()
      })
      .catch((cause: unknown) => { setError(errorText(t, cause, 'error.local.entregasAplicar')) })
      .finally(() => { setBusy(false) })
  }

  const aPartir = (plan?.split ?? []).filter((p) => !excluidas.has(p.nodeId))
  const cuadra = plan !== null && plan.totals.minutesAfter === plan.totals.minutesBefore

  return (
    <section className="card" style={{ marginTop: 12 }}>
      <h3 style={{ margin: '0 0 4px' }}>{t('entregas.titulo')}</h3>
      <p className="faint" style={{ margin: '0 0 10px', maxWidth: '90ch' }}>
        {t('entregas.explica')}
      </p>

      <div className="toolbar">
        <select className="input" value={projectId} onChange={(e) => { setProjectId(e.target.value) }}>
          {aplicables.map((p) => (
            <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
          ))}
        </select>
        <button className="button" disabled={busy || projectId === ''} onClick={previsualizar}>
          {t('entregas.previsualizar')}
        </button>
        {plan === null || !canApply || aPartir.length === 0 ? null : (
          <button className="button button--primary" disabled={busy || !cuadra} onClick={aplicar}>
            {t('entregas.aplicar', aPartir.length)}
          </button>
        )}
      </div>

      {error === null ? null : <div className="error-banner">{error}</div>}
      {hecho === null ? null : <div className="ok-banner">{hecho}</div>}

      {plan === null ? null : (
        <>
          {/* Lo primero que hay que mirar: que el tamaño no se mueva. */}
          <div className={cuadra ? 'notice' : 'warn-banner'} style={{ marginTop: 10 }}>
            {cuadra
              ? t('entregas.cuadra', plan.totals.tasksBefore, plan.totals.tasksAfter,
                  hours(plan.totals.minutesBefore, 0, locale))
              : t('entregas.noCuadra', hours(plan.totals.minutesBefore, 0, locale),
                  hours(plan.totals.minutesAfter, 0, locale))}
          </div>

          {plan.split.length === 0 ? (
            <p className="faint" style={{ marginTop: 10 }}>{t('entregas.nada')}</p>
          ) : (
            <>
              <h4>{t('entregas.seParten', plan.split.length)}</h4>
              <table className="grid grid--inline">
                <thead>
                  <tr>
                    <th>{canApply ? t('entregas.col.partir') : ''}</th>
                    <th>{t('entregas.col.tarea')}</th>
                    <th>{t('entregas.col.entregable')}</th>
                    <th>{t('entregas.col.entregas')}</th>
                    <th>{t('entregas.col.mudanzas')}</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.split.map((propuesta) => (
                    <tr key={propuesta.nodeId}>
                      <td>
                        {!canApply ? null : (
                          <input
                            type="checkbox"
                            checked={!excluidas.has(propuesta.nodeId)}
                            onChange={() => {
                              setExcluidas((previo) => {
                                const nuevo = new Set(previo)
                                if (nuevo.has(propuesta.nodeId)) nuevo.delete(propuesta.nodeId)
                                else nuevo.add(propuesta.nodeId)
                                return nuevo
                              })
                            }}
                          />
                        )}
                      </td>
                      <td>
                        <span className="faint">{propuesta.path}</span> {propuesta.name}
                      </td>
                      <td className="faint">
                        {propuesta.documentCode}
                        <div>{t(`entregas.reparte.${propuesta.magnitude}` as keyof Diccionario)}</div>
                      </td>
                      <td>
                        {propuesta.deliveries.map((entrega) => (
                          <div key={entrega.order}>
                            <b>{entrega.gate === '' ? '—' : entrega.gate}</b>{' '}
                            <span className="faint">
                              {entrega.maturity ?? t('entregas.final')}
                            </span>{' '}
                            {Math.round(entrega.shareBp / 100)} % ·{' '}
                            <b>{hours(entrega.minutes, 1, locale)} h</b>
                          </div>
                        ))}
                      </td>
                      {/* Una cosa por línea: pegadas se leen como una sola frase. */}
                      <td className="faint">
                        {propuesta.copiedResourceIds.length === 0 ? null : (
                          <div>{t('entregas.copiaAsignaciones', propuesta.copiedResourceIds.length)}</div>
                        )}
                        {propuesta.relinked.length === 0 ? null : (
                          <div>{t('entregas.mudaEnlaces', propuesta.relinked.length)}</div>
                        )}
                        {propuesta.copiedResourceIds.length === 0 && propuesta.relinked.length === 0
                          ? /* texto-fijo: guion de celda vacía */ '—'
                          : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {plan.skipped.length === 0 ? null : (
            <>
              <h4>{t('entregas.noSeTocan', plan.skipped.length)}</h4>
              <table className="grid grid--inline">
                <thead>
                  <tr>
                    <th>{t('entregas.col.tarea')}</th>
                    <th>{t('entregas.col.motivo')}</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.skipped.map((descarte) => (
                    <tr key={descarte.nodeId}>
                      <td>
                        <span className="faint">{descarte.path}</span> {descarte.name}
                      </td>
                      <td className="faint">{t(motivoDe(descarte.reason))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </section>
  )
}
