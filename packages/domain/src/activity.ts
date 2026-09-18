/**
 * Las subactividades de un entregable: la cadena, y las cuatro cosas que
 * pueden estar mal.
 *
 * Un documento no es una tarea. En el libro con el que el equipo planifica de
 * verdad cada documento aparece varias veces —una por subactividad— y cada una
 * tiene su rol, sus horas y su predecesora:
 *
 *     (S) Safety-Bid/BECO   C    S-Eng      50 h   ← (MSt) PROJECT Start
 *     (S) Safety-Bid/BECO   R1   TL RAMS    10 h   ← (S) Safety-Bid/BECO - C
 *
 * Aquí se modela eso, y **nada más que eso**: qué subactividades tiene un
 * entregable y en qué orden se encadenan. Aplicarlo a un proyecto —partir la
 * tarea, poner fechas, atar dependencias— es otra cosa y va en otro sitio.
 *
 * **Todo es por rol.** En este fichero no hay ni una persona, igual que en
 * `signature.ts` y por lo mismo.
 *
 * ## Lo que este fichero NO comprueba, y por qué
 *
 * Tres reglas que parecen obvias y que el libro real desmiente:
 *
 *   - **«Una revisión sin creación está mal.»** No: hay entregables con `R2` y
 *     sin `C`. Los escribe otro departamento y RAMS sólo revisa. Es la mitad
 *     del trabajo de un equipo de seguridad.
 *   - **«Los niveles no pueden saltarse.»** Tampoco: hay `C + R3` sin `R2`.
 *     `review_1/2/3` son **niveles**, no rondas.
 *   - **«Quien revisa no puede tener el rol de quien escribe.»** Es la regla de
 *     independencia de `signature.ts`, y ahí está bien. Aquí no: la mayoría de
 *     los entregables del libro tienen `C: S-Eng` y `R1: S-Eng`, porque un rol
 *     lo ocupan varias personas. Avisar aquí sería avisar de casi todo, que es
 *     la forma segura de que dejen de leerse los avisos.
 *
 * Avisa, no impide, como todo el resto del catálogo.
 */

/** Los cinco papeles del libro del equipo, y sólo esos. */
export type ActivityStep = 'create' | 'review_1' | 'review_2' | 'review_3' | 'support'

/** El orden en que se encadenan. `support` no está: no encadena con nadie. */
const CADENA: readonly ActivityStep[] = ['create', 'review_1', 'review_2', 'review_3']

export interface DocumentActivity {
  readonly step: ActivityStep
  /** Dos roles en el mismo nivel. Lo normal es 1. */
  readonly position: number
  /** El nombre del rol, nunca el de una persona. */
  readonly role: string
  /** Lo que cuesta, en minutos. Nulo mientras nadie lo haya estimado. */
  readonly standardMinutes: number | null
  /** La firma que descarga, si descarga alguna. */
  readonly signature: ActivitySignatureRef | null
}

export interface ActivitySignatureRef {
  readonly step: 'author' | 'verifier' | 'approver' | 'reviewer'
  readonly position: number
}

/**
 * El código es el contrato: el motor manda el código y los datos, la interfaz
 * escribe la frase. Añadir uno es barato; cambiar uno rompe lo ya guardado.
 */
export type ActivityProblemCode =
  | 'ACTIVITY_ON_CONTAINER'
  | 'ACTIVITY_SUPPORT_SIGNS'
  | 'ACTIVITY_SIGNATURE_TWICE'
  | 'ACTIVITY_SIGNATURE_ORPHAN'

export interface ActivityProblem {
  readonly code: ActivityProblemCode
  readonly payload: Readonly<Record<string, string | number>>
}

/** Lo que se comprueba cambia según lo que sea la fila del catálogo. */
export type ActivityKind = 'documento' | 'hito' | 'fase'

/** Una firma declarada en el ciclo, para poder decir cuál se quedó sin trabajo. */
export interface DeclaredSignature {
  readonly step: ActivitySignatureRef['step']
  readonly position: number
  readonly standardMinutes: number | null
}

const clave = (referencia: ActivitySignatureRef): string =>
  `${referencia.step}#${String(referencia.position)}`

/** Orden estable: mismas entradas, misma lista, siempre (P2). */
function ordenadas(actividades: readonly DocumentActivity[]): readonly DocumentActivity[] {
  const rango = (paso: ActivityStep): number => {
    const i = CADENA.indexOf(paso)
    return i === -1 ? CADENA.length : i
  }
  return actividades.toSorted((a, b) => rango(a.step) - rango(b.step) || a.position - b.position)
}

/**
 * Una arista de la cadena interna del entregable. `de` va antes que `a`.
 *
 * Se encadenan **los niveles declarados**, saltándose los huecos: con `C` y
 * `R3` la cadena es `C → R3`, porque un nivel que no existe no puede esperar a
 * nadie. Es lo que hace el libro cuando salta del 1 al 3.
 *
 * Dentro de un mismo nivel las subactividades van **en paralelo**: dos
 * revisores del nivel 1 revisan a la vez, no uno detrás de otro. Por eso la
 * arista va de todas las del nivel anterior a todas las del siguiente.
 */
export interface ActivityEdge {
  readonly from: ActivityStep
  readonly fromPosition: number
  readonly to: ActivityStep
  readonly toPosition: number
}

export function activityChain(actividades: readonly DocumentActivity[]): readonly ActivityEdge[] {
  const porNivel = CADENA.map((paso) =>
    ordenadas(actividades.filter((actividad) => actividad.step === paso)),
  ).filter((nivel) => nivel.length > 0)

  const aristas: ActivityEdge[] = []
  for (let i = 1; i < porNivel.length; i += 1) {
    for (const antes of porNivel[i - 1] ?? []) {
      for (const despues of porNivel[i] ?? []) {
        aristas.push({
          from: antes.step,
          fromPosition: antes.position,
          to: despues.step,
          toPosition: despues.position,
        })
      }
    }
  }
  return aristas
}

/**
 * La subactividad que cierra el entregable de cara a los demás: la revisión de
 * nivel más alto que se haya declarado, o la creación si no hay ninguna.
 *
 * Es la que importa para el plan: en el libro, el sucesor de un documento
 * empieza a **crearse** cuando el predecesor está **revisado**, no cuando ha
 * terminado todo lo suyo. De 299 dependencias entre documentos, la forma
 * dominante es exactamente esa.
 *
 * `undefined` si el entregable sólo declara soporte: el soporte no cierra nada.
 */
export function lastGate(actividades: readonly DocumentActivity[]): DocumentActivity | undefined {
  const enCadena = ordenadas(actividades.filter((actividad) => actividad.step !== 'support'))
  return enCadena[enCadena.length - 1]
}

/**
 * Por dónde entra el trabajo de un entregable: la creación, si la hay. Si el
 * documento lo escribe otro departamento y aquí sólo se revisa, entra por la
 * primera revisión declarada.
 */
export function firstGate(actividades: readonly DocumentActivity[]): DocumentActivity | undefined {
  return ordenadas(actividades.filter((actividad) => actividad.step !== 'support'))[0]
}

/**
 * Revisa las subactividades de un entregable. Devuelve los problemas en orden
 * estable (P2).
 *
 * Un entregable **sin ninguna subactividad declarada** no da ningún problema:
 * no está mal rellenado, está sin rellenar, y son dos cosas distintas.
 */
export function checkActivities(
  kind: ActivityKind,
  actividades: readonly DocumentActivity[],
  firmas: readonly DeclaredSignature[] = [],
): readonly ActivityProblem[] {
  if (actividades.length === 0) return []

  // Una fase agrupa y un hito es un instante: ninguno de los dos se escribe ni
  // se revisa. Que alguien haya declarado subactividades ahí suele querer decir
  // que la fila está mal tipada. Es la misma comprobación que el ciclo de firma
  // hace, y por la misma razón.
  if (kind !== 'documento') {
    return [{ code: 'ACTIVITY_ON_CONTAINER', payload: { kind, count: actividades.length } }]
  }

  const problemas: ActivityProblem[] = []
  const descargadas = new Map<string, DocumentActivity[]>()

  for (const actividad of ordenadas(actividades)) {
    if (actividad.signature === null) continue

    // El soporte acompaña: va a las reuniones, contesta preguntas, aguanta al
    // ISA. No escribe ni firma, y si alguien le cuelga una firma es que esa
    // firma no tiene quien la haga.
    if (actividad.step === 'support') {
      problemas.push({
        code: 'ACTIVITY_SUPPORT_SIGNS',
        payload: {
          role: actividad.role,
          position: actividad.position,
          signatureStep: actividad.signature.step,
        },
      })
      continue
    }

    const k = clave(actividad.signature)
    const yaEstaban = descargadas.get(k)
    if (yaEstaban === undefined) descargadas.set(k, [actividad])
    else yaEstaban.push(actividad)
  }

  // Dos subactividades descargando la misma firma no son dos firmas: son una
  // contada dos veces, y sus minutos se sumarían dos veces el día que entren en
  // la carga de alguien.
  for (const [k, lista] of [...descargadas].toSorted(([a], [b]) => a.localeCompare(b))) {
    if (lista.length < 2) continue
    const primera = lista[0]
    if (primera?.signature == null) continue
    problemas.push({
      code: 'ACTIVITY_SIGNATURE_TWICE',
      payload: {
        signatureStep: primera.signature.step,
        signaturePosition: primera.signature.position,
        count: lista.length,
        steps: lista.map((actividad) => actividad.step).join(', '),
        key: k,
      },
    })
  }

  // La que de verdad importa: una firma que cuesta minutos y que ninguna
  // subactividad hace. Es el hueco que ADR-0032 dejó escrito —«el motor todavía
  // no lo suma a la carga de nadie»— y esos minutos se quedarían fuera del plan
  // sin que nadie lo note. Una firma SIN minutos declarados no se avisa: no hay
  // nada que se pierda.
  for (const firma of firmas.toSorted(
    (a, b) => a.step.localeCompare(b.step) || a.position - b.position,
  )) {
    if (firma.standardMinutes === null || firma.standardMinutes === 0) continue
    if (descargadas.has(clave(firma))) continue
    problemas.push({
      code: 'ACTIVITY_SIGNATURE_ORPHAN',
      payload: {
        signatureStep: firma.step,
        signaturePosition: firma.position,
        minutes: firma.standardMinutes,
      },
    })
  }

  return problemas
}

/**
 * Lo que cuesta el entregable entero, en minutos, sumando lo declarado.
 *
 * **No entra en la carga de nadie** todavía, igual que `signatureMinutes`:
 * meterlo en el cálculo cambia las cifras de todas las pantallas y es una
 * decisión aparte.
 */
export function activityMinutes(actividades: readonly DocumentActivity[]): number {
  return actividades.reduce((total, actividad) => total + (actividad.standardMinutes ?? 0), 0)
}

/**
 * Los minutos de firma que **ya están contados** dentro de las subactividades,
 * para poder sumar el entregable sin contar dos veces lo mismo.
 */
export function signatureMinutesCovered(actividades: readonly DocumentActivity[]): number {
  return actividades
    .filter((actividad) => actividad.signature !== null && actividad.step !== 'support')
    .reduce((total, actividad) => total + (actividad.standardMinutes ?? 0), 0)
}
