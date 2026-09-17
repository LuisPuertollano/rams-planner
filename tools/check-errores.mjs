#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseDictionaryKeys } from './finding-translations.mjs'
import { checkErrorTranslations, loadErrorSources } from './error-translations.mjs'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const { codigos, claves, sueltos } = await loadErrorSources(rootDir, parseDictionaryKeys)
const problemas = checkErrorTranslations(codigos, claves, sueltos)

if (problemas.length === 0) {
  console.log(`Errores traducidos: OK (${String(codigos.length)} código(s), ninguno escrito a mano)`)
  process.exit(0)
}

console.error('Errores traducidos: FALTA ALGO\n')
for (const problema of problemas) console.error(`  [${problema.kind}] ${problema.detail}`)
process.exit(1)
