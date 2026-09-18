/**
 * El ciclo de firma de un entregable, y las cuatro cosas que pueden estar mal.
 *
 * Un entregable RAMS no está hecho cuando su autor lo termina: está hecho
 * cuando lo ha verificado alguien distinto y lo ha aprobado quien puede. Los
 * procedimientos lo traen en tabla —Autor · Verificador 1 · Verificador 2 ·
 * Aprobador · Revisores— y lo que aquí se comprueba es exactamente lo que esa
 * tabla da por supuesto y nadie escribe: que haya aprobador, que haya autor, y
 * que quien verifica no sea quien escribió.
 *
 * **Todo es por rol.** En este fichero no hay ni una persona, y la
 * independencia se mide entre nombres de rol. Los procedimientos lo escriben
 * así a propósito: cuando hace falta que verifique otra persona del mismo
 * puesto, ponen «RAMS Engineer 1» y «RAMS Engineer 2», que son dos roles
 * distintos aunque sea el mismo puesto. Un catálogo que pone el mismo texto en
 * las dos casillas está diciendo que firma dos veces el mismo, y eso es lo que
 * se avisa.
 *
 * Avisa, no impide. Un catálogo a medio rellenar es el estado normal de un
 * catálogo el primer día, y una herramienta que se niega a guardarlo es una
 * herramienta que no se usa. Es la misma decisión que ADR-0016 tomó con los
 * ciclos de la matriz.
 */

/** Los cuatro papeles que los procedimientos distinguen. */
export type SignatureStep = 'author' | 'verifier' | 'approver' | 'reviewer'

export interface Signature {
  readonly step: SignatureStep
  /** Distingue Verificador 1 de Verificador 2. Autor y aprobador llevan 1. */
  readonly position: number
  /** El nombre del rol, nunca el de una persona. */
  readonly role: string
  /** Lo que cuesta la firma, en minutos. El motor todavía no lo suma a nadie. */
  readonly standardMinutes: number | null
}

/**
 * El código es el contrato: el motor manda el código y los datos, la interfaz
 * escribe la frase. Añadir uno es barato; cambiar uno rompe lo ya guardado.
 */
export type SignatureProblemCode =
  | 'SIGNATURE_NO_AUTHOR'
  | 'SIGNATURE_NO_APPROVER'
  | 'SIGNATURE_NOT_INDEPENDENT'
  | 'SIGNATURE_ROLE_REPEATED'
  | 'SIGNATURE_ON_CONTAINER'

export interface SignatureProblem {
  readonly code: SignatureProblemCode
  readonly payload: Readonly<Record<string, string | number>>
}

/** Lo que se comprueba cambia según lo que sea la fila del catálogo. */
export type SignedKind = 'documento' | 'hito' | 'fase'

/**
 * Dos roles son el mismo si su nombre lo es, ignorando mayúsculas y espacios
 * de sobra. `RAMS Engineer` y `rams engineer` son el mismo puesto escrito por
 * dos personas distintas; `RAMS Engineer 1` y `RAMS Engineer 2` no lo son, y
 * ahí está toda la independencia que los procedimientos piden.
 */
function mismoRol(uno: string, otro: string): boolean {
  return normaliza(uno) === normaliza(otro)
}

function normaliza(rol: string): string {
  return rol.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')
}

function deLPaso(firmas: readonly Signature[], step: SignatureStep): readonly Signature[] {
  return firmas.filter((firma) => firma.step === step).toSorted((a, b) => a.position - b.position)
}

/**
 * Revisa el ciclo de firma de un entregable. Devuelve los problemas en orden
 * estable (P2): siempre el mismo catálogo da siempre la misma lista.
 *
 * Un entregable **sin ninguna firma declarada** no da ningún problema: no está
 * mal rellenado, está sin rellenar, y son dos cosas distintas. El día que se
 * declara la primera firma es cuando empieza a tener sentido preguntar si
 * falta el aprobador.
 */
export function checkSignatureCycle(
  kind: SignedKind,
  firmas: readonly Signature[],
): readonly SignatureProblem[] {
  if (firmas.length === 0) return []

  // Una fase agrupa y un hito es un instante: ninguno de los dos se escribe, se
  // verifica ni se aprueba. Que alguien haya declarado un ciclo de firma ahí
  // suele querer decir que la fila está mal tipada, no que el ciclo sobre.
  if (kind !== 'documento') {
    return [{ code: 'SIGNATURE_ON_CONTAINER', payload: { kind, count: firmas.length } }]
  }

  const problemas: SignatureProblem[] = []
  const autores = deLPaso(firmas, 'author')
  const verificadores = deLPaso(firmas, 'verifier')
  const aprobadores = deLPaso(firmas, 'approver')

  if (autores.length === 0) {
    problemas.push({ code: 'SIGNATURE_NO_AUTHOR', payload: { declared: firmas.length } })
  }
  if (aprobadores.length === 0) {
    problemas.push({ code: 'SIGNATURE_NO_APPROVER', payload: { declared: firmas.length } })
  }

  // La independencia se mide contra el autor, que es de quien hay que ser
  // independiente. Se comprueban el verificador y el aprobador, porque un
  // aprobador que es el autor firma su propio trabajo igual que un verificador.
  for (const autor of autores) {
    for (const firma of [...verificadores, ...aprobadores]) {
      if (!mismoRol(autor.role, firma.role)) continue
      problemas.push({
        code: 'SIGNATURE_NOT_INDEPENDENT',
        payload: { role: firma.role, step: firma.step, position: firma.position },
      })
    }
  }

  // Dos verificadores con el mismo rol no son dos verificaciones: son una
  // escrita dos veces. Se mira dentro de cada paso, no entre pasos distintos.
  for (const paso of ['verifier', 'approver', 'reviewer'] as const) {
    const delPaso = deLPaso(firmas, paso)
    for (let i = 1; i < delPaso.length; i += 1) {
      const actual = delPaso[i]
      if (actual === undefined) continue
      const antes = delPaso.slice(0, i).find((firma) => mismoRol(firma.role, actual.role))
      if (antes === undefined) continue
      problemas.push({
        code: 'SIGNATURE_ROLE_REPEATED',
        payload: { role: actual.role, step: paso, position: actual.position },
      })
    }
  }

  return problemas
}

/**
 * Lo que cuesta el ciclo entero, en minutos, sumando lo declarado.
 *
 * Existe para poder enseñarlo —«este entregable son 8 h de autor y 3 h de
 * firmas»— y **no entra en la carga de nadie**: meterlo en el cálculo cambia
 * las cifras de todas las pantallas y es una decisión aparte.
 */
export function signatureMinutes(firmas: readonly Signature[]): number {
  return firmas.reduce((total, firma) => total + (firma.standardMinutes ?? 0), 0)
}
