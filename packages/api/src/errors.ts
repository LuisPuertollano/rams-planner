/**
 * Los errores de la API, cada uno con su código estable.
 *
 * Mismo contrato que los hallazgos y que el catálogo de permisos: **el código
 * es lo que viaja**, y la frase castellana va de respaldo. La interfaz escribe
 * la frase en el idioma de quien mira, y un código que todavía no conozca
 * enseña el castellano, que es mejor que un hueco.
 *
 * Antes cada ruta escribía su frase a mano en un `reply.status(...).send(...)`.
 * Eran veintiuna frases sueltas, ninguna con código, así que la interfaz no
 * tenía de dónde agarrarse para traducirlas: lo único que le llegaba era texto.
 * Dárselo obligaba a pasar por todos los sitios, que es lo que hace esto.
 *
 * Que ninguno se quede sin traducir lo comprueba `pnpm check:errores`, que vive
 * en `tools/` y lee este fichero del disco.
 */

import type { FastifyReply } from 'fastify'
import { ZodError } from 'zod'

/**
 * El catálogo. Añadir uno es barato; cambiar el nombre de uno no, porque la
 * interfaz lo tiene en cuatro diccionarios. Se añade, no se renombra.
 */
export const ERROR_CODES = [
  // --- Sesión y permisos ----------------------------------------------------
  'SIN_SESION',
  'SIN_PERMISO',
  'FUNCION_SIN_CONFIGURAR',
  'CREDENCIALES_INVALIDAS',
  'CLAVE_ACTUAL_INCORRECTA',
  'CLAVE_SIN_CAMBIO',
  // --- Copia de seguridad ---------------------------------------------------
  'COPIA_VACIA',
  'COPIA_NO_ES_ZIP',
  'COPIA_SIN_MANIFIESTO',
  'COPIA_TOCADA',
  'COPIA_INCOMPLETA',
  'COPIA_OTRO_ESQUEMA',
  // --- Administración -------------------------------------------------------
  'FUNCIONES_DESCONOCIDAS',
  'ROL_NO_EXISTE',
  'ROL_DE_SISTEMA_NO_SE_EDITA',
  'ROL_DE_SISTEMA_NO_SE_BORRA',
  'CORREO_YA_USADO',
  'NO_TE_DESACTIVES',
  'NO_TE_QUITES_LA_SUPERADMINISTRACION',
  // --- Catálogos ------------------------------------------------------------
  'DOCUMENTO_YA_EXISTE',
  'DOCUMENTO_NO_SE_ESPERA_A_SI_MISMO',
  'FIRMA_CASILLA_REPETIDA',
  'SUBACTIVIDAD_CASILLA_REPETIDA',
  'COMPETENCIA_YA_EXISTE',
  // --- Peticiones -----------------------------------------------------------
  'DATOS_INVALIDOS',
  'NADA_QUE_CAMBIAR',
  'ENDPOINT_DESCONOCIDO',
  'CSV_VACIO',
  'CSV_INVALIDO',
  'TARIFAS_SIN_PERMISO',
  // --- Informes -------------------------------------------------------------
  'SIN_EJECUCION',
  'SIN_PERIODO',
  'PERIODO_INVERTIDO',
  // --- Lo que rechaza el esquema al escribir --------------------------------
  'PROYECTO_YA_EXISTE',
  'ASIGNACION_YA_EXISTE',
  'DEPENDENCIA_YA_EXISTE',
  'REGISTRO_YA_EXISTE',
  'DATOS_FUERA_DE_REGLA',
  'REFERENCIA_PERDIDA',
  'RECURSO_YA_EXISTE',
  'TARIFA_SOLAPADA',
  'DISPONIBILIDAD_SOLAPADA',
  'FECHAS_FUERA_DE_RANGO',
  'CALENDARIO_NO_EXISTE',
  'ESCRITURA_RECHAZADA',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/**
 * Lo que la frase necesita para poder escribirse en otro idioma, con los
 * nombres ya resueltos —igual que el `payload` de un hallazgo—. Si un código
 * describe varias situaciones, trae una clave que las distingue: `donde` en
 * `SIN_PERMISO`.
 */
export type ErrorExtra = Readonly<Record<string, string | number | boolean | null | readonly string[]>>

/**
 * Responde con un error.
 *
 * El `code` primero y la frase después, en ese orden, porque ése es el orden de
 * importancia: la frase es el respaldo de un código que la interfaz no conozca
 * todavía, no lo contrario.
 */
export function fallar(
  reply: FastifyReply,
  status: number,
  code: ErrorCode,
  mensaje: string,
  extra: ErrorExtra = {},
): FastifyReply {
  return reply.status(status).send({ error: mensaje, code, ...extra })
}

/** Un fallo de escritura que el esquema rechazó, ya con su código y su frase. */
export interface FalloDeEscritura {
  readonly code: ErrorCode
  readonly mensaje: string
}

/**
 * Traduce lo que rechaza PostgreSQL cuando alguien escribe algo que no puede
 * escribir. Un `23P01` aquí no es un fallo del programa: es la invariante R1
 * («la disponibilidad de una persona no se solapa consigo misma») haciendo su
 * trabajo, y merece una frase, no un volcado.
 *
 * El `ambito` hace falta porque el mismo código de PostgreSQL significa cosas
 * distintas según lo que se estuviera escribiendo: un `23503` al guardar una
 * tarea es una referencia que se ha perdido, y al guardar una persona es el
 * calendario que no existe. Antes eran dos funciones casi iguales en dos
 * ficheros, lo que hacía fácil arreglar una y olvidar la otra.
 */
export function describeDbError(error: unknown, ambito: 'plan' | 'equipo'): FalloDeEscritura | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  const code = String(error.code)
  const constraint = 'constraint' in error ? String((error as { constraint: unknown }).constraint) : ''

  if (ambito === 'equipo') {
    if (code === '23P01') {
      return constraint.includes('cost_rate')
        ? {
            code: 'TARIFA_SOLAPADA',
            mensaje: 'Ya hay una tarifa que cubre parte de esas fechas. Borra la anterior o ajusta el periodo.',
          }
        : {
            code: 'DISPONIBILIDAD_SOLAPADA',
            mensaje:
              'Ya hay un periodo de disponibilidad que se solapa con esas fechas. Borra el anterior o ajusta el periodo.',
          }
    }
    if (code === '23505') return { code: 'RECURSO_YA_EXISTE', mensaje: 'Ya existe un recurso con ese código.' }
    if (code === '23514') {
      return {
        code: 'FECHAS_FUERA_DE_RANGO',
        mensaje:
          'Las fechas o los valores están fuera de lo permitido (revisa que «hasta» no sea anterior a «desde»).',
      }
    }
    if (code === '23503') return { code: 'CALENDARIO_NO_EXISTE', mensaje: 'El calendario indicado no existe.' }
    return null
  }

  if (code === '23505') {
    if (constraint.includes('project_code')) {
      return { code: 'PROYECTO_YA_EXISTE', mensaje: 'Ya existe un proyecto con ese código.' }
    }
    if (constraint.includes('assignment')) {
      return { code: 'ASIGNACION_YA_EXISTE', mensaje: 'Esa persona ya está asignada a esta tarea.' }
    }
    if (constraint.includes('dependency')) {
      return { code: 'DEPENDENCIA_YA_EXISTE', mensaje: 'Esa dependencia ya existe.' }
    }
    return { code: 'REGISTRO_YA_EXISTE', mensaje: 'Ya existe un registro con esos datos.' }
  }
  if (code === '23514') {
    return {
      code: 'DATOS_FUERA_DE_REGLA',
      mensaje: 'Los datos no cumplen una regla del esquema (revisa duraciones y fechas).',
    }
  }
  if (code === '23503') return { code: 'REFERENCIA_PERDIDA', mensaje: 'Algo de lo que referencias ya no existe.' }
  return null
}

/**
 * Lo que Zod rechazó, dicho como una frase y no como un volcado.
 *
 * `ZodError.message` es el JSON de los problemas, con sus `path` y sus `code`
 * internos. Enseñárselo a quien rellenó un formulario no es explicar nada: lo
 * que necesita saber es **qué campo** y **qué le pasa**.
 *
 * Devuelve nulo si no es un error de Zod, para que quien llama siga su camino.
 */
export function describeZodError(error: unknown): FalloDeEscritura | null {
  if (!(error instanceof ZodError)) return null
  const campos = error.issues.map((problema) => {
    const donde = problema.path.join('.')
    return donde === '' ? problema.message : `«${donde}»: ${problema.message}`
  })
  return { code: 'DATOS_INVALIDOS', mensaje: campos.join('; ') }
}
