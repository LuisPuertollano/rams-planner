/**
 * La copia de seguridad: sacar la base entera a CSV y volver a meterla.
 *
 * El diseño se apoya en una frontera que esta herramienta ya tiene marcada con
 * permisos de base de datos: **la zona declarada** —lo que alguien escribió— y
 * **la zona derivada** —lo que el motor calculó—. `planner_api` no puede
 * escribir en la segunda y `planner_engine` no puede escribir en la primera.
 *
 * De ahí sale la decisión que más pesa: **la zona derivada no se copia**. Son
 * casi trescientas mil filas de reparto en una cartera real, se recalculan en
 * un segundo y medio, y guardarlas multiplicaría el zip por cien para probar
 * menos. Lo que sí se guarda es la **huella de entrada** de la última
 * ejecución: restaurar, recalcular y obtener la misma huella demuestra que la
 * copia era fiel. Es el principio P2 convertido en procedimiento.
 *
 * Con una excepción que no es una excepción: **las líneas base sí se copian**.
 * Son lo único derivado que no se puede recalcular, porque congelan un plan que
 * desde entonces ha cambiado.
 *
 * El orden de restauración **no se mantiene a mano**: sale de las claves ajenas
 * reales de PostgreSQL, ordenadas topológicamente. Una lista escrita a mano se
 * desincroniza a la segunda tabla nueva, y entonces restaurar falla en una
 * instalación de verdad y no en CI.
 */

import type { Queryable } from './db.js'

/** En qué parte del zip vive cada tabla, y qué significa esa parte. */
export type Zona = 'declarada' | 'parametrizacion' | 'historia' | 'derivada' | 'secreta'

export interface TablaCopiada {
  readonly tabla: string
  readonly zona: Zona
  readonly filas: number
  readonly columnas: readonly string[]
}

/**
 * Lo que NO sale en la copia, y por qué cada cosa.
 *
 * Un zip de copia acaba en un disco compartido. Que ahí no haya con qué entrar
 * en la herramienta no es una precaución: es la diferencia entre una copia y
 * una filtración.
 */
const COLUMNAS_QUE_NO_SALEN: Readonly<Record<string, readonly string[]>> = {
  // El hash es suficiente para entrar por fuerza bruta si alguien se lo lleva.
  // Restaurar recrea la cuenta y exige contraseña nueva, que es lo correcto.
  app_user: ['password_hash'],
}

/** Tablas que no se copian nunca, con el motivo. */
export const NO_SE_COPIAN: Readonly<Record<string, string>> = {
  schema_migrations: 'la lleva dbmate, y restaurarla encima mentiría sobre qué migraciones corrieron',
  user_session: 'una sesión abierta no es un dato que restaurar; es una llave',
}

/**
 * La zona derivada: se recalcula, no se copia.
 *
 * Se exporta porque quien comprueba una copia tiene que saber qué tablas NO
 * espera encontrar dentro. Sin eso, la comprobación da por incompleta una copia
 * que está entera.
 */
export const SE_RECALCULAN: ReadonlySet<string> = new Set([
  'task_result', 'assignment_timephased', 'finding', 'derivation', 'capacity_cell',
])
const DERIVADAS = SE_RECALCULAN

/** Lo que el motor calculó pero no puede volver a calcular. */
const HISTORIA = new Set(['baseline', 'calculation_run', 'capacity_set', 'change_event', 'progress_update'])

/** Lo que parametriza la herramienta, más que describir el trabajo. */
const PARAMETRIZACION = new Set([
  'app_role', 'app_user', 'role_permission', 'user_role', 'rule_definition',
  'field_definition', 'skill', 'tag', 'calendar', 'calendar_week_slot',
  'calendar_exception', 'calendar_exception_slot',
])

function zonaDe(tabla: string): Zona {
  if (DERIVADAS.has(tabla)) return 'derivada'
  if (HISTORIA.has(tabla)) return 'historia'
  if (PARAMETRIZACION.has(tabla)) return 'parametrizacion'
  return 'declarada'
}

/**
 * Las tablas que hay, en orden de restauración.
 *
 * El orden sale de las claves ajenas: una tabla va después de todas aquellas a
 * las que apunta. Las particiones de `assignment_timephased` se quedan fuera
 * —son zona derivada y además se crean solas— igual que las vistas.
 */
export async function tablasEnOrden(db: Queryable): Promise<readonly string[]> {
  const { rows: tablas } = await db.query<{ tabla: string }>(
    `SELECT c.relname AS tabla
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relispartition = FALSE
      ORDER BY c.relname`,
  )
  const { rows: aristas } = await db.query<{ hijo: string; padre: string }>(
    `SELECT c.conrelid::regclass::text AS hijo, c.confrelid::regclass::text AS padre
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'public' AND c.conrelid <> c.confrelid`,
  )

  const todas = tablas.map((f) => f.tabla).filter((t) => !(t in NO_SE_COPIAN))
  const conjunto = new Set(todas)
  const espera = new Map<string, Set<string>>(todas.map((t) => [t, new Set<string>()]))
  for (const arista of aristas) {
    const hijo = arista.hijo.replace(/^public\./, '')
    const padre = arista.padre.replace(/^public\./, '')
    if (!conjunto.has(hijo) || !conjunto.has(padre)) continue
    espera.get(hijo)?.add(padre)
  }

  // Kahn, y en orden alfabético dentro de cada nivel: sin ese desempate, dos
  // copias de la misma base podrían ordenar las tablas distinto y el zip
  // dejaría de ser reproducible (P2).
  const orden: string[] = []
  const puestas = new Set<string>()
  while (orden.length < todas.length) {
    const listas = todas
      .filter((t) => !puestas.has(t) && [...(espera.get(t) ?? [])].every((p) => puestas.has(p)))
      .sort()
    if (listas.length === 0) {
      // Un ciclo de claves ajenas. No lo hay hoy, y si algún día lo hubiera es
      // mejor decirlo que ordenar a ojo y fallar al restaurar.
      throw new Error(
        `Hay un ciclo de claves ajenas entre: ${todas.filter((t) => !puestas.has(t)).join(', ')}`,
      )
    }
    for (const tabla of listas) { orden.push(tabla); puestas.add(tabla) }
  }
  return orden
}

/** Las columnas de una tabla, en el orden en que están declaradas. */
export async function columnasDe(db: Queryable, tabla: string): Promise<readonly string[]> {
  const { rows } = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [tabla],
  )
  const fuera = new Set(COLUMNAS_QUE_NO_SALEN[tabla] ?? [])
  return rows.map((f) => f.column_name).filter((c) => !fuera.has(c))
}

/**
 * Vuelca una tabla a filas de texto.
 *
 * Todo sale como cadena y `NULL` sale como cadena vacía, con una consecuencia
 * que hay que conocer: una columna de texto que valga la cadena vacía y otra
 * que valga `NULL` se escriben igual y vuelven como `NULL`. Se acepta a
 * propósito. La alternativa —un centinela tipo `\N`— hace el CSV ilegible en
 * Excel, y ese era el requisito: que se pueda auditar sin la herramienta.
 */
export async function volcarTabla(
  db: Queryable,
  tabla: string,
  columnas: readonly string[],
): Promise<readonly Readonly<Record<string, string>>[]> {
  const lista = columnas.map((c) => `"${c}"::text`).join(', ')
  const clave = columnas.map((c) => `"${c}"`).join(', ')
  const { rows } = await db.query<Record<string, string | null>>(
    `SELECT ${lista} FROM "${tabla}" ORDER BY ${clave}`,
  )
  return rows.map((fila) => {
    const salida: Record<string, string> = {}
    for (const columna of columnas) salida[columna] = fila[columna] ?? ''
    return salida
  })
}

/** Cuántas filas tiene cada tabla, para el manifiesto y para el resumen. */
export async function contar(db: Queryable, tabla: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${tabla}"`)
  return Number(rows[0]?.n ?? '0')
}

export interface HuellaDeEjecucion {
  readonly runId: string
  readonly inputHash: string
  readonly engineVersion: string
  readonly startedAt: string
}

/**
 * La última ejecución completada, que es la que prueba que la copia es fiel.
 *
 * Restaurar y recalcular tiene que dar esta misma `inputHash`. Si no la da, la
 * copia perdió algo por el camino, y más vale saberlo el día que se restaura
 * que el día que alguien pregunta por una cifra.
 */
export async function ultimaEjecucion(db: Queryable): Promise<HuellaDeEjecucion | null> {
  const { rows } = await db.query<{
    id: string; input_hash: string; engine_version: string; started_at: string
  }>(
    `SELECT id, input_hash, engine_version, started_at::text
       FROM calculation_run
      WHERE finished_at IS NOT NULL AND status = 'succeeded'
      ORDER BY started_at DESC, id DESC
      LIMIT 1`,
  )
  const fila = rows[0]
  if (fila === undefined) return null
  return {
    runId: fila.id,
    inputHash: fila.input_hash,
    engineVersion: fila.engine_version,
    startedAt: fila.started_at,
  }
}

/** La versión del esquema: la última migración aplicada. */
export async function versionDelEsquema(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1',
  )
  return rows[0]?.version ?? ''
}

export interface ResumenDeCopia {
  readonly tablas: readonly TablaCopiada[]
  readonly esquema: string
  readonly ejecucion: HuellaDeEjecucion | null
}

/** Lee todo lo que va a la copia, sin escribir nada. */
export async function leerCopia(
  db: Queryable,
  incluirDerivadas: boolean,
): Promise<{ resumen: ResumenDeCopia; datos: ReadonlyMap<string, readonly Readonly<Record<string, string>>[]> }> {
  const orden = await tablasEnOrden(db)
  const tablas: TablaCopiada[] = []
  const datos = new Map<string, readonly Readonly<Record<string, string>>[]>()
  for (const tabla of orden) {
    const zona = zonaDe(tabla)
    if (zona === 'derivada' && !incluirDerivadas) {
      tablas.push({ tabla, zona, filas: await contar(db, tabla), columnas: [] })
      continue
    }
    const columnas = await columnasDe(db, tabla)
    const filas = await volcarTabla(db, tabla, columnas)
    datos.set(tabla, filas)
    tablas.push({ tabla, zona, filas: filas.length, columnas })
  }
  return {
    resumen: {
      tablas,
      esquema: await versionDelEsquema(db),
      ejecucion: await ultimaEjecucion(db),
    },
    datos,
  }
}

export interface ResultadoDeRestauracion {
  readonly tablas: number
  readonly filas: number
  readonly saltadas: readonly { tabla: string; motivo: string }[]
}

/**
 * Lo que la copia trae pero la restauración NO escribe, y por qué.
 *
 * Esto no salió de una decisión de diseño: salió de intentarlo. El esquema
 * tiene disparadores que protegen cosas, y al chocar con ellos quedó claro que
 * tenían razón.
 */
export const NO_SE_RESTAURAN: Readonly<Record<string, string>> = {
  // El historial es append-only (P7) y el disparador rechaza borrarlo. Y hace
  // bien: restaurarlo sería REESCRIBIR la historia. Se exporta porque es
  // evidencia, y no se restaura porque la evidencia no se fabrica. Lo que sí
  // queda es el rastro de la propia restauración, con su comentario.
  change_event: 'el historial es append-only: se copia como evidencia, no se reescribe',
}

/**
 * Filas que se quedan donde están: las que crea la migración y el esquema
 * protege. Un rol de sistema no se puede borrar ni degradar, y sus permisos no
 * se editan «porque los tiene todos por definición».
 */
const SOLO_LO_QUE_NO_ES_DE_SISTEMA: Readonly<Record<string, string>> = {
  app_role: 'is_system = FALSE',
  role_permission: 'role_id NOT IN (SELECT id FROM app_role WHERE is_system)',
}

/**
 * Las columnas con las que una tabla se apunta a sí misma.
 *
 * `wbs_node.parent_id` es la que hay hoy: una fase contiene paquetes que
 * contienen tareas, y las tres viven en la misma tabla. Ordenar las TABLAS no
 * basta ahí; hay que ordenar las FILAS, porque un hijo no puede entrar antes
 * que su padre.
 *
 * Esto lo destapó restaurar la cartera real. Con los datos de demostración
 * pasaba por casualidad —pocos nodos y los UUID cayeron de cara—, que es la
 * peor forma de que una prueba pase.
 */
async function columnasQueApuntanAsiMisma(
  db: Queryable,
  tabla: string,
): Promise<readonly string[]> {
  const { rows } = await db.query<{ columna: string }>(
    `SELECT a.attname AS columna
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN unnest(c.conkey) AS k(attnum) ON TRUE
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.contype = 'f' AND n.nspname = 'public'
        AND c.conrelid = c.confrelid AND t.relname = $1`,
    [tabla],
  )
  return rows.map((f) => f.columna)
}

/**
 * Ordena las filas de una tabla que se apunta a sí misma: padres antes que
 * hijos.
 *
 * Una fila cuyo padre no esté en el juego —porque apunta a nulo, o a algo que
 * la copia no trae— va en la primera tanda: si el padre falta de verdad, que lo
 * diga la clave ajena y no este orden.
 */
function padresPrimero(
  filas: readonly Readonly<Record<string, string>>[],
  columnas: readonly string[],
): readonly Readonly<Record<string, string>>[] {
  const identificador = (fila: Readonly<Record<string, string>>): string => fila['id'] ?? ''
  const todas = new Set(filas.map(identificador))
  const puestas = new Set<string>()
  const ordenadas: Readonly<Record<string, string>>[] = []
  let pendientes = [...filas]

  while (pendientes.length > 0) {
    const listas = pendientes.filter((fila) =>
      columnas.every((columna) => {
        const padre = fila[columna] ?? ''
        return padre === '' || !todas.has(padre) || puestas.has(padre)
      }),
    )
    if (listas.length === 0) {
      // Un ciclo entre filas. No debería existir —un nodo no puede ser su
      // propio abuelo— pero si lo hay, mejor decirlo que entrar a medias.
      throw new Error(`Hay un ciclo de padres entre ${String(pendientes.length)} fila(s)`)
    }
    for (const fila of listas) { ordenadas.push(fila); puestas.add(identificador(fila)) }
    const yaEstan = new Set(listas)
    pendientes = pendientes.filter((fila) => !yaEstan.has(fila))
  }
  return ordenadas
}

/**
 * Lo que una tabla que NO se restaura sigue señalando.
 *
 * El historial no se borra nunca, y apunta a `app_user.actor_id`. Consecuencia:
 * **un usuario que aparece en la historia no se puede borrar**. La base lo
 * impide, y hace bien — si se pudiera, se podría borrar a quien hizo algo y
 * dejar el cambio sin dueño.
 *
 * Así que esas tablas no se vacían: se **funden**. Las filas que trae la copia
 * se meten o se actualizan, y las que no trae sólo se van si nadie las señala.
 * Esto no se mantiene a mano: sale de las claves ajenas de verdad, así que el
 * día que el historial apunte a otra cosa, esto se entera solo.
 */
async function loQueSeFunde(
  db: Queryable,
): Promise<ReadonlyMap<string, readonly { tabla: string; columna: string }[]>> {
  const { rows } = await db.query<{ destino: string; origen: string; columna: string }>(
    `SELECT c.confrelid::regclass::text AS destino,
            o.relname                   AS origen,
            a.attname                   AS columna
       FROM pg_constraint c
       JOIN pg_class o ON o.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = o.relnamespace
       JOIN unnest(c.conkey) AS k(attnum) ON TRUE
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.contype = 'f' AND n.nspname = 'public' AND o.relname = ANY($1)`,
    [Object.keys(NO_SE_RESTAURAN)],
  )
  const porDestino = new Map<string, { tabla: string; columna: string }[]>()
  for (const fila of rows) {
    const destino = fila.destino.replace(/^public\./, '')
    const lista = porDestino.get(destino) ?? []
    lista.push({ tabla: fila.origen, columna: fila.columna })
    porDestino.set(destino, lista)
  }
  return porDestino
}

/** La clave primaria de una tabla, para poder fundir en vez de insertar. */
async function clavePrimaria(db: Queryable, tabla: string): Promise<readonly string[]> {
  const { rows } = await db.query<{ columna: string }>(
    `SELECT a.attname AS columna
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN unnest(c.conkey) AS k(attnum) ON TRUE
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.contype = 'p' AND n.nspname = 'public' AND t.relname = $1`,
    [tabla],
  )
  return rows.map((f) => f.columna)
}

/** Qué columnas admiten nulo, para no confundir «vacío» con «nulo». */
async function columnasNulables(db: Queryable, tabla: string): Promise<ReadonlySet<string>> {
  const { rows } = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND is_nullable = 'YES'`,
    [tabla],
  )
  return new Set(rows.map((f) => f.column_name))
}

/**
 * Restaura: vacía la base y la vuelve a llenar con lo que trae la copia.
 *
 * **Esto borra todo lo que hay.** Va entero dentro de una transacción, así que
 * o entra todo o no entra nada; una restauración a medias dejaría una base que
 * parece buena y no lo es, que es peor que una base vacía.
 *
 * Las tablas se vacían en orden inverso al de restauración —los hijos antes que
 * los padres— y se llenan en el orden que dan las claves ajenas.
 *
 * **Los disparadores se quedan puestos, todos.** Los de invariante porque son
 * lo que garantiza que lo que entra es coherente: una copia que sólo entra con
 * los invariantes apagados no es una copia buena, es un volcado. Y los de
 * auditoría porque una restauración SÍ es un cambio, y el historial tiene que
 * poder decirlo. Cada fila que escribe esto queda registrada con el comentario
 * que se le pasa, así que el historial no dice «alguien cambió tres mil cosas»
 * sino «esto fue la restauración de la copia del 20 de septiembre».
 */
export async function restaurarCopia(
  db: Queryable,
  datos: ReadonlyMap<string, readonly Readonly<Record<string, string>>[]>,
  comentario: string,
): Promise<ResultadoDeRestauracion> {
  const orden = await tablasEnOrden(db)
  const saltadas: { tabla: string; motivo: string }[] = []

  // El comentario viaja en la sesión y lo recoge el disparador de auditoría,
  // que ya lo lee desde el primer día. No hace falta tocar nada más.
  await db.query('SELECT set_config($1, $2, TRUE)', ['app.change_comment', comentario])

  const seFunde = await loQueSeFunde(db)
  for (const tabla of [...orden].reverse()) {
    if (tabla in NO_SE_RESTAURAN) continue
    const condiciones: string[] = []
    const salvo = SOLO_LO_QUE_NO_ES_DE_SISTEMA[tabla]
    if (salvo !== undefined) condiciones.push(salvo)
    // Lo que el historial señala no se borra: ni se puede, ni se debe.
    for (const quien of seFunde.get(tabla) ?? []) {
      const clave = await clavePrimaria(db, tabla)
      const columna = clave[0]
      if (columna === undefined) continue
      condiciones.push(
        `"${columna}" NOT IN (SELECT "${quien.columna}" FROM "${quien.tabla}"` +
          ` WHERE "${quien.columna}" IS NOT NULL)`,
      )
    }
    await db.query(
      `DELETE FROM "${tabla}"${condiciones.length === 0 ? '' : ` WHERE ${condiciones.join(' AND ')}`}`,
    )
  }

  let filasPuestas = 0
  let tablasPuestas = 0
  for (const tabla of orden) {
    const motivo = NO_SE_RESTAURAN[tabla]
    if (motivo !== undefined) { saltadas.push({ tabla, motivo }); continue }
    const filas = datos.get(tabla)
    if (filas === undefined) {
      // La zona derivada no falta: no se copia a propósito, y decir «la copia
      // no la trae» haría pensar que la copia está coja.
      saltadas.push({
        tabla,
        motivo: SE_RECALCULAN.has(tabla)
          ? 'la calcula el motor: no se copia, se recalcula'
          : 'la copia no la trae',
      })
      continue
    }
    tablasPuestas += 1
    if (filas.length === 0) continue
    const columnas = Object.keys(filas[0] ?? {})
    if (columnas.length === 0) continue
    const nulables = await columnasNulables(db, tabla)
    const deSistema = tabla in SOLO_LO_QUE_NO_ES_DE_SISTEMA
      ? await idsDeSistema(db, tabla)
      : null
    const filtradas = deSistema === null ? filas : filas.filter((f) => !deSistema(f))
    // Si la tabla se apunta a sí misma, los padres van antes que los hijos.
    const propias = await columnasQueApuntanAsiMisma(db, tabla)
    const aPoner = propias.length === 0 ? filtradas : padresPrimero(filtradas, propias)
    if (aPoner.length === 0) continue
    const lista = columnas.map((c) => `"${c}"`).join(', ')

    // Por lotes y no fila a fila: una cartera real trae miles de filas en
    // `wbs_node` y `dependency`, y un viaje por fila convierte medio segundo en
    // medio minuto. El lote se acota porque PostgreSQL admite 65.535 parámetros.
    // Una tabla que el historial señala puede tener filas que sobrevivieron al
    // vaciado, así que aquí se funde: la copia manda sobre lo que quedó.
    const clave = seFunde.has(tabla) ? await clavePrimaria(db, tabla) : []
    const alFundir =
      clave.length === 0
        ? ''
        : ` ON CONFLICT (${clave.map((c) => `"${c}"`).join(', ')}) DO UPDATE SET ` +
          columnas
            .filter((c) => !clave.includes(c))
            .map((c) => `"${c}" = EXCLUDED."${c}"`)
            .join(', ')

    const porLote = Math.max(1, Math.floor(60_000 / columnas.length))
    for (let inicio = 0; inicio < aPoner.length; inicio += porLote) {
      const lote = aPoner.slice(inicio, inicio + porLote)
      const valores: (string | null)[] = []
      const huecos = lote.map((fila, i) => {
        const marcas = columnas.map((columna, j) => {
          const bruto = fila[columna] ?? ''
          // Vacío es nulo sólo donde cabe un nulo. Donde no cabe, una cadena
          // vacía es un valor legítimo y hay que dejarla pasar tal cual.
          valores.push(bruto === '' && nulables.has(columna) ? null : bruto)
          return `$${String(i * columnas.length + j + 1)}`
        })
        return `(${marcas.join(', ')})`
      })
      await db.query(`INSERT INTO "${tabla}" (${lista}) VALUES ${huecos.join(', ')}${alFundir}`, valores)
      filasPuestas += lote.length
    }
  }

  return { tablas: tablasPuestas, filas: filasPuestas, saltadas }
}

/** Las filas de sistema que ya están puestas y que no hay que volver a meter. */
async function idsDeSistema(
  db: Queryable,
  tabla: string,
): Promise<(fila: Readonly<Record<string, string>>) => boolean> {
  if (tabla === 'app_role') {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM app_role WHERE is_system')
    const ids = new Set(rows.map((f) => f.id))
    return (fila) => ids.has(fila['id'] ?? '')
  }
  const { rows } = await db.query<{ id: string }>('SELECT id FROM app_role WHERE is_system')
  const ids = new Set(rows.map((f) => f.id))
  return (fila) => ids.has(fila['role_id'] ?? '')
}
