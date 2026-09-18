#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { checkRampa, rampasDelCss } from './rampa.mjs'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = await readFile(join(rootDir, 'packages/web/src/styles.css'), 'utf8')
const rampas = rampasDelCss(css)

if (rampas.length === 0) {
  console.error('La rampa de saturación: NO LA ENCUENTRO en packages/web/src/styles.css')
  process.exit(1)
}

const problemas = rampas.flatMap(({ pasos, texto }, indice) =>
  checkRampa(pasos, `rampa ${String(indice + 1)} de ${String(rampas.length)}`, texto),
)

if (problemas.length === 0) {
  console.log(`La rampa de saturación: OK (${String(rampas.length)} rampa(s), divergentes y medidas)`)
  process.exit(0)
}

console.error('La rampa de saturación: TORCIDA\n')
for (const problema of problemas) console.error(`  [${problema.kind}] ${problema.detail}`)
process.exit(1)
