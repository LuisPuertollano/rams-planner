/**
 * Serialización canónica (principio P3).
 *
 * El `input_hash` de una ejecución de cálculo se calcula sobre esta cadena, así
 * que dos snapshots equivalentes deben producir exactamente el mismo texto con
 * independencia del orden en que se construyeron los objetos.
 *
 * Reglas: claves ordenadas por punto de código, sin espacios, sin `undefined`,
 * sin números no finitos y sin `-0`. Lo que no se puede serializar de forma
 * determinista se rechaza en vez de serializarse mal.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanonicalizationError'
  }
}

/** Devuelve la representación canónica de un valor JSON. */
export function canonicalize(value: JsonValue): string {
  return write(value, [])
}

function write(value: JsonValue, path: readonly string[]): string {
  if (value === null) return 'null'

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      return writeNumber(value, path)
    case 'string':
      return JSON.stringify(value)
    case 'object':
      return Array.isArray(value) ? writeArray(value, path) : writeObject(value, path)
    default:
      throw new CanonicalizationError(`Tipo no serializable en ${describe(path)}`)
  }
}

function writeNumber(value: number, path: readonly string[]): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalizationError(`Número no finito en ${describe(path)}`)
  }
  // -0 y 0 son el mismo valor del dominio: se normalizan para que el hash coincida.
  return Object.is(value, -0) ? '0' : String(value)
}

function writeArray(value: readonly JsonValue[], path: readonly string[]): string {
  const items = value.map((item, index) => write(item, [...path, String(index)]))
  return `[${items.join(',')}]`
}

function writeObject(value: { [key: string]: JsonValue }, path: readonly string[]): string {
  const entries = Object.keys(value)
    .sort()
    .map((key) => {
      const child = value[key]
      if (child === undefined) {
        throw new CanonicalizationError(`Valor undefined en ${describe([...path, key])}`)
      }
      return `${JSON.stringify(key)}:${write(child, [...path, key])}`
    })
  return `{${entries.join(',')}}`
}

function describe(path: readonly string[]): string {
  return path.length === 0 ? '<raíz>' : path.join('.')
}
