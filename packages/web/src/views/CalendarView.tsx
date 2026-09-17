import { useEffect, useMemo, useState } from 'react'
import { fetchCapacity, fetchTeam, type DailyCapacity, type ResourceDetail } from '../api.js'
import { hours } from '../format.js'
import { errorText } from '../errors.js'
import { useT } from '../i18n/index.js'

interface Props {
  readonly runId: string
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

const TIPOS: Readonly<Record<string, string>> = {
  vacation: 'Vacaciones',
  sick: 'Baja',
  training: 'Formación',
  parental: 'Permiso parental',
  public_holiday: 'Festivo propio',
  other: 'Ausencia',
}

/** Días de un mes, como fechas ISO. Sin `Date`: el mes es un dato, no un instante. */
function diasDe(year: number, month: number): readonly string[] {
  const bisiesto = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const largos = [31, bisiesto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const total = largos[month] ?? 30
  const dias: string[] = []
  for (let day = 1; day <= total; day += 1) {
    dias.push(`${String(year)}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }
  return dias
}

/**
 * El calendario del equipo: quién está fuera, cuándo, y qué capacidad queda.
 *
 * Las ausencias ya restaban capacidad desde el primer día; lo que faltaba era
 * verlas. Un agosto en el que coinciden cuatro personas no se detecta mirando
 * siete fichas individuales, se detecta de un vistazo en una rejilla.
 *
 * La capacidad de cada día sale del cálculo, no de rehacer aquí el calendario:
 * es exactamente la que el motor ha usado para repartir el trabajo.
 */
export function CalendarView({ runId }: Props): React.JSX.Element {
  const { t } = useT()
  const hoy = new Date()
  const [year, setYear] = useState(hoy.getFullYear())
  const [month, setMonth] = useState(hoy.getMonth())
  const [team, setTeam] = useState<readonly ResourceDetail[] | null>(null)
  const [days, setDays] = useState<readonly DailyCapacity[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fechas = useMemo(() => diasDe(year, month), [year, month])
  const desde = fechas[0] ?? ''
  const hasta = fechas[fechas.length - 1] ?? ''

  useEffect(() => {
    if (runId === '' || desde === '' || hasta === '') return
    let cancelado = false
    Promise.all([fetchTeam(), fetchCapacity(runId, desde, hasta)])
      .then(([equipo, capacidad]) => {
        if (cancelado) return
        setTeam(equipo.resources)
        setDays(capacidad)
      })
      .catch((cause: unknown) => {
        if (!cancelado) setError(errorText(t, cause, 'error.local.calendario'))
      })
    return () => { cancelado = true }
  }, [runId, desde, hasta])

  const capacidadDe = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of days ?? []) map.set(`${row.resourceId}|${row.date}`, row.capacityMinutes)
    return map
  }, [days])

  /** La ausencia que cubre ese día, si la hay. Es lo que distingue estar de
   *  vacaciones de que sea sábado: en capacidad los dos son cero. */
  const ausenciaDe = (resource: ResourceDetail, fecha: string): string | null => {
    const encontrada = resource.absences.find((item) => item.from <= fecha && fecha <= item.to)
    return encontrada === undefined ? null : (TIPOS[encontrada.kind] ?? 'Ausencia')
  }

  const mover = (delta: number): void => {
    const total = month + delta
    setYear(year + Math.floor(total / 12))
    setMonth(((total % 12) + 12) % 12)
  }

  if (runId === '') {
    return <div className="empty"><h3>Todavía no hay ningún cálculo</h3><p>La capacidad sale del plan calculado.</p></div>
  }
  if (team === null || days === null) {
    return <div className="empty"><h3>{error ?? 'Cargando el calendario…'}</h3></div>
  }

  const capacidadDelMes = (days).reduce((sum, row) => sum + row.capacityMinutes, 0)
  const brutoDelMes = (days).reduce((sum, row) => sum + row.grossMinutes, 0)
  const cargaDelMes = (days).reduce((sum, row) => sum + row.plannedMinutes, 0)
  // Sin factores declarados los dos números coinciden, y decirlo sería ruido.
  const reservadoDelMes = brutoDelMes - capacidadDelMes

  return (
    <>
      {error === null ? null : <div className="error-banner" style={{ margin: 12 }}>{error}</div>}
      <div className="toolbar">
        <button className="button" onClick={() => { mover(-1) }}>‹</button>
        <b style={{ minWidth: 150, textAlign: 'center' }}>{MESES[month]} {year}</b>
        <button className="button" onClick={() => { mover(1) }}>›</button>
        <span className="faint">
          Capacidad del equipo este mes: <b>{hours(capacidadDelMes)} h</b>, ya con las ausencias y los
          festivos descontados
          {reservadoDelMes === 0 ? null : (
            <> · de las <b>{hours(brutoDelMes)} h</b> del calendario se reservan <b>{hours(reservadoDelMes)} h</b> para
            tiempo indirecto y para lo que no ha pasado todavía</>
          )}
          {' · '}{cargaDelMes === 0 ? 'sin trabajo comprometido' : <>comprometidas <b>{hours(cargaDelMes)} h</b></>}
        </span>
      </div>

      <table className="grid grid--calendar">
        <thead>
          <tr>
            <th style={{ minWidth: 160 }}>Persona</th>
            {fechas.map((fecha) => (
              <th key={fecha}>{fecha.slice(8)}</th>
            ))}
            <th>Horas</th>
          </tr>
        </thead>
        <tbody>
          {team.map((resource) => {
            const total = fechas.reduce((sum, fecha) => sum + (capacidadDe.get(`${resource.id}|${fecha}`) ?? 0), 0)
            return (
              <tr key={resource.id}>
                <td>{resource.displayName}</td>
                {fechas.map((fecha) => {
                  const capacidad = capacidadDe.get(`${resource.id}|${fecha}`) ?? 0
                  const ausencia = ausenciaDe(resource, fecha)
                  const clase =
                    ausencia !== null ? 'dia--ausente' : capacidad === 0 ? 'dia--cerrado' : 'dia--abierto'
                  const titulo =
                    ausencia !== null
                      ? `${resource.displayName} · ${fecha}: ${ausencia}`
                      : capacidad === 0
                        ? `${resource.displayName} · ${fecha}: no laborable`
                        : `${resource.displayName} · ${fecha}: ${hours(capacidad, 1)} h disponibles`
                  return <td key={fecha} className={clase} title={titulo} />
                })}
                <td className="cell--derived">{hours(total)}</td>
              </tr>
            )
          })}
          <tr className="row--total">
            <td>Capacidad del equipo</td>
            {fechas.map((fecha) => {
              const total = team.reduce(
                (sum, resource) => sum + (capacidadDe.get(`${resource.id}|${fecha}`) ?? 0),
                0,
              )
              return (
                <td key={fecha} className="dia--total" title={`${fecha}: ${hours(total, 1)} h de equipo`}>
                  {total === 0 ? '' : Math.round(total / 60)}
                </td>
              )
            })}
            <td>{hours(capacidadDelMes)}</td>
          </tr>
        </tbody>
      </table>

      <div className="legend" style={{ padding: '12px 16px' }}>
        <span><span className="legend__swatch dia--ausente" /> Ausencia declarada</span>
        <span><span className="legend__swatch dia--cerrado" /> No laborable (fin de semana o festivo)</span>
        <span><span className="legend__swatch dia--abierto" /> Disponible</span>
      </div>
    </>
  )
}
