import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  createAppUser,
  createRole,
  fetchAdminSheet,
  grant,
  removeRole,
  revoke,
  saveRolePermissions,
  setUserActive,
  setUserPassword,
  type AdminSheet,
  type Project,
} from '../api.js'
import { fullDate } from '../format.js'

interface Props {
  readonly projects: readonly Project[]
  /** Quién está mirando, para no dejar que se quite a sí mismo lo que le sostiene. */
  readonly currentUserId: string | null
}

type Pestana = 'hoja' | 'usuarios'

/**
 * La hoja de permisos y la gestión de usuarios.
 *
 * La hoja es una matriz de **funciones × roles**, agrupada por pantalla. Las
 * funciones son filas y no columnas a propósito: crecen con la herramienta y
 * los roles no, así que la tabla crece hacia abajo, que es donde hay sitio.
 *
 * Lo que sale de aquí no es cosmético: cada casilla es lo que la API deja o no
 * deja hacer. Esconder un botón no es un permiso, y por eso la hoja y el
 * servidor leen exactamente la misma lista.
 */
export function AdminView({ projects, currentUserId }: Props): React.JSX.Element {
  const [sheet, setSheet] = useState<AdminSheet | null>(null)
  const [pestana, setPestana] = useState<Pestana>('hoja')
  const [borrador, setBorrador] = useState<Record<string, Set<string>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const recargar = async (): Promise<void> => {
    const siguiente = await fetchAdminSheet()
    setSheet(siguiente)
    const inicial: Record<string, Set<string>> = {}
    for (const rol of siguiente.roles) inicial[rol.id] = new Set(rol.permissions)
    setBorrador(inicial)
  }

  useEffect(() => {
    recargar().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar la hoja')
    })
  }, [])

  const run = (accion: () => Promise<void>, mensaje?: string): void => {
    setBusy(true)
    setError(null)
    setAviso(null)
    accion()
      .then(recargar)
      .then(() => { if (mensaje !== undefined) setAviso(mensaje) })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : 'No se pudo guardar') })
      .finally(() => { setBusy(false) })
  }

  const porPantalla = useMemo(() => {
    if (sheet === null) return []
    return sheet.screens.map((pantalla) => ({
      pantalla,
      funciones: sheet.permissions.filter((permiso) => permiso.screen === pantalla),
    }))
  }, [sheet])

  /** Un rol con cambios sin guardar se marca: guardar es una acción explícita. */
  const tieneCambios = (roleId: string): boolean => {
    const original = sheet?.roles.find((rol) => rol.id === roleId)?.permissions ?? []
    const actual = borrador[roleId] ?? new Set<string>()
    return original.length !== actual.size || original.some((code) => !actual.has(code))
  }

  const alternar = (roleId: string, code: string): void => {
    setBorrador((anterior) => {
      const copia = { ...anterior }
      const conjunto = new Set(copia[roleId] ?? [])
      if (conjunto.has(code)) conjunto.delete(code)
      else conjunto.add(code)
      copia[roleId] = conjunto
      return copia
    })
  }

  if (sheet === null) {
    return <div className="empty"><h3>{error ?? 'Cargando la hoja…'}</h3></div>
  }

  const editables = sheet.roles.filter((rol) => !rol.isSystem)
  const sistema = sheet.roles.filter((rol) => rol.isSystem)

  return (
    <>
      {error === null ? null : <div className="error-banner" style={{ margin: 12 }}>{error}</div>}
      {aviso === null ? null : (
        <div className="notice" style={{ margin: 12 }}>
          {aviso}
          <button className="button" onClick={() => { setAviso(null) }}>Entendido</button>
        </div>
      )}

      <div className="toolbar">
        <button className="tab" aria-selected={pestana === 'hoja'} onClick={() => { setPestana('hoja') }}>
          Hoja de permisos
        </button>
        <button className="tab" aria-selected={pestana === 'usuarios'} onClick={() => { setPestana('usuarios') }}>
          Usuarios y roles
        </button>
        <span className="faint">
          {sheet.permissions.length} funciones · {sheet.roles.length} roles ·{' '}
          {sheet.users.length === 1 ? '1 usuario' : `${sheet.users.length} usuarios`}
        </span>
      </div>

      {pestana === 'hoja' ? (
        <>
          <p className="faint" style={{ padding: '0 16px', maxWidth: '90ch' }}>
            Cada casilla es lo que la herramienta deja o no deja hacer de verdad: no esconde botones, deniega
            la operación. Las funciones marcadas con <span className="sensible">●</span> conviene pensarlas dos
            veces.{' '}
            {sistema.length === 0 ? null : (
              <>
                <b>{sistema.map((rol) => rol.name).join(', ')}</b> lo tiene todo siempre y no aparece aquí: es
                lo que evita que desmarcar una casilla te deje fuera de tu propia herramienta.
              </>
            )}
          </p>

          <table className="grid grid--hoja">
            <thead>
              <tr>
                <th style={{ minWidth: 320 }}>Función</th>
                {editables.map((rol) => (
                  <th key={rol.id} title={rol.description ?? undefined}>
                    {rol.name}
                    {tieneCambios(rol.id) ? <span className="sin-guardar" title="Sin guardar"> •</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {porPantalla.map(({ pantalla, funciones }) => (
                <Fragment key={pantalla}>
                  <tr className="row--total">
                    <td colSpan={editables.length + 1}>{pantalla}</td>
                  </tr>
                  {funciones.map((permiso) => (
                    <tr key={permiso.code}>
                      <td>
                        <div className="funcion__nombre">
                          {permiso.sensitive === true ? <span className="sensible">●</span> : null}
                          {permiso.label}
                        </div>
                        <div className="funcion__detalle">{permiso.detail}</div>
                      </td>
                      {editables.map((rol) => (
                        <td key={rol.id} style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={borrador[rol.id]?.has(permiso.code) ?? false}
                            disabled={busy}
                            aria-label={`${rol.name}: ${permiso.label}`}
                            onChange={() => { alternar(rol.id, permiso.code) }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr className="row--total">
                <td>Guardar</td>
                {editables.map((rol) => (
                  <td key={rol.id} style={{ textAlign: 'center' }}>
                    <button
                      className={tieneCambios(rol.id) ? 'button button--primary' : 'button'}
                      disabled={busy || !tieneCambios(rol.id)}
                      onClick={() => {
                        run(
                          async () => { await saveRolePermissions(rol.id, [...(borrador[rol.id] ?? [])]) },
                          `Guardados los permisos de «${rol.name}».`,
                        )
                      }}
                    >
                      Guardar
                    </button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>

          <div className="toolbar">
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                const name = window.prompt('Nombre del rol nuevo')
                if (name === null || name.trim() === '') return
                const code = window.prompt('Código corto (minúsculas, sin espacios)', name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'))
                if (code === null || code.trim() === '') return
                const description = window.prompt('Para qué es este rol', '') ?? ''
                run(async () => { await createRole(code.trim(), name.trim(), description) })
              }}
            >
              + Rol
            </button>
            <span className="faint">Quitar un rol:</span>
            {editables.map((rol) => (
              <button
                key={rol.id}
                className="button"
                disabled={busy}
                title={`Quitar el rol «${rol.name}»`}
                onClick={() => {
                  if (window.confirm(`¿Quitar el rol «${rol.name}»? Quien lo tuviera se queda sin él.`)) {
                    run(async () => { await removeRole(rol.id) })
                  }
                }}
              >
                ✕ {rol.name}
              </button>
            ))}
          </div>
        </>
      ) : (
        <UsuariosYRoles
          sheet={sheet}
          projects={projects}
          currentUserId={currentUserId}
          busy={busy}
          onRun={run}
        />
      )}
    </>
  )
}

function UsuariosYRoles({
  sheet,
  projects,
  currentUserId,
  busy,
  onRun,
}: {
  readonly sheet: AdminSheet
  readonly projects: readonly Project[]
  readonly currentUserId: string | null
  readonly busy: boolean
  readonly onRun: (accion: () => Promise<void>, mensaje?: string) => void
}): React.JSX.Element {
  const nombreDeRol = new Map(sheet.roles.map((rol) => [rol.id, rol.name]))
  const esDeSistema = new Set(sheet.roles.filter((rol) => rol.isSystem).map((rol) => rol.id))
  const codigoDeProyecto = new Map(projects.map((proyecto) => [proyecto.id, proyecto.code]))

  return (
    <>
      <p className="faint" style={{ padding: '0 16px', maxWidth: '90ch' }}>
        Un rol concedido <b>en toda la herramienta</b> vale en todos los proyectos. Concedido{' '}
        <b>en un proyecto</b>, vale sólo ahí. Lo que alguien puede hacer en un proyecto es la suma de los dos,
        así que un rol por proyecto añade permisos, nunca los quita.
      </p>

      <table className="grid">
        <thead>
          <tr>
            <th style={{ minWidth: 220 }}>Persona</th>
            <th>Roles</th>
            <th>Último acceso</th>
            <th>Estado</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sheet.users.map((usuario) => {
            const suyos = sheet.grants.filter((concesion) => concesion.userId === usuario.id)
            return (
              <tr key={usuario.id} style={usuario.isActive ? undefined : { opacity: 0.5 }}>
                <td>
                  <div>{usuario.displayName}</div>
                  <div className="funcion__detalle">{usuario.email}</div>
                </td>
                <td style={{ textAlign: 'left' }}>
                  {suyos.length === 0 ? (
                    <span className="faint">sin roles: no puede hacer nada</span>
                  ) : (
                    suyos.map((concesion) => (
                      <span className="tag" key={concesion.id} style={{ marginRight: 6 }}>
                        {nombreDeRol.get(concesion.roleId) ?? '?'}
                        {concesion.projectId === null
                          ? ''
                          : ` · ${codigoDeProyecto.get(concesion.projectId) ?? '?'}`}
                        {usuario.id === currentUserId && esDeSistema.has(concesion.roleId) ? null : (
                          <button
                            className="skill-head__drop"
                            disabled={busy}
                            title="Retirar este rol"
                            onClick={() => { onRun(async () => { await revoke(concesion.id) }) }}
                          >
                            ✕
                          </button>
                        )}
                      </span>
                    ))
                  )}
                </td>
                <td className="muted">{usuario.lastLoginAt === null ? 'nunca' : fullDate(usuario.lastLoginAt)}</td>
                <td>{usuario.isActive ? 'activo' : 'desactivado'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <ConcederRol
                    sheet={sheet}
                    projects={projects}
                    userId={usuario.id}
                    busy={busy}
                    onRun={onRun}
                  />{' '}
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      const clave = window.prompt(`Contraseña nueva para ${usuario.displayName} (12 o más)`)
                      if (clave === null || clave.length < 12) return
                      onRun(
                        async () => { await setUserPassword(usuario.id, clave) },
                        `Contraseña cambiada. Sus sesiones abiertas se han cerrado.`,
                      )
                    }}
                  >
                    Clave
                  </button>{' '}
                  <button
                    className="button"
                    disabled={busy || usuario.id === currentUserId}
                    title={
                      usuario.id === currentUserId
                        ? 'No puedes desactivar tu propia cuenta'
                        : usuario.isActive
                          ? 'Desactivar: deja de poder entrar y se cierran sus sesiones'
                          : 'Reactivar'
                    }
                    onClick={() => { onRun(async () => { await setUserActive(usuario.id, !usuario.isActive) }) }}
                  >
                    {usuario.isActive ? 'Desactivar' : 'Reactivar'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="toolbar">
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            const displayName = window.prompt('Nombre de la persona')
            if (displayName === null || displayName.trim() === '') return
            const email = window.prompt('Correo')
            if (email === null || email.trim() === '') return
            const password = window.prompt('Contraseña inicial (12 caracteres o más)')
            if (password === null || password.length < 12) {
              window.alert('La contraseña debe tener al menos 12 caracteres.')
              return
            }
            onRun(async () => { await createAppUser(email.trim(), displayName.trim(), password) })
          }}
        >
          + Usuario
        </button>
        <span className="faint">
          Un usuario recién creado no puede hacer nada hasta que se le concede un rol.
        </span>
      </div>
    </>
  )
}

function ConcederRol({
  sheet,
  projects,
  userId,
  busy,
  onRun,
}: {
  readonly sheet: AdminSheet
  readonly projects: readonly Project[]
  readonly userId: string
  readonly busy: boolean
  readonly onRun: (accion: () => Promise<void>, mensaje?: string) => void
}): React.JSX.Element {
  const [abierto, setAbierto] = useState(false)
  const [roleId, setRoleId] = useState(sheet.roles[0]?.id ?? '')
  const [projectId, setProjectId] = useState('')

  if (!abierto) {
    return (
      <button className="button" disabled={busy} onClick={() => { setAbierto(true) }} title="Conceder un rol a esta persona">
        + Conceder
      </button>
    )
  }

  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <select className="input" value={roleId} onChange={(event) => { setRoleId(event.target.value) }}>
        {sheet.roles.map((rol) => (
          <option key={rol.id} value={rol.id}>{rol.name}</option>
        ))}
      </select>
      <select className="input" value={projectId} onChange={(event) => { setProjectId(event.target.value) }}>
        <option value="">en toda la herramienta</option>
        {projects
          .filter((proyecto) => !proyecto.isTemplate)
          .map((proyecto) => (
            <option key={proyecto.id} value={proyecto.id}>sólo en {proyecto.code}</option>
          ))}
      </select>
      <button
        className="button button--primary"
        disabled={busy || roleId === ''}
        onClick={() => {
          onRun(async () => { await grant(userId, roleId, projectId === '' ? null : projectId) })
          setAbierto(false)
        }}
      >
        Conceder
      </button>
      <button className="button" onClick={() => { setAbierto(false) }}>Cancelar</button>
    </span>
  )
}
