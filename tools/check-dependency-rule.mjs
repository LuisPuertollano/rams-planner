#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { checkDependencyRule, loadWorkspace } from './dependency-rule.mjs'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const packages = await loadWorkspace(rootDir)
const violations = checkDependencyRule(packages)

if (violations.length === 0) {
  console.log(`Regla de dependencia: OK (${String(packages.length)} paquete(s) verificado(s))`)
  process.exit(0)
}

console.error('Regla de dependencia: VIOLADA\n')
for (const violation of violations) {
  console.error(`  [${violation.kind}] ${violation.detail}`)
}
process.exit(1)
