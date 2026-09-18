/**
 * Importación del equipo desde un CSV plano.
 *
 *   codigo;nombre;calendario;jornada;indirecto;reserva;alta;baja;competencias;tarifa;tarifa_desde;tarifa_hasta
 *
 * Existe por una avería de las que sólo se ven con datos de verdad. ADR-0040
 * metió el plan del equipo entero y dejó escrita su deuda: **las personas
 * entraban por su nombre del libro, con jornada estándar y sin tarifa.** Lo que
 * no se dijo entonces, porque no se miró, es que *no había forma de arreglarlo
 * en bloque*: la herramienta sabe dar de alta a una persona, de una en una, en
 * un formulario. Veintisiete personas con su calendario, su jornada, sus
 * competencias y su tarifa son ciento y pico formularios.
 *
 * Tres reglas, las mismas que el catálogo de entregables porque son las que
 * hacen que volver a cargar un fichero corregido corrija de verdad:
 *
 *   - **El código manda.** Una fila cuyo código ya existe *actualiza* a esa
 *     persona en vez de crear otra. Cargar dos veces el mismo fichero deja el
 *     equipo igual que cargarlo una vez.
 *
 *   - **`competencias` es la lista completa** de lo que esa persona sabe hacer,
 *     no una añadidura: lo que no venga en la casilla se le quita. Y sólo
 *     afecta a las filas que el fichero nombra.
 *
 *   - **Las tarifas se añaden, no se reemplazan.** Es la única excepción a lo
 *     anterior y tiene motivo: una tarifa no es un dato de la persona, es un
 *     tramo de su historia con fecha de principio y de fin. Borrar las
 *     anteriores para dejar la del fichero reescribiría el coste de lo que ya
 *     pasó. Una tarifa idéntica a otra que ya está no se duplica; una que pisa
 *     un tramo existente con otro importe se avisa y no se mete.
 *
 * Y una que no se hereda: **el fichero decide qué permiso hace falta.** Traer
 * personas pide `equipo.editar`; traer además tarifas pide `tarifas.editar`,
 * porque lo que cobra alguien no es lo mismo que su jornada. Un fichero sin
 * columna de tarifa no exige el segundo permiso.
 */

import {
  addCostRate,
  createResource,
  createSkill,
  readCalendars,
  readResourceDetails,
  readSkillMatrix,
  setResourceSkill,
  updateResource,
  type Queryable,
} from "@planner/persistence";
import { parseCsv, parseNumber } from "./csv.js";
import { ImportError } from "./import-plan.js";

/** Las columnas sin las que no se puede leer una fila. Las demás son opcionales. */
const OBLIGATORIAS = ["codigo", "nombre"] as const;

/** Las columnas que hacen falta para meter una tarifa. */
const COLUMNAS_DE_TARIFA = ["tarifa", "tarifa_desde", "tarifa_hasta"] as const;

const CIEN_POR_CIEN_BP = 10_000;
const CENTIMOS_POR_EURO = 100;
/** Tope del factor indirecto y de la reserva, como en el esquema: media jornada. */
const FACTOR_MAXIMO_BP = 5_000;
const NIVEL_MINIMO = 1;
const NIVEL_MAXIMO = 5;

const FECHA = /^\d{4}-\d{2}-\d{2}$/u;

export interface TeamImportSummary {
  readonly rows: number;
  readonly created: number;
  readonly updated: number;
  /** Competencias que no existían y se han creado al vuelo. */
  readonly skillsCreated: number;
  /** Parejas persona-competencia escritas. */
  readonly skillsSet: number;
  readonly rates: number;
  readonly warnings: readonly string[];
}

/** Si el fichero trae tarifas. Lo pregunta la ruta antes de dejar pasar. */
export function traeTarifas(text: string): boolean {
  const filas = parseCsv(text);
  return filas.some((fila) => (fila["tarifa"] ?? "").trim() !== "");
}

export interface FilaLeida {
  readonly line: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly calendario: string | null;
  readonly jornadaBp: number | null;
  readonly indirectoBp: number | null;
  readonly reservaBp: number | null;
  readonly alta: string | null;
  readonly baja: string | null;
  /** `null` cuando el fichero no trae la columna: entonces no dice nada y no se toca. */
  readonly competencias: readonly { nombre: string; nivel: number }[] | null;
  readonly tarifa: {
    centimosHora: number;
    desde: string;
    hasta: string;
  } | null;
}

/** Un porcentaje declarado, a puntos básicos. Admite coma o punto decimal. */
function porcentaje(
  valor: string,
  campo: string,
  linea: number,
  tope: number,
): number {
  const numero = parseNumber(valor);
  if (numero === null) {
    throw new ImportError(
      `Línea ${String(linea)}: «${campo}» no es un número: «${valor}»`,
    );
  }
  const bp = Math.round(numero * (CIEN_POR_CIEN_BP / 100));
  if (bp < 0 || bp > tope) {
    throw new ImportError(
      `Línea ${String(linea)}: «${campo}» tiene que estar entre 0 y ${String(tope / 100)} %, y vale ${String(numero)}`,
    );
  }
  return bp;
}

function fecha(valor: string, campo: string, linea: number): string {
  if (!FECHA.test(valor)) {
    throw new ImportError(
      `Línea ${String(linea)}: «${campo}» tiene que ser AAAA-MM-DD, y es «${valor}»`,
    );
  }
  return valor;
}

/**
 * Las competencias de una casilla: `Hazard Log:4|FMECA:3`.
 *
 * El nivel es obligatorio y va de 1 a 5. Ponerle un nivel por defecto a quien
 * no lo declara sería la herramienta opinando sobre lo que alguien sabe hacer,
 * que es justo el dato que se estaba importando.
 */
function competencias(
  valor: string,
  linea: number,
): readonly { nombre: string; nivel: number }[] {
  const trozos = valor
    .split(/[|,;]/u)
    .map((trozo) => trozo.trim())
    .filter((trozo) => trozo !== "");
  return trozos.map((trozo) => {
    const corte = trozo.lastIndexOf(":");
    if (corte < 1) {
      throw new ImportError(
        `Línea ${String(linea)}: «${trozo}» no dice el nivel. Se escribe «Hazard Log:4», de 1 a 5.`,
      );
    }
    const nombre = trozo.slice(0, corte).trim();
    const nivel = Number(trozo.slice(corte + 1).trim());
    if (
      !Number.isInteger(nivel) ||
      nivel < NIVEL_MINIMO ||
      nivel > NIVEL_MAXIMO
    ) {
      throw new ImportError(
        `Línea ${String(linea)}: el nivel de «${nombre}» tiene que ser un entero de ${String(NIVEL_MINIMO)} a ${String(NIVEL_MAXIMO)}, y es «${trozo.slice(corte + 1).trim()}»`,
      );
    }
    return { nombre, nivel };
  });
}

/**
 * Lee el fichero entero sin tocar la base, para poder probarlo sin base. Es la
 * mitad que decide si un fichero entra: la otra sólo escribe lo que ésta dice.
 */
export function parseTeamCsv(text: string): readonly FilaLeida[] {
  const filas = parseCsv(text);
  if (filas.length === 0)
    throw new ImportError("El fichero no tiene ninguna fila de datos");

  const primera = filas[0] ?? {};
  const faltan = OBLIGATORIAS.filter((columna) => !(columna in primera));
  if (faltan.length > 0) {
    throw new ImportError(`Faltan columnas obligatorias: ${faltan.join(", ")}`);
  }
  const hayCompetencias = "competencias" in primera;
  const hayTarifa = COLUMNAS_DE_TARIFA.every((columna) => columna in primera);

  const vistos = new Set<string>();
  return filas.map((fila, indice) => {
    const linea = indice + 2;
    const dame = (columna: string): string => (fila[columna] ?? "").trim();
    const codigo = dame("codigo");
    const nombre = dame("nombre");
    if (codigo === "")
      throw new ImportError(`Línea ${String(linea)}: falta el código`);
    if (nombre === "")
      throw new ImportError(`Línea ${String(linea)}: falta el nombre`);
    if (vistos.has(codigo.toLowerCase())) {
      throw new ImportError(
        `Línea ${String(linea)}: el código «${codigo}» sale dos veces en el fichero`,
      );
    }
    vistos.add(codigo.toLowerCase());

    const jornada = dame("jornada");
    const indirecto = dame("indirecto");
    const reserva = dame("reserva");
    const alta = dame("alta");
    const baja = dame("baja");
    const importe = dame("tarifa");

    let tarifa: FilaLeida["tarifa"] = null;
    if (hayTarifa && importe !== "") {
      const euros = parseNumber(importe);
      if (euros === null || euros < 0) {
        throw new ImportError(
          `Línea ${String(linea)}: «tarifa» no es un importe válido: «${importe}»`,
        );
      }
      const desde = dame("tarifa_desde");
      const hasta = dame("tarifa_hasta");
      if (desde === "" || hasta === "") {
        throw new ImportError(
          `Línea ${String(linea)}: una tarifa necesita «tarifa_desde» y «tarifa_hasta». Una tarifa sin tramo no se puede cobrar a nada.`,
        );
      }
      tarifa = {
        centimosHora: Math.round(euros * CENTIMOS_POR_EURO),
        desde: fecha(desde, "tarifa_desde", linea),
        hasta: fecha(hasta, "tarifa_hasta", linea),
      };
      if (tarifa.hasta <= tarifa.desde) {
        throw new ImportError(
          `Línea ${String(linea)}: «tarifa_hasta» tiene que ir después de «tarifa_desde»`,
        );
      }
    }

    return {
      line: linea,
      codigo,
      nombre,
      calendario: dame("calendario") === "" ? null : dame("calendario"),
      jornadaBp:
        jornada === "" ? null : porcentaje(jornada, "jornada", linea, 20_000),
      indirectoBp:
        indirecto === ""
          ? null
          : porcentaje(indirecto, "indirecto", linea, FACTOR_MAXIMO_BP),
      reservaBp:
        reserva === ""
          ? null
          : porcentaje(reserva, "reserva", linea, FACTOR_MAXIMO_BP),
      alta: alta === "" ? null : fecha(alta, "alta", linea),
      baja: baja === "" ? null : fecha(baja, "baja", linea),
      competencias: hayCompetencias
        ? competencias(dame("competencias"), linea)
        : null,
      tarifa,
    };
  });
}

/** Un código de competencia a partir de su nombre: lo que el nombre tenga de código. */
function codigoDeCompetencia(nombre: string): string {
  return nombre.trim().toUpperCase().replace(/\s+/gu, "-").slice(0, 60);
}

export async function importTeamCsv(
  db: Queryable,
  text: string,
): Promise<TeamImportSummary> {
  const filas = parseTeamCsv(text);
  const avisos: string[] = [];

  const calendarios = await readCalendars(db);
  const porNombre = new Map<string, string>();
  for (const calendario of calendarios) {
    porNombre.set(calendario.code.trim().toLowerCase(), calendario.id);
    porNombre.set(calendario.name.trim().toLowerCase(), calendario.id);
  }

  const equipo = await readResourceDetails(db);
  const porCodigo = new Map(
    equipo.map((persona) => [persona.code.trim().toLowerCase(), persona]),
  );

  const matriz = await readSkillMatrix(db);
  const competenciaPorNombre = new Map<string, string>();
  for (const competencia of matriz.skills) {
    competenciaPorNombre.set(
      competencia.name.trim().toLowerCase(),
      competencia.id,
    );
    competenciaPorNombre.set(
      competencia.code.trim().toLowerCase(),
      competencia.id,
    );
  }

  let creadas = 0;
  let actualizadas = 0;
  let competenciasCreadas = 0;
  let competenciasPuestas = 0;
  let tarifas = 0;

  for (const fila of filas) {
    let calendarId: string | null = null;
    if (fila.calendario !== null) {
      calendarId = porNombre.get(fila.calendario.toLowerCase()) ?? null;
      if (calendarId === null) {
        avisos.push(
          `Línea ${String(fila.line)}: no hay ningún calendario que se llame «${fila.calendario}». ` +
            `«${fila.nombre}» entra sin calendario propio.`,
        );
      }
    }

    const campos = {
      code: fila.codigo,
      displayName: fila.nombre,
      ...(fila.calendario === null ? {} : { calendarId }),
      ...(fila.jornadaBp === null ? {} : { maxUnitsBp: fila.jornadaBp }),
      ...(fila.indirectoBp === null ? {} : { indirectBp: fila.indirectoBp }),
      ...(fila.reservaBp === null ? {} : { reserveBp: fila.reservaBp }),
      ...(fila.alta === null ? {} : { activeFrom: fila.alta }),
      ...(fila.baja === null ? {} : { activeTo: fila.baja }),
    };

    const ya = porCodigo.get(fila.codigo.toLowerCase());
    let resourceId: string;
    if (ya === undefined) {
      resourceId = await createResource(db, campos);
      creadas += 1;
    } else {
      resourceId = ya.id;
      await updateResource(db, resourceId, campos);
      actualizadas += 1;
    }

    if (fila.competencias !== null) {
      const quiere = new Map<string, number>();
      for (const competencia of fila.competencias) {
        let skillId = competenciaPorNombre.get(
          competencia.nombre.toLowerCase(),
        );
        if (skillId === undefined) {
          skillId = await createSkill(
            db,
            codigoDeCompetencia(competencia.nombre),
            competencia.nombre,
          );
          competenciaPorNombre.set(competencia.nombre.toLowerCase(), skillId);
          competenciasCreadas += 1;
        }
        quiere.set(skillId, competencia.nivel);
      }
      // La casilla es la lista completa: lo que tenía y ya no viene, se le quita.
      const tenia = matriz.resourceSkills.filter(
        (rs) => rs.resourceId === resourceId,
      );
      for (const anterior of tenia) {
        if (!quiere.has(anterior.skillId))
          await setResourceSkill(db, resourceId, anterior.skillId, 0);
      }
      for (const [skillId, nivel] of quiere) {
        await setResourceSkill(db, resourceId, skillId, nivel);
        competenciasPuestas += 1;
      }
    }

    if (fila.tarifa !== null) {
      const tramos = ya?.costRates ?? [];
      const identica = tramos.some(
        (tramo) =>
          tramo.from === fila.tarifa?.desde &&
          tramo.to === fila.tarifa.hasta &&
          tramo.standardCentsHour === fila.tarifa.centimosHora,
      );
      if (!identica) {
        try {
          await addCostRate(db, resourceId, {
            from: fila.tarifa.desde,
            to: fila.tarifa.hasta,
            standardCentsHour: fila.tarifa.centimosHora,
          });
          tarifas += 1;
        } catch {
          // El EXCLUDE del esquema impide dos tarifas que se pisen para la misma
          // persona. Un tramo que choca con otro distinto es una decisión —¿cuál
          // vale?— y no la toma el importador.
          avisos.push(
            `Línea ${String(fila.line)}: «${fila.nombre}» ya tiene una tarifa que se pisa con ` +
              `${fila.tarifa.desde} → ${fila.tarifa.hasta}. No se ha metido; retira la anterior si toca.`,
          );
        }
      }
    }
  }

  return {
    rows: filas.length,
    created: creadas,
    updated: actualizadas,
    skillsCreated: competenciasCreadas,
    skillsSet: competenciasPuestas,
    rates: tarifas,
    warnings: avisos,
  };
}
