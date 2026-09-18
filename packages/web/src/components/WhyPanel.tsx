import { useEffect, useState } from 'react'
import { fetchDerivations, type DerivationRow, type TaskRow } from '../api.js'
import { errorText } from '../errors.js'
import { days, fullDate, hours } from '../format.js'
import { existeClave, useT, type Traductor } from '../i18n/index.js'

interface Props {
  readonly runId: string
  readonly task: TaskRow
  readonly onClose: () => void
}

/**
 * El nombre de una regla y el de una entrada, en el idioma de quien mira.
 *
 * Mismo trato que los hallazgos y los errores: el código —`FS_LINK`,
 * `lagMinutes`— es el contrato, y la frase la escribe la interfaz. Lo que no
 * esté traducido sale con su código, que es feo pero no miente; y una regla
 * nueva del motor aparece con su nombre técnico en vez de desaparecer.
 */
function nombreDeLaRegla(t: Traductor['t'], regla: string, respaldo: string): string {
  const clave = `porque.regla.${regla}`
  return existeClave(clave) ? t(clave) : respaldo
}

function nombreDeLaEntrada(t: Traductor['t'], entrada: string): string {
  const clave = `porque.entrada.${entrada}`
  return existeClave(clave) ? t(clave) : entrada
}

/**
 * El panel «¿por qué?».
 *
 * Es la diferencia entre una herramienta en la que se confía y una en la que
 * no: cada fecha se despliega hasta la regla que la produjo y las entradas que
 * usó, y desde ahí hasta el dato que alguien escribió.
 */
export function WhyPanel({ runId, task, onClose }: Props): React.JSX.Element {
  const { t } = useT()
  const [derivations, setDerivations] = useState<readonly DerivationRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDerivations(null)
    setError(null)
    fetchDerivations(runId, task.nodeId)
      .then((rows) => { if (!cancelled) setDerivations(rows) })
      .catch((cause: unknown) => { if (!cancelled) setError(errorText(t, cause, 'error.local.cargar')) })
    return () => { cancelled = true }
  }, [runId, task.nodeId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  return (
    <>
      <button className="backdrop" onClick={onClose} aria-label={t('boton.cerrar')} />
      <aside className="why" role="dialog" aria-label={t('porque.titulo', task.name)}>
        <div className="why__head">
          <div>
            <h2>{task.name}</h2>
            <p className="faint" style={{ margin: '2px 0 0', fontSize: 12 }}>
              {fullDate(task.scheduledStart)} → {fullDate(task.scheduledFinish)} · {days(task.durationMinutes)} ·{' '}
              {task.workMinutes === null || task.workMinutes === 0
                ? t('porque.sinTrabajo')
                : `${hours(task.workMinutes)} h`}
            </p>
          </div>
          <button className="button" onClick={onClose} style={{ marginLeft: 'auto' }}>
            {t('boton.cerrar')}
          </button>
        </div>

        <div className="why__body">
          {error !== null ? <div className="error-banner">{error}</div> : null}
          {derivations === null && error === null ? <p className="faint">{t('porque.cargando')}</p> : null}

          {derivations?.map((derivation, index) => (
            <div className="why__node" key={`${derivation.rule}-${String(index)}`}>
              <div className="why__rule">{derivation.rule}</div>
              <div className="why__output">{nombreDeLaRegla(t, derivation.rule, derivation.targetType)}</div>
              <div className="muted" style={{ fontSize: 13 }}>
                → {formatValue(derivation.output)}
              </div>
              <dl className="why__inputs">
                {Object.entries(derivation.inputs)
                  .filter(([, value]) => value !== null && value !== '')
                  .map(([key, value]) => (
                    <div key={key} style={{ display: 'contents' }}>
                      <dt>{nombreDeLaEntrada(t, key)}</dt>
                      <dd>{formatValue(value)}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          ))}

          {derivations !== null && derivations.length === 0 ? (
            <p className="faint">{t('porque.sinDerivaciones')}</p>
          ) : null}

          <p className="faint" style={{ fontSize: 12, marginBottom: 0 }}>
            {t('porque.traza')} <code>{runId.slice(0, 8)}</code>. {t('porque.trazaDetalle')}
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
