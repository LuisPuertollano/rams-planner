import { useEffect, useState } from 'react'
import { fetchDiff, fetchRuns, type Baseline, type Project, type RunSummary, type TaskDiff } from '../api.js'
import { dateTime, fullDate, hours } from '../format.js'
import { errorText } from '../errors.js'
import { useT } from '../i18n/index.js'

interface Props {
  readonly baselines: readonly Baseline[]
  readonly currentRunId: string
  readonly projects: readonly Project[]
}

/**
 * Comparación contra una línea base.
 *
 * Es un `JOIN` entre dos `run_id`, y por eso sale gratis: los resultados no
 * viven pegados a los datos declarados, sino colgados de su ejecución.
 */
export function DiffView({ baselines, currentRunId, projects }: Props): React.JSX.Element {
  const { t } = useT()
  const [selected, setSelected] = useState<string>(baselines[0]?.runId ?? '')
  const [rows, setRows] = useState<readonly TaskDiff[] | null>(null)
  const [runs, setRuns] = useState<readonly RunSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchRuns()
      .then((result) => {
        setRuns(result)
        if (baselines.length === 0) {
          const previous = result.find((run) => run.id !== currentRunId)
          if (previous !== undefined) setSelected((current) => (current === '' ? previous.id : current))
        }
      })
      .catch(() => { /* la comparación puede vivir sólo con las líneas base */ })
  }, [baselines.length, currentRunId])

  useEffect(() => {
    if (selected === '' || selected === currentRunId) {
      setRows(null)
      return
    }
    let cancelled = false
    fetchDiff(selected, currentRunId)
      .then((result) => { if (!cancelled) setRows(result) })
      .catch((cause: unknown) => { if (!cancelled) setError(errorText(t, cause, 'error.local.cargar')) })
    return () => { cancelled = true }
  }, [selected, currentRunId])

  const options = [
    ...baselines.map((baseline) => ({
      value: baseline.runId,
      label: `⭑ ${baseline.name} · ${fullDate(baseline.capturedAt)}`,
    })),
    ...runs
      .filter((run) => run.id !== currentRunId && !baselines.some((baseline) => baseline.runId === run.id))
      .map((run) => ({
        value: run.id,
        label: `${dateTime(run.startedAt)} · ${
          run.triggerReason ?? t('comparar.calculo')
        }`,
      })),
  ]

  if (options.length === 0) {
    return (
      <div className="empty">
        <h3>{t('comparar.vacio')}</h3>
        <p>{t('comparar.vacioDetalle')}</p>
      </div>
    )
  }

  const nameOf = (projectId: string): string => projects.find((p) => p.id === projectId)?.code ?? ''

  return (
    <div>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <label>
          {t('comparar.con')}{' '}
          <select className="button" value={selected} onChange={(event) => { setSelected(event.target.value) }}>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error === null ? null : <div className="error-banner" style={{ margin: 12 }}>{error}</div>}

      {rows === null ? (
        <div className="empty"><h3>{t('comparar.cargando')}</h3></div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <h3>{t('comparar.iguales')}</h3>
          <p>{t('comparar.igualesDetalle')}</p>
        </div>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th style={{ minWidth: 280 }}>{t('col.tarea')}</th>
              <th>{t('comparar.inicioBase')}</th>
              <th>{t('comparar.inicioAhora')}</th>
              <th>{t('comparar.deltaInicio')}</th>
              <th>{t('comparar.finBase')}</th>
              <th>{t('comparar.finAhora')}</th>
              <th>{t('comparar.deltaFin')}</th>
              <th>{t('comparar.deltaTrabajo')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.nodeId}>
                <td>
                  <span className="faint">{nameOf(row.projectId)}</span> {row.name}
                </td>
                <td className="muted">{fullDate(row.startFrom)}</td>
                <td>{fullDate(row.startTo)}</td>
                <td className={delayClass(row.startDeltaDays)}>{formatDelta(row.startDeltaDays, 'd')}</td>
                <td className="muted">{fullDate(row.finishFrom)}</td>
                <td>{fullDate(row.finishTo)}</td>
                <td className={delayClass(row.finishDeltaDays)}>{formatDelta(row.finishDeltaDays, 'd')}</td>
                <td className={delayClass(row.workDeltaMinutes)}>
                  {row.workDeltaMinutes === null || row.workDeltaMinutes === 0
                    ? '—'
                    : `${row.workDeltaMinutes > 0 ? '+' : '−'}${hours(Math.abs(row.workDeltaMinutes))} h`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function formatDelta(value: number | null, suffix: string): string {
  if (value === null || value === 0) return '—'
  return `${value > 0 ? '+' : '−'}${String(Math.abs(value))} ${suffix}`
}

function delayClass(value: number | null): string {
  if (value === null || value === 0) return 'faint'
  return value > 0 ? 'critical' : 'muted'
}
