import { useEffect, useState } from 'react'
import { applyRebalance, fetchRebalance, type Project, type RebalanceProposal } from '../api.js'
import { fullDate, hours, percent } from '../format.js'
import { errorText } from '../errors.js'
import { useT } from '../i18n/index.js'

interface Props {
  readonly projects: readonly Project[]
  readonly onChanged: () => void
}

const UMBRALES: readonly { value: number; label: string }[] = [
  { value: 8_000, label: 'por encima del 80 %' },
  { value: 10_000, label: 'por encima del 100 %' },
  { value: 12_000, label: 'por encima del 120 %' },
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
          Considerar sobrecargado a quien esté{' '}
          <select
            className="button"
            value={threshold}
            onChange={(event) => { setThreshold(Number(event.target.value)) }}
          >
            {UMBRALES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <span className="faint">
          Son propuestas: se aplican de una en una y sólo si te convencen. Ninguna deja sobrecargado a quien
          recoge el trabajo.
        </span>
      </div>

      {proposals === null ? (
        <div className="empty"><h3>Calculando…</h3></div>
      ) : proposals.length === 0 ? (
        <div className="empty">
          <h3>No hay nada que mover</h3>
          <p>
            {avisos.length === 0
              ? 'Nadie pasa del umbral elegido, o el trabajo ya está donde tiene que estar.'
              : 'Hay gente sobrecargada, pero nadie puede recoger su trabajo. Mira los avisos de abajo.'}
          </p>
        </div>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th style={{ minWidth: 240 }}>Tarea</th>
              <th>Trabajo</th>
              <th>Fechas</th>
              <th>De</th>
              <th>A</th>
              <th title="Saturación de quien suelta el trabajo, antes y después">Suelta 🔒</th>
              <th title="Saturación de quien lo recoge, antes y después">Recoge 🔒</th>
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
                    title="Mueve la asignación y recalcula el plan"
                  >
                    Aplicar
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
