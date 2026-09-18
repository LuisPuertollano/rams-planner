import { useEffect, useMemo, useState } from 'react'
import {
  createDocumentType,
  fetchDocuments,
  removeDocumentType,
  setActivities,
  setPredecessors,
  setPrecedence,
  setSignatures,
  updateDocumentType,
  DOCUMENT_KINDS,
  type ActivityEffort,
  type ActivityProblem,
  type ActivityStep,
  type DocumentActivity,
  type DocumentCatalogue,
  type DocumentFields,
  type DocumentKind,
  type DocumentSignature,
  type DocumentType,
  type Signature,
  type SignatureProblem,
} from '../api.js'
import { ImportDialog } from '../components/ImportDialog.js'
import { errorRows, errorText } from '../errors.js'
import { hours } from '../format.js'
import { useT, type Diccionario } from '../i18n/index.js'

interface Props {
  /** Si esta persona puede tocar el catálogo y las cruces, o sólo mirarlos. */
  readonly canEdit: boolean
}

/** Cómo se mira el catálogo: fila a fila, o como rejilla. */
type Modo = 'lista' | 'matriz'

/**
 * Cuántas filas admite la rejilla antes de dejar de ser una herramienta.
 *
 * No es un número mágico: una matriz de n filas tiene n² casillas, y a partir
 * de unas treinta la pantalla ya no cabe sin desplazarse en las dos
 * direcciones a la vez, que es justo cuando marcar la casilla correcta pasa de
 * ser trabajo a ser puntería. Por encima de esto, la lista es lo que se abre.
 */
const CABEN_EN_LA_REJILLA = 30

type Traductor = (clave: keyof Diccionario, ...valores: readonly (string | number)[]) => string

/**
 * Los documentos del equipo, su ficha y el orden en que se pueden hacer.
 *
 * Dos formas de mirar lo mismo, y la elección no es estética:
 *
 *   - **Lista** — una fila por entregable, con su ficha y con sus predecesores
 *     escritos. Es lo que funciona cuando el catálogo es de verdad: un catálogo
 *     EN 50126 son unas ochenta filas y unas ciento treinta flechas.
 *   - **Matriz** — la rejilla, donde la fila es condición necesaria de la
 *     columna. Se lee de un vistazo y se vuelve impracticable enseguida: con
 *     ochenta entregables son 6.400 casillas. Por eso sólo se abre sola cuando
 *     el catálogo es pequeño, y por eso **respeta el filtro**: filtrar a seis
 *     documentos devuelve una rejilla que se puede usar.
 *
 * El filtro es la pieza que hace posible todo lo demás. Sin él, ochenta filas
 * son una lista que nadie recorre.
 */
export function DocumentsView({ canEdit }: Props): React.JSX.Element {
  const { t, locale } = useT()
  const [catalogo, setCatalogo] = useState<DocumentCatalogue | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ texto: string; filas: readonly string[] } | null>(null)
  const [modo, setModo] = useState<Modo | null>(null)
  const [texto, setTexto] = useState('')
  const [disciplina, setDisciplina] = useState('')
  const [puerta, setPuerta] = useState('')
  const [tipo, setTipo] = useState<'' | DocumentKind>('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [importando, setImportando] = useState(false)

  const recargar = async (): Promise<void> => { setCatalogo(await fetchDocuments()) }

  useEffect(() => {
    recargar().catch((cause: unknown) => {
      setError(errorText(t, cause, 'error.local.catalogo'))
    })
  }, [])

  const run = (accion: () => Promise<void>): void => {
    setBusy(true)
    setError(null)
    accion()
      .then(recargar)
      .catch((cause: unknown) => {
        setError(errorText(t, cause, 'error.local.guardar'))
        setAviso({ texto: '', filas: errorRows(cause) })
      })
      .finally(() => { setBusy(false) })
  }

  const tipos = useMemo(() => catalogo?.types ?? [], [catalogo])

  /** Los predecesores de cada documento, ya indexados. */
  const esperaA = useMemo(() => {
    const mapa = new Map<string, string[]>()
    for (const p of catalogo?.precedences ?? []) {
      const lista = mapa.get(p.successorId) ?? []
      lista.push(p.predecessorId)
      mapa.set(p.successorId, lista)
    }
    return mapa
  }, [catalogo])

  const cruces = useMemo(() => {
    const set = new Set<string>()
    for (const p of catalogo?.precedences ?? []) set.add(`${p.predecessorId}|${p.successorId}`)
    return set
  }, [catalogo])

  /**
   * Los pares que se esperan mutuamente. No se impide marcarlos —a veces se
   * descubre el ciclo justo al marcar el segundo— pero se señalan: un plan
   * generado a partir de un ciclo no se puede calcular.
   */
  const ciclos = useMemo(() => {
    const malos = new Set<string>()
    for (const clave of cruces) {
      const [a, b] = clave.split('|')
      if (a !== undefined && b !== undefined && cruces.has(`${b}|${a}`)) malos.add(clave)
    }
    return malos
  }, [cruces])

  /** El ciclo de firma de cada entregable, ya indexado y en orden. */
  const firmasDe = useMemo(() => {
    const mapa = new Map<string, DocumentSignature[]>()
    for (const firma of catalogo?.signatures ?? []) {
      const lista = mapa.get(firma.documentTypeId) ?? []
      lista.push(firma)
      mapa.set(firma.documentTypeId, lista)
    }
    return mapa
  }, [catalogo])

  /**
   * Lo que está mal repartido en cada ciclo. Lo calcula el servidor y aquí sólo
   * se agrupa: el código es el contrato y la frase la escribe el diccionario.
   */
  const problemasDe = useMemo(() => {
    const mapa = new Map<string, SignatureProblem[]>()
    for (const problema of catalogo?.signatureProblems ?? []) {
      const lista = mapa.get(problema.documentTypeId) ?? []
      lista.push(problema)
      mapa.set(problema.documentTypeId, lista)
    }
    return mapa
  }, [catalogo])

  /** Las subactividades de cada entregable, ya indexadas y en orden. */
  const actividadesDe = useMemo(() => {
    const mapa = new Map<string, DocumentActivity[]>()
    for (const actividad of catalogo?.activities ?? []) {
      const lista = mapa.get(actividad.documentTypeId) ?? []
      lista.push(actividad)
      mapa.set(actividad.documentTypeId, lista)
    }
    return mapa
  }, [catalogo])

  /** Lo que está mal en las subactividades. Lo calcula el servidor, igual que la firma. */
  const problemasDeActividad = useMemo(() => {
    const mapa = new Map<string, ActivityProblem[]>()
    for (const problema of catalogo?.activityProblems ?? []) {
      const lista = mapa.get(problema.documentTypeId) ?? []
      lista.push(problema)
      mapa.set(problema.documentTypeId, lista)
    }
    return mapa
  }, [catalogo])

  /** Lo que cuesta cada entregable según su cadena, y por dónde cierra. */
  const esfuerzoDe = useMemo(() => {
    const mapa = new Map<string, ActivityEffort>()
    for (const fila of catalogo?.activityEffort ?? []) mapa.set(fila.documentTypeId, fila)
    return mapa
  }, [catalogo])

  const disciplinas = useMemo(
    () => [...new Set(tipos.map((x) => x.discipline).filter((d): d is string => d !== null))].sort(),
    [tipos],
  )
  const puertas = useMemo(
    () => [...new Set(tipos.map((x) => x.gate).filter((g): g is string => g !== null))].sort(),
    [tipos],
  )

  const visibles = useMemo(() => {
    const busca = texto.trim().toLowerCase()
    return tipos.filter((x) => {
      if (disciplina !== '' && x.discipline !== disciplina) return false
      if (puerta !== '' && x.gate !== puerta) return false
      if (tipo !== '' && x.kind !== tipo) return false
      if (busca === '') return true
      return (
        x.code.toLowerCase().includes(busca) ||
        x.name.toLowerCase().includes(busca) ||
        (x.description ?? '').toLowerCase().includes(busca) ||
        (x.taskCode ?? '').toLowerCase().includes(busca)
      )
    })
  }, [tipos, texto, disciplina, puerta, tipo])

  // Sin elección explícita, la rejilla sólo se abre si cabe.
  const modoReal: Modo = modo ?? (tipos.length <= CABEN_EN_LA_REJILLA ? 'matriz' : 'lista')

  const codigoDe = useMemo(() => new Map(tipos.map((x) => [x.id, x.code])), [tipos])

  if (error !== null && catalogo === null) return <div className="empty"><h3>{error}</h3></div>
  if (catalogo === null) return <div className="empty"><h3>{t('app.cargando')}</h3></div>

  // Un solo botón, y lo que abre explica el fichero antes de pedirlo. El de la
  // plantilla vivía aquí al lado sin decir que fuera la respuesta a «¿qué
  // formato?»; ahora está dentro, junto a la tabla de columnas.
  const barraDeCarga = !canEdit ? null : (
    <button
      className="button"
      disabled={busy}
      title={t('documentos.importarTitulo')}
      onClick={() => { setImportando(true) }}
    >
      {t('documentos.importar')}
    </button>
  )

  // El diálogo lo define `ImportDialog`, no esta pantalla: el mismo contrato se
  // abre desde aquí, desde el menú «Calcular» y desde Datos → Importaciones, y
  // tres copias del mismo texto se separan a la primera frase que alguien
  // mejore en una sola de ellas.
  const panelDeImportacion = !importando ? null : (
    <ImportDialog
      tipo="documents"
      onClose={() => { setImportando(false) }}
      onImported={() => { void recargar() }}
      exportarUrl={tipos.length === 0 ? undefined : '/api/documents/export.csv'}
    />
  )

  if (tipos.length === 0) {
    return (
      <div className="empty">
        {panelDeImportacion}
        <h3>{t('documentos.vacio.titulo')}</h3>
        <p style={{ maxWidth: '58ch', margin: '0 auto' }}>{t('documentos.vacio.texto')}</p>
        <p className="faint" style={{ maxWidth: '58ch', margin: '12px auto 0' }}>
          {t('documentos.vacio.detalle')}
        </p>
        {!canEdit ? null : (
          <div className="stat-row" style={{ justifyContent: 'center', marginTop: 20 }}>
            <NuevoDocumento busy={busy} onRun={run} t={t} />
            {barraDeCarga}
          </div>
        )}
      </div>
    )
  }

  const enEdicion = tipos.find((x) => x.id === abierto) ?? null

  return (
    <>
      {panelDeImportacion}
      {error === null ? null : <div className="error-banner" style={{ margin: 12 }}>{error}</div>}
      {aviso === null ? null : (
        <div className={aviso.texto === '' ? 'error-banner' : 'notice'} style={{ margin: 12 }}>
          {aviso.texto === '' ? null : <b>{aviso.texto}</b>}
          {aviso.filas.length === 0 ? null : (
            <ul>{aviso.filas.slice(0, 10).map((fila) => <li key={fila}>{fila}</li>)}</ul>
          )}
          {aviso.filas.length <= 10 ? null : (
            <p className="faint">{t('documentos.yMas', aviso.filas.length - 10)}</p>
          )}
          <button className="button" onClick={() => { setAviso(null) }}>{t('app.entendido')}</button>
        </div>
      )}

      <div className="toolbar">
        <input
          className="input"
          type="search"
          placeholder={t('documentos.buscar')}
          value={texto}
          onChange={(event) => { setTexto(event.target.value) }}
          style={{ minWidth: 220 }}
        />
        <select className="input" value={tipo} onChange={(e) => { setTipo(e.target.value as '' | DocumentKind) }}>
          <option value="">{t('documentos.todosLosTipos')}</option>
          {DOCUMENT_KINDS.map((k) => (
            <option key={k} value={k}>{t(`documentos.tipo.${k}` as keyof Diccionario)}</option>
          ))}
        </select>
        {disciplinas.length === 0 ? null : (
          <select className="input" value={disciplina} onChange={(e) => { setDisciplina(e.target.value) }}>
            <option value="">{t('documentos.todasLasDisciplinas')}</option>
            {disciplinas.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        {puertas.length === 0 ? null : (
          <select className="input" value={puerta} onChange={(e) => { setPuerta(e.target.value) }}>
            <option value="">{t('documentos.todasLasPuertas')}</option>
            {puertas.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <span className="faint">{t('documentos.cuantos', visibles.length, tipos.length)}</span>
        <span style={{ flex: 1 }} />
        <button
          className={modoReal === 'lista' ? 'button button--primary' : 'button'}
          onClick={() => { setModo('lista') }}
        >
          {t('documentos.modo.lista')}
        </button>
        <button
          className={modoReal === 'matriz' ? 'button button--primary' : 'button'}
          onClick={() => { setModo('matriz') }}
          title={t('documentos.modo.matrizTitulo')}
        >
          {t('documentos.modo.matriz')}
        </button>
        <a className="button" href="/api/documents/export.csv">{t('documentos.exportar')}</a>
        {barraDeCarga}
        {!canEdit ? null : <NuevoDocumento busy={busy} onRun={run} t={t} />}
      </div>

      {enEdicion === null || !canEdit ? null : (
        <Editor
          documento={enEdicion}
          todos={tipos}
          predecesores={esperaA.get(enEdicion.id) ?? []}
          firmas={firmasDe.get(enEdicion.id) ?? []}
          problemas={problemasDe.get(enEdicion.id) ?? []}
          actividades={actividadesDe.get(enEdicion.id) ?? []}
          problemasDeActividad={problemasDeActividad.get(enEdicion.id) ?? []}
          busy={busy}
          onRun={run}
          onCerrar={() => { setAbierto(null) }}
        />
      )}

      {modoReal === 'lista' ? (
        <Lista
          visibles={visibles}
          esperaA={esperaA}
          firmasDe={firmasDe}
          problemasDe={problemasDe}
          actividadesDe={actividadesDe}
          problemasDeActividad={problemasDeActividad}
          esfuerzoDe={esfuerzoDe}
          codigoDe={codigoDe}
          canEdit={canEdit}
          busy={busy}
          abierto={abierto}
          locale={locale}
          t={t}
          onAbrir={(id) => { setAbierto(abierto === id ? null : id) }}
          onQuitar={(documento) => {
            const pregunta =
              documento.usedInTasks === 0
                ? t('documentos.quitar.confirma', documento.name)
                : t('documentos.quitar.confirmaEnUso', documento.name, documento.usedInTasks)
            if (window.confirm(pregunta)) run(async () => { await removeDocumentType(documento.id) })
          }}
        />
      ) : (
        <Matriz
          visibles={visibles}
          cruces={cruces}
          ciclos={ciclos}
          canEdit={canEdit}
          busy={busy}
          t={t}
          onMarcar={(predecessorId, successorId, required) => {
            run(async () => { await setPrecedence(predecessorId, successorId, required) })
          }}
        />
      )}
    </>
  )
}

/**
 * La lista: una fila por entregable, con su ficha y sus predecesores escritos.
 *
 * Los predecesores salen como códigos y no como una cuenta, a propósito: «este
 * espera a S-SAP y a S-SSPHA» es una frase que se verifica de un vistazo, y
 * «espera a 2» no dice nada que sirva.
 */
function Lista({
  visibles, esperaA, firmasDe, problemasDe, actividadesDe, problemasDeActividad, esfuerzoDe,
  codigoDe, canEdit, busy, abierto, locale, t, onAbrir, onQuitar,
}: {
  readonly visibles: readonly DocumentType[]
  readonly esperaA: ReadonlyMap<string, readonly string[]>
  readonly firmasDe: ReadonlyMap<string, readonly DocumentSignature[]>
  readonly problemasDe: ReadonlyMap<string, readonly SignatureProblem[]>
  readonly actividadesDe: ReadonlyMap<string, readonly DocumentActivity[]>
  readonly problemasDeActividad: ReadonlyMap<string, readonly ActivityProblem[]>
  readonly esfuerzoDe: ReadonlyMap<string, ActivityEffort>
  readonly codigoDe: ReadonlyMap<string, string>
  readonly canEdit: boolean
  readonly busy: boolean
  readonly abierto: string | null
  readonly locale: string
  readonly t: Traductor
  readonly onAbrir: (id: string) => void
  readonly onQuitar: (documento: DocumentType) => void
}): React.JSX.Element {
  if (visibles.length === 0) {
    return <p className="faint" style={{ padding: '0 16px' }}>{t('documentos.sinResultados')}</p>
  }
  return (
    <table className="grid grid--texto">
      <thead>
        <tr>
          <th>{t('documentos.col.codigo')}</th>
          <th>{t('documentos.col.nombre')}</th>
          <th>{t('documentos.col.tipo')}</th>
          <th>{t('documentos.col.disciplina')}</th>
          <th>{t('documentos.col.puerta')}</th>
          <th title={t('documentos.col.semanasTitulo')}>{t('documentos.col.semanas')}</th>
          <th>{t('documentos.col.esfuerzo')}</th>
          <th>{t('documentos.col.esperaA')}</th>
          <th title={t('documentos.col.firmaTitulo')}>{t('documentos.col.firma')}</th>
          <th title={t('documentos.col.cadenaTitulo')}>{t('documentos.col.cadena')}</th>
          <th>{t('documentos.col.enTareas')}</th>
          {!canEdit ? null : <th />}
        </tr>
      </thead>
      <tbody>
        {visibles.map((documento) => {
          const predecesores = (esperaA.get(documento.id) ?? [])
            .map((id) => codigoDe.get(id) ?? '?')
            .sort()
          return (
            <tr key={documento.id} className={abierto === documento.id ? 'fila--abierta' : undefined}>
              <td>
                <button
                  className="button"
                  onClick={() => { onAbrir(documento.id) }}
                  title={t('documentos.abrirFicha')}
                >
                  {documento.code}
                </button>
              </td>
              <td title={documento.description ?? undefined}>{documento.name}</td>
              <td>{t(`documentos.tipo.${documento.kind}` as keyof Diccionario)}</td>
              <td>{documento.discipline ?? '—'}</td>
              <td>{documento.gate ?? '—'}</td>
              <td>{documento.weeksBeforeGate === null ? '—' : documento.weeksBeforeGate}</td>
              <td>
                {documento.standardMinutes === null || documento.standardMinutes === 0
                  ? '—'
                  : `${hours(documento.standardMinutes, 0, locale)} h`}
              </td>
              <td className="faint">{predecesores.length === 0 ? '—' : predecesores.join(', ')}</td>
              <td>
                <Ciclo
                  firmas={firmasDe.get(documento.id) ?? []}
                  problemas={problemasDe.get(documento.id) ?? []}
                  t={t}
                />
              </td>
              <td>
                <Cadena
                  actividades={actividadesDe.get(documento.id) ?? []}
                  problemas={problemasDeActividad.get(documento.id) ?? []}
                  esfuerzo={esfuerzoDe.get(documento.id)}
                  locale={locale}
                  t={t}
                />
              </td>
              <td>{documento.usedInTasks === 0 ? '—' : documento.usedInTasks}</td>
              {!canEdit ? null : (
                <td>
                  <button
                    className="button"
                    disabled={busy}
                    title={t('documentos.quitar')}
                    onClick={() => { onQuitar(documento) }}
                  >
                    ✕
                  </button>
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** La rejilla de siempre, recortada a lo que el filtro deja ver. */
function Matriz({
  visibles, cruces, ciclos, canEdit, busy, t, onMarcar,
}: {
  readonly visibles: readonly DocumentType[]
  readonly cruces: ReadonlySet<string>
  readonly ciclos: ReadonlySet<string>
  readonly canEdit: boolean
  readonly busy: boolean
  readonly t: Traductor
  readonly onMarcar: (predecessorId: string, successorId: string, required: boolean) => void
}): React.JSX.Element {
  if (visibles.length === 0) {
    return <p className="faint" style={{ padding: '0 16px' }}>{t('documentos.sinResultados')}</p>
  }
  return (
    <>
      <p className="faint" style={{ padding: '0 16px', maxWidth: '96ch' }}>{t('documentos.matriz.explica')}</p>
      {visibles.length <= CABEN_EN_LA_REJILLA ? null : (
        <p className="warn-banner" style={{ margin: '0 12px 8px' }}>
          {t('documentos.matriz.demasiadas', visibles.length, visibles.length * visibles.length)}
        </p>
      )}
      <table className="grid grid--matriz">
        <thead>
          <tr>
            <th style={{ minWidth: 240 }}>
              <span className="faint">{t('documentos.matriz.esCondicionDe')}</span>
            </th>
            {visibles.map((columna) => (
              <th key={columna.id} title={columna.name}>
                <span className="matriz__cabecera">{columna.code}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibles.map((fila) => (
            <tr key={fila.id}>
              <td>
                <div className="funcion__nombre">{fila.name}</div>
                <div className="funcion__detalle">
                  {fila.code}
                  {fila.gate === null ? '' : ` · ${fila.gate}`}
                  {fila.usedInTasks === 0 ? '' : ` · ${t('documentos.enTareas', fila.usedInTasks)}`}
                </div>
              </td>
              {visibles.map((columna) => {
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
                        ? t('documentos.matriz.diagonal')
                        : t('documentos.matriz.casilla', fila.name, columna.name)
                    }
                  >
                    {esDiagonal ? null : (
                      <input
                        type="checkbox"
                        checked={marcada}
                        disabled={busy || !canEdit}
                        aria-label={t('documentos.matriz.casilla', fila.name, columna.name)}
                        onChange={() => { onMarcar(fila.id, columna.id, !marcada) }}
                      />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

/**
 * La ficha de un entregable, con su lista de predecesores.
 *
 * Un formulario y no tres `window.prompt` seguidos: con nueve campos, la cadena
 * de diálogos es una prueba de memoria, y no deja corregir el segundo sin
 * volver a escribir el primero.
 */
function Editor({
  documento, todos, predecesores, firmas, problemas, actividades, problemasDeActividad,
  busy, onRun, onCerrar,
}: {
  readonly documento: DocumentType
  readonly todos: readonly DocumentType[]
  readonly predecesores: readonly string[]
  readonly firmas: readonly DocumentSignature[]
  readonly problemas: readonly SignatureProblem[]
  readonly actividades: readonly DocumentActivity[]
  readonly problemasDeActividad: readonly ActivityProblem[]
  readonly busy: boolean
  readonly onRun: (accion: () => Promise<void>) => void
  readonly onCerrar: () => void
}): React.JSX.Element {
  const { t } = useT()
  const [campos, setCampos] = useState<DocumentFields>({})
  const [busca, setBusca] = useState('')
  const [elegidos, setElegidos] = useState<ReadonlySet<string>>(new Set(predecesores))

  // Al cambiar de documento, la ficha empieza de cero: arrastrar los cambios a
  // medio escribir de otro entregable sería la peor clase de sorpresa.
  useEffect(() => {
    setCampos({})
    setElegidos(new Set(predecesores))
    setBusca('')
  }, [documento.id])

  const cambia = (clave: keyof DocumentFields, v: unknown): void => {
    setCampos((previo) => ({ ...previo, [clave]: v }))
  }
  /** Lo que se escribió, o lo que hay guardado si nadie ha tocado el campo. */
  const texto = (clave: 'code' | 'name' | 'description' | 'discipline' | 'gate' | 'taskCode'): string => {
    const escrito = campos[clave]
    if (escrito !== undefined) return escrito ?? ''
    return documento[clave] ?? ''
  }
  const numero = (clave: 'weeksBeforeGate' | 'standardMinutes'): number | null => {
    const escrito = campos[clave]
    return escrito === undefined ? documento[clave] : escrito
  }

  const candidatos = useMemo(() => {
    const buscado = busca.trim().toLowerCase()
    return todos
      .filter((x) => x.id !== documento.id)
      .filter(
        (x) =>
          buscado === '' ||
          x.code.toLowerCase().includes(buscado) ||
          x.name.toLowerCase().includes(buscado),
      )
  }, [todos, busca, documento.id])

  const cambiados = Object.keys(campos).length > 0
  const mismos = elegidos.size === predecesores.length && predecesores.every((id) => elegidos.has(id))
  const minutos = numero('standardMinutes')

  return (
    <div className="ficha">
      <div className="toolbar">
        <b>{documento.code} · {documento.name}</b>
        <span style={{ flex: 1 }} />
        <button className="button" onClick={onCerrar}>{t('documentos.cerrarFicha')}</button>
      </div>

      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <label>
          {t('documentos.col.codigo')}{' '}
          <input
            className="input"
            style={{ width: 160 }}
            value={texto('code')}
            onChange={(e) => { cambia('code', e.target.value) }}
          />
        </label>
        <label>
          {t('documentos.col.nombre')}{' '}
          <input
            className="input"
            style={{ minWidth: 260 }}
            value={texto('name')}
            onChange={(e) => { cambia('name', e.target.value) }}
          />
        </label>
        <label>
          {t('documentos.col.tipo')}{' '}
          <select
            className="input"
            value={campos.kind ?? documento.kind}
            onChange={(e) => { cambia('kind', e.target.value) }}
          >
            {DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>{t(`documentos.tipo.${k}` as keyof Diccionario)}</option>
            ))}
          </select>
        </label>
        <label>
          {t('documentos.col.disciplina')}{' '}
          <input
            className="input"
            style={{ width: 130 }}
            value={texto('discipline')}
            onChange={(e) => { cambia('discipline', e.target.value === '' ? null : e.target.value) }}
          />
        </label>
        <label>
          {t('documentos.col.puerta')}{' '}
          <input
            className="input"
            style={{ width: 100 }}
            value={texto('gate')}
            onChange={(e) => { cambia('gate', e.target.value === '' ? null : e.target.value) }}
          />
        </label>
        <label title={t('documentos.col.semanasTitulo')}>
          {t('documentos.col.semanas')}{' '}
          <input
            className="input"
            type="number"
            min={0}
            style={{ width: 90 }}
            value={numero('weeksBeforeGate') ?? ''}
            onChange={(e) => {
              cambia('weeksBeforeGate', e.target.value === '' ? null : Number(e.target.value))
            }}
          />
        </label>
        <label>
          {t('documentos.col.esfuerzo')}{' '}
          <input
            className="input"
            type="number"
            min={0}
            step={0.5}
            style={{ width: 100 }}
            value={minutos === null ? '' : String(minutos / 60)}
            onChange={(e) => {
              // La pantalla habla en horas; la base guarda minutos enteros (P5).
              cambia('standardMinutes', e.target.value === '' ? null : Math.round(Number(e.target.value) * 60))
            }}
          />
        </label>
        <label>
          {t('documentos.col.codigoTarea')}{' '}
          <input
            className="input"
            style={{ width: 150 }}
            value={texto('taskCode')}
            onChange={(e) => { cambia('taskCode', e.target.value === '' ? null : e.target.value) }}
          />
        </label>
      </div>

      <div className="toolbar">
        <label style={{ flex: 1 }}>
          {t('documentos.col.descripcion')}{' '}
          <input
            className="input"
            style={{ width: '100%' }}
            value={texto('description')}
            onChange={(e) => { cambia('description', e.target.value === '' ? null : e.target.value) }}
          />
        </label>
      </div>

      <h4>{t('documentos.esperaA.titulo', elegidos.size)}</h4>
      <p className="faint" style={{ margin: '0 0 8px', maxWidth: '90ch' }}>
        {t('documentos.esperaA.explica')}
      </p>
      <input
        className="input"
        type="search"
        placeholder={t('documentos.esperaA.buscar')}
        value={busca}
        onChange={(e) => { setBusca(e.target.value) }}
        style={{ marginBottom: 8, minWidth: 260 }}
      />
      <div className="ficha__candidatos">
        {candidatos.map((otro) => (
          <label key={otro.id}>
            <input
              type="checkbox"
              checked={elegidos.has(otro.id)}
              onChange={() => {
                setElegidos((previo) => {
                  const nuevo = new Set(previo)
                  if (nuevo.has(otro.id)) nuevo.delete(otro.id)
                  else nuevo.add(otro.id)
                  return nuevo
                })
              }}
            />{' '}
            <b>{otro.code}</b> <span className="faint">{otro.name}</span>
          </label>
        ))}
      </div>

      <div className="toolbar">
        <button
          className="button button--primary"
          disabled={busy || (!cambiados && mismos)}
          onClick={() => {
            onRun(async () => {
              if (cambiados) await updateDocumentType(documento.id, campos)
              if (!mismos) await setPredecessors(documento.id, [...elegidos])
              setCampos({})
            })
          }}
        >
          {t('documentos.guardar')}
        </button>
        <span className="faint">
          {!cambiados && mismos ? t('documentos.sinCambios') : t('documentos.conCambios')}
        </span>
      </div>

      <CicloDeFirma
        documento={documento}
        firmas={firmas}
        problemas={problemas}
        busy={busy}
        onRun={onRun}
      />

      <Subactividades
        documento={documento}
        actividades={actividades}
        firmas={firmas}
        problemas={problemasDeActividad}
        busy={busy}
        onRun={onRun}
      />
    </div>
  )
}

function NuevoDocumento({
  busy, onRun, t,
}: {
  readonly busy: boolean
  readonly onRun: (accion: () => Promise<void>) => void
  readonly t: Traductor
}): React.JSX.Element {
  return (
    <button
      className="button"
      disabled={busy}
      onClick={() => {
        const name = window.prompt(t('documentos.nuevo.nombre'))
        if (name === null || name.trim() === '') return
        const code = window.prompt(
          t('documentos.nuevo.codigo'),
          name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 12),
        )
        if (code === null || code.trim() === '') return
        // Lo demás se rellena en la ficha: pedirlo aquí serían nueve diálogos.
        onRun(async () => { await createDocumentType(code.trim(), name.trim()) })
      }}
    >
      {t('documentos.nuevo')}
    </button>
  )
}

// ---------------------------------------------------------------------------
// El ciclo de firma
// ---------------------------------------------------------------------------

/** Las cinco casillas del ciclo, en el orden en que se firman. */
const CASILLAS = [
  { step: 'author', position: 1, clave: 'documentos.firma.autor' },
  { step: 'verifier', position: 1, clave: 'documentos.firma.verificador1' },
  { step: 'verifier', position: 2, clave: 'documentos.firma.verificador2' },
  { step: 'approver', position: 1, clave: 'documentos.firma.aprobador' },
] as const

/**
 * El ciclo en una celda: los roles en el orden en que firman.
 *
 * Los roles y no un contador, por lo mismo que la columna «espera a» escribe
 * los códigos: «Ing. RAMS → Ing. Sistemas → PrEM» se verifica de un vistazo y
 * «3 firmas» no dice nada que sirva.
 */
function Ciclo({
  firmas, problemas, t,
}: {
  readonly firmas: readonly DocumentSignature[]
  readonly problemas: readonly SignatureProblem[]
  readonly t: Traductor
}): React.JSX.Element {
  if (firmas.length === 0) return <span className="faint">{/* texto-fijo: guion de celda vacía */}—</span>
  const cadena = firmas
    .filter((firma) => firma.step !== 'reviewer')
    .map((firma) => firma.role)
    .join(' › ')
  const revisores = firmas.filter((firma) => firma.step === 'reviewer').length
  return (
    <span className={problemas.length === 0 ? undefined : 'firma--rota'}>
      {problemas.length === 0 ? null : (
        <b title={problemas.map((problema) => fraseDeProblema(t, problema)).join(' · ')}>
          {/* texto-fijo: señal de aviso, no es una palabra */}⚠{' '}
        </b>
      )}
      {cadena === '' ? <span className="faint">{/* texto-fijo: guion */}—</span> : cadena}
      {revisores === 0 ? null : (
        <span className="faint"> {t('documentos.firma.masRevisores', revisores)}</span>
      )}
    </span>
  )
}

/**
 * La frase la escribe el diccionario; el servidor sólo manda código y datos.
 *
 * Cada código recibe los suyos, en vez de un `payload` volcado en orden: una
 * frase que recibe un rol vacío porque ese código no lleva rol es la clase de
 * detalle que sólo se ve en alemán y un viernes.
 */
function fraseDeProblema(t: Traductor, problema: SignatureProblem): string {
  const clave = `firma.${problema.code}` as keyof Diccionario
  const rol = String(problema.payload['role'] ?? '')
  const paso = String(problema.payload['step'] ?? '')
  const tipo = String(problema.payload['kind'] ?? '')
  switch (problema.code) {
    case 'SIGNATURE_NOT_INDEPENDENT':
    case 'SIGNATURE_ROLE_REPEATED':
      return t(clave, rol, t(`documentos.firma.paso.${paso}` as keyof Diccionario))
    case 'SIGNATURE_ON_CONTAINER':
      return t(clave, t(`documentos.tipo.${tipo}` as keyof Diccionario))
    default:
      return t(clave)
  }
}

/**
 * El ciclo de firma en la ficha: cuatro casillas y la lista de revisores.
 *
 * Cuatro casillas fijas y no una tabla que crece, porque los procedimientos
 * que dieron pie a esto tienen exactamente esas cuatro y añadir un tercer
 * verificador es una pantalla que nadie ha pedido. La base sí lo admite: el
 * día que haga falta, el dato ya cabe y lo que cambia es esta pantalla.
 *
 * Los revisores no llevan minutos. No firman: se les convoca a la revisión, y
 * lo que cuesta esa reunión ya está en el esfuerzo de la propia puerta.
 */
function CicloDeFirma({
  documento, firmas, problemas, busy, onRun,
}: {
  readonly documento: DocumentType
  readonly firmas: readonly DocumentSignature[]
  readonly problemas: readonly SignatureProblem[]
  readonly busy: boolean
  readonly onRun: (accion: () => Promise<void>) => void
}): React.JSX.Element {
  const { t } = useT()
  const guardadas = useMemo<readonly Signature[]>(
    () => firmas.map(({ step, position, role, standardMinutes }) => ({ step, position, role, standardMinutes })),
    [firmas],
  )
  const [borrador, setBorrador] = useState<readonly Signature[]>(guardadas)

  // Al cambiar de entregable, el borrador vuelve a lo guardado: arrastrar el
  // ciclo a medio escribir de otro documento sería la peor clase de sorpresa.
  useEffect(() => { setBorrador(guardadas) }, [documento.id, guardadas])

  const buscar = (step: Signature['step'], position: number): Signature | undefined =>
    borrador.find((firma) => firma.step === step && firma.position === position)

  const poner = (step: Signature['step'], position: number, cambio: Partial<Signature>): void => {
    setBorrador((previo) => {
      const resto = previo.filter((firma) => !(firma.step === step && firma.position === position))
      const actual = previo.find((firma) => firma.step === step && firma.position === position)
      const nueva: Signature = {
        step,
        position,
        role: cambio.role ?? actual?.role ?? '',
        standardMinutes: cambio.standardMinutes === undefined
          ? (actual?.standardMinutes ?? null)
          : cambio.standardMinutes,
      }
      // Una casilla sin rol no es una firma: se va del borrador entera.
      return nueva.role.trim() === '' ? resto : [...resto, nueva]
    })
  }

  const revisores = borrador
    .filter((firma) => firma.step === 'reviewer')
    .toSorted((a, b) => a.position - b.position)
    .map((firma) => firma.role)

  const ponerRevisores = (texto: string): void => {
    const roles = texto.split(/[|,;]/).map((rol) => rol.trim()).filter((rol) => rol !== '')
    setBorrador((previo) => [
      ...previo.filter((firma) => firma.step !== 'reviewer'),
      ...roles.map((role, indice): Signature => ({
        step: 'reviewer',
        position: indice + 1,
        role,
        standardMinutes: null,
      })),
    ])
  }

  const clave = (firmas: readonly Signature[]): string =>
    firmas
      .map((firma) => `${firma.step}:${String(firma.position)}:${firma.role}:${String(firma.standardMinutes)}`)
      .toSorted()
      .join('|')
  const cambiado = clave(borrador) !== clave(guardadas)

  return (
    <>
      <h4>{t('documentos.firma.titulo', borrador.length)}</h4>
      <p className="faint" style={{ margin: '0 0 8px', maxWidth: '90ch' }}>
        {t('documentos.firma.explica')}
      </p>

      {problemas.length === 0 || cambiado ? null : (
        <ul className="firma__problemas">
          {problemas.map((problema) => (
            <li key={`${problema.code}-${String(problema.payload['role'] ?? '')}-${String(problema.payload['position'] ?? '')}`}>
              {fraseDeProblema(t, problema)}
            </li>
          ))}
        </ul>
      )}

      <div className="ficha__firmas">
        {CASILLAS.map((casilla) => {
          const actual = buscar(casilla.step, casilla.position)
          return (
            <label key={`${casilla.step}${String(casilla.position)}`}>
              <span>{t(casilla.clave)}</span>
              <input
                className="input"
                placeholder={t('documentos.firma.rol')}
                value={actual?.role ?? ''}
                onChange={(e) => { poner(casilla.step, casilla.position, { role: e.target.value }) }}
              />
              <input
                className="input"
                type="number"
                min={0}
                step={15}
                style={{ width: 96 }}
                placeholder={t('documentos.firma.minutos')}
                title={t('documentos.firma.minutosTitulo')}
                value={actual?.standardMinutes ?? ''}
                disabled={actual === undefined}
                onChange={(e) => {
                  const texto = e.target.value.trim()
                  poner(casilla.step, casilla.position, {
                    standardMinutes: texto === '' ? null : Math.max(0, Math.trunc(Number(texto))),
                  })
                }}
              />
            </label>
          )
        })}
        <label>
          <span>{t('documentos.firma.revisores')}</span>
          <input
            className="input"
            placeholder={t('documentos.firma.revisoresEjemplo')}
            value={revisores.join(', ')}
            onChange={(e) => { ponerRevisores(e.target.value) }}
          />
          <span className="faint firma__nota">{t('documentos.firma.revisoresSinMinutos')}</span>
        </label>
      </div>

      <div className="toolbar">
        <button
          className="button"
          disabled={busy || !cambiado}
          onClick={() => {
            onRun(async () => { await setSignatures(documento.id, borrador) })
          }}
        >
          {t('documentos.firma.guardar')}
        </button>
        <span className="faint">
          {cambiado ? t('documentos.conCambios') : t('documentos.sinCambios')}
        </span>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Las subactividades
// ---------------------------------------------------------------------------

/**
 * Las cinco casillas de la cadena, en el orden en que se trabajan.
 *
 * Cinco fijas y no una tabla que crece, por lo mismo que el ciclo de firma:
 * son exactamente las cinco que tiene el libro con el que el equipo planifica,
 * y una sexta es una pantalla que nadie ha pedido. La base admite más de un rol
 * por casilla; el día que haga falta, lo que cambia es esto.
 */
const PASOS = [
  { step: 'create', clave: 'documentos.sub.crear' },
  { step: 'review_1', clave: 'documentos.sub.revisar1' },
  { step: 'review_2', clave: 'documentos.sub.revisar2' },
  { step: 'review_3', clave: 'documentos.sub.revisar3' },
  { step: 'support', clave: 'documentos.sub.soportar' },
] as const satisfies readonly { step: ActivityStep; clave: keyof Diccionario }[]

/** Lo que cada subactividad puede descargar, más «ninguna». */
const FIRMAS_QUE_DESCARGA = [
  { step: 'author', position: 1, clave: 'documentos.firma.autor' },
  { step: 'verifier', position: 1, clave: 'documentos.firma.verificador1' },
  { step: 'verifier', position: 2, clave: 'documentos.firma.verificador2' },
  { step: 'approver', position: 1, clave: 'documentos.firma.aprobador' },
] as const

type Subactividad = Omit<DocumentActivity, 'documentTypeId'>

/**
 * La cadena en una celda: los roles en el orden en que trabajan.
 *
 * Se escribe `S-Eng › TL RAMS` y no «2 subactividades», por lo mismo que la
 * columna del ciclo escribe los roles: la cadena se verifica de un vistazo y un
 * contador no dice nada que sirva. El soporte va aparte y entre paréntesis
 * porque no está en la cadena: acompaña, no bloquea.
 */
function Cadena({
  actividades, problemas, esfuerzo, locale, t,
}: {
  readonly actividades: readonly DocumentActivity[]
  readonly problemas: readonly ActivityProblem[]
  readonly esfuerzo: ActivityEffort | undefined
  readonly locale: string
  readonly t: Traductor
}): React.JSX.Element {
  if (actividades.length === 0) return <span className="faint">{/* texto-fijo: guion de celda vacía */}—</span>
  const enCadena = actividades.filter((actividad) => actividad.step !== 'support')
  const soporte = actividades.filter((actividad) => actividad.step === 'support')
  const minutos = esfuerzo?.minutes ?? 0
  return (
    <span className={problemas.length === 0 ? undefined : 'firma--rota'}>
      {problemas.length === 0 ? null : (
        <b title={problemas.map((problema) => fraseDeSubactividad(t, problema)).join(' · ')}>
          {/* texto-fijo: señal de aviso, no es una palabra */}⚠{' '}
        </b>
      )}
      {enCadena.length === 0 ? (
        <span className="faint">{/* texto-fijo: guion */}—</span>
      ) : (
        enCadena.map((actividad) => actividad.role).join(' › ')
      )}
      {soporte.length === 0 ? null : (
        <span className="faint"> {t('documentos.sub.masSoporte', soporte.length)}</span>
      )}
      {minutos === 0 ? null : (
        <span className="faint"> · {hours(minutos, 0, locale)} h</span>
      )}
    </span>
  )
}

/** La frase la escribe el diccionario; el servidor sólo manda código y datos. */
function fraseDeSubactividad(t: Traductor, problema: ActivityProblem): string {
  const clave = `sub.${problema.code}` as keyof Diccionario
  const tipo = String(problema.payload['kind'] ?? '')
  const firma = String(problema.payload['signatureStep'] ?? '')
  const nombreDeFirma = (): string => t(`documentos.firma.paso.${firma}` as keyof Diccionario)
  switch (problema.code) {
    case 'ACTIVITY_ON_CONTAINER':
      return t(clave, t(`documentos.tipo.${tipo}` as keyof Diccionario))
    case 'ACTIVITY_SUPPORT_SIGNS':
      return t(clave, String(problema.payload['role'] ?? ''), nombreDeFirma())
    case 'ACTIVITY_SIGNATURE_TWICE':
      return t(clave, nombreDeFirma(), String(problema.payload['steps'] ?? ''))
    case 'ACTIVITY_SIGNATURE_ORPHAN':
      return t(clave, nombreDeFirma(), Number(problema.payload['minutes'] ?? 0))
    default:
      return t(clave)
  }
}

/**
 * Las subactividades en la ficha: crear, tres niveles de revisión y soporte.
 *
 * Es lo que hace que un entregable deje de ser «40 h de alguien». En el libro
 * con el que el equipo planifica de verdad, un documento son 40 h de quien lo
 * escribe y 10 h de quien lo revisa, y son dos personas distintas en dos
 * momentos distintos. Aquí se declara eso una vez, por rol, y vale para todos
 * los proyectos.
 *
 * Lo que este editor todavía **no** hace, y conviene decirlo: no parte ninguna
 * tarea ni mueve ninguna fecha. Es el catálogo. Aplicarlo a un proyecto es el
 * paso siguiente, y cambiará cifras en todas las pantallas.
 */
function Subactividades({
  documento, actividades, firmas, problemas, busy, onRun,
}: {
  readonly documento: DocumentType
  readonly actividades: readonly DocumentActivity[]
  readonly firmas: readonly DocumentSignature[]
  readonly problemas: readonly ActivityProblem[]
  readonly busy: boolean
  readonly onRun: (accion: () => Promise<void>) => void
}): React.JSX.Element {
  const { t } = useT()
  const guardadas = useMemo<readonly Subactividad[]>(
    () => actividades.map(({ step, position, role, standardMinutes, signature }) =>
      ({ step, position, role, standardMinutes, signature })),
    [actividades],
  )
  const [borrador, setBorrador] = useState<readonly Subactividad[]>(guardadas)

  // Al cambiar de entregable, el borrador vuelve a lo guardado. Misma razón que
  // en el ciclo de firma: arrastrar lo de otro documento sería la peor sorpresa.
  useEffect(() => { setBorrador(guardadas) }, [documento.id, guardadas])

  const buscar = (step: ActivityStep): Subactividad | undefined =>
    borrador.find((actividad) => actividad.step === step && actividad.position === 1)

  const poner = (step: ActivityStep, cambio: Partial<Subactividad>): void => {
    setBorrador((previo) => {
      const resto = previo.filter((actividad) => !(actividad.step === step && actividad.position === 1))
      const actual = previo.find((actividad) => actividad.step === step && actividad.position === 1)
      const nueva: Subactividad = {
        step,
        position: 1,
        role: cambio.role ?? actual?.role ?? '',
        standardMinutes:
          cambio.standardMinutes === undefined
            ? (actual?.standardMinutes ?? null)
            : cambio.standardMinutes,
        signature: cambio.signature === undefined ? (actual?.signature ?? null) : cambio.signature,
      }
      // Una casilla sin rol no es una subactividad: se va del borrador entera.
      return nueva.role.trim() === '' ? resto : [...resto, nueva]
    })
  }

  const clave = (lista: readonly Subactividad[]): string =>
    lista
      .map((a) =>
        [a.step, a.position, a.role, a.standardMinutes, a.signature?.step, a.signature?.position].join(':'),
      )
      .toSorted()
      .join('|')
  const cambiado = clave(borrador) !== clave(guardadas)

  /** Sólo se ofrecen las firmas que este entregable declara: no hay otras. */
  const descargables = FIRMAS_QUE_DESCARGA.filter((casilla) =>
    firmas.some((firma) => firma.step === casilla.step && firma.position === casilla.position),
  )

  return (
    <>
      <h4>{t('documentos.sub.titulo', borrador.length)}</h4>
      <p className="faint" style={{ margin: '0 0 8px', maxWidth: '90ch' }}>
        {t('documentos.sub.explica')}
      </p>

      {problemas.length === 0 || cambiado ? null : (
        <ul className="firma__problemas">
          {problemas.map((problema) => (
            <li key={`${problema.code}-${String(problema.payload['signatureStep'] ?? '')}-${String(problema.payload['signaturePosition'] ?? '')}`}>
              {fraseDeSubactividad(t, problema)}
            </li>
          ))}
        </ul>
      )}

      <div className="ficha__firmas ficha__subactividades">
        {PASOS.map((paso) => {
          const actual = buscar(paso.step)
          return (
            <label key={paso.step}>
              <span>{t(paso.clave)}</span>
              <input
                className="input"
                placeholder={t('documentos.sub.rol')}
                value={actual?.role ?? ''}
                onChange={(e) => { poner(paso.step, { role: e.target.value }) }}
              />
              <input
                className="input"
                type="number"
                min={0}
                step={15}
                style={{ width: 96 }}
                placeholder={t('documentos.sub.minutos')}
                title={t('documentos.sub.minutosTitulo')}
                value={actual?.standardMinutes ?? ''}
                disabled={actual === undefined}
                onChange={(e) => {
                  const texto = e.target.value.trim()
                  poner(paso.step, {
                    standardMinutes: texto === '' ? null : Math.max(0, Math.trunc(Number(texto))),
                  })
                }}
              />
              {/* La cuarta celda va SIEMPRE, aunque vaya vacía: la rejilla reparte
                  por orden, y una fila de tres celdas en una rejilla de cuatro
                  se lleva la primera casilla de la fila siguiente. El soporte no
                  firma, así que su casilla es la que va vacía. */}
              <span className="sub__firma">
              {paso.step === 'support' || descargables.length === 0 ? null : (
                <select
                  className="input"
                  title={t('documentos.sub.descargaTitulo')}
                  value={
                    actual?.signature === null || actual?.signature === undefined
                      ? ''
                      : `${actual.signature.step}:${String(actual.signature.position)}`
                  }
                  disabled={actual === undefined}
                  onChange={(e) => {
                    const [step, position] = e.target.value.split(':')
                    poner(paso.step, {
                      signature:
                        step === undefined || position === undefined || e.target.value === ''
                          ? null
                          : { step: step as Signature['step'], position: Number(position) },
                    })
                  }}
                >
                  <option value="">{t('documentos.sub.noFirma')}</option>
                  {descargables.map((casilla) => (
                    <option
                      key={`${casilla.step}${String(casilla.position)}`}
                      value={`${casilla.step}:${String(casilla.position)}`}
                    >
                      {t(casilla.clave)}
                    </option>
                  ))}
                </select>
              )}
              </span>
            </label>
          )
        })}
      </div>

      <div className="toolbar">
        <button
          className="button"
          disabled={busy || !cambiado}
          onClick={() => {
            onRun(async () => { await setActivities(documento.id, borrador) })
          }}
        >
          {t('documentos.sub.guardar')}
        </button>
        <span className="faint">
          {cambiado ? t('documentos.sub.conCambios') : t('documentos.sub.sinCambios')}
        </span>
      </div>
    </>
  )
}
