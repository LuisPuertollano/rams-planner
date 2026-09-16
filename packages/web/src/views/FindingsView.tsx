import type { FindingRow } from '../api.js'
import { fullDate } from '../format.js'

const LABELS: Record<string, string> = {
  blocking: 'bloqueante',
  error: 'error',
  warning: 'aviso',
  info: 'información',
}

const EXPLANATIONS: Record<string, string> = {
  DEPENDENCY_CYCLE: 'Hay un ciclo de dependencias. El motor se detiene en vez de romper un enlace por su cuenta.',
  CONSTRAINT_CONFLICT: 'Una restricción dura contradice a las dependencias. Gana la restricción y el conflicto queda visible.',
  RESOURCE_OVERALLOCATED: 'La carga supera la capacidad. El dato es diario; aquí se resume por mes.',
  RESOURCE_NO_CAPACITY: 'Hay trabajo asignado en días sin capacidad.',
  DEADLINE_MISSED: 'La fecha objetivo es blanda: no mueve la tarea, sólo avisa.',
  BUDGET_EXCEEDED: 'El trabajo planificado supera el esfuerzo estándar del paquete.',
  TASK_UNASSIGNED: 'Hay trabajo estimado sin nadie asignado.',
  TASK_NO_WORK: 'La tarea ocupa tiempo pero no consume trabajo de nadie.',
  CONTOUR_MISMATCH: 'El reparto manual no suma el trabajo declarado. Se respeta el reparto manual.',
}

export function FindingsView({ findings }: { readonly findings: readonly FindingRow[] }): React.JSX.Element {
  if (findings.length === 0) {
    return (
      <div className="empty">
        <h3>Ningún hallazgo</h3>
        <p>El plan no tiene ciclos, ni conflictos de restricción, ni nadie por encima de su capacidad.</p>
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
              {LABELS[finding.severity] ?? finding.severity} · {finding.code}
              {finding.occursOn === null ? '' : ` · ${fullDate(finding.occursOn)}`}
            </div>
            <p className="finding__message">{finding.message}</p>
            <p className="faint" style={{ margin: '2px 0 0', fontSize: 12 }}>
              {EXPLANATIONS[finding.code] ?? ''}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
