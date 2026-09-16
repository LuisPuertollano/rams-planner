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
import { euroRate, fullDate, percent } from '../format.js'

interface Props {
  /** Se llama tras cada cambio: el servidor ya ha recalculado, la pantalla debe recargarse. */
  readonly onChanged: () => void
}

const ABSENCE_KINDS: readonly { value: string; label: string }[] = [
  { value: 'vacation', label: 'Vacaciones' },
  { value: 'sick', label: 'Baja' },
  { value: 'training', label: 'Formación' },
  { value: 'parental', label: 'Permiso parental' },
  { value: 'public_holiday', label: 'Festivo propio' },
  { value: 'other', label: 'Otros' },
]

const absenceLabel = (kind: string): string =>
  ABSENCE_KINDS.find((item) => item.value === kind)?.label ?? kind

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
export function ResourcesView({ onChanged }: Props): React.JSX.Element {
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
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el equipo')
    })
  }, [])

  /** Toda escritura pasa por aquí: recarga la ficha y avisa al resto de la aplicación. */
  const run = (action: () => Promise<void>): void => {
    setBusy(true)
    setError(null)
    action()
      .then(reload)
      .then(onChanged)
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : 'No se pudo guardar') })
      .finally(() => { setBusy(false) })
  }

  const selected = useMemo(() => {
    if (team === null) return null
    return team.resources.find((resource) => resource.id === selectedId) ?? team.resources[0] ?? null
  }, [team, selectedId])

  if (team === null) {
    return (
      <div className="empty">
        <h3>{error ?? 'Cargando el equipo…'}</h3>
      </div>
    )
  }

  return (
    <div className="team">
      <aside className="team__list">
        <div className="team__list-head">
          <span className="faint">{team.resources.length} persona(s)</span>
          <button className="button" onClick={() => { setCreating(true) }} disabled={busy}>
            + Añadir
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
              {resource.calendarCode ?? 'sin calendario'} · {percent(resource.maxUnitsBp)}
              {resource.costRates.length === 0 ? <span className="warn-dot" title="Sin tarifa: el coste sale a cero"> ⚠</span> : null}
            </span>
          </button>
        ))}
        {team.resources.length === 0 ? <p className="faint" style={{ padding: 12 }}>Aún no hay nadie.</p> : null}
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
            <h3>Nadie seleccionado</h3>
            <p>Añade a alguien o importa un plan: las personas del CSV se crean solas.</p>
          </div>
        ) : (
          <ResourceCard
            key={selected.id}
            resource={selected}
            calendars={team.calendars}
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
  readonly busy: boolean
  readonly onRun: (action: () => Promise<void>) => void
}

function ResourceCard({ resource, calendars, busy, onRun }: CardProps): React.JSX.Element {
  const [name, setName] = useState(resource.displayName)

  return (
    <>
      <div className="card">
        <h3 className="card__title">Ficha</h3>
        <div className="field-grid">
          <label className="field">
            <span>Nombre</span>
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
            <span>Código</span>
            <input className="input" value={resource.code} disabled readOnly />
          </label>

          <label className="field">
            <span title="De él salen los días y las horas laborables de esta persona">Calendario</span>
            <select
              className="input"
              value={resource.calendarId ?? ''}
              disabled={busy}
              onChange={(event) => {
                const value = event.target.value
                onRun(async () => { await patchResource(resource.id, { calendarId: value === '' ? null : value }) })
              }}
            >
              <option value="">— sin calendario propio —</option>
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.code} · {calendar.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span title="Dedicación máxima por defecto. Los periodos de disponibilidad la pisan cuando existen">
              Dedicación base
            </span>
            <PercentInput
              valueBp={resource.maxUnitsBp}
              busy={busy}
              onCommit={(unitsBp) => { onRun(async () => { await patchResource(resource.id, { maxUnitsBp: unitsBp }) }) }}
            />
          </label>
        </div>
        <p className="card__note">
          Cambiar cualquiera de estos campos recalcula el plan entero: la capacidad de esta persona
          cambia y con ella su saturación y el coste de sus tareas.
        </p>
      </div>

      <PeriodCard<AvailabilityPeriod>
        title="Disponibilidad"
        hint="Dedicación por tramos: una excedencia, una media jornada, un refuerzo temporal. Los tramos no se pueden solapar."
        rows={resource.availability}
        empty={`Sin tramos: se usa la dedicación base (${percent(resource.maxUnitsBp)}).`}
        columns={['Desde', 'Hasta', 'Dedicación', 'Motivo']}
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
        title="Ausencias"
        hint="Vacaciones, bajas y formación. Restan capacidad sin tocar el calendario del equipo."
        rows={resource.absences}
        empty="Sin ausencias registradas."
        columns={['Desde', 'Hasta', 'Tipo', 'Nota']}
        cells={(row) => [fullDate(row.from), fullDate(row.to), absenceLabel(row.kind), row.note ?? '—']}
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
        title="Tarifas"
        hint="Coste por hora con vigencia. Sin tarifa el coste de las tareas de esta persona sale a cero, que es peor que salir mal."
        rows={resource.costRates}
        empty="Sin tarifa: el coste de sus tareas sale a cero."
        columns={['Desde', 'Hasta', 'Coste/hora', '']}
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
        <h3 className="card__title">Baja</h3>
        <p className="card__note">
          Dar de baja no borra nada: la persona deja de contar en los cálculos nuevos, pero las
          ejecuciones ya hechas siguen explicándose exactamente igual.
        </p>
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`¿Dar de baja a ${resource.displayName}? Sus tareas se quedarán sin asignar.`)) {
              onRun(async () => { await removeResource(resource.id) })
            }
          }}
        >
          Dar de baja
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
  const [adding, setAdding] = useState(false)

  return (
    <div className="card">
      <div className="card__head">
        <h3 className="card__title">{title}</h3>
        <button className="button" disabled={busy} onClick={() => { setAdding((value) => !value) }}>
          {adding ? 'Cancelar' : '+ Añadir'}
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
                    title="Quitar este tramo"
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
      <label className="field"><span>Desde</span>
        <input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value) }} required />
      </label>
      <label className="field"><span>Hasta</span>
        <input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value) }} required />
      </label>
      <label className="field"><span>Dedicación %</span>
        <input className="input" inputMode="decimal" value={percentValue} onChange={(e) => { setPercentValue(e.target.value) }} required />
      </label>
      <label className="field"><span>Motivo</span>
        <input className="input" value={reason} onChange={(e) => { setReason(e.target.value) }} placeholder="opcional" />
      </label>
      <button className="button button--primary" type="submit" disabled={busy}>Guardar</button>
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
      <label className="field"><span>Tipo</span>
        <select className="input" value={kind} onChange={(e) => { setKind(e.target.value) }}>
          {ABSENCE_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label className="field"><span>Desde</span>
        <input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value) }} required />
      </label>
      <label className="field"><span>Hasta</span>
        <input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value) }} required />
      </label>
      <label className="field"><span>Nota</span>
        <input className="input" value={note} onChange={(e) => { setNote(e.target.value) }} placeholder="opcional" />
      </label>
      <button className="button button--primary" type="submit" disabled={busy}>Guardar</button>
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
      <label className="field"><span>Desde</span>
        <input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value) }} required />
      </label>
      <label className="field"><span>Hasta</span>
        <input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value) }} required />
      </label>
      <label className="field"><span>€ por hora</span>
        <input className="input" inputMode="decimal" value={euroPerHour} onChange={(e) => { setEuroPerHour(e.target.value) }} required />
      </label>
      <button className="button button--primary" type="submit" disabled={busy}>Guardar</button>
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
      <h3 className="card__title">Nueva persona</h3>
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
        <label className="field"><span>Nombre</span>
          <input className="input" value={displayName} onChange={(e) => { setDisplayName(e.target.value) }} required autoFocus />
        </label>
        <label className="field"><span>Código</span>
          <input className="input" value={code} placeholder={suggestedCode} onChange={(e) => { setCode(e.target.value) }} />
        </label>
        <label className="field"><span>Calendario</span>
          <select className="input" value={calendarId} onChange={(e) => { setCalendarId(e.target.value) }}>
            <option value="">— sin calendario propio —</option>
            {calendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>{calendar.code} · {calendar.name}</option>
            ))}
          </select>
        </label>
        <button className="button button--primary" type="submit" disabled={busy}>Crear</button>
        <button className="button" type="button" onClick={onCancel} disabled={busy}>Cancelar</button>
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
