import { useEffect, useMemo, useState } from 'react'
import { fetchReconciliation, type CasillaConciliacion, type Conciliacion, type MotivoDescuadre } from '../api.js'
import { errorText } from '../errors.js'
import { hours, monthLabel, percent } from '../format.js'
import { useT, type Diccionario, type Traductor } from '../i18n/index.js'
import { activePeriods } from '../periods.js'

interface Props {
  readonly puedeImportar: boolean
  readonly onImportar: (tipo: 'monthly' | 'splits') => void
}

/**
 * Los cuatro motivos, de peor a menos malo, con su color y su frase.
 *
 * El orden es el de la gravedad y no el alfabético: la leyenda se lee de
 * izquierda a derecha y lo primero tiene que ser lo que hay que arreglar antes.
 */
const MOTIVOS: readonly (readonly [MotivoDescuadre, string, keyof Diccionario])[] = [
  ['dos-caminos', 'severity-blocking', 'conciliar.motivo.dos-caminos'],
  ['no-suma-cien', 'severity-error', 'conciliar.motivo.no-suma-cien'],
  ['sin-declarar', 'severity-warning', 'conciliar.motivo.sin-declarar'],
  ['sin-horas', 'severity-info', 'conciliar.motivo.sin-horas'],
]

const COLOR = new Map(MOTIVOS.map(([motivo, token]) => [motivo, token]))
const FRASE = new Map(MOTIVOS.map(([motivo, , clave]) => [motivo, clave]))

/** El texto de una casilla: el porcentaje que ha llegado a una tarea. */
function laCifra(casilla: CasillaConciliacion, t: Traductor['t']): string {
  if (casilla.minutes === 0) return t('conciliar.soloDeclarado')
  return percent(Math.round((casilla.allocated * 10_000) / casilla.minutes))
}

/**
 * La conciliación: qué horas han llegado a una tarea y cuáles no.
 *
 * Existe porque el descuadre es **lo normal**, no la excepción. Las horas
 * llegan del sistema de fichaje por proyecto y mes; el reparto por tarea lo
 * declara cada persona; y entre las dos cosas se cuela un mes sin declarar, una
 * declaración que suma 90 % o un proyecto que alguien confundió con otro.
 *
 * Sin esta pantalla nada de eso se ve: el informe enseña menos gasto del real y
 * no hay forma de sospecharlo. La pregunta que contesta es «¿por qué el FMECA
 * dice 12 h si Ana lleva tres semanas con él?».
 *
 * La matriz es persona × mes y no una lista, por lo mismo que el mapa de calor:
 * treinta personas por doce meses son trescientas sesenta casillas, y lo que
 * hace falta ver de un vistazo es **en qué mes de quién** hay que entrar.
 */
export function ReconcileView({ puedeImportar, onImportar }: Props): React.JSX.Element {
  const { t, locale } = useT()
  const hoy = new Date()
  const [desde, setDesde] = useState(`${String(hoy.getUTCFullYear())}-01-01`)
  const [hasta, setHasta] = useState(`${String(hoy.getUTCFullYear())}-12-31`)
  const [datos, setDatos] = useState<Conciliacion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [elegida, setElegida] = useState<CasillaConciliacion | null>(null)

  useEffect(() => {
    setOcupado(true)
    setError(null)
    fetchReconciliation(desde, hasta)
      .then((respuesta) => { setDatos(respuesta); setElegida(null) })
      .catch((cause: unknown) => { setError(errorText(t, cause, 'error.local.conciliar')) })
      .finally(() => { setOcupado(false) })
  }, [desde, hasta])

  const periodos = useMemo(
    () => activePeriods((datos?.matriz ?? []).map((casilla) => casilla.period)),
    [datos],
  )
  const porClave = useMemo(() => {
    const mapa = new Map<string, CasillaConciliacion>()
    for (const casilla of datos?.matriz ?? []) mapa.set(`${casilla.resourceId}|${casilla.period}`, casilla)
    return mapa
  }, [datos])

  const sinRepartir = (datos?.minutesIn ?? 0) - (datos?.minutesAllocated ?? 0)

  return (
    <section className="card">
      <h3 style={{ margin: '0 0 4px' }}>{t('conciliar.titulo')}</h3>
      <p className="faint" style={{ margin: '0 0 10px', maxWidth: '90ch' }}>{t('conciliar.explica')}</p>

      <div className="toolbar">
        <label className="field"><span>{t('informe.desde')}</span>
          <input className="input" type="date" value={desde} onChange={(e) => { setDesde(e.target.value) }} />
        </label>
        <label className="field"><span>{t('informe.hasta')}</span>
          <input className="input" type="date" value={hasta} onChange={(e) => { setHasta(e.target.value) }} />
        </label>
        {!puedeImportar ? null : (
          <>
            <button className="button" onClick={() => { onImportar('monthly') }}>
              {t('conciliar.cargarHoras')}
            </button>
            <button className="button" onClick={() => { onImportar('splits') }}>
              {t('conciliar.cargarReparto')}
            </button>
          </>
        )}
      </div>

      {error === null ? null : <div className="error-banner" style={{ marginTop: 10 }}>{error}</div>}

      {/* La cifra por la que se entra aquí, arriba del todo y sin buscarla. */}
      {datos === null ? null : (
        <div className={sinRepartir === 0 ? 'ok-banner' : 'warn-banner'} style={{ marginTop: 10 }}>
          {sinRepartir === 0
            ? t('conciliar.todoCuadra', hours(datos.minutesIn, 0, locale))
            : t(
                'conciliar.faltan',
                hours(sinRepartir, 0, locale),
                hours(datos.minutesIn, 0, locale),
                percent(datos.minutesIn === 0 ? 0 : Math.round((sinRepartir * 10_000) / datos.minutesIn)),
              )}
        </div>
      )}

      {datos === null || periodos.length === 0 ? (
        ocupado ? null : <div className="empty" style={{ marginTop: 12 }}><h3>{t('conciliar.vacio')}</h3></div>
      ) : (
        <>
          <table className="grid" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>{t('col.recurso')}</th>
                {periodos.map((periodo) => <th key={periodo}>{monthLabel(periodo)}</th>)}
              </tr>
            </thead>
            <tbody>
              {datos.people.map((persona) => (
                <tr key={persona.id}>
                  <td>{persona.displayName}</td>
                  {periodos.map((periodo) => {
                    const casilla = porClave.get(`${persona.id}|${periodo}`)
                    if (casilla === undefined) {
                      return <td key={periodo} style={{ padding: 0 }} className="faint">·</td>
                    }
                    // Un mes que cuadra lleva el gris neutro, no nada: si sólo
                    // se pintaran los malos, una fila entera de texto suelto no
                    // se leería como una rejilla y habría que contar columnas
                    // para saber de qué mes habla cada cifra.
                    const token = casilla.motivo === null ? 'util-idle' : COLOR.get(casilla.motivo)
                    const cuadra = casilla.motivo === null
                    return (
                      <td key={periodo} style={{ padding: 0 }}>
                        <button
                          className={cuadra ? 'heat' : 'heat heat--motivo'}
                          style={{ background: `var(--${token ?? 'util-idle'})` }}
                          onClick={() => { setElegida(casilla) }}
                          title={t(
                            'conciliar.casilla',
                            persona.displayName,
                            monthLabel(periodo),
                            hours(casilla.allocated, 0, locale),
                            hours(casilla.minutes, 0, locale),
                          )}
                        >
                          {laCifra(casilla, t)}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="legend" style={{ marginTop: 10 }}>
            <span>{t('conciliar.leyenda')}</span>
            {MOTIVOS.map(([motivo, token, clave]) => (
              <span key={motivo}>
                <span className="legend__swatch" style={{ background: `var(--${token})` }} />
                {t(clave)}
              </span>
            ))}
          </div>

          {/* El detalle de la casilla elegida: qué proyecto y qué le pasa. */}
          {elegida === null ? (
            <p className="faint" style={{ marginTop: 10 }}>{t('conciliar.pincha')}</p>
          ) : (
            <table className="grid grid--inline" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>{t('col.proyecto')}</th>
                  <th>{t('conciliar.col.motivo')}</th>
                  <th className="num">{t('conciliar.col.horasFuera')}</th>
                  <th className="num">{t('conciliar.col.declarado')}</th>
                  <th>{t('conciliar.col.arreglo')}</th>
                </tr>
              </thead>
              <tbody>
                {datos.descuadres
                  .filter((fila) => fila.resourceId === elegida.resourceId && fila.period === elegida.period)
                  .map((fila) => (
                    <tr key={`${fila.projectId}|${fila.motivo}`}>
                      <td>{fila.projectCode}</td>
                      <td>{t(FRASE.get(fila.motivo) ?? 'conciliar.motivo.sin-declarar')}</td>
                      <td className="num">{fila.minutes === 0 ? '—' : hours(fila.minutes, 0, locale)}</td>
                      <td className="num">{fila.declaredBp === 0 ? '—' : percent(fila.declaredBp)}</td>
                      <td className="faint">{t(`conciliar.arreglo.${fila.motivo}` as keyof Diccionario)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  )
}
