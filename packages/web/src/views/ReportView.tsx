import { useMemo, useState } from 'react'
import {
  fetchReport,
  type Highlight,
  type Project,
  type Report,
  type ReportRisk,
} from '../api.js'
import { findingText, severityLabel } from '../findings.js'
import { days, euros, fullDate, hours, monthLabel, percent, shortDate, utilizationClass } from '../format.js'
import { useT, type Diccionario } from '../i18n/index.js'
import { errorText } from '../errors.js'

interface Props {
  readonly projects: readonly Project[]
}

/** Atajos de periodo. No hay uno «por defecto»: el que manda es todo el plan. */
type Atajo = 'todo' | 'trimestre' | 'semestre' | 'anio'

/**
 * El informe: uno o varios proyectos, en el periodo que se elija.
 *
 * Arriba, el resumen —lo que habría que leer si sólo se leyeran cinco líneas—;
 * debajo, el detalle del que salen esas cinco líneas. Las dos cosas vienen del
 * mismo cálculo y llevan su identificador al pie: dos personas que miran este
 * informe están mirando los mismos números.
 *
 * Nada de esto es editable, porque nada de esto es un dato declarado: es lo que
 * el motor sacó de los que sí lo son.
 */
export function ReportView({ projects }: Props): React.JSX.Element {
  const { t, locale } = useT()
  const aplicables = useMemo(() => projects.filter((p) => !p.isTemplate), [projects])

  const [elegidos, setElegidos] = useState<ReadonlySet<string>>(new Set())
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [informe, setInforme] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  const aplicarAtajo = (atajo: Atajo): void => {
    const hoy = new Date()
    const iso = (fecha: Date): string => fecha.toISOString().slice(0, 10)
    if (atajo === 'todo') {
      setDesde('')
      setHasta('')
      return
    }
    if (atajo === 'trimestre') {
      const primerMes = Math.trunc(hoy.getUTCMonth() / 3) * 3
      setDesde(iso(new Date(Date.UTC(hoy.getUTCFullYear(), primerMes, 1))))
      setHasta(iso(new Date(Date.UTC(hoy.getUTCFullYear(), primerMes + 3, 0))))
      return
    }
    if (atajo === 'semestre') {
      setDesde(iso(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1))))
      setHasta(iso(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 6, 0))))
      return
    }
    setDesde(`${String(hoy.getUTCFullYear())}-01-01`)
    setHasta(`${String(hoy.getUTCFullYear())}-12-31`)
  }

  const generar = (): void => {
    setBusy(true)
    setError(null)
    setCopiado(false)
    fetchReport([...elegidos], desde, hasta)
      .then(setInforme)
      .catch((cause: unknown) => {
        setInforme(null)
        setError(errorText(t, cause, 'error.local.informe'))
      })
      .finally(() => { setBusy(false) })
  }

  const frase = (punto: Highlight): string => contar(t, punto, locale)

  /** «—» cuando no hay horas; una «h» detrás cuando las hay. Nunca «— h». */
  const horas = (minutos: number): string => (minutos === 0 ? '—' : `${hours(minutos)} h`)

  const copiar = (): void => {
    if (informe === null) return
    const texto = [
      ...informe.tldr.map((punto) => `- ${frase(punto)}`),
      '',
      t(
        'informe.pie',
        informe.runId.slice(0, 8),
        fullDate(informe.period.from),
        fullDate(informe.period.to),
        fullDate(informe.asOf),
      ),
    ].join('\n')
    navigator.clipboard
      .writeText(texto)
      .then(() => { setCopiado(true) })
      .catch(() => { setError('El navegador no ha dejado copiar al portapapeles.') })
  }

  return (
    <div className="informe">
      <div className="toolbar">
        <span className="faint">{t('informe.proyectos')}:</span>
        <select
          className="input input--multiple"
          multiple
          size={Math.min(6, Math.max(2, aplicables.length))}
          value={[...elegidos]}
          disabled={busy}
          onChange={(event) => {
            setElegidos(new Set([...event.target.selectedOptions].map((opcion) => opcion.value)))
          }}
        >
          {aplicables.map((proyecto) => (
            <option key={proyecto.id} value={proyecto.id}>
              {proyecto.code} · {proyecto.name}
            </option>
          ))}
        </select>
        <button
          className="button"
          disabled={busy || elegidos.size === 0}
          onClick={() => { setElegidos(new Set()) }}
          title={t('informe.todos')}
        >
          {t('informe.todos')}
        </button>
      </div>

      <div className="toolbar">
        <label>
          {t('informe.desde')}{' '}
          <input
            className="input"
            type="date"
            value={desde}
            disabled={busy}
            onChange={(event) => { setDesde(event.target.value) }}
          />
        </label>
        <label>
          {t('informe.hasta')}{' '}
          <input
            className="input"
            type="date"
            value={hasta}
            disabled={busy}
            onChange={(event) => { setHasta(event.target.value) }}
          />
        </label>
        {(['todo', 'trimestre', 'semestre', 'anio'] as const).map((atajo) => (
          <button
            key={atajo}
            className="button"
            disabled={busy}
            onClick={() => { aplicarAtajo(atajo) }}
          >
            {t(`informe.periodo.${atajo}` as keyof Diccionario)}
          </button>
        ))}
        <button className="button button--primary" disabled={busy} onClick={generar}>
          {busy ? t('informe.generando') : t('informe.generar')}
        </button>
        {informe === null ? null : (
          <button className="button" disabled={busy} onClick={copiar}>
            {copiado ? `✓ ${t('informe.copiado')}` : t('informe.copiar')}
          </button>
        )}
      </div>

      {error === null ? null : <div className="error-banner">{error}</div>}

      {informe === null ? null : (
        <>
          {!informe.costsHidden ? null : <div className="warn-banner">{t('informe.sinCostes')}</div>}
          {!informe.peopleHidden ? null : <div className="warn-banner">{t('informe.sinPersonas')}</div>}
          {!informe.actualsHidden ? null : <div className="warn-banner">{t('informe.sinReales')}</div>}

          <section className="informe__resumen">
            <h3>{t('informe.seccion.resumen')}</h3>
            <ul>
              {informe.tldr.map((punto) => (
                <li key={punto.kind} className={`informe__punto informe__punto--${punto.severity}`}>
                  {frase(punto)}
                </li>
              ))}
            </ul>
          </section>

          {informe.totals.tasksInPeriod === 0 && informe.totals.plannedMinutes === 0 ? (
            <p className="faint" style={{ padding: '0 16px' }}>{t('informe.vacio')}</p>
          ) : null}

          {informe.months.length === 0 ? null : (
            <section>
              <h3>{t('informe.seccion.meses')}</h3>
              <p className="faint" style={{ margin: '0 0 8px', maxWidth: '96ch' }}>
                {t('informe.nota.capacidad')}
              </p>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th>Comprometido</th>
                    {informe.actualsHidden ? null : <th title={t('informe.col.fichadoTitulo')}>{t('informe.col.fichado')}</th>}
                    <th>Capacidad</th>
                    <th>Saturación</th>
                    {informe.costsHidden ? null : <th>Coste</th>}
                  </tr>
                </thead>
                <tbody>
                  {informe.months.map((mes) => (
                    <tr key={mes.period}>
                      <td>{monthLabel(mes.period)}</td>
                      <td>{horas(mes.plannedMinutes)}</td>
                      {informe.actualsHidden ? null : <td>{horas(mes.actualMinutes)}</td>}
                      <td>{informe.peopleHidden ? '—' : horas(mes.capacityMinutes)}</td>
                      <td className={utilizationClass(mes.utilizationBp)}>
                        {informe.peopleHidden ? '—' : percent(mes.utilizationBp)}
                      </td>
                      {informe.costsHidden ? null : <td>{euros(mes.costCents)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {informe.projects.length === 0 ? null : (
            <section>
              <h3>{t('informe.seccion.proyectos')}</h3>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Proyecto</th>
                    <th>Comprometido</th>
                    {informe.actualsHidden ? null : <th title={t('informe.col.fichadoTitulo')}>{t('informe.col.fichado')}</th>}
                    {informe.costsHidden ? null : <th>Coste</th>}
                    <th>Tareas</th>
                    <th>Avance</th>
                    <th>Empieza</th>
                    <th>Termina</th>
                    <th>Críticas</th>
                    <th>En riesgo</th>
                  </tr>
                </thead>
                <tbody>
                  {informe.projects.map((proyecto) => (
                    <tr key={proyecto.projectId}>
                      <td title={proyecto.name}>{proyecto.code}</td>
                      <td>{horas(proyecto.plannedMinutes)}</td>
                      {informe.actualsHidden ? null : <td>{horas(proyecto.actualMinutes)}</td>}
                      {informe.costsHidden ? null : <td>{euros(proyecto.costCents)}</td>}
                      <td>
                        {proyecto.tasksInPeriod} / {proyecto.tasksTotal}
                      </td>
                      <td>{percent(proyecto.percentCompleteBp)}</td>
                      <td>{shortDate(proyecto.start)}</td>
                      <td>{shortDate(proyecto.finish)}</td>
                      <td>{proyecto.criticalTasks}</td>
                      <td className={proyecto.risks > 0 ? 'warn-dot' : undefined}>{proyecto.risks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {informe.people.length === 0 ? null : (
            <section>
              <h3>{t('informe.seccion.personas')}</h3>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Persona</th>
                    <th>Comprometido</th>
                    {informe.actualsHidden ? null : <th title={t('informe.col.fichadoTitulo')}>{t('informe.col.fichado')}</th>}
                    <th>Capacidad</th>
                    <th>Saturación</th>
                    <th>Peor mes</th>
                    <th>Proyectos</th>
                  </tr>
                </thead>
                <tbody>
                  {informe.people.map((persona) => (
                    <tr key={persona.resourceId}>
                      <td>{persona.displayName}</td>
                      <td>{horas(persona.plannedMinutes)}</td>
                      {informe.actualsHidden ? null : <td>{horas(persona.actualMinutes)}</td>}
                      <td>{horas(persona.capacityMinutes)}</td>
                      <td className={utilizationClass(persona.utilizationBp)}>
                        {percent(persona.utilizationBp)}
                      </td>
                      <td className={utilizationClass(persona.worst?.utilizationBp ?? null)}>
                        {persona.worst === null
                          ? '—'
                          : `${monthLabel(persona.worst.period)} · ${percent(persona.worst.utilizationBp)}`}
                      </td>
                      <td>{persona.projects.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {informe.risks.length === 0 ? null : (
            <section>
              <h3>{t('informe.seccion.riesgos')}</h3>
              <table className="grid grid--texto">
                <thead>
                  <tr>
                    <th>Tarea</th>
                    <th>Proyecto</th>
                    <th>Qué pasa</th>
                    <th>Avance</th>
                  </tr>
                </thead>
                <tbody>
                  {informe.risks.slice(0, 50).map((riesgo) => (
                    <tr key={riesgo.nodeId}>
                      <td>
                        {riesgo.path} {riesgo.name}
                      </td>
                      <td>{riesgo.projectCode}</td>
                      <td className={riesgo.kind === 'retraso' ? 'warn-dot' : 'sensible'}>
                        {motivo(t, riesgo)}
                      </td>
                      <td>{percent(riesgo.percentCompleteBp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {informe.risks.length <= 50 ? null : (
                <p className="faint">
                  … y {informe.risks.length - 50} más. Lo peor va arriba.
                </p>
              )}
            </section>
          )}

          {informe.findings.length === 0 ? null : (
            <section>
              <h3>{t('informe.seccion.hallazgos')}</h3>
              <table className="grid grid--texto">
                <tbody>
                  {informe.findings.slice(0, 50).map((hallazgo, indice) => (
                    <tr key={`${hallazgo.code}-${String(indice)}`}>
                      <td>
                        <span className={`severity severity-${hallazgo.severity}`} />
                        {severityLabel(t, hallazgo.severity)}
                      </td>
                      <td>{hallazgo.entityName ?? '—'}</td>
                      <td>{findingText(t, hallazgo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <p className="faint informe__pie">
            {t(
              'informe.pie',
              informe.runId.slice(0, 8),
              fullDate(informe.period.from),
              fullDate(informe.period.to),
              fullDate(informe.asOf),
            )}
          </p>
        </>
      )}
    </div>
  )
}

/** La frase del punto del resumen, con sus cifras ya en la unidad que se lee. */
function contar(
  t: (clave: keyof Diccionario, ...valores: readonly (string | number)[]) => string,
  punto: Highlight,
  locale: string,
): string {
  const n = (nombre: string): number => punto.numbers[nombre] ?? 0
  /**
   * Las horas de una frase, donde el cero **se escribe**.
   *
   * En una celda, `hours` devuelve «—» y está bien: la raya dice «aquí no hay
   * nada». Dentro de una frase que enumera un reparto, «— h posibles» no se lee
   * como nada, se lee como un hueco sin rellenar. Ahí el cero es el dato.
   */
  const h = (nombre: string): string => (n(nombre) === 0 ? '0' : hours(n(nombre), 0, locale))
  switch (punto.kind) {
    case 'alcance':
      return t('informe.tldr.alcance', n('projects'), n('tasks'), n('months'))
    case 'trabajo':
      return t(
        'informe.tldr.trabajo',
        h('plannedMinutes'),
        h('capacityMinutes'),
        punto.numbers['utilizationBp'] === undefined ? '—' : percent(n('utilizationBp')),
      )
    case 'realidad':
      return t(
        'informe.tldr.realidad',
        h('actualMinutes'),
        h('plannedMinutes'),
        // El mes va como etiqueta y no como cifra: es lo que hace comparable
        // la comparación, no una magnitud.
        punto.labels[0] === undefined || punto.labels[0] === '' ? '—' : monthLabel(punto.labels[0]),
      )
    case 'trabajo-fuera-de-plan':
      return t(
        'informe.tldr.trabajo-fuera-de-plan',
        h('unplannedMinutes'),
        percent(n('shareBp')),
      )
    case 'compromiso':
      return t(
        'informe.tldr.compromiso',
        percent(n('notFirmBp')),
        h('firmMinutes'),
        h('likelyMinutes'),
        h('possibleMinutes'),
      )
    case 'capacidad-reservada':
      return t(
        'informe.tldr.capacidad-reservada',
        h('reservedMinutes'),
        percent(n('reservedBp')),
        h('grossMinutes'),
        h('plannableMinutes'),
      )
    case 'avance':
      return t(
        'informe.tldr.avance',
        percent(n('percentCompleteBp')),
        n('completed'),
        n('inProgress'),
        n('notStarted'),
      )
    case 'coste':
      return t('informe.tldr.coste', euros(n('costCents'), locale))
    case 'sobrecarga':
      return t(
        'informe.tldr.sobrecarga',
        n('people'),
        punto.labels[0] ?? '—',
        punto.labels[1] === undefined || punto.labels[1] === '' ? '—' : monthLabel(punto.labels[1]),
        percent(n('worstUtilizationBp')),
      )
    case 'riesgo':
      return t('informe.tldr.riesgo', n('total'), n('deadline'), n('slack'), n('late'))
    case 'hallazgos':
      return t('informe.tldr.hallazgos', n('blocking'), n('error'), n('warning'))
    case 'sin-fechas':
      return t('informe.tldr.sin-fechas', n('tasks'))
  }
}

function motivo(
  t: (clave: keyof Diccionario, ...valores: readonly (string | number)[]) => string,
  riesgo: ReportRisk,
): string {
  if (riesgo.kind === 'holgura-negativa') {
    return t('informe.riesgo.holgura-negativa', days(riesgo.amount) ?? '')
  }
  return t(`informe.riesgo.${riesgo.kind}`, riesgo.amount)
}
