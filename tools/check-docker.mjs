#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { checkDockerPackages, loadDockerSources } from './docker-packages.mjs'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const { enElDisco, enLaImagen } = await loadDockerSources(rootDir)
const problemas = checkDockerPackages(enElDisco, enLaImagen)

if (problemas.length === 0) {
  console.log(`Dockerfile completo: OK (${String(enElDisco.length)} paquete(s) en la imagen)`)
  process.exit(0)
}

console.error('Dockerfile incompleto: EL CONTENEDOR NO VA A ARRANCAR\n')
for (const problema of problemas) console.error(`  [${problema.kind}] ${problema.detail}`)
process.exit(1)
