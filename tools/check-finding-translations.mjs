#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { checkFindingTranslations, loadFindingSources } from './finding-translations.mjs'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const { codigos, claves } = await loadFindingSources(rootDir)
const problemas = checkFindingTranslations(codigos, claves)

if (problemas.length === 0) {
  console.log(`Hallazgos traducidos: OK (${String(codigos.length)} código(s) del catálogo)`)
  process.exit(0)
}

console.error('Hallazgos traducidos: FALTA ALGO\n')
for (const problema of problemas) console.error(`  [${problema.kind}] ${problema.detail}`)
process.exit(1)
