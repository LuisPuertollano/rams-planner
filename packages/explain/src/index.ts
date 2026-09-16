/**
 * Derivaciones: la respuesta a «¿por qué este número es este número?» (P4).
 *
 * No es logging. Es una salida de primera clase del motor: cada valor derivado
 * registra la regla que lo produjo y las entradas que usó, y la interfaz navega
 * esa traza hasta los datos que alguien escribió.
 *
 * El sumidero es inyectable para que el modo rápido (la previsualización
 * interactiva del navegador) no pague nada por recogerlas.
 */

export type DerivationValue = string | number | boolean | null

export interface Derivation {
  /** Qué valor se explica, p. ej. `task.scheduledStart`. */
  readonly targetType: string
  /** Identidad de la entidad a la que pertenece ese valor. */
  readonly targetId: string
  /** Código estable de la regla aplicada, p. ej. `FS_LINK`. */
  readonly rule: string
  /** Entradas usadas, con referencias a los datos declarados. */
  readonly inputs: Readonly<Record<string, DerivationValue>>
  /** Valor producido. */
  readonly output: DerivationValue
}

export interface DerivationSink {
  record(derivation: Derivation): void
}

/** Sumidero que descarta todo. Coste cero cuando no hace falta explicar. */
export const NOOP_SINK: DerivationSink = {
  record(): void {
    // Intencionadamente vacío.
  },
}

export interface DerivationCollector {
  readonly sink: DerivationSink
  readonly derivations: readonly Derivation[]
}

/** Sumidero que acumula en memoria. */
export function createDerivationCollector(): DerivationCollector {
  const derivations: Derivation[] = []
  return {
    sink: {
      record(derivation: Derivation): void {
        derivations.push(derivation)
      },
    },
    derivations,
  }
}

/** Índice por valor explicado, para responder rápido al panel «¿por qué?». */
export function indexDerivations(
  derivations: readonly Derivation[],
): ReadonlyMap<string, readonly Derivation[]> {
  const index = new Map<string, Derivation[]>()
  for (const derivation of derivations) {
    const key = `${derivation.targetType}:${derivation.targetId}`
    const bucket = index.get(key)
    if (bucket === undefined) index.set(key, [derivation])
    else bucket.push(derivation)
  }
  return index
}
