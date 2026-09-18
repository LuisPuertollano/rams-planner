#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buscaEnLaInterfaz } from './literales.mjs'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const { ficheros, literales } = await buscaEnLaInterfaz(rootDir)

if (literales.length === 0) {
  console.log(`Ni una frase a mano: OK (${String(ficheros)} pantalla(s) revisada(s))`)
  process.exit(0)
}

console.error('Frases escritas a mano en la interfaz: FALTA TRADUCIR\n')
for (const literal of literales) {
  console.error(`  ${literal.fichero}:${String(literal.linea)} [${literal.donde}] ${literal.texto}`)
}
console.error(
  `\n${String(literales.length)} literal(es). Cada uno va al diccionario (packages/web/src/i18n/) y se lee con t().` +
    '\nSi de verdad no se traduce —un comando, una clave—, déjalo con un comentario «texto-fijo: la razón».',
)
process.exit(1)
