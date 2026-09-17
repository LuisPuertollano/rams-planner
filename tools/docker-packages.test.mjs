import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { checkDockerPackages, loadDockerSources, parseDockerfilePackages } from './docker-packages.mjs'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Un Dockerfile de juguete con las dos listas, como el de verdad. */
const dockerfile = (paquetes) =>
  [
    'FROM node:22-alpine AS build',
    ...paquetes.map((p) => `COPY packages/${p}/package.json      ./packages/${p}/`),
    'RUN pnpm install --frozen-lockfile --prod',
    ...paquetes.map((p) => `COPY --from=build /app/packages/${p}/dist      ./packages/${p}/dist`),
  ].join('\n')

const CINCO = ['domain', 'calendar', 'explain', 'scheduler', 'api']

describe('la regla: el Dockerfile no se olvida un paquete', () => {
  it('el workspace la cumple', async () => {
    const { enElDisco, enLaImagen } = await loadDockerSources(rootDir)
    expect(checkDockerPackages(enElDisco, enLaImagen)).toEqual([])
    // Y se leyó el Dockerfile de verdad, con el paquete que provocó todo esto.
    expect(enElDisco).toContain('report')
    expect(enLaImagen.conManifiesto).toContain('report')
    expect(enLaImagen.conDist).toContain('report')
  })

  it('caza el paquete que existe y no está en la imagen', () => {
    // La avería, exactamente: `report` en el disco y en ninguna de las dos
    // listas. Es lo que se murió al arrancar el contenedor.
    const problemas = checkDockerPackages(
      [...CINCO, 'report'],
      parseDockerfilePackages(dockerfile(CINCO)),
    )
    expect(problemas.map((p) => p.kind)).toEqual(['falta-el-manifiesto', 'falta-el-dist'])
    expect(problemas[0]?.detail).toContain('@planner/report')
  })

  it('el manifiesto sin su dist también es un contenedor roto', () => {
    const fuente = dockerfile(CINCO) + '\nCOPY packages/report/package.json ./packages/report/'
    const problemas = checkDockerPackages([...CINCO, 'report'], parseDockerfilePackages(fuente))
    expect(problemas.map((p) => p.kind)).toEqual(['falta-el-dist'])
  })

  it('caza lo que sobra, que rompe el build entero', () => {
    // Un `COPY` de un paquete retirado no es un aviso: `docker build` falla.
    const problemas = checkDockerPackages(CINCO, parseDockerfilePackages(dockerfile([...CINCO, 'retirado'])))
    expect(problemas.map((p) => p.kind).sort()).toEqual(['dist-huerfano', 'manifiesto-huerfano'])
    expect(problemas.some((p) => p.detail.includes('retirado'))).toBe(true)
  })

  it('si el parseo se rompe, se entera en vez de dar verde', () => {
    // Lo peligroso de una regla que lee texto: que deje de encontrar nada y
    // pase en verde para siempre.
    expect(() => parseDockerfilePackages('FROM node:22-alpine')).toThrow(/parseo/)
    expect(() => parseDockerfilePackages(dockerfile(['domain', 'api']))).toThrow(/parseo/)
  })
})
