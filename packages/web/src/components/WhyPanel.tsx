import { useEffect, useState } from 'react'
import { fetchDerivations, type DerivationRow, type TaskRow } from '../api.js'
import { days, fullDate, hours } from '../format.js'

interface Props {
  readonly runId: string
  readonly task: TaskRow
  readonly onClose: () => void
}

const RULES: Record<string, string> = {
  FS_LINK: 'Enlace fin-inicio con su predecesora',
  SS_LINK: 'Enlace inicio-inicio',
  FF_LINK: 'Enlace fin-fin',
  SF_LINK: 'Enlace inicio-fin',
  PROJECT_START: 'Arranque del proyecto',
  CONSTRAINT_SNET: 'Restricción: no empezar antes de',
  CONSTRAINT_FNET: 'Restricción: no terminar antes de',
  CONSTRAINT_MSO: 'Restricción dura: debe empezar el',
  CONSTRAINT_MFO: 'Restricción dura: debe terminar el',
  CALENDAR_RESOLUTION: 'Calendario que se ha usado',
  TASK_EQUATION_FIXED_WORK: 'Ecuación de la tarea: trabajo fijo',
  TASK_EQUATION_FIXED_DURATION: 'Ecuación de la tarea: duración fija',
  TASK_EQUATION_FIXED_UNITS: 'Ecuación de la tarea: unidades fijas',
}

const INPUT_LABELS: Record<string, string> = {
  predecessor: 'predecesora',
  project: 'arranque del proyecto',
  lagMinutes: 'desfase (min)',
  calendar: 'calendario',
  taskCalendar: 'calendario de la tarea',
  resourceCalendar: 'calendario del recurso',
  projectCalendar: 'calendario del proyecto',
  defaultCalendar: 'calendario por defecto',
  constraintKind: 'restricción',
  constraintDate: 'fecha de la restricción',
  calendarId: 'calendario',
  taskCalendarId: 'calendario de la tarea',
  projectCalendarId: 'calendario del proyecto',
  defaultCalendarId: 'calendario por defecto',
  workMinutes: 'trabajo (min)',
  unitsBp: 'dedicación (pb)',
  durationMinutes: 'duración (min)',
  declaredDuration: 'duración declarada (min)',
  dayCount: 'días laborables',
  from: 'desde',
  to: 'hasta',
}

/**
 * El panel «¿por qué?».
 *
 * Es la diferencia entre una herramienta en la que se confía y una en la que
 * no: cada fecha se despliega hasta la regla que la produjo y las entradas que
 * usó, y desde ahí hasta el dato que alguien escribió.
 */
export function WhyPanel({ runId, task, onClose }: Props): React.JSX.Element {
  const [derivations, setDerivations] = useState<readonly DerivationRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDerivations(null)
    setError(null)
    fetchDerivations(runId, task.nodeId)
      .then((rows) => { if (!cancelled) setDerivations(rows) })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Error') })
    return () => { cancelled = true }
  }, [runId, task.nodeId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  return (
    <>
      <button className="backdrop" onClick={onClose} aria-label="Cerrar" />
      <aside className="why" role="dialog" aria-label={`Por qué: ${task.name}`}>
        <div className="why__head">
          <div>
            <h2>{task.name}</h2>
            <p className="faint" style={{ margin: '2px 0 0', fontSize: 12 }}>
              {fullDate(task.scheduledStart)} → {fullDate(task.scheduledFinish)} · {days(task.durationMinutes)} ·{' '}
              {task.workMinutes === null || task.workMinutes === 0 ? 'sin trabajo' : `${hours(task.workMinutes)} h`}
            </p>
          </div>
          <button className="button" onClick={onClose} style={{ marginLeft: 'auto' }}>
            Cerrar
          </button>
        </div>

        <div className="why__body">
          {error !== null ? <div className="error-banner">{error}</div> : null}
          {derivations === null && error === null ? <p className="faint">Cargando la traza…</p> : null}

          {derivations?.map((derivation, index) => (
            <div className="why__node" key={`${derivation.rule}-${String(index)}`}>
              <div className="why__rule">{derivation.rule}</div>
              <div className="why__output">{RULES[derivation.rule] ?? derivation.targetType}</div>
              <div className="muted" style={{ fontSize: 13 }}>
                → {formatValue(derivation.output)}
              </div>
              <dl className="why__inputs">
                {Object.entries(derivation.inputs)
                  .filter(([, value]) => value !== null && value !== '')
                  .map(([key, value]) => (
                    <div key={key} style={{ display: 'contents' }}>
                      <dt>{INPUT_LABELS[key] ?? key}</dt>
                      <dd>{formatValue(value)}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          ))}

          {derivations !== null && derivations.length === 0 ? (
            <p className="faint">
              Esta ejecución no guardó derivaciones para esta tarea. Las de las ejecuciones antiguas se purgan por
              política; las de una línea base se conservan siempre.
            </p>
          ) : null}

          <p className="faint" style={{ fontSize: 12, marginBottom: 0 }}>
            Traza de la ejecución <code>{runId.slice(0, 8)}</code>. Cada hoja de este árbol es un dato que alguien
            escribió, y tiene su propia entrada en el registro de cambios.
          </p>
        </div>
      </aside>
    </>
  )
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'sí' : 'no'
  if (typeof value === 'number') return String(value)
  const text = String(value)
  // Los identificadores completos no aportan nada en pantalla.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(text) ? `${text.slice(0, 8)}…` : text
}
