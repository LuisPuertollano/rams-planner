/**
 * CLI del planificador.
 *
 *   planner seed-demo    carga el juego de datos de demostración
 *   planner calculate    recalcula y guarda una ejecución
 *   planner runs         lista las últimas ejecuciones
 *   planner crear-superadmin <correo> <nombre>   da de alta al primero
 *   planner cambiar-clave <correo>               le pone una contraseña nueva
 */

import { randomBytes } from 'node:crypto'
import {
  createPool,
  createUser,
  grantRole,
  readRoles,
  readUsers,
  recentRuns,
  setUserPassword,
  withTransaction,
} from '@planner/persistence'
import { readConfig } from './config.js'
import { calculate, defaultScenarioId } from './engine.js'
import { seedDemoData } from './demo-data.js'

const command = process.argv[2] ?? 'help'
const config = readConfig(process.env)
const pool = createPool(config.databaseUrl)

try {
  switch (command) {
    case 'seed-demo': {
      const created = await withTransaction(pool, (db) => seedDemoData(db))
      if (created) {
        const scenarioId = await withTransaction(pool, (db) => defaultScenarioId(db))
        const summary = await calculate(pool, scenarioId, 'carga de datos de demostración')
        console.log(
          `Datos de demostración cargados y calculados: ${String(summary.tasks)} tareas, ` +
            `${String(summary.timephasedCells)} celdas de carga, ${String(summary.findings)} hallazgos ` +
            `(${String(summary.durationMs)} ms).`,
        )
      } else {
        console.log('La base de datos ya tiene proyectos: no se toca nada.')
      }
      break
    }

    case 'calculate': {
      const scenarioId = await withTransaction(pool, (db) => defaultScenarioId(db))
      const summary = await calculate(pool, scenarioId, 'recálculo desde la CLI')
      console.log(JSON.stringify(summary, null, 2))
      break
    }

    case 'runs': {
      // Una tabla, no un JSON: esto se mira desde una terminal, y lo que se
      // busca aquí es el hash. Dos ejecuciones con el mismo hash tienen que dar
      // el mismo resultado; si no, el motor ha dejado de ser determinista (P2).
      const runs = await withTransaction(pool, (db) => recentRuns(db))
      if (runs.length === 0) {
        console.log('No hay ninguna ejecución todavía.')
        break
      }
      console.log('ejecución  fecha             motor    ms   hash      congelada  motivo')
      for (const run of runs) {
        const started = run.startedAt.slice(0, 16).replace('T', ' ')
        console.log(
          [
            run.id.slice(0, 8),
            started,
            run.engineVersion.padEnd(7),
            String(run.durationMs ?? 0).padStart(5),
            run.inputHash.slice(0, 8),
            run.isFrozen ? '   sí     ' : '   no     ',
            run.triggerReason ?? '',
          ].join('  '),
        )
      }
      break
    }

    /**
     * El primer usuario, sin el cual nadie puede entrar nunca.
     *
     * La contraseña se genera aquí y se imprime una sola vez, en vez de
     * pedirla por argumento: lo que se escribe en la línea de órdenes queda en
     * el historial del intérprete y en la lista de procesos de la máquina.
     */
    case 'crear-superadmin': {
      const email = process.argv[3]
      const nombre = process.argv[4]
      if (email === undefined || nombre === undefined) {
        console.error('Uso: planner crear-superadmin <correo> <nombre>')
        process.exitCode = 1
        break
      }
      const clave = randomBytes(12).toString('base64url')
      await withTransaction(
        pool,
        async (db) => {
          const roles = await readRoles(db)
          const sistema = roles.find((rol) => rol.isSystem)
          if (sistema === undefined) throw new Error('No existe el rol de superadministración')
          const userId = await createUser(db, { email, displayName: nombre, password: clave })
          await grantRole(db, userId, sistema.id, null)
        },
        { comment: 'alta del superadministrador desde la CLI' },
      )
      console.log(`Creado «${nombre}» <${email}> como superadministrador.`)
      console.log(`Contraseña: ${clave}`)
      console.log('Apúntala ahora: no se vuelve a mostrar. Cámbiala al entrar.')
      break
    }

    case 'cambiar-clave': {
      const email = process.argv[3]
      if (email === undefined) {
        console.error('Uso: planner cambiar-clave <correo>')
        process.exitCode = 1
        break
      }
      const clave = randomBytes(12).toString('base64url')
      const cambiado = await withTransaction(
        pool,
        async (db) => {
          const usuarios = await readUsers(db)
          const usuario = usuarios.find((item) => item.email.toLowerCase() === email.toLowerCase())
          if (usuario === undefined) return false
          await setUserPassword(db, usuario.id, clave)
          return true
        },
        { comment: 'cambio de contraseña desde la CLI' },
      )
      if (!cambiado) {
        console.error(`No hay ningún usuario con el correo «${email}».`)
        process.exitCode = 1
        break
      }
      console.log(`Contraseña nueva para <${email}>: ${clave}`)
      console.log('Sus sesiones abiertas se han cerrado.')
      break
    }

    default:
      console.log('Uso: planner <seed-demo|calculate|runs|crear-superadmin|cambiar-clave>')
      process.exitCode = 1
  }
} finally {
  await pool.end()
}
