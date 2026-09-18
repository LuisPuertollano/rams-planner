import { useEffect, useMemo, useState } from 'react'
import {
  addAbsence,
  addAvailability,
  addCostRate,
  createResource,
  fetchTeam,
  patchResource,
  removeAbsence,
  removeAvailability,
  removeCostRate,
  removeResource,
  type AbsencePeriod,
  type AvailabilityPeriod,
  type CalendarOption,
  type CostRatePeriod,
  type ResourceDetail,
  type TeamState,
} from '../api.js'
import { euroRate, fullDate, hours, percent } from '../format.js'
import { errorText } from '../errors.js'
import { existeClave, useT, type Traductor } from '../i18n/index.js'

interface Props {
  /** Se llama tras cada cambio: el servidor ya ha recalculado, la pantalla debe recargarse. */
  readonly onChanged: () => void
}

const ABSENCE_KINDS = ['vacation', 'sick', 'training', 'parental', 'public_holiday', 'other'] as const

/** Cómo se dice un tipo de ausencia. El valor del enum es el contrato. */
const absenceLabel = (t: Traductor['t'], kind: string): string => {
  const clave = kind === 'other' ? 'ausencia.otros' : `ausencia.${kind}`
  return existeClave(clave) ? t(clave) : kind
}

const today = (): string => new Date().toISOString().slice(0, 10)

/**
 * La ficha del equipo.
 *
 * Es la única pantalla donde se declara **de qué está hecha la capacidad**: el
 * calendario que se aplica a cada persona, su dedicación por periodos, sus
 * ausencias y su tarifa. Nada de esto es derivado, así que aquí no hay ningún
 * candado: todo se edita. Lo que sí hay es la consecuencia visible — cada
 * cambio recalcula el plan, porque si no la carga que muestra la herramienta
 * dejaría de corresponderse con lo que acabas de declarar.
 */
/**
 * Lo que queda de un día tras los factores de esta persona.
 *
 * Es la misma cuenta que hace el motor —multiplicar, en este orden, redondeando
 * a minutos— y está aquí sólo para poder enseñarla en la ficha. Quien manda es
 * el servidor: esto es un ejemplo, no el número con el que se planifica.
 */
function planificable(minutos: number, resource: ResourceDetail): number {
  const trasIndirecto = Math.round((minutos * (10_000 - resource.indirectBp)) / 10_000)
  return Math.round((trasIndirecto * (10_000 - resource.reserveBp)) / 10_000)
}

export function ResourcesView({ onChanged }: Props): React.JSX.Element {
  const { t } = useT()
  const [team, setTeam] = useState<TeamState | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const reload = async (): Promise<void> => {
    setTeam(await fetchTeam())
  }

  useEffect(() => {
    reload().catch((cause: unknown) => {
      setError(errorText(t, cause, 'error.local.equipo'))
    })
  }, [])

  /** Toda escritura pasa por aquí: recarga la ficha y avisa al resto de la aplicación. */
  const run = (action: () => Promise<void>): void => {
    setBusy(true)
    setError(null)
    action()
      .then(reload)
      .then(onChanged)
      .catch((cause: unknown) => { setError(errorText(t, cause, 'error.local.guardar')) })
      .finally(() => { setBusy(false) })
  }

  const selected = useMemo(() => {
    if (team === null) return null
    return team.resources.find((resource) => resource.id === selectedId) ?? team.resources[0] ?? null
  }, [team, selectedId])

  if (team === null) {
    return (
      <div className="empty">
        <h3>{error ?? t('equipo.cargando')}</h3>
      </div>
    )
  }

  return (
    <div className="team">
      <aside className="team__list">
        <div className="team__list-head">
          <span className="faint">{t('equipo.cuantos', team.resources.length)}</span>
          <button className="button" onClick={() => { setCreating(true) }} disabled={busy}>
            {t('equipo.anadir')}
          </button>
        </div>
        {team.resources.map((resource) => (
          <button
            key={resource.id}
            className="team__item"
            aria-current={selected?.id === resource.id}
            onClick={() => { setSelectedId(resource.id) }}
          >
            <span className="team__item-name">{resource.displayName}</span>
            <span className="team__item-meta">
              {resource.calendarCode ?? t('equipo.sinCalendario')} · {percent(resource.maxUnitsBp)}
              {resource.costRates.length === 0 && team.costsHidden !== true ? (
                <span className="warn-dot" title={t('equipo.sinTarifaAviso')}> ⚠</span>
              ) : null}
            </span>
          </button>
        ))}
        {team.resources.length === 0 ? <p className="faint" style={{ padding: 12 }}>{t('equipo.vacio')}</p> : null}
      </aside>

      <section className="team__detail">
        {error === null ? null : <div className="error-banner">{error}</div>}
        {creating ? (
          <NewResourceForm
            calendars={team.calendars}
            busy={busy}
            onCancel={() => { setCreating(false) }}
            onCreate={(input) => {
              run(async () => { await createResource(input) })
              setCreating(false)
            }}
          />
        ) : null}

        {/*
          Mientras se da de alta a alguien no se muestra la ficha de otra
          persona: dos campos «Nombre» a la vez en la misma pantalla son una
          invitación a escribir en el que no es.
        */}
        {creating ? null : selected === null ? (
          <div className="empty">
            <h3>{t('equipo.nadieElegido')}</h3>
            <p>{t('equipo.nadieElegidoDetalle')}</p>
          </div>
        ) : (
          <ResourceCard
            key={selected.id}
            resource={selected}
            calendars={team.calendars}
            costsHidden={team.costsHidden === true}
            busy={busy}
            onRun={run}
          />
        )}
      </section>
    </div>
  )
}

interface CardProps {
  readonly resource: ResourceDetail
  readonly calendars: readonly CalendarOption[]
  /** Sin permiso de costes las tarifas ni se piden: no hay nada que enseñar. */
  readonly costsHidden: boolean
  readonly busy: boolean
  readonly onRun: (action: () => Promise<void>) => void
}

function ResourceCard({ resource, calendars, costsHidden, busy, onRun }: CardProps): React.JSX.Element {
  const { t } = useT()
  const [name, setName] = useState(resource.displayName)

  return (
    <>
      <div className="card">
        <h3 className="card__title">{t('equipo.ficha')}</h3>
        <div className="field-grid">
          <label className="field">
            <span>{t('col.nombre')}</span>
            <input
              className="input"
              value={name}
              disabled={busy}
              onChange={(event) => { setName(event.target.value) }}
              onBlur={() => {
                if (name.trim() !== '' && name !== resource.displayName) {
                  onRun(async () => { await patchResource(resource.id, { displayName: name.trim() }) })
                }
              }}
            />
          </label>

          <label className="field">
            <span>{t('col.codigo')}</span>
            <input className="input" value={resource.code} disabled readOnly />
          </label>

          <label className="field">
            <span title={t('equipo.calendarioTitulo')}>{t('registro.entidad.calendar')}</span>
            <select
              className="input"
              value={resource.calendarId ?? ''}
              disabled={busy}
              onChange={(event) => {
                const value = event.target.value
                onRun(async () => { await patchResource(resource.id, { calendarId: value === '' ? null : value }) })
              }}
            >
              <option value="">{t('equipo.sinCalendarioPropio')}</option>
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.code} · {calendar.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span title={t('equipo.dedicacionBaseTitulo')}>{t('equipo.dedicacionBase')}</span>
            <PercentInput
              valueBp={resource.maxUnitsBp}
              busy={busy}
              onCommit={(unitsBp) => { onRun(async () => { await patchResource(resource.id, { maxUnitsBp: unitsBp }) }) }}
            />
          </label>

          <label className="field">
            <span title={t('equipo.indirectoTitulo')}>{t('equipo.indirecto')}</span>
            <PercentInput
              valueBp={resource.indirectBp}
              busy={busy}
              onCommit={(bp) => { onRun(async () => { await patchResource(resource.id, { indirectBp: bp }) }) }}
            />
          </label>

          <label className="field">
            <span title={t('equipo.reservaTitulo')}>{t('equipo.reserva')}</span>
            <PercentInput
              valueBp={resource.reserveBp}
              busy={busy}
              onCommit={(bp) => { onRun(async () => { await patchResource(resource.id, { reserveBp: bp }) }) }}
            />
          </label>
        </div>
        <p className="card__note">
          {t('equipo.indirectoNota')}{' '}
          {resource.indirectBp === 0 && resource.reserveBp === 0
            ? t('equipo.indirectoCero')
            : t('equipo.indirectoAlgo', hours(planificable(480, resource), 1))}{' '}
          {t('equipo.indirectoAviso')}
        </p>
        <p className="card__note">{t('equipo.recalculaNota')}</p>
      </div>

      <PeriodCard<AvailabilityPeriod>
        title={t('equipo.disponibilidad')}
        hint={t('equipo.disponibilidadNota')}
        rows={resource.availability}
        empty={t('equipo.disponibilidadVacia', percent(resource.maxUnitsBp))}
        columns={[t('col.desde'), t('col.hasta'), t('col.dedicacion'), t('col.motivo')]}
        cells={(row) => [fullDate(row.from), fullDate(row.to), percent(row.unitsBp), row.reason ?? '—']}
        busy={busy}
        onDelete={(id) => { onRun(async () => { await removeAvailability(id) }) }}
        form={(close) => (
          <AvailabilityForm
            busy={busy}
            onSubmit={(period) => {
              onRun(async () => { await addAvailability(resource.id, period) })
              close()
            }}
          />
        )}
      />

      <PeriodCard<AbsencePeriod>
        title={t('equipo.ausencias')}
        hint={t('equipo.ausenciasNota')}
        rows={resource.absences}
        empty={t('equipo.ausenciasVacias')}
        columns={[t('col.desde'), t('col.hasta'), t('col.tipo'), t('col.nota')]}
        cells={(row) => [fullDate(row.from), fullDate(row.to), absenceLabel(t, row.kind), row.note ?? '—']}
        busy={busy}
        onDelete={(id) => { onRun(async () => { await removeAbsence(id) }) }}
        form={(close) => (
          <AbsenceForm
            busy={busy}
            onSubmit={(absence) => {
              onRun(async () => { await addAbsence(resource.id, absence) })
              close()
            }}
          />
        )}
      />

      <PeriodCard<CostRatePeriod>
        title={t('equipo.tarifas')}
        hint={costsHidden ? t('equipo.tarifasOcultas') : t('equipo.tarifasNota')}
        rows={resource.costRates}
        empty={costsHidden ? t('equipo.tarifasVaciasOcultas') : t('equipo.tarifasVacias')}
        columns={[t('col.desde'), t('col.hasta'), t('equipo.costeHora'), '']}
        cells={(row) => [fullDate(row.from), fullDate(row.to), `${euroRate(row.standardCentsHour)}/h`, row.currency]}
        busy={busy}
        onDelete={(id) => { onRun(async () => { await removeCostRate(id) }) }}
        form={(close) => (
          <RateForm
            busy={busy}
            onSubmit={(rate) => {
              onRun(async () => { await addCostRate(resource.id, rate) })
              close()
            }}
          />
        )}
      />

      <div className="card">
        <h3 className="card__title">{t('equipo.baja')}</h3>
        <p className="card__note">{t('equipo.bajaNota')}</p>
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(t('equipo.bajaConfirma', resource.displayName))) {
              onRun(async () => { await removeResource(resource.id) })
            }
          }}
        >
          {t('equipo.darDeBaja')}
        </button>
      </div>
    </>
  )
}

interface PeriodCardProps<T extends { id: string }> {
  readonly title: string
  readonly hint: string
  readonly rows: readonly T[]
  readonly empty: string
  readonly columns: readonly string[]
  readonly cells: (row: T) => readonly string[]
  readonly busy: boolean
  readonly onDelete: (id: string) => void
  readonly form: (close: () => void) => React.JSX.Element
}

/** Una lista de tramos con vigencia: misma forma para disponibilidad, ausencias y tarifas. */
function PeriodCard<T extends { id: string }>({
  title,
  hint,
  rows,
  empty,
  columns,
  cells,
  busy,
  onDelete,
  form,
}: PeriodCardProps<T>): React.JSX.Element {
  const { t } = useT()
  const [adding, setAdding] = useState(false)

  return (
    <div className="card">
      <div className="card__head">
        <h3 className="card__title">{title}</h3>
        <button className="button" disabled={busy} onClick={() => { setAdding((value) => !value) }}>
          {adding ? t('boton.cancelar') : t('equipo.anadir')}
        </button>
      </div>
      <p className="card__note">{hint}</p>
      {adding ? form(() => { setAdding(false) }) : null}
      {rows.length === 0 ? (
        <p className="faint" style={{ margin: '8px 0 0' }}>{empty}</p>
      ) : (
        <table className="grid grid--inline">
          <thead>
            <tr>
              {columns.map((column) => <th key={column}>{column}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {cells(row).map((cell, index) => <td key={columns[index] ?? String(index)}>{cell}</td>)}
                <td>
                  <button
                    className="button"
                    disabled={busy}
                    title={t('equipo.quitarTramo')}
                    onClick={() => { onDelete(row.id) }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function AvailabilityForm({
  busy,
  onSubmit,
}: {
  readonly busy: boolean
  readonly onSubmit: (period: { from: string; to: string; unitsBp: number; reason: string | null }) => void
}): React.JSX.Element {
  const { t } = useT()
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [percentValue, setPercentValue] = useState('50')
  const [reason, setReason] = useState('')

  return (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault()
        const units = Math.round(Number(percentValue.replace(',', '.')) * 100)
        if (!Number.isFinite(units)) return
        onSubmit({ from, to, unitsBp: units, reason: reason.trim() === '' ? null : reason.trim() })
      }}
    >
      <label className="field"><span>{t('col.desde')}</span>
        <input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value) }} required />
      </label>
      <label className="field"><span>{t('col.hasta')}</span>
        <input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value) }} required />
      </label>
      <label className="field"><span>{t('editar.dedicacionPorciento')}</span>
        <input className="input" inputMode="decimal" value={percentValue} onChange={(e) => { setPercentValue(e.target.value) }} required />
      </label>
      <label className="field"><span>{t('col.motivo')}</span>
        <input className="input" value={reason} onChange={(e) => { setReason(e.target.value) }} placeholder={t('equipo.opcional')} />
      </label>
      <button className="button button--primary" type="submit" disabled={busy}>{t('boton.guardar')}</button>
    </form>
  )
}

function AbsenceForm({
  busy,
  onSubmit,
}: {
  readonly busy: boolean
  readonly onSubmit: (absence: { kind: string; from: string; to: string; note: string | null }) => void
}): React.JSX.Element {
  const { t } = useT()
  const [kind, setKind] = useState('vacation')
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [note, setNote] = useState('')

  return (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({ kind, from, to, note: note.trim() === '' ? null : note.trim() })
      }}
    >
      <label className="field"><span>{t('col.tipo')}</span>
        <select className="input" value={kind} onChange={(e) => { setKind(e.target.value) }}>
          {ABSENCE_KINDS.map((item) => (
            <option key={item} value={item}>{absenceLabel(t, item)}</option>
          ))}
        </select>
      </label>
      <label className="field"><span>{t('col.desde')}</span>
        <input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value) }} required />
      </label>
      <label className="field"><span>{t('col.hasta')}</span>
        <input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value) }} required />
      </label>
      <label className="field"><span>{t('col.nota')}</span>
        <input className="input" value={note} onChange={(e) => { setNote(e.target.value) }} placeholder={t('equipo.opcional')} />
      </label>
      <button className="button button--primary" type="submit" disabled={busy}>{t('boton.guardar')}</button>
    </form>
  )
}

function RateForm({
  busy,
  onSubmit,
}: {
  readonly busy: boolean
  readonly onSubmit: (rate: { from: string; to: string; standardCentsHour: number }) => void
}): React.JSX.Element {
  const { t } = useT()
  const [from, setFrom] = useState(`${String(new Date().getFullYear())}-01-01`)
  const [to, setTo] = useState(`${String(new Date().getFullYear() + 4)}-12-31`)
  const [euroPerHour, setEuroPerHour] = useState('75')

  return (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault()
        // Euros con decimales fuera, céntimos enteros dentro: el borde de
        // presentación es el único sitio donde existe la coma (P5).
        const cents = Math.round(Number(euroPerHour.replace(',', '.')) * 100)
        if (!Number.isFinite(cents) || cents < 0) return
        onSubmit({ from, to, standardCentsHour: cents })
      }}
    >
      <label className="field"><span>{t('col.desde')}</span>
        <input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value) }} required />
      </label>
      <label className="field"><span>{t('col.hasta')}</span>
        <input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value) }} required />
      </label>
      <label className="field"><span>{t('col.euroHora')}</span>
        <input className="input" inputMode="decimal" value={euroPerHour} onChange={(e) => { setEuroPerHour(e.target.value) }} required />
      </label>
      <button className="button button--primary" type="submit" disabled={busy}>{t('boton.guardar')}</button>
    </form>
  )
}

function NewResourceForm({
  calendars,
  busy,
  onCancel,
  onCreate,
}: {
  readonly calendars: readonly CalendarOption[]
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onCreate: (input: { code: string; displayName: string; calendarId: string | null; maxUnitsBp: number }) => void
}): React.JSX.Element {
  const { t } = useT()
  const [displayName, setDisplayName] = useState('')
  const [code, setCode] = useState('')
  const [calendarId, setCalendarId] = useState(calendars[0]?.id ?? '')

  /** El código se propone a partir del nombre, pero se puede cambiar antes de guardar. */
  const suggestedCode = displayName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '')

  return (
    <div className="card">
      <h3 className="card__title">{t('equipo.nuevaPersona')}</h3>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault()
          const finalCode = (code.trim() === '' ? suggestedCode : code.trim())
          if (displayName.trim() === '' || finalCode === '') return
          onCreate({
            code: finalCode,
            displayName: displayName.trim(),
            calendarId: calendarId === '' ? null : calendarId,
            maxUnitsBp: 10_000,
          })
        }}
      >
        <label className="field"><span>{t('col.nombre')}</span>
          <input className="input" value={displayName} onChange={(e) => { setDisplayName(e.target.value) }} required autoFocus />
        </label>
        <label className="field"><span>{t('col.codigo')}</span>
          <input className="input" value={code} placeholder={suggestedCode} onChange={(e) => { setCode(e.target.value) }} />
        </label>
        <label className="field"><span>{t('registro.entidad.calendar')}</span>
          <select className="input" value={calendarId} onChange={(e) => { setCalendarId(e.target.value) }}>
            <option value="">{t('equipo.sinCalendarioPropio')}</option>
            {calendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>{calendar.code} · {calendar.name}</option>
            ))}
          </select>
        </label>
        <button className="button button--primary" type="submit" disabled={busy}>{t('boton.crear')}</button>
        <button className="button" type="button" onClick={onCancel} disabled={busy}>{t('boton.cancelar')}</button>
      </form>
    </div>
  )
}

function PercentInput({
  valueBp,
  busy,
  onCommit,
}: {
  readonly valueBp: number
  readonly busy: boolean
  readonly onCommit: (unitsBp: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(valueBp / 100).replace('.', ',')

  return (
    <span className="editable">
      <input
        className="input"
        value={shown}
        inputMode="decimal"
        disabled={busy}
        onChange={(event) => { setDraft(event.target.value) }}
        onBlur={() => {
          if (draft === null) return
          const parsed = Math.round(Number(draft.replace(',', '.')) * 100)
          setDraft(null)
          if (!Number.isFinite(parsed) || parsed === valueBp || parsed < 0 || parsed > 20_000) return
          onCommit(parsed)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') setDraft(null)
        }}
      />
      <span className="editable__suffix">%</span>
    </span>
  )
}
