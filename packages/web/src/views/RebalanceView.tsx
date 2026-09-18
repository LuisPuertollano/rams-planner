import { useEffect, useState } from 'react'
import { applyRebalance, fetchRebalance, type Project, type RebalanceProposal } from '../api.js'
import { fullDate, hours, percent } from '../format.js'
import { errorText } from '../errors.js'
import { useT, type Diccionario } from '../i18n/index.js'

interface Props {
  readonly projects: readonly Project[]
  readonly onChanged: () => void
}

const UMBRALES: readonly { value: number; label: keyof Diccionario }[] = [
  { value: 8_000, label: 'reparto.umbral.80' },
  { value: 10_000, label: 'reparto.umbral.100' },
  { value: 12_000, label: 'reparto.umbral.120' },
]

/**
 * Propuestas de reparto de trabajo.
 *
 * Cada fila es un movimiento concreto con su justificación y su efecto en las
 * dos personas. Se aplican de una en una, a mano y a propósito: la herramienta
 * ve horas y competencias declaradas, no ve que alguien acaba de entrar o que
 * ese cliente exige que firme una persona concreta. Quien planifica sí.
 */
export function RebalanceView({ projects, onChanged }: Props): React.JSX.Element {
  const { t } = useT()
  const [threshold, setThreshold] = useState(10_000)
  const [proposals, setProposals] = useState<readonly RebalanceProposal[] | null>(null)
  const [avisos, setAvisos] = useState<readonly { entityId: string; message: string }[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = (value: number): void => {
    setProposals(null)
    fetchRebalance(value)
      .then((result) => {
        setProposals(result.proposals)
        setAvisos(result.findings.map((finding) => ({ entityId: finding.entityId, message: finding.message })))
      })
      .catch((cause: unknown) => {
        setError(errorText(t, cause, 'error.local.propuestas'))
      })
  }

  useEffect(() => { reload(threshold) }, [threshold])

  const codeOf = new Map(projects.map((project) => [project.id, project.code]))

  const aplicar = (proposal: RebalanceProposal): void => {
    setBusy(proposal.assignmentId)
    setError(null)
    applyRebalance(proposal)
      .then(() => { onChanged(); reload(threshold) })
      .catch((cause: unknown) => { setError(errorText(t, cause, 'error.local.aplicar')) })
      .finally(() => { setBusy(null) })
  }

  return (
    <>
      {error === null ? null : <div className="error-banner" style={{ margin: 12 }}>{error}</div>}
      <div className="toolbar">
        <label className="faint">
          {t('reparto.umbral')}{' '}
          <select
            className="button"
            value={threshold}
            onChange={(event) => { setThreshold(Number(event.target.value)) }}
          >
            {UMBRALES.map((item) => (
              <option key={item.value} value={item.value}>{t(item.label)}</option>
            ))}
          </select>
        </label>
        <span className="faint">{t('reparto.nota')}</span>
      </div>

      {proposals === null ? (
        <div className="empty"><h3>{t('reparto.calculando')}</h3></div>
      ) : proposals.length === 0 ? (
        <div className="empty">
          <h3>{t('reparto.vacio')}</h3>
          <p>
            {avisos.length === 0 ? t('reparto.vacioNadie') : t('reparto.vacioSinCandidato')}
          </p>
        </div>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th style={{ minWidth: 240 }}>{t('col.tarea')}</th>
              <th>{t('col.trabajo')}</th>
              <th>{t('col.fechas')}</th>
              <th>{t('col.de')}</th>
              <th>{t('col.a')}</th>
              <th title={t('reparto.sueltaTitulo')}>{t('reparto.suelta')}</th>
              <th title={t('reparto.recogeTitulo')}>{t('reparto.recoge')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {proposals.map((proposal) => (
              <tr key={proposal.assignmentId} style={busy === proposal.assignmentId ? { opacity: 0.55 } : undefined}>
                <td>
                  <span className="wbs__name">
                    <span>{proposal.taskName}</span>
                    <span className="tag">{codeOf.get(proposal.projectId) ?? ''}</span>
                  </span>
                  <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>{proposal.reason}</div>
                </td>
                <td>{hours(proposal.minutes)} h</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {fullDate(proposal.firstDay)} → {fullDate(proposal.lastDay)}
                </td>
                <td>{proposal.fromResourceName}</td>
                <td>{proposal.toResourceName}</td>
                <td className="cell--derived">
                  <span className="critical">{percent(proposal.fromBeforeBp)}</span> →{' '}
                  {percent(proposal.fromAfterBp)}
                </td>
                <td className="cell--derived">
                  {percent(proposal.toBeforeBp)} → {percent(proposal.toAfterBp)}
                </td>
                <td>
                  <button
                    className="button button--primary"
                    disabled={busy !== null}
                    onClick={() => { aplicar(proposal) }}
                    title={t('reparto.aplicarTitulo')}
                  >
                    {t('reparto.aplicar')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {avisos.length === 0 ? null : (
        <div style={{ padding: '4px 0' }}>
          {avisos.map((aviso) => (
            <div className="finding" key={aviso.entityId}>
              <span className="finding__dot severity-info" />
              <div>
                {/* texto-fijo: es el código del hallazgo, el mismo en los cuatro idiomas */}
                <div className="finding__code">REBALANCE_NO_CANDIDATE</div>
                <p className="finding__message">{aviso.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
