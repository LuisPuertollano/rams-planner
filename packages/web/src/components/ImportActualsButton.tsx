import { useRef, useState } from 'react'
import { errorRows, errorText } from '../errors.js'
import { hours, shortDate } from '../format.js'
import { useT } from '../i18n/index.js'

interface ActualsResult {
  readonly rows: number
  readonly saved: number
  readonly minutes: number
  readonly projects: number
  readonly people: number
  readonly from: string
  readonly to: string
  readonly warnings: readonly string[]
}

/**
 * Carga del parte de horas.
 *
 * Hermano de `ImportButton` y deliberadamente no el mismo: **no recalcula**. El
 * plan dice cuándo puede pasar el trabajo y lo que ya pasó no cambia esa
 * respuesta, así que cargar horas no invalida nada de lo que hay en pantalla.
 * Por eso tampoco avisa a nadie de que recargue.
 *
 * Los errores salen con su número de fila: corregir un parte de trescientas
 * líneas de error en error es inaceptable.
 */
export function ImportActualsButton(): React.JSX.Element {
  const { t, locale } = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ActualsResult | null>(null)
  const [problems, setProblems] = useState<{ message: string; rows: readonly string[] } | null>(null)

  const onFile = (file: File | undefined): void => {
    if (file === undefined) return
    setBusy(true)
    setResult(null)
    setProblems(null)

    file
      .text()
      .then(async (text) => {
        const response = await fetch('/api/import/actuals', {
          method: 'POST',
          headers: { 'content-type': 'text/csv' },
          body: text,
        })
        const body = (await response.json()) as ActualsResult & { error?: string; rows?: unknown }
        if (!response.ok) {
          setProblems({
            message: body.error ?? t('horas.noSePudo'),
            rows: Array.isArray(body.rows) ? (body.rows as readonly string[]) : [],
          })
          return
        }
        setResult(body)
      })
      .catch((cause: unknown) => {
        setProblems({ message: errorText(t, cause, 'error.local.fichero'), rows: errorRows(cause) })
      })
      .finally(() => {
        setBusy(false)
        if (inputRef.current !== null) inputRef.current.value = ''
      })
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(event) => { onFile(event.target.files?.[0]) }}
      />
      <button
        className="button"
        disabled={busy}
        onClick={() => { inputRef.current?.click() }}
        title={t('horas.importarTitulo')}
      >
        {busy ? t('horas.importando') : t('horas.importar')}
      </button>

      {result === null && problems === null ? null : (
        <div className="import-result" role="status">
          {problems !== null ? (
            <>
              <b>{problems.message}</b>
              <ul>
                {problems.rows.slice(0, 8).map((row) => (
                  <li key={row}>{row}</li>
                ))}
              </ul>
              {problems.rows.length > 8 ? (
                <p className="faint">{t('horas.yMas', problems.rows.length - 8)}</p>
              ) : null}
            </>
          ) : result === null ? null : (
            <>
              <b>
                {t(
                  'horas.resultado',
                  hours(result.minutes, 0, locale),
                  result.rows,
                  result.saved,
                  result.projects,
                  result.people,
                  shortDate(result.from),
                  shortDate(result.to),
                )}
              </b>
              {result.warnings.slice(0, 5).map((warning) => (
                <p className="faint" key={warning}>
                  {warning}
                </p>
              ))}
            </>
          )}
          <a className="button" href="/api/import/plantilla-horas.csv">
            {t('horas.plantilla')}
          </a>
          <button className="button" onClick={() => { setResult(null); setProblems(null) }}>
            {t('app.entendido')}
          </button>
        </div>
      )}
    </>
  )
}
