import { useRef, useState } from 'react'
import { comprobarCopia, restaurarCopia, type CopiaComprobada, type CopiaRestaurada } from '../api.js'
import { errorText } from '../errors.js'
import { useT } from '../i18n/index.js'

interface Props {
  readonly puedeExportar: boolean
  readonly puedeRestaurar: boolean
  readonly onRestaurado: () => void
}

/**
 * Sacar la copia y volver a meterla.
 *
 * Las dos mitades no se parecen en nada y por eso están separadas por una
 * línea: la de arriba es un enlace y no puede romper nada; la de abajo **borra
 * la base entera**.
 *
 * Esa segunda mitad tiene tres frenos, y ninguno sobra: no se puede pulsar sin
 * haber comprobado antes la copia —que es lo que enseña qué trae y avisa si
 * está tocada o es de otra versión—, hay que escribir una palabra a mano, y
 * encima sale la confirmación del navegador. Es la operación más destructiva de
 * la herramienta y la única que no tiene vuelta atrás.
 */
export function BackupPanel({ puedeExportar, puedeRestaurar, onRestaurado }: Props): React.JSX.Element {
  const { t } = useT()
  const entrada = useRef<HTMLInputElement>(null)
  const [conDerivadas, setConDerivadas] = useState(false)
  const [fichero, setFichero] = useState<File | null>(null)
  const [comprobada, setComprobada] = useState<CopiaComprobada | null>(null)
  const [escrito, setEscrito] = useState('')
  const [hecho, setHecho] = useState<CopiaRestaurada | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const PALABRA = t('copia.palabra')

  const elegir = (elegido: File | null): void => {
    setFichero(elegido)
    setComprobada(null)
    setHecho(null)
    setError(null)
    setEscrito('')
  }

  const comprobar = (): void => {
    if (fichero === null) return
    setOcupado(true)
    setError(null)
    comprobarCopia(fichero)
      .then(setComprobada)
      .catch((cause: unknown) => {
        setComprobada(null)
        setError(errorText(t, cause, 'error.local.copiaComprobar'))
      })
      .finally(() => { setOcupado(false) })
  }

  const restaurar = (): void => {
    if (fichero === null || comprobada === null) return
    if (!window.confirm(t('copia.confirma'))) return
    setOcupado(true)
    setError(null)
    restaurarCopia(fichero)
      .then((resultado) => {
        setHecho(resultado)
        setComprobada(null)
        setFichero(null)
        setEscrito('')
        if (entrada.current !== null) entrada.current.value = ''
        onRestaurado()
      })
      .catch((cause: unknown) => { setError(errorText(t, cause, 'error.local.copiaRestaurar')) })
      .finally(() => { setOcupado(false) })
  }

  const filasQueTrae = (comprobada?.tablas ?? []).reduce((suma, fila) => suma + fila.filas, 0)

  return (
    <section className="card" style={{ marginTop: 12 }}>
      <h3 style={{ margin: '0 0 4px' }}>{t('copia.titulo')}</h3>
      <p className="faint" style={{ margin: '0 0 10px', maxWidth: '90ch' }}>{t('copia.explica')}</p>

      {!puedeExportar ? null : (
        <>
          <h4 style={{ marginBottom: 4 }}>{t('copia.sacar.titulo')}</h4>
          <p className="faint" style={{ margin: '0 0 8px', maxWidth: '90ch' }}>
            {t('copia.sacar.explica')}
          </p>
          <div className="toolbar">
            <a className="button button--primary" href={`/api/copia${conDerivadas ? '?derivadas=si' : ''}`}>
              {t('copia.sacar.boton')}
            </a>
            <label className="faint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={conDerivadas}
                onChange={(e) => { setConDerivadas(e.target.checked) }}
              />
              {t('copia.sacar.conDerivadas')}
            </label>
          </div>
          <p className="faint" style={{ marginTop: 6, maxWidth: '90ch' }}>{t('copia.sacar.cron')}</p>
        </>
      )}

      {!puedeRestaurar ? null : (
        <>
          <hr style={{ margin: '18px 0', border: 0, borderTop: '1px solid var(--linea, #ddd)' }} />
          <h4 style={{ marginBottom: 4 }}>{t('copia.meter.titulo')}</h4>
          <div className="warn-banner" style={{ marginBottom: 10 }}>{t('copia.meter.aviso')}</div>

          <div className="toolbar">
            <input
              ref={entrada}
              type="file"
              accept=".zip,application/zip"
              className="input"
              onChange={(e) => { elegir(e.target.files?.[0] ?? null) }}
            />
            <button className="button" disabled={ocupado || fichero === null} onClick={comprobar}>
              {t('copia.meter.comprobar')}
            </button>
          </div>

          {error === null ? null : <div className="error-banner" style={{ marginTop: 10 }}>{error}</div>}

          {comprobada === null ? null : (
            <>
              <div className="notice" style={{ marginTop: 10 }}>
                {t('copia.meter.trae', comprobada.tablas.length, filasQueTrae, comprobada.esquema)}
              </div>
              <table className="grid grid--inline" style={{ marginTop: 8 }}>
                <thead>
                  <tr><th>{t('copia.col.tabla')}</th><th className="num">{t('copia.col.filas')}</th></tr>
                </thead>
                <tbody>
                  {[...comprobada.tablas]
                    .sort((izq, der) => der.filas - izq.filas || izq.tabla.localeCompare(der.tabla))
                    .map((fila) => (
                      <tr key={fila.tabla}>
                        <td>{fila.tabla}</td>
                        <td className="num">{fila.filas}</td>
                      </tr>
                    ))}
                </tbody>
              </table>

              {/* Escribir la palabra a mano: un botón se pulsa sin leer. */}
              <div className="toolbar" style={{ marginTop: 12 }}>
                <label className="faint">{t('copia.meter.escribe', PALABRA)}</label>
                <input
                  className="input"
                  value={escrito}
                  onChange={(e) => { setEscrito(e.target.value) }}
                  style={{ maxWidth: 200 }}
                />
                <button
                  className="button button--danger"
                  disabled={ocupado || escrito.trim().toUpperCase() !== PALABRA}
                  onClick={restaurar}
                >
                  {t('copia.meter.boton')}
                </button>
              </div>
            </>
          )}

          {hecho === null ? null : (
            <>
              <div className="ok-banner" style={{ marginTop: 10 }}>
                {t('copia.meter.hecho', hecho.tablas, hecho.filas, hecho.run.tasks ?? 0)}
              </div>
              {/* Lo que hay que mirar después: la huella. */}
              <p className="faint" style={{ marginTop: 6, maxWidth: '90ch' }}>
                {t('copia.meter.huella')}
              </p>
              {hecho.saltadas.length === 0 ? null : (
                <ul className="faint" style={{ marginTop: 6 }}>
                  {hecho.saltadas.map((saltada) => (
                    <li key={saltada.tabla}><b>{saltada.tabla}</b>: {saltada.motivo}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
