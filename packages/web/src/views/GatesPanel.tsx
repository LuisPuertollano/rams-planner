import { useEffect, useMemo, useState } from 'react'
import {
  applyGates,
  fetchGatePlan,
  fetchProjectGates,
  saveProjectGates,
  type GatePlan,
  type GateSkipReason,
  type Project,
  type ProjectGate,
} from '../api.js'
import { errorText } from '../errors.js'
import { GateReadinessPanel } from './GateReadinessPanel.js'
import { useT, type Diccionario } from '../i18n/index.js'

interface Props {
  readonly projects: readonly Project[]
  /** Si esta persona puede escribir fechas objetivo. Sin eso, sólo mira. */
  readonly canApply: boolean
  readonly onApplied: () => void
}

const motivoDe = (razon: GateSkipReason): keyof Diccionario =>
  `puertas.motivo.${razon}` as keyof Diccionario

/**
 * Las puertas de certificación del proyecto, y las fechas objetivo que salen de
 * ellas.
 *
 * Dos mitades, y la de arriba es la que hay que rellenar primero: sin la fecha
 * de la puerta no hay nada que calcular, y el descarte que más se va a ver el
 * primer día es justo ése. Por eso la lista de puertas que el catálogo pide y
 * el proyecto no ha fechado se enseña en grande, con sus nombres, en vez de
 * quedar escondida entre los descartes.
 *
 * Lo que se escribe es la **fecha objetivo**, que es blanda: no mueve la tarea,
 * avisa cuando el plan no llega. Eso también va dicho en la pantalla, porque la
 * diferencia entre «esto empuja mi plan» y «esto me avisa» decide si alguien se
 * atreve a darle al botón.
 */
export function GatesPanel({ projects, canApply, onApplied }: Props): React.JSX.Element {
  const { t } = useT()
  const aplicables = useMemo(() => projects.filter((p) => !p.isTemplate), [projects])
  const [projectId, setProjectId] = useState<string>(aplicables[0]?.id ?? '')
  const [puertas, setPuertas] = useState<readonly ProjectGate[]>([])
  const [plan, setPlan] = useState<GatePlan | null>(null)
  const [excluidas, setExcluidas] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)
  /** Sube al aplicar objetivos: así la preparación no se queda con cifras viejas. */
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (projectId === '') return
    setPlan(null)
    fetchProjectGates(projectId)
      .then(setPuertas)
      .catch((cause: unknown) => { setError(errorText(t, cause, 'error.local.puertasLeer')) })
  }, [projectId, t])

  const guardar = (siguiente: readonly ProjectGate[]): void => {
    setBusy(true)
    setError(null)
    saveProjectGates(projectId, siguiente)
      .then((guardadas) => {
        setPuertas(guardadas)
        // La propuesta vieja hablaba de otras fechas: se tira, no se retoca.
        setPlan(null)
      })
      .catch((cause: unknown) => { setError(errorText(t, cause, 'error.local.puertasGuardar')) })
      .finally(() => { setBusy(false) })
  }

  const previsualizar = (): void => {
    if (projectId === '') return
    setBusy(true)
    setError(null)
    setHecho(null)
    fetchGatePlan(projectId)
      .then((resultado) => {
        setPlan(resultado)
        setExcluidas(new Set())
      })
      .catch((cause: unknown) => {
        setPlan(null)
        setError(errorText(t, cause, 'error.local.puertasProponer'))
      })
      .finally(() => { setBusy(false) })
  }

  const aplicar = (): void => {
    if (plan === null) return
    const aPoner = plan.set.filter((objetivo) => !excluidas.has(objetivo.nodeId))
    if (aPoner.length === 0) return
    if (!window.confirm(t('puertas.confirma', aPoner.length))) return
    setBusy(true)
    setError(null)
    applyGates(projectId, [...excluidas])
      .then((resultado) => {
        setHecho(
          t('puertas.hecho', resultado.result.deadlinesSet, resultado.result.deadlinesChanged),
        )
        setPlan(null)
        setVersion((previo) => previo + 1)
        onApplied()
      })
      .catch((cause: unknown) => { setError(errorText(t, cause, 'error.local.puertasAplicar')) })
      .finally(() => { setBusy(false) })
  }

  const aPoner = (plan?.set ?? []).filter((o) => !excluidas.has(o.nodeId))
  const sinFecha = plan?.totals.puertasSinFecha ?? []

  const cambiaPuerta = (i: number, campo: 'gate' | 'date', valor: string): void => {
    setPuertas((previo) =>
      previo.map((puerta, j) => (i === j ? { ...puerta, [campo]: valor } : puerta)),
    )
  }

  return (
    <section className="card" style={{ marginTop: 12 }}>
      <h3 style={{ margin: '0 0 4px' }}>{t('puertas.titulo')}</h3>
      <p className="faint" style={{ margin: '0 0 10px', maxWidth: '90ch' }}>
        {t('puertas.explica')}
      </p>

      <div className="toolbar">
        <select className="input" value={projectId} onChange={(e) => { setProjectId(e.target.value) }}>
          {aplicables.map((p) => (
            <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
          ))}
        </select>
        <button className="button" disabled={busy || projectId === ''} onClick={previsualizar}>
          {t('puertas.previsualizar')}
        </button>
        {plan === null || !canApply || aPoner.length === 0 ? null : (
          <button className="button button--primary" disabled={busy} onClick={aplicar}>
            {t('puertas.aplicar', aPoner.length)}
          </button>
        )}
      </div>

      {error === null ? null : <div className="error-banner">{error}</div>}
      {hecho === null ? null : <div className="ok-banner">{hecho}</div>}

      <h4>{t('puertas.cuando')}</h4>
      <table className="grid grid--inline">
        <thead>
          <tr>
            <th>{t('puertas.col.puerta')}</th>
            <th>{t('puertas.col.fecha')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {puertas.map((puerta, i) => (
            <tr key={`${puerta.gate}-${String(i)}`}>
              <td>
                <input
                  className="input"
                  style={{ maxWidth: 160 }}
                  value={puerta.gate}
                  disabled={!canApply}
                  onChange={(e) => { cambiaPuerta(i, 'gate', e.target.value) }}
                />
              </td>
              <td>
                <input
                  className="input"
                  style={{ maxWidth: 200 }}
                  type="date"
                  value={puerta.date}
                  disabled={!canApply}
                  onChange={(e) => { cambiaPuerta(i, 'date', e.target.value) }}
                />
              </td>
              <td>
                {!canApply ? null : (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => { guardar(puertas.filter((_, j) => j !== i)) }}
                  >
                    {t('puertas.quitar')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!canApply ? null : (
        <div className="toolbar">
          <button
            className="button"
            disabled={busy}
            onClick={() => {
              setPuertas((previo) => [...previo, { gate: '', date: '', notes: null }])
            }}
          >
            {t('puertas.anadir')}
          </button>
          <button
            className="button button--primary"
            disabled={busy || puertas.some((p) => p.gate.trim() === '' || p.date === '')}
            onClick={() => { guardar(puertas) }}
          >
            {t('puertas.guardar')}
          </button>
        </div>
      )}

      <GateReadinessPanel projectId={projectId} version={version} />

      {plan === null ? null : (
        <>
          {sinFecha.length === 0 ? null : (
            /* El descarte que más se ve el primer día, y se arregla arriba. */
            <div className="warn-banner" style={{ marginTop: 10 }}>
              {t('puertas.faltanFechas', sinFecha.join(', '))}
            </div>
          )}

          {plan.set.length === 0 ? (
            <p className="faint" style={{ marginTop: 10 }}>{t('puertas.nada')}</p>
          ) : (
            <>
              <h4>{t('puertas.sePonen', plan.set.length)}</h4>
              <table className="grid grid--inline">
                <thead>
                  <tr>
                    <th>{canApply ? t('puertas.col.poner') : ''}</th>
                    <th>{t('puertas.col.tarea')}</th>
                    <th>{t('puertas.col.entregable')}</th>
                    <th>{t('puertas.col.cuenta')}</th>
                    <th>{t('puertas.col.objetivo')}</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.set.map((objetivo) => (
                    <tr key={objetivo.nodeId}>
                      <td>
                        {!canApply ? null : (
                          <input
                            type="checkbox"
                            checked={!excluidas.has(objetivo.nodeId)}
                            onChange={() => {
                              setExcluidas((previo) => {
                                const nuevo = new Set(previo)
                                if (nuevo.has(objetivo.nodeId)) nuevo.delete(objetivo.nodeId)
                                else nuevo.add(objetivo.nodeId)
                                return nuevo
                              })
                            }}
                          />
                        )}
                      </td>
                      <td>
                        <span className="faint">{objetivo.path}</span> {objetivo.name}
                      </td>
                      <td className="faint">{objetivo.documentCode}</td>
                      {/* La cuenta entera, que es lo que hace revisable la fila. */}
                      <td className="faint">
                        {objetivo.weeks === 0
                          ? t('puertas.enLaPuerta', objetivo.gate, objetivo.gateDate)
                          : t('puertas.cuenta', objetivo.gate, objetivo.gateDate, objetivo.weeks)}
                      </td>
                      <td>
                        <b>{objetivo.deadline}</b>
                        {objetivo.previous === null ? null : (
                          <div className="faint">{t('puertas.antes', objetivo.previous)}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {plan.skipped.length === 0 ? null : (
            <>
              <h4>{t('puertas.noSeTocan', plan.skipped.length)}</h4>
              <table className="grid grid--inline">
                <thead>
                  <tr>
                    <th>{t('puertas.col.tarea')}</th>
                    <th>{t('puertas.col.motivo')}</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.skipped.map((descarte) => (
                    <tr key={descarte.nodeId}>
                      <td>
                        <span className="faint">{descarte.path}</span> {descarte.name}
                      </td>
                      <td className="faint">
                        {t(motivoDe(descarte.reason))}
                        {descarte.gate === null ? null : ` · ${descarte.gate}`}
                        {descarte.deadline === null
                          ? null
                          : ` · ${t(
                              descarte.reason === 'ya-puesta'
                                ? 'puertas.esLaQueTiene'
                                : 'puertas.habriaSido',
                              descarte.deadline,
                            )}`}
                      </td>
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
