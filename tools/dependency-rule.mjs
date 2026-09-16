/**
 * Regla de dependencia de la arquitectura hexagonal.
 *
 * El núcleo es puro: no conoce a los adaptadores, no importa módulos de Node y
 * no hace I/O. Que eso lo verifique CI y no la disciplina de cada commit es lo
 * que impide que la regla se erosione (principios P1 y P2).
 */

import { builtinModules } from 'node:module'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const CORE_PACKAGES = ['domain', 'calendar', 'scheduler', 'workload', 'explain', 'rules']
export const ADAPTER_PACKAGES = ['persistence', 'api', 'cli', 'interop', 'web']

const BUILTIN_NAMES = new Set(builtinModules)

/** Clasifica un paquete del workspace por su carpeta. */
export function layerOf(packageDir) {
  if (CORE_PACKAGES.includes(packageDir)) return 'core'
  if (ADAPTER_PACKAGES.includes(packageDir)) return 'adapter'
  return 'unknown'
}

/**
 * Comprueba la regla sobre una descripción ya cargada del workspace.
 * Función pura: recibe datos, devuelve violaciones. Así se puede testear sin
 * tocar el disco.
 *
 * @param {{dir: string, name: string, dependencies: string[], imports: string[]}[]} packages
 * @returns {{package: string, kind: string, detail: string}[]}
 */
export function checkDependencyRule(packages) {
  const violations = []

  for (const pkg of packages) {
    const layer = layerOf(pkg.dir)

    if (layer === 'unknown') {
      violations.push({
        package: pkg.dir,
        kind: 'unknown-layer',
        detail: `El paquete "${pkg.dir}" no está declarado ni como núcleo ni como adaptador. Añádelo a CORE_PACKAGES o a ADAPTER_PACKAGES.`,
      })
      continue
    }

    if (layer !== 'core') continue

    for (const dependency of pkg.dependencies) {
      const target = dependency.startsWith('@planner/') ? dependency.slice('@planner/'.length) : null
      if (target !== null && layerOf(target) !== 'core') {
        violations.push({
          package: pkg.dir,
          kind: 'core-depends-on-adapter',
          detail: `El núcleo "${pkg.dir}" declara una dependencia de "${dependency}". Las flechas apuntan hacia dentro.`,
        })
      }
    }

    for (const specifier of pkg.imports) {
      if (isNodeBuiltin(specifier)) {
        violations.push({
          package: pkg.dir,
          kind: 'core-imports-node-builtin',
          detail: `El núcleo "${pkg.dir}" importa "${specifier}". El núcleo no hace I/O (P2).`,
        })
      }
      const target = specifier.startsWith('@planner/') ? specifier.split('/')[1] : null
      if (target != null && layerOf(target) === 'adapter') {
        violations.push({
          package: pkg.dir,
          kind: 'core-imports-adapter',
          detail: `El núcleo "${pkg.dir}" importa "${specifier}".`,
        })
      }
    }
  }

  return violations
}

function isNodeBuiltin(specifier) {
  if (specifier.startsWith('node:')) return true
  return BUILTIN_NAMES.has(specifier)
}

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)[^'"\n]*?from\s*['"]([^'"]+)['"]/g

/** Extrae los especificadores importados de un fichero TypeScript. */
export function extractImports(source) {
  const found = []
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1]
    if (specifier !== undefined) found.push(specifier)
  }
  return found
}

/** Carga el workspace desde el disco. Es la parte impura, y por eso es fina. */
export async function loadWorkspace(rootDir) {
  const packagesDir = join(rootDir, 'packages')
  const entries = await readdir(packagesDir, { withFileTypes: true })
  const packages = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = entry.name
    const manifest = JSON.parse(await readFile(join(packagesDir, dir, 'package.json'), 'utf8'))
    const sourceDir = join(packagesDir, dir, 'src')
    const imports = []

    for (const file of await listTypeScriptFiles(sourceDir)) {
      if (file.endsWith('.test.ts')) continue
      imports.push(...extractImports(await readFile(file, 'utf8')))
    }

    packages.push({
      dir,
      name: manifest.name ?? dir,
      dependencies: Object.keys(manifest.dependencies ?? {}),
      imports,
    })
  }

  return packages
}

async function listTypeScriptFiles(directory) {
  const found = []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...(await listTypeScriptFiles(path)))
    else if (entry.name.endsWith('.ts')) found.push(path)
  }
  return found
}
