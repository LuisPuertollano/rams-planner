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
import { useT, type Traductor } from '../i18n/index.js'
import { permissionDetail, permissionLabel, screenName } from '../permissions.js'

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
  const { t } = useT()

  const recargar = async (): Promise<void> => {
    const siguiente = await fetchAdminSheet()
    setSheet(siguiente)
    const inicial: Record<string, Set<string>> = {}
    for (const rol of siguiente.roles) inicial[rol.id] = new Set(rol.permissions)
    setBorrador(inicial)
  }

  useEffect(() => {
    recargar().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : t('admin.errorCargar'))
    })
  }, [])

  const run = (accion: () => Promise<void>, mensaje?: string): void => {
    setBusy(true)
    setError(null)
    setAviso(null)
    accion()
      .then(recargar)
      .then(() => { if (mensaje !== undefined) setAviso(mensaje) })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : t('admin.errorGuardar')) })
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
    return <div className="empty"><h3>{error ?? t('hoja.cargando')}</h3></div>
  }

  const editables = sheet.roles.filter((rol) => !rol.isSystem)
  const sistema = sheet.roles.filter((rol) => rol.isSystem)

  return (
    <>
      {error === null ? null : <div className="error-banner" style={{ margin: 12 }}>{error}</div>}
      {aviso === null ? null : (
        <div className="notice" style={{ margin: 12 }}>
          {aviso}
          <button className="button" onClick={() => { setAviso(null) }}>{t('admin.entendido')}</button>
        </div>
      )}

      <div className="toolbar">
        <button className="tab" aria-selected={pestana === 'hoja'} onClick={() => { setPestana('hoja') }}>
          {t('hoja.pestana.permisos')}
        </button>
        <button className="tab" aria-selected={pestana === 'usuarios'} onClick={() => { setPestana('usuarios') }}>
          {t('hoja.pestana.usuarios')}
        </button>
        <span className="faint">
          {t('hoja.resumen', sheet.permissions.length, sheet.roles.length, sheet.users.length)}
        </span>
      </div>

      {pestana === 'hoja' ? (
        <>
          <p className="faint" style={{ padding: '0 16px', maxWidth: '90ch' }}>
            {t('hoja.intro')}{' '}
            {sistema.length === 0
              ? null
              : t('hoja.intro.sistema', sistema.map((rol) => rol.name).join(', '))}
          </p>

          <table className="grid grid--hoja">
            <thead>
              <tr>
                <th style={{ minWidth: 320 }}>{t('hoja.columna.funcion')}</th>
                {editables.map((rol) => (
                  <th key={rol.id} title={rol.description ?? undefined}>
                    {rol.name}
                    {tieneCambios(rol.id) ? (
                      <span className="sin-guardar" title={t('hoja.sinGuardar')}> •</span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {porPantalla.map(({ pantalla, funciones }) => (
                <Fragment key={pantalla}>
                  <tr className="row--total">
                    <td colSpan={editables.length + 1}>{screenName(t, pantalla)}</td>
                  </tr>
                  {funciones.map((permiso) => (
                    <tr key={permiso.code}>
                      <td>
                        <div className="funcion__nombre">
                          {permiso.sensitive === true ? <span className="sensible">●</span> : null}
                          {permissionLabel(t, permiso.code, permiso.label)}
                          {permiso.scope === 'global' ? (
                            <span className="tag" title={t('hoja.tag.global.pista')}>
                              {t('hoja.tag.global')}
                            </span>
                          ) : null}
                        </div>
                        <div className="funcion__detalle">
                          {permissionDetail(t, permiso.code, permiso.detail)}
                        </div>
                      </td>
                      {editables.map((rol) => (
                        <td key={rol.id} style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={borrador[rol.id]?.has(permiso.code) ?? false}
                            disabled={busy}
                            aria-label={`${rol.name}: ${permissionLabel(t, permiso.code, permiso.label)}`}
                            onChange={() => { alternar(rol.id, permiso.code) }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr className="row--total">
                <td>{t('hoja.guardar')}</td>
                {editables.map((rol) => (
                  <td key={rol.id} style={{ textAlign: 'center' }}>
                    <button
                      className={tieneCambios(rol.id) ? 'button button--primary' : 'button'}
                      disabled={busy || !tieneCambios(rol.id)}
                      onClick={() => {
                        run(
                          async () => { await saveRolePermissions(rol.id, [...(borrador[rol.id] ?? [])]) },
                          t('hoja.guardado', rol.name),
                        )
                      }}
                    >
                      {t('hoja.guardar')}
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
                const name = window.prompt(t('admin.rol.pideNombre'))
                if (name === null || name.trim() === '') return
                const code = window.prompt(
                  t('admin.rol.pideCodigo'),
                  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
                )
                if (code === null || code.trim() === '') return
                const description = window.prompt(t('admin.rol.pideDetalle'), '') ?? ''
                run(async () => { await createRole(code.trim(), name.trim(), description) })
              }}
            >
              {t('admin.rol.nuevo')}
            </button>
            <span className="faint">{t('admin.rol.quitar')}</span>
            {editables.map((rol) => (
              <button
                key={rol.id}
                className="button"
                disabled={busy}
                title={t('admin.rol.quitarPista', rol.name)}
                onClick={() => {
                  if (window.confirm(t('admin.rol.quitarConfirma', rol.name))) {
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
          t={t}
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
  t,
}: {
  readonly sheet: AdminSheet
  readonly projects: readonly Project[]
  readonly currentUserId: string | null
  readonly busy: boolean
  readonly onRun: (accion: () => Promise<void>, mensaje?: string) => void
  readonly t: Traductor['t']
}): React.JSX.Element {
  const nombreDeRol = new Map(sheet.roles.map((rol) => [rol.id, rol.name]))
  const esDeSistema = new Set(sheet.roles.filter((rol) => rol.isSystem).map((rol) => rol.id))
  const codigoDeProyecto = new Map(projects.map((proyecto) => [proyecto.id, proyecto.code]))

  return (
    <>
      <p className="faint" style={{ padding: '0 16px', maxWidth: '90ch' }}>
        {t('admin.usuarios.intro')}
      </p>

      <table className="grid">
        <thead>
          <tr>
            <th style={{ minWidth: 220 }}>{t('admin.col.persona')}</th>
            <th>{t('admin.col.roles')}</th>
            <th>{t('admin.col.ultimoAcceso')}</th>
            <th>{t('admin.col.estado')}</th>
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
                    <span className="faint">{t('admin.sinRoles')}</span>
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
                            title={t('admin.retirarRol')}
                            onClick={() => { onRun(async () => { await revoke(concesion.id) }) }}
                          >
                            ✕
                          </button>
                        )}
                      </span>
                    ))
                  )}
                </td>
                <td className="muted">{usuario.lastLoginAt === null ? t('admin.nunca') : fullDate(usuario.lastLoginAt)}</td>
                <td>{usuario.isActive ? t('admin.activo') : t('admin.desactivado')}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <ConcederRol
                    sheet={sheet}
                    projects={projects}
                    userId={usuario.id}
                    busy={busy}
                    onRun={onRun}
                    t={t}
                  />{' '}
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      const clave = window.prompt(t('admin.clave.pide', usuario.displayName))
                      if (clave === null || clave.length < 12) return
                      onRun(
                        async () => { await setUserPassword(usuario.id, clave) },
                        t('admin.clave.hecho'),
                      )
                    }}
                  >
                    {t('admin.clave')}
                  </button>{' '}
                  <button
                    className="button"
                    disabled={busy || usuario.id === currentUserId}
                    title={
                      usuario.id === currentUserId
                        ? t('admin.noTeDesactivas')
                        : usuario.isActive
                          ? t('admin.desactivar.pista')
                          : t('admin.reactivar')
                    }
                    onClick={() => { onRun(async () => { await setUserActive(usuario.id, !usuario.isActive) }) }}
                  >
                    {usuario.isActive ? t('admin.desactivar') : t('admin.reactivar')}
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
            const displayName = window.prompt(t('admin.usuario.pideNombre'))
            if (displayName === null || displayName.trim() === '') return
            const email = window.prompt(t('admin.usuario.pideCorreo'))
            if (email === null || email.trim() === '') return
            const password = window.prompt(t('admin.usuario.pideClave'))
            if (password === null || password.length < 12) {
              window.alert(t('admin.usuario.claveCorta'))
              return
            }
            onRun(async () => { await createAppUser(email.trim(), displayName.trim(), password) })
          }}
        >
          {t('admin.usuario.nuevo')}
        </button>
        <span className="faint">{t('admin.usuario.sinRol')}</span>
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
  t,
}: {
  readonly sheet: AdminSheet
  readonly projects: readonly Project[]
  readonly userId: string
  readonly busy: boolean
  readonly onRun: (accion: () => Promise<void>, mensaje?: string) => void
  readonly t: Traductor['t']
}): React.JSX.Element {
  const [abierto, setAbierto] = useState(false)
  const [roleId, setRoleId] = useState(sheet.roles[0]?.id ?? '')
  const [projectId, setProjectId] = useState('')

  if (!abierto) {
    return (
      <button
        className="button"
        disabled={busy}
        onClick={() => { setAbierto(true) }}
        title={t('admin.conceder.pista')}
      >
        {t('admin.conceder')}
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
        <option value="">{t('admin.conceder.enTodo')}</option>
        {projects
          .filter((proyecto) => !proyecto.isTemplate)
          .map((proyecto) => (
            <option key={proyecto.id} value={proyecto.id}>{t('admin.conceder.soloEn', proyecto.code)}</option>
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
        {t('admin.conceder.hacer')}
      </button>
      <button className="button" onClick={() => { setAbierto(false) }}>{t('admin.cancelar')}</button>
    </span>
  )
}
