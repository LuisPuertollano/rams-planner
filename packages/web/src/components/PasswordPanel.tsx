import { useState } from 'react'
import { changeOwnPassword } from '../api.js'
import { errorText } from '../errors.js'
import { useT } from '../i18n/index.js'

interface Props {
  readonly onClose: () => void
  /** Se llama cuando el cambio va bien: hay que volver a entrar. */
  readonly onChanged: () => void
}

/** Lo que pide la API. Decirlo antes evita un viaje y un mensaje seco. */
const MINIMO = 12

/**
 * Cambiar la propia contraseña.
 *
 * Existe porque la herramienta te la da hecha —la CLI genera una y dice
 * «cámbiala al entrar»— y hasta ahora no había dónde. Pedir la actual no es
 * burocracia: sin ella, un ordenador sin bloquear basta para quedarse con la
 * cuenta de otro.
 */
export function PasswordPanel({ onClose, onChanged }: Props): React.JSX.Element {
  const { t } = useT()
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const problema =
    nueva.length > 0 && nueva.length < MINIMO
      ? t('clave.corta', MINIMO)
      : repetida.length > 0 && nueva !== repetida
        ? t('clave.distintas')
        : nueva.length > 0 && nueva === actual
          ? t('clave.igual')
          : null

  const enviar = (event: React.FormEvent): void => {
    event.preventDefault()
    if (problema !== null) return
    setBusy(true)
    setError(null)
    changeOwnPassword(actual, nueva)
      .then(onChanged)
      .catch((cause: unknown) => {
        setError(errorText(t, cause, 'clave.error'))
      })
      .finally(() => { setBusy(false) })
  }

  return (
    <>
      <button className="backdrop" onClick={onClose} aria-label="Cerrar" />
      <aside className="why" role="dialog" aria-label="Cambiar mi contraseña">
      <div className="why__head">
        <h3 style={{ margin: 0 }}>{t('clave.titulo')}</h3>
        <button className="button" onClick={onClose} style={{ marginLeft: 'auto' }}>
          {t('clave.cerrar')}
        </button>
      </div>

      <form className="why__body" onSubmit={enviar} style={{ display: 'grid', gap: 14 }}>
        {error === null ? null : <div className="error-banner">{error}</div>}

        <label className="login__campo">
          <span>{t('clave.actual')}</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={actual}
            required
            autoFocus
            onChange={(event) => { setActual(event.target.value) }}
          />
        </label>

        <label className="login__campo">
          <span>{t('clave.nueva', MINIMO)}</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={nueva}
            required
            onChange={(event) => { setNueva(event.target.value) }}
          />
        </label>

        <label className="login__campo">
          <span>{t('clave.repite')}</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={repetida}
            required
            onChange={(event) => { setRepetida(event.target.value) }}
          />
        </label>

        {problema === null ? null : <p className="faint">{problema}</p>}

        <p className="faint">
          {t('clave.aviso')}
        </p>

        <button
          className="button button--primary"
          type="submit"
          disabled={busy || problema !== null || actual === '' || nueva === ''}
        >
          {busy ? t('clave.enviando') : t('clave.enviar')}
        </button>
      </form>
      </aside>
    </>
  )
}
