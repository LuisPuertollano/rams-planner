import { useState } from 'react'
import { changeOwnPassword } from '../api.js'

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
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const problema =
    nueva.length > 0 && nueva.length < MINIMO
      ? `La nueva tiene que tener ${String(MINIMO)} caracteres o más.`
      : repetida.length > 0 && nueva !== repetida
        ? 'Las dos copias de la nueva no coinciden.'
        : nueva.length > 0 && nueva === actual
          ? 'La nueva tiene que ser distinta de la actual.'
          : null

  const enviar = (event: React.FormEvent): void => {
    event.preventDefault()
    if (problema !== null) return
    setBusy(true)
    setError(null)
    changeOwnPassword(actual, nueva)
      .then(onChanged)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'No se pudo cambiar la contraseña')
      })
      .finally(() => { setBusy(false) })
  }

  return (
    <>
      <button className="backdrop" onClick={onClose} aria-label="Cerrar" />
      <aside className="why" role="dialog" aria-label="Cambiar mi contraseña">
      <div className="why__head">
        <h3 style={{ margin: 0 }}>Cambiar mi contraseña</h3>
        <button className="button" onClick={onClose} style={{ marginLeft: 'auto' }}>
          Cerrar
        </button>
      </div>

      <form className="why__body" onSubmit={enviar} style={{ display: 'grid', gap: 14 }}>
        {error === null ? null : <div className="error-banner">{error}</div>}

        <label className="login__campo">
          <span>Contraseña actual</span>
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
          <span>Contraseña nueva ({MINIMO} caracteres o más)</span>
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
          <span>Repite la nueva</span>
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
          Al cambiarla se cierran todas tus sesiones, ésta incluida: tendrás que volver a entrar con la
          nueva. Es a propósito — si la cambias porque alguien más la conocía, dejar sesiones vivas no
          arregla nada.
        </p>

        <button
          className="button button--primary"
          type="submit"
          disabled={busy || problema !== null || actual === '' || nueva === ''}
        >
          {busy ? 'Cambiando…' : 'Cambiar y volver a entrar'}
        </button>
      </form>
      </aside>
    </>
  )
}
