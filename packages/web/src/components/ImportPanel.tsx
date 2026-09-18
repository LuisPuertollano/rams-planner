import { useEffect, useRef, useState } from 'react'
import { fetchImportSpec, type ImportSpec } from '../api.js'
import { errorRows, errorText } from '../errors.js'
import { existeClave, useT } from '../i18n/index.js'

interface Props<R> {
  /** Qué importación es. Decide el contrato que se pide y la plantilla. */
  readonly tipo: 'plan' | 'actuals' | 'documents' | 'team'
  readonly onClose: () => void
  readonly importar: (texto: string) => Promise<R>
  /** La frase de «ha ido bien», con las cifras de esa importación. */
  readonly resumen: (resultado: R) => string
  /** Lo que no impidió cargar pero merece leerse. */
  readonly avisos?: ((resultado: R) => readonly string[]) | undefined
  /** Para que el resto de la aplicación recargue si hace falta. */
  readonly onImported?: (() => void) | undefined
  /**
   * Cuando ya hay datos, exportarlos es la mejor plantilla que existe: trae las
   * columnas reales y los valores reales. Se ofrece si la pantalla la tiene.
   */
  readonly exportarUrl?: string | undefined
}

/**
 * Qué fichero hace falta, antes de pedirlo.
 *
 * Nació de una frase que lo resume todo: «el CSV puede tener mil formas y no sé
 * lo que esperas». Antes de esto había un botón «Plantilla» al lado del de
 * importar, sin decir que fuera la respuesta a esa pregunta; la plantilla no
 * explicaba ninguna columna; y en el parte de horas el enlace sólo aparecía
 * **después** de importar, que es cuando ya no sirve.
 *
 * Ahora pulsar «Importar» abre esto, y esto enseña, por este orden: qué hace la
 * importación, las reglas que conviene saber antes de rellenar nada, la tabla
 * de columnas con un ejemplo real en cada una, y sólo entonces el botón de
 * elegir el fichero.
 *
 * La tabla **se pide a la API**, no se escribe aquí. Una copia en la interfaz
 * se queda vieja el día que alguien añade una columna al parser; esto no puede.
 */
export function ImportPanel<R>({
  tipo, onClose, importar, resumen, avisos, onImported, exportarUrl,
}: Props<R>): React.JSX.Element {
  const { t } = useT()
  const [spec, setSpec] = useState<ImportSpec | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<readonly string[]>([])
  const [hecho, setHecho] = useState<{ texto: string; avisos: readonly string[] } | null>(null)
  const ficheroRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchImportSpec(tipo)
      .then(setSpec)
      .catch((cause: unknown) => { setError(errorText(t, cause, 'error.local.formato')) })
  }, [tipo])

  /**
   * El texto de la columna o de la regla, del diccionario si está y del
   * servidor si no.
   *
   * Mismo trato que los hallazgos y los errores: el servidor manda el contrato
   * —que es lo que el parser cumple de verdad— y la interfaz escribe la frase
   * cuando la tiene traducida. Hoy sólo la tiene en castellano, y por eso el
   * respaldo no es un adorno: es lo que se lee en los otros tres idiomas.
   */
  const frase = (clave: string, respaldo: string): string => {
    const completa = `importar.${tipo}.${clave}`
    return existeClave(completa) ? t(completa) : respaldo
  }

  const cargar = (file: File | undefined): void => {
    if (file === undefined) return
    setBusy(true)
    setError(null)
    setDetalle([])
    setHecho(null)
    file
      .text()
      .then(async (contenido) => {
        const resultado = await importar(contenido)
        setHecho({ texto: resumen(resultado), avisos: avisos?.(resultado) ?? [] })
        onImported?.()
      })
      .catch((cause: unknown) => {
        setError(errorText(t, cause, 'error.local.fichero'))
        setDetalle(errorRows(cause))
      })
      .finally(() => {
        setBusy(false)
        if (ficheroRef.current !== null) ficheroRef.current.value = ''
      })
  }

  return (
    <>
      <button className="backdrop" onClick={onClose} aria-label={t('importar.cerrar')} />
      <aside className="why why--ancho" role="dialog" aria-label={t('importar.titulo')}>
        <div className="why__head">
          <h3 style={{ margin: 0 }}>{t('importar.titulo')}</h3>
          <button className="button" onClick={onClose} style={{ marginLeft: 'auto' }}>
            {t('importar.cerrar')}
          </button>
        </div>

        <div className="why__body">
          {error === null ? null : (
            <div className="error-banner">
              <b>{error}</b>
              {detalle.length === 0 ? null : (
                <ul>{detalle.slice(0, 12).map((fila) => <li key={fila}>{fila}</li>)}</ul>
              )}
              {detalle.length <= 12 ? null : (
                <p className="faint">{t('importar.yMas', detalle.length - 12)}</p>
              )}
            </div>
          )}

          {hecho === null ? null : (
            <div className="ok-banner">
              <b>{hecho.texto}</b>
              {hecho.avisos.length === 0 ? null : (
                <ul>{hecho.avisos.slice(0, 8).map((fila) => <li key={fila}>{fila}</li>)}</ul>
              )}
            </div>
          )}

          {spec === null ? (
            <p className="faint">{t('app.cargando')}</p>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>{frase('resumen', spec.resumen)}</p>

              <h4>{t('importar.reglas')}</h4>
              <ul className="importar__reglas">
                {spec.reglas.map((regla, indice) => (
                  <li key={regla}>{frase(`regla.${String(indice)}`, regla)}</li>
                ))}
              </ul>

              <h4>{t('importar.columnas')}</h4>
              <p className="faint" style={{ marginTop: 0 }}>{t('importar.columnasNota')}</p>
              <table className="grid grid--texto">
                <thead>
                  <tr>
                    <th>{t('importar.col.nombre')}</th>
                    <th>{t('importar.col.haceFalta')}</th>
                    <th>{t('importar.col.que')}</th>
                    <th>{t('importar.col.ejemplo')}</th>
                  </tr>
                </thead>
                <tbody>
                  {spec.columnas.map((columna) => (
                    <tr key={columna.nombre}>
                      <td><code>{columna.nombre}</code></td>
                      <td className={columna.obligatoria ? 'sensible' : 'faint'}>
                        {columna.obligatoria ? t('importar.si') : t('importar.no')}
                      </td>
                      <td>{frase(`col.${columna.nombre}`, columna.que)}</td>
                      <td className="faint"><code>{columna.ejemplo}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h4>{t('importar.plantilla.titulo')}</h4>
              <p className="faint" style={{ marginTop: 0 }}>{t('importar.plantilla.explica')}</p>
              <div className="toolbar" style={{ padding: 0 }}>
                <a className="button button--primary" href={`/api/import/${tipo}/plantilla.csv`}>
                  {t('importar.plantilla.descargar')}
                </a>
                {exportarUrl === undefined ? null : (
                  <a className="button" href={exportarUrl} title={t('importar.exportarTitulo')}>
                    {t('importar.exportar')}
                  </a>
                )}
              </div>

              <h4>{t('importar.cargar.titulo')}</h4>
              <input
                ref={ficheroRef}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(event) => { cargar(event.target.files?.[0]) }}
              />
              <div className="toolbar" style={{ padding: 0 }}>
                <button
                  className="button button--primary"
                  disabled={busy}
                  onClick={() => { ficheroRef.current?.click() }}
                >
                  {busy ? t('importar.cargando') : t('importar.elegir')}
                </button>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  )
}
