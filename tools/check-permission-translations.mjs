#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseDictionaryKeys } from './finding-translations.mjs'
import { checkPermissionTranslations, loadPermissionSources } from './permission-translations.mjs'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const { catalogo, claves } = await loadPermissionSources(rootDir, parseDictionaryKeys)
const problemas = checkPermissionTranslations(catalogo, claves)

if (problemas.length === 0) {
  console.log(
    `Permisos traducidos: OK (${String(catalogo.codigos.length)} función(es) en ` +
      `${String(catalogo.pantallas.length)} pantalla(s))`,
  )
  process.exit(0)
}

console.error('Permisos traducidos: FALTA ALGO\n')
for (const problema of problemas) console.error(`  [${problema.kind}] ${problema.detail}`)
process.exit(1)
