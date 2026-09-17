import { useState } from 'react'
import { signIn, type MeResponse } from '../api.js'

interface Props {
  readonly onEntered: (me: MeResponse) => void
}

/**
 * La puerta.
 *
 * No dice nada de lo que hay detrás: ni cuántos usuarios hay, ni si el correo
 * existe. Lo único que distingue un correo desconocido de una contraseña mala
 * es nada, y eso es a propósito.
 */
export function LoginView({ onEntered }: Props): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const entrar = (event: React.FormEvent): void => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    signIn(email.trim(), password)
      .then(onEntered)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'No se pudo entrar')
      })
      .finally(() => { setBusy(false) })
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={entrar}>
        <h1>RAMS Planner</h1>
        <p className="faint">carga de trabajo, explicada hasta el último minuto</p>

        {error === null ? null : <div className="error-banner">{error}</div>}

        <label className="login__campo">
          <span>Correo</span>
          <input
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            required
            autoFocus
            onChange={(event) => { setEmail(event.target.value) }}
          />
        </label>

        <label className="login__campo">
          <span>Contraseña</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            required
            onChange={(event) => { setPassword(event.target.value) }}
          />
        </label>

        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>

        <p className="faint login__pie">
          ¿No tienes cuenta? Te la da quien administre la herramienta. Si acabas de instalarla y no hay
          ninguna, créate la primera con{' '}
          <code>node packages/api/dist/cli.js crear-superadmin &lt;correo&gt; &lt;nombre&gt;</code>.
        </p>
      </form>
    </div>
  )
}
