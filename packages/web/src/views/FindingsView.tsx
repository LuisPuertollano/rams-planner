import type { FindingRow } from '../api.js'
import { findingHint, findingText, severityLabel } from '../findings.js'
import { fullDate } from '../format.js'
import { useT } from '../i18n/index.js'

/**
 * Todo lo que el motor quiere decirte.
 *
 * El texto no llega hecho del servidor: se construye aquí, del código del
 * hallazgo y de sus datos, en el idioma activo. Debajo de cada uno va lo que
 * ese código significa siempre, que es lo que convierte un aviso en algo que
 * se puede arreglar.
 */
export function FindingsView({ findings }: { readonly findings: readonly FindingRow[] }): React.JSX.Element {
  const { t } = useT()

  if (findings.length === 0) {
    return (
      <div className="empty">
        <h3>{t('hallazgo.vacio.titulo')}</h3>
        <p>{t('hallazgo.vacio.detalle')}</p>
      </div>
    )
  }

  return (
    <div>
      {findings.map((finding, index) => (
        <div className="finding" key={`${finding.code}-${finding.entityId}-${String(index)}`}>
          <span className={`finding__dot severity-${finding.severity}`} />
          <div>
            <div className="finding__code">
              {severityLabel(t, finding.severity)} · {finding.code}
              {finding.occursOn === null ? '' : ` · ${fullDate(finding.occursOn)}`}
            </div>
            <p className="finding__message">{findingText(t, finding)}</p>
            <p className="faint" style={{ margin: '2px 0 0', fontSize: 12 }}>
              {findingHint(t, finding.code)}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
