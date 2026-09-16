/**
 * Lectura y escritura de CSV.
 *
 * Detecta el separador: Excel en español y en alemán escribe con punto y coma,
 * y dar por hecha la coma es la causa número uno de importaciones que «no
 * funcionan» sin que nadie sepa por qué.
 */

export type CsvRow = Readonly<Record<string, string>>

export function detectDelimiter(text: string): ';' | ',' | '\t' {
  const header = text.split(/\r?\n/)[0] ?? ''
  const counts = { ';': count(header, ';'), ',': count(header, ','), '\t': count(header, '\t') }
  if (counts['\t'] > counts[';'] && counts['\t'] > counts[',']) return '\t'
  return counts[';'] >= counts[','] ? ';' : ','
}

/** Parser completo: admite comillas, separadores dentro de comillas y saltos de línea. */
export function parseCsv(text: string): readonly CsvRow[] {
  const delimiter = detectDelimiter(text)
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text // BOM de Excel
  const records = parseRecords(clean, delimiter)
  const header = records[0]
  if (header === undefined) return []

  const columns = header.map((name) => name.trim().toLowerCase())
  return records.slice(1)
    .filter((record) => record.some((value) => value.trim() !== ''))
    .map((record) => {
      const row: Record<string, string> = {}
      for (const [index, column] of columns.entries()) row[column] = (record[index] ?? '').trim()
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
