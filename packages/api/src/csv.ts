/**
 * Lectura y escritura de CSV.
 *
 * Detecta el separador: Excel en español y en alemán escribe con punto y coma,
 * y dar por hecha la coma es la causa número uno de importaciones que «no
 * funcionan» sin que nadie sepa por qué.
 *
 * Y admite **comentarios**: una línea cuya primera celda empieza por `#` no es
 * un dato. Es lo que permite que una plantilla se explique sola —el manual de
 * las columnas viaja dentro del propio fichero, y las filas de ejemplo van
 * comentadas para que no se importen por descuido— sin que el importador
 * necesite saber nada de eso.
 */

export type CsvRow = Readonly<Record<string, string>>

/** Una línea de comentario: la primera celda empieza por `#`. */
const esComentario = (linea: string): boolean => linea.trimStart().startsWith('#')

/**
 * El separador, mirando la primera línea que **no** sea un comentario.
 *
 * Mirar la primera a secas bastaba hasta que las plantillas empezaron a llevar
 * su manual delante: una línea de prosa sin puntos y coma haría elegir la coma
 * y el fichero entero se leería como una sola columna.
 */
export function detectDelimiter(text: string): ';' | ',' | '\t' {
  const header = text.split(/\r?\n/).find((linea) => linea.trim() !== '' && !esComentario(linea)) ?? ''
  const counts = { ';': count(header, ';'), ',': count(header, ','), '\t': count(header, '\t') }
  if (counts['\t'] > counts[';'] && counts['\t'] > counts[',']) return '\t'
  return counts[';'] >= counts[','] ? ';' : ','
}

/**
 * Cómo leer un CSV, y por qué hay dos maneras.
 *
 * `'importacion'` es lo que espera un fichero que ha tocado una persona:
 * recorta los espacios, baja las cabeceras a minúsculas y trata `#` en la
 * primera columna como un comentario, para que la plantilla pueda traer su
 * propio manual dentro.
 *
 * `'literal'` no hace nada de eso, y para una copia de seguridad es lo único
 * correcto. Recortar espacios en una importación es amable; en una restauración
 * es **corromper el dato**: un proyecto llamado `«Plan RAMS »` volvería sin su
 * espacio, y ni siquiera fallaría. Y un valor que empiece por `#` haría
 * desaparecer la fila entera sin decir nada.
 *
 * Esto no se vio leyendo el código: se vio pasándole al parser una fila con
 * espacios, comillas, saltos de línea y punto y coma dentro. Todo lo demás daba
 * la vuelta bien; los espacios, no.
 */
export type ModoCsv = 'importacion' | 'literal'

/**
 * Parser completo: admite comillas, separadores dentro de comillas, saltos de
 * línea dentro de un campo, y líneas de comentario.
 */
export function parseCsv(text: string, modo: ModoCsv = 'importacion'): readonly CsvRow[] {
  const literal = modo === 'literal'
  const delimiter = literal ? ';' : detectDelimiter(text)
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text // BOM de Excel
  const crudos = parseRecords(clean, delimiter)
  const records = literal ? crudos : crudos.filter((record) => !esComentario(record[0] ?? ''))
  const header = records[0]
  if (header === undefined) return []

  const columns = header.map((name) => (literal ? name : name.trim().toLowerCase()))
  return records.slice(1)
    .filter((record) => literal || record.some((value) => value.trim() !== ''))
    .map((record) => {
      const row: Record<string, string> = {}
      for (const [index, column] of columns.entries()) {
        const bruto = record[index] ?? ''
        row[column] = literal ? bruto : bruto.trim()
      }
      return row
    })
}

function count(text: string, character: string): number {
  let found = 0
  for (const char of text) if (char === character) found += 1
  return found
}

function parseRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else inQuotes = false
      } else field += char ?? ''
      continue
    }
    if (char === '"') inQuotes = true
    else if (char === delimiter) {
      record.push(field)
      field = ''
    } else if (char === '\n') {
      record.push(field)
      records.push(record)
      record = []
      field = ''
    } else if (char !== '\r') field += char ?? ''
  }
  record.push(field)
  if (record.some((value) => value !== '')) records.push(record)
  return records
}

/** Escribe CSV con punto y coma y coma decimal: lo que Excel en español espera. */
export function toCsv(rows: readonly CsvRow[], columns: readonly string[]): string {
  const escape = (value: string): string =>
    /[";\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
  const lines = [columns.join(';')]
  for (const row of rows) lines.push(columns.map((column) => escape(row[column] ?? '')).join(';'))
  // BOM explícito: sin él, Excel abre el fichero en latin-1 y rompe los acentos.
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

/** Acepta «7,5» y «7.5»: nadie debería pelearse con el separador decimal. */
export function parseNumber(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (normalized === '') return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}
