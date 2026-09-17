/**
 * Que el `Dockerfile` no se olvide un paquete del workspace.
 *
 * La avería que esto caza ya ocurrió, y costó una tarde de producción: al crear
 * `packages/report` nadie lo añadió a las dos listas del `Dockerfile`, así que
 * la imagen salió sin ese paquete. Compila, pasa las pruebas, pasa CI —que hace
 * `pnpm build` y nada más— y **se muere al arrancar el contenedor**:
 *
 *     Cannot find package '@planner/report' imported from
 *     /app/packages/api/dist/report-routes.js
 *
 * El `Dockerfile` enumera los paquetes a mano y no puede hacer otra cosa: un
 * `COPY` con comodín sobre los manifiestos aplana los directorios en uno, y
 * copiar el árbol entero perdería el que es el motivo de enumerarlos —que
 * `pnpm install --prod` sólo se repita cuando cambia un `package.json`, no
 * cuando cambia una línea de código—.
 *
 * Así que la lista se queda, y lo que se añade es quien la vigila. Mismo sitio
 * y misma forma que las otras reglas de `tools/`: lee los ficheros del disco,
 * sin compilar nada.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Los paquetes que el `Dockerfile` mete en la imagen, en sus dos listas: el
 * `package.json` —que es lo que hace que `pnpm` cree el enlace del workspace— y
 * el `dist`, que es el código.
 *
 * @param {string} fuente Contenido del `Dockerfile`.
 * @returns {{conManifiesto: string[], conDist: string[]}}
 */
export function parseDockerfilePackages(fuente) {
  const conManifiesto = [
    ...fuente.matchAll(/^COPY\s+packages\/([\w-]+)\/package\.json\s/gm),
  ].map((c) => c[1])
  const conDist = [
    ...fuente.matchAll(/^COPY\s+--from=build\s+\/app\/packages\/([\w-]+)\/dist\s/gm),
  ].map((c) => c[1])

  if (conManifiesto.length < 5 || conDist.length < 5) {
    throw new Error(
      `Sólo se leyeron ${String(conManifiesto.length)} manifiestos y ${String(conDist.length)} dist ` +
        'del Dockerfile. El parseo está roto.',
    )
  }
  return { conManifiesto, conDist }
}

/**
 * Los problemas, o una lista vacía.
 *
 * Se comprueba en los dos sentidos, como las demás reglas: **lo que falta** es
 * un contenedor que no arranca, y **lo que sobra** es un `COPY` de algo que ya
 * no existe, que rompe el `docker build` entero.
 *
 * El `web` es el caso especial y está a propósito: su `dist` es la interfaz
 * compilada y se sirve como ficheros estáticos, no se importa nunca. Da igual,
 * porque las dos listas lo llevan y la regla no necesita distinguirlo.
 *
 * @param {string[]} enElDisco Nombres de carpeta bajo `packages/`.
 * @param {{conManifiesto: string[], conDist: string[]}} enLaImagen
 * @returns {{kind: string, detail: string}[]}
 */
export function checkDockerPackages(enElDisco, enLaImagen) {
  const problemas = []
  const manifiesto = new Set(enLaImagen.conManifiesto)
  const dist = new Set(enLaImagen.conDist)
  const disco = new Set(enElDisco)

  for (const paquete of enElDisco) {
    if (!manifiesto.has(paquete)) {
      problemas.push({
        kind: 'falta-el-manifiesto',
        detail:
          `El Dockerfile no copia "packages/${paquete}/package.json". Sin él pnpm no crea el enlace ` +
          `del workspace y el contenedor se muere al importar "@planner/${paquete}".`,
      })
    }
    if (!dist.has(paquete)) {
      problemas.push({
        kind: 'falta-el-dist',
        detail:
          `El Dockerfile no copia "packages/${paquete}/dist". El enlace existiría y apuntaría a un ` +
          'directorio vacío.',
      })
    }
  }

  for (const paquete of manifiesto) {
    if (!disco.has(paquete)) {
      problemas.push({
        kind: 'manifiesto-huerfano',
        detail: `El Dockerfile copia "packages/${paquete}/package.json" y ese paquete no existe. El build falla.`,
      })
    }
  }
  for (const paquete of dist) {
    if (!disco.has(paquete)) {
      problemas.push({
        kind: 'dist-huerfano',
        detail: `El Dockerfile copia "packages/${paquete}/dist" y ese paquete no existe. El build falla.`,
      })
    }
  }

  return problemas
}

/** Lee el workspace del disco. Aparte, para que la comprobación sea pura. */
export async function loadDockerSources(rootDir) {
  const entradas = await readdir(join(rootDir, 'packages'), { withFileTypes: true })
  return {
    enElDisco: entradas.filter((entrada) => entrada.isDirectory()).map((entrada) => entrada.name).sort(),
    enLaImagen: parseDockerfilePackages(await readFile(join(rootDir, 'Dockerfile'), 'utf8')),
  }
}
