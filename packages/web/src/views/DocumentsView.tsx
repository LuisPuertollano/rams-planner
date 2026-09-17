import { useEffect, useMemo, useState } from 'react'
import {
  createDocumentType,
  fetchDocuments,
  removeDocumentType,
  setPrecedence,
  updateDocumentType,
  type DocumentCatalogue,
} from '../api.js'

interface Props {
  /** Si esta persona puede tocar el catálogo y las cruces, o sólo mirarlos. */
  readonly canEdit: boolean
}

/**
 * La matriz de documentos: **la fila es condición necesaria de la columna**.
 *
 * El plan de un proyecto de seguridad es, en el fondo, una lista de entregables
 * y el orden en que se pueden hacer. Ese orden no cambia de proyecto a
 * proyecto: lo fija la norma y la forma de trabajar del equipo. Hasta ahora
 * había que volver a dibujarlo a mano en cada plan nuevo, y cada vez salía un
 * poco distinto.
 *
 * Aquí se declara una vez. La diagonal está tapada porque un documento no se
 * espera a sí mismo, y las casillas que cerrarían un ciclo se marcan: si A
 * espera a B y B espera a A, ningún plan que salga de aquí se puede calcular.
 */
export function DocumentsView({ canEdit }: Props): React.JSX.Element {
  const [catalogo, setCatalogo] = useState<DocumentCatalogue | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recargar = async (): Promise<void> => { setCatalogo(await fetchDocuments()) }

  useEffect(() => {
    recargar().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el catálogo')
    })
  }, [])

  const run = (accion: () => Promise<void>): void => {
    setBusy(true)
    setError(null)
    accion()
      .then(recargar)
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : 'No se pudo guardar') })
      .finally(() => { setBusy(false) })
  }

  /** Las cruces, indexadas para pintar la matriz sin recorrerla entera. */
  const cruces = useMemo(() => {
    const set = new Set<string>()
    for (const p of catalogo?.precedences ?? []) set.add(`${p.predecessorId}|${p.successorId}`)
    return set
  }, [catalogo])

  /**
   * Los pares que se esperan mutuamente. No se impide marcarlos —a veces se
   * descubre el ciclo justo al marcar el segundo— pero se señalan en rojo: un
   * plan generado a partir de un ciclo no se puede calcular.
   */
  const ciclos = useMemo(() => {
    const malos = new Set<string>()
    for (const clave of cruces) {
      const [a, b] = clave.split('|')
      if (a !== undefined && b !== undefined && cruces.has(`${b}|${a}`)) malos.add(clave)
    }
    return malos
  }, [cruces])

  if (error !== null && catalogo === null) return <div className="empty"><h3>{error}</h3></div>
  if (catalogo === null) return <div className="empty"><h3>Cargando el catálogo…</h3></div>

  const tipos = catalogo.types

  if (tipos.length === 0) {
    return (
      <div className="empty">
        <h3>Todavía no hay documentos declarados</h3>
        <p style={{ maxWidth: '58ch', margin: '0 auto' }}>
          Aquí se declara <b>una sola vez</b> qué entregables tiene el equipo y cuál es condición necesaria
          de cuál: el Hazard Log antes que el FMECA, el FMECA antes que el Safety Case. Después, cada
          proyecto sólo tiene que decir qué tarea entrega qué documento.
        </p>
        <p className="faint" style={{ maxWidth: '58ch', margin: '12px auto 0' }}>
          Se deja vacío a propósito: los entregables son los vuestros, no los que se le ocurran a la
          herramienta.
        </p>
        {!canEdit ? null : (
          <div className="stat-row" style={{ justifyContent: 'center', marginTop: 20 }}>
            <NuevoDocumento busy={busy} onRun={run} />
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {error === null ? null : <div className="error-banner" style={{ margin: 12 }}>{error}</div>}

      <p className="faint" style={{ padding: '0 16px', maxWidth: '96ch' }}>
        Una cruz dice que <b>el documento de la fila es condición necesaria del de la columna</b>: el de la
        columna no se puede terminar sin el de la fila. Se declara una vez y vale para todos los proyectos.
        La diagonal está tapada porque un documento no se espera a sí mismo, y una casilla en{' '}
        <span className="sensible">rojo</span> es un ciclo: dos documentos que se esperan el uno al otro, lo
        que ningún plan puede cumplir.
      </p>

      <table className="grid grid--matriz">
        <thead>
          <tr>
            <th style={{ minWidth: 240 }}>
              <span className="faint">es condición de ▸</span>
            </th>
            {tipos.map((columna) => (
              <th key={columna.id} title={columna.name}>
                <span className="matriz__cabecera">{columna.code}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tipos.map((fila) => (
            <tr key={fila.id}>
              <td>
                <div className="funcion__nombre">{fila.name}</div>
                <div className="funcion__detalle">
                  {fila.code}
                  {fila.description === null || fila.description === '' ? null : ` · ${fila.description}`}
                  {fila.usedInTasks === 0 ? null : ` · en ${String(fila.usedInTasks)} tarea(s)`}
                </div>
              </td>
              {tipos.map((columna) => {
                const clave = `${fila.id}|${columna.id}`
                const esDiagonal = fila.id === columna.id
                const marcada = cruces.has(clave)
                return (
                  <td
                    key={columna.id}
                    className={
                      esDiagonal ? 'matriz__diagonal' : ciclos.has(clave) ? 'matriz__ciclo' : undefined
                    }
                    title={
                      esDiagonal
                        ? 'Un documento no se espera a sí mismo'
                        : `«${fila.name}» es condición necesaria de «${columna.name}»`
                    }
                  >
                    {esDiagonal ? null : (
                      <input
                        type="checkbox"
                        checked={marcada}
                        disabled={busy || !canEdit}
                        aria-label={`${fila.name} es condición de ${columna.name}`}
                        onChange={() => {
                          run(async () => { await setPrecedence(fila.id, columna.id, !marcada) })
                        }}
                      />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {!canEdit ? null : (
        <div className="toolbar">
          <NuevoDocumento busy={busy} onRun={run} />
          <span className="faint">Quitar un documento:</span>
          {tipos.map((tipo) => (
            <button
              key={tipo.id}
              className="button"
              disabled={busy}
              title={
                tipo.usedInTasks === 0
                  ? `Retirar «${tipo.name}»`
                  : `Retirar «${tipo.name}», que ahora mismo entregan ${String(tipo.usedInTasks)} tarea(s)`
              }
              onClick={() => {
                const aviso =
                  tipo.usedInTasks === 0
                    ? `¿Retirar «${tipo.name}»? Desaparece de la matriz.`
                    : `«${tipo.name}» lo entregan ${String(tipo.usedInTasks)} tarea(s). ` +
                      'Retirarlo lo saca de la matriz y de sus fichas. ¿Seguir?'
                if (window.confirm(aviso)) run(async () => { await removeDocumentType(tipo.id) })
              }}
            >
              ✕ {tipo.code}
            </button>
          ))}
        </div>
      )}

      {!canEdit ? null : (
        <div className="toolbar">
          <span className="faint">
            Renombrar: pulsa el nombre de una fila para cambiarlo.
          </span>
          {tipos.map((tipo) => (
            <button
              key={tipo.id}
              className="button"
              disabled={busy}
              onClick={() => {
                const name = window.prompt(`Nombre de «${tipo.code}»`, tipo.name)
                if (name === null || name.trim() === '') return
                const description = window.prompt('Para qué es', tipo.description ?? '') ?? ''
                run(async () => {
                  await updateDocumentType(tipo.id, { name: name.trim(), description })
                })
              }}
            >
              ✎ {tipo.code}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function NuevoDocumento({
  busy,
  onRun,
}: {
  readonly busy: boolean
  readonly onRun: (accion: () => Promise<void>) => void
}): React.JSX.Element {
  return (
    <button
      className="button"
      disabled={busy}
      onClick={() => {
        const name = window.prompt('Nombre del documento (por ejemplo, «Hazard Log preliminar»)')
        if (name === null || name.trim() === '') return
        const code = window.prompt(
          'Código corto, el que se verá en la cabecera de la matriz',
          name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 12),
        )
        if (code === null || code.trim() === '') return
        const description = window.prompt('Para qué es este documento', '') ?? ''
        onRun(async () => { await createDocumentType(code.trim(), name.trim(), description) })
      }}
    >
      + Documento
    </button>
  )
}
