import { useRef, useState } from 'react'

interface ImportResult {
  readonly projects: number
  readonly tasks: number
  readonly dependencies: number
  readonly assignments: number
  readonly resourcesCreated: readonly string[]
  readonly warnings: readonly string[]
}

interface Props {
  readonly onImported: () => void
}

/**
 * Importación de un plan desde el CSV que cualquiera ya tiene en Excel.
 *
 * Los errores se enseñan con el número de fila: «falta el nombre de la tarea en
 * la fila 12» es accionable; «error al importar» no lo es.
 */
export function ImportButton({ onImported }: Props): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [problems, setProblems] = useState<{ message: string; rows: readonly string[] } | null>(null)

  const onFile = (file: File | undefined): void => {
    if (file === undefined) return
    setBusy(true)
    setResult(null)
    setProblems(null)

    file
      .text()
      .then(async (text) => {
        const response = await fetch('/api/import/plan', {
          method: 'POST',
          headers: { 'content-type': 'text/csv' },
          body: text,
        })
        const body = (await response.json()) as ImportResult & { error?: string; rows?: readonly string[] }
        if (!response.ok) {
          setProblems({ message: body.error ?? 'No se pudo importar', rows: body.rows ?? [] })
          return
        }
        setResult(body)
        onImported()
      })
      .catch((cause: unknown) => {
        setProblems({ message: cause instanceof Error ? cause.message : 'No se pudo leer el fichero', rows: [] })
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
        title="Importar un plan desde un CSV"
      >
        {busy ? 'Importando…' : 'Importar CSV'}
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
              {problems.rows.length > 8 ? <p className="faint">…y {problems.rows.length - 8} más.</p> : null}
            </>
          ) : result === null ? null : (
            <>
              <b>
                Importado: {result.projects} proyecto(s), {result.tasks} tareas, {result.dependencies} enlaces y{' '}
                {result.assignments} asignaciones.
              </b>
              {result.resourcesCreated.length === 0 ? null : (
                <p>
                  Personas nuevas: {result.resourcesCreated.join(', ')}. Se han creado con jornada estándar y sin
                  tarifa: revísalas.
                </p>
              )}
              {result.warnings.slice(0, 5).map((warning) => (
                <p className="faint" key={warning}>
                  {warning}
                </p>
              ))}
            </>
          )}
          <button className="button" onClick={() => { setResult(null); setProblems(null) }}>
            Cerrar
          </button>
        </div>
      )}
    </>
  )
}
