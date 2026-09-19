/**
 * CLI del planificador.
 *
 *   planner seed-demo    carga el juego de datos de demostración
 *   planner calculate    recalcula y guarda una ejecución
 *   planner runs         lista las últimas ejecuciones
 *   planner crear-superadmin <correo> <nombre>   da de alta al primero
 *   planner cambiar-clave <correo>               le pone una contraseña nueva
 *   planner copia [fichero.zip]                  saca la copia de seguridad
 *   planner restaurar <fichero.zip>              la vuelve a meter (BORRA TODO)
 *
 * Las dos últimas existen aquí y no sólo en la pantalla por una razón concreta:
 * una copia que sólo se saca pulsando un botón no se puede poner en un cron, y
 * una copia que hay que acordarse de sacar no es una copia de seguridad.
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
import { readFileSync, writeFileSync } from 'node:fs'
import { exportarCopia, importarCopia, CopiaInvalida } from './backup.js'
import { nombreDeCopia } from './backup-routes.js'
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

    case 'copia': {
      const instante = new Date()
      const conDerivadas = process.argv.includes('--con-derivadas')
      const copia = await withTransaction(pool, (db) =>
        exportarCopia(db, { instante, incluirDerivadas: conDerivadas }),
      )
      const destino = process.argv[3] ?? nombreDeCopia(instante)
      // Si el destino es «-», el zip sale por la salida estándar: así se puede
      // canalizar a otro sitio sin dejar el fichero por el disco.
      if (destino === '-') process.stdout.write(copia.zip)
      else writeFileSync(destino, copia.zip)
      const filas = copia.resumen.tablas.reduce((suma, t) => suma + t.filas, 0)
      console.error(
        `Copia de ${String(copia.resumen.tablas.length)} tabla(s) y ${String(filas)} fila(s) ` +
          `en ${String(copia.ficheros)} fichero(s), ${String(Math.round(copia.zip.length / 1024))} kB` +
          `${destino === '-' ? '' : ` → ${destino}`}.`,
      )
      if (copia.resumen.ejecucion !== null) {
        console.error(`Huella de entrada: ${copia.resumen.ejecucion.inputHash}`)
      }
      break
    }

    case 'restaurar': {
      const origen = process.argv[3]
      if (origen === undefined) {
        console.error('Uso: planner restaurar <fichero.zip> [--si-estoy-seguro]')
        process.exitCode = 1
        break
      }
      // Restaurar borra la base entera. Desde una pantalla hay un «¿seguro?»;
      // desde la línea de órdenes la confirmación tiene que escribirse, porque
      // aquí no hay a quién preguntar y una flecha arriba se pulsa sin mirar.
      if (!process.argv.includes('--si-estoy-seguro')) {
        console.error(
          'Restaurar BORRA todo lo que haya en la base y lo sustituye por la copia.\n' +
            'Si es lo que quieres, repite la orden con --si-estoy-seguro.',
        )
        process.exitCode = 1
        break
      }
      const cuando = new Date().toISOString().slice(0, 19).replace('T', ' ')
      try {
        const hecho = await withTransaction(
          pool,
          (db) => importarCopia(db, readFileSync(origen), `restauración desde la CLI (${cuando})`),
          { comment: 'restauración de una copia de seguridad desde la CLI' },
        )
        console.log(
          `Restauradas ${String(hecho.tablas)} tabla(s) y ${String(hecho.filas)} fila(s).`,
        )
        for (const saltada of hecho.saltadas) {
          console.log(`  ${saltada.tabla}: no se restaura — ${saltada.motivo}`)
        }
      } catch (error) {
        if (error instanceof CopiaInvalida) {
          console.error(`No se restauró: ${error.message}${error.detalle === undefined ? '' : ` (${error.detalle})`}`)
          process.exitCode = 1
          break
        }
        throw error
      }
      const scenarioId = await withTransaction(pool, (db) => defaultScenarioId(db))
      const summary = await calculate(pool, scenarioId, 'restauración de una copia')
      const { rows } = await pool.query<{ input_hash: string }>(
        'SELECT input_hash FROM calculation_run WHERE id = $1', [summary.runId],
      )
      console.log(
        `Recalculado: ${String(summary.tasks)} tareas, ${String(summary.timephasedCells)} celdas.`,
      )
      console.log(
        `Huella de entrada: ${rows[0]?.input_hash ?? '(ninguna)'}\n` +
          'Compárala con la del LEEME de la copia: si coincide, la vuelta fue fiel.',
      )
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
      console.log(
        'Apúntala ahora: no se vuelve a mostrar. Cámbiala nada más entrar, con el botón ' +
          '«Contraseña» de la barra de arriba.',
      )
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
      console.log('Uso: planner <seed-demo|calculate|runs|crear-superadmin|cambiar-clave|copia|restaurar>')
      process.exitCode = 1
  }
} finally {
  await pool.end()
}
