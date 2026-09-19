import { useState } from 'react'
import { signIn, type MeResponse } from '../api.js'
import { useT } from '../i18n/index.js'
import { errorText } from '../errors.js'

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
  const { t } = useT()
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
        setError(errorText(t, cause, 'login.error'))
      })
      .finally(() => { setBusy(false) })
  }

  return (
    <div className="login">
      {/* La puerta lleva la misma tinta que la barra de mando: lo primero que
          se ve ya es la herramienta, no una tarjeta blanca cualquiera. */}
      <div className="login__marca">
        <h1>{t('app.nombre')}</h1>
        <p>{t('app.lema')}</p>
      </div>

      <form className="login__card" onSubmit={entrar}>
        {error === null ? null : <div className="error-banner">{error}</div>}

        <label className="login__campo">
          <span>{t('login.correo')}</span>
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
          <span>{t('login.contrasena')}</span>
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
          {busy ? t('login.entrando') : t('login.entrar')}
        </button>

        <p className="faint login__pie">
          {t('login.pie', '')}{' '}
          <code>node packages/api/dist/cli.js crear-superadmin &lt;correo&gt; &lt;nombre&gt;</code>
        </p>
      </form>
    </div>
  )
}
