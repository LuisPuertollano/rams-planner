import { useMemo, useState } from 'react'
import {
  applySubactivities,
  fetchSubactivityPlan,
  type Project,
  type SplitSkipReason,
  type SubactivityPlan,
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

const motivoDe = (razon: SplitSkipReason): keyof Diccionario =>
  `partir.motivo.${razon}` as keyof Diccionario

const nombreDelPaso = (step: string): keyof Diccionario =>
  `documentos.sub.${
    { create: 'crear', review_1: 'revisar1', review_2: 'revisar2', review_3: 'revisar3', support: 'soportar' }[
      step
    ] ?? 'crear'
  }` as keyof Diccionario

/**
 * Partir las tareas de un proyecto en la cadena de subactividades de su
 * entregable.
 *
 * Es la operación que más cambia un plan de las que hay en esta herramienta:
 * una tarea deja de ser una tarea y pasa a ser un paquete con hijos, y sus
 * asignaciones y sus dependencias se mudan. Por eso se enseña entera antes de
 * escribir nada, con lo que se descarta y por qué, y se puede desmarcar lo que
 * no cuadre.
 *
 * Lo que hay que mirar antes de aceptar, y por eso va arriba y en grande: **el
 * trabajo total no cambia**. Partir reparte en la proporción del catálogo, no
 * re-estima. Si esas dos cifras no coinciden, algo va mal y no hay que aplicar.
 */
export function SplitTasksPanel({ projects, canApply, locale, onApplied }: Props): React.JSX.Element {
  const { t } = useT()
  const aplicables = useMemo(() => projects.filter((p) => !p.isTemplate), [projects])
  const [projectId, setProjectId] = useState<string>(aplicables[0]?.id ?? '')
  const [plan, setPlan] = useState<SubactivityPlan | null>(null)
  const [excluidas, setExcluidas] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)

  const nombreDocumento = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const doc of plan?.documents ?? []) mapa.set(doc.id, `${doc.code} · ${doc.name}`)
    return mapa
  }, [plan])

  const previsualizar = (): void => {
    if (projectId === '') return
    setBusy(true)
    setError(null)
    setHecho(null)
    fetchSubactivityPlan(projectId)
      .then((resultado) => {
        setPlan(resultado)
        setExcluidas(new Set())
      })
      .catch((cause: unknown) => {
        setPlan(null)
        setError(errorText(t, cause, 'error.local.partirProponer'))
      })
      .finally(() => { setBusy(false) })
  }

  const aplicar = (): void => {
    if (plan === null) return
    const aPartir = plan.split.filter((propuesta) => !excluidas.has(propuesta.nodeId))
    if (aPartir.length === 0) return
    if (!window.confirm(t('partir.confirma', aPartir.length))) return
    setBusy(true)
    setError(null)
    applySubactivities(projectId, [...excluidas])
      .then((resultado) => {
        setHecho(
          t(
            'partir.hecho',
            resultado.result.tasksSplit,
            resultado.result.childrenCreated,
            resultado.result.relinked,
          ),
        )
        setPlan(null)
        onApplied()
      })
      .catch((cause: unknown) => { setError(errorText(t, cause, 'error.local.partirAplicar')) })
      .finally(() => { setBusy(false) })
  }

  const aPartir = (plan?.split ?? []).filter((p) => !excluidas.has(p.nodeId))
  const cuadra = plan !== null && plan.totals.minutesAfter === plan.totals.minutesBefore

  return (
    <section className="card" style={{ marginTop: 12 }}>
      <h3 style={{ margin: '0 0 4px' }}>{t('partir.titulo')}</h3>
      <p className="faint" style={{ margin: '0 0 10px', maxWidth: '90ch' }}>
        {t('partir.explica')}
      </p>

      <div className="toolbar">
        <select className="input" value={projectId} onChange={(e) => { setProjectId(e.target.value) }}>
          {aplicables.map((p) => (
            <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
          ))}
        </select>
        <button className="button" disabled={busy || projectId === ''} onClick={previsualizar}>
          {t('partir.previsualizar')}
        </button>
        {plan === null || !canApply ? null : (
          <button
            className="button button--primary"
            disabled={busy || aPartir.length === 0 || !cuadra}
            onClick={aplicar}
          >
            {t('partir.aplicar', aPartir.length)}
          </button>
        )}
      </div>

      {error === null ? null : <div className="error-banner">{error}</div>}
      {hecho === null ? null : <div className="ok-banner">{hecho}</div>}

      {plan === null ? null : (
        <>
          {/* Lo primero que hay que mirar: que el trabajo no se mueva. */}
          <div className={cuadra ? 'notice' : 'warn-banner'} style={{ marginTop: 10 }}>
            {cuadra
              ? t(
                  'partir.cuadra',
                  plan.totals.tasksBefore,
                  plan.totals.tasksAfter,
                  hours(plan.totals.minutesBefore, 0, locale),
                )
              : t(
                  'partir.noCuadra',
                  hours(plan.totals.minutesBefore, 0, locale),
                  hours(plan.totals.minutesAfter, 0, locale),
                )}
          </div>

          {plan.split.length === 0 ? (
            <p className="faint" style={{ marginTop: 10 }}>{t('partir.nada')}</p>
          ) : (
            <>
              <h4>{t('partir.seParten', plan.split.length)}</h4>
              <table className="grid grid--inline">
                <thead>
                  <tr>
                    <th>{canApply ? t('partir.col.partir') : ''}</th>
                    <th>{t('partir.col.tarea')}</th>
                    <th>{t('partir.col.entregable')}</th>
                    <th>{t('partir.col.cadena')}</th>
                    <th>{t('partir.col.mudanzas')}</th>
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
                        {nombreDocumento.get(propuesta.documentTypeId) ?? propuesta.documentTypeId}
                        <div>{t(`partir.reparte.${propuesta.magnitude}` as keyof Diccionario)}</div>
                      </td>
                      <td>
                        {propuesta.children.map((hijo) => (
                          <div key={`${hijo.step}${String(hijo.position)}`}>
                            {t(nombreDelPaso(hijo.step))}{' '}
                            <span className="faint">{hijo.role}</span>{' '}
                            <b>{hours(hijo.minutes, 1, locale)} h</b>
                            {!hijo.isGate ? null : (
                              <span className="faint"> · {t('partir.cierra')}</span>
                            )}
                          </div>
                        ))}
                      </td>
                      <td className="faint">
                        {propuesta.movedResourceIds.length === 0
                          ? null
                          : t('partir.mudaAsignaciones', propuesta.movedResourceIds.length)}
                        {propuesta.relinked.length === 0
                          ? null
                          : ` ${t('partir.mudaEnlaces', propuesta.relinked.length)}`}
                        {propuesta.movedResourceIds.length === 0 && propuesta.relinked.length === 0
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
              <h4>{t('partir.noSeTocan', plan.skipped.length)}</h4>
              <table className="grid grid--inline">
                <thead>
                  <tr>
                    <th>{t('partir.col.tarea')}</th>
                    <th>{t('partir.col.motivo')}</th>
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
