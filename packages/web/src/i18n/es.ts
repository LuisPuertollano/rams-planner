/**
 * El diccionario en castellano. **Es la fuente**: las claves que existen aquí
 * son las que existen, y los otros tres idiomas se escriben contra este tipo.
 *
 * Las claves se leen: `pantalla.cosa`. Nada de `msg_142`, que obliga a abrir
 * dos ficheros para saber de qué se está hablando.
 */
export const es = {
  // --- La cabecera y la navegación ------------------------------------------
  'app.nombre': 'RAMS Planner',
  'app.lema': 'carga de trabajo, explicada hasta el último minuto',
  'app.cargando': 'Cargando…',
  'app.errorCargar': 'Error al cargar',
  'app.errorRecargar': 'Error al recargar',
  'app.entendido': 'Entendido',

  'boton.importar': 'Importar CSV',
  'boton.exportar': 'Exportar',
  'boton.exportarTitulo': 'Descargar la carga mensual en CSV, con el identificador del cálculo en cada fila',
  'boton.lineaBase': 'Línea base',
  'boton.lineaBaseTitulo': 'Congelar el plan actual como línea base',
  'boton.nivelar': 'Nivelar',
  'boton.nivelarTitulo':
    'Retrasar tareas hasta que el plan quepa en la capacidad del equipo. Crea una ejecución nueva; el plan original no se toca',
  'boton.recalcular': 'Recalcular',
  'boton.calculando': 'Calculando…',
  'boton.contrasena': 'Contraseña',
  'boton.contrasenaTitulo': 'Cambiar mi contraseña',
  'boton.salir': 'Salir',
  'boton.tema': 'Tema: automático, claro u oscuro',
  'boton.idioma': 'Idioma',

  'lineaBase.pide': 'Nombre de la línea base',
  'lineaBase.porDefecto': 'Plan %s',
  'lineaBase.error': 'No se pudo congelar',
  'calculo.error': 'No se pudo recalcular',
  'calculo.nivelado':
    'Nivelado: %s tarea(s) retrasadas para que el plan quepa en la capacidad del equipo. Compara con la ejecución anterior para ver qué ha costado.',
  'calculo.niveladoParcial':
    'Nivelación parcial: %s tarea(s) retrasadas, pero quedan sobrecargas que ningún retraso arregla. Mira los hallazgos.',
  'calculo.razonInterfaz': 'recálculo desde la interfaz',
  'calculo.razonNivelacion': 'nivelación de recursos',

  'ejecucion.chip': 'ejecución %s · motor %s · %s · %s ms',
  'ejecucion.hash': 'Hash de entradas: %s',

  // --- Pestañas --------------------------------------------------------------
  'tab.carga': 'Carga',
  'tab.carga.pista': 'Cuántas horas tiene comprometida cada persona, cada mes, en cada proyecto',
  'tab.saturacion': 'Saturación',
  'tab.saturacion.pista': 'Quién se pasa de capacidad, cuándo y por cuánto',
  'tab.plan': 'Plan',
  'tab.plan.pista': 'El árbol de trabajo con sus fechas calculadas',
  'tab.cronograma': 'Cronograma',
  'tab.cronograma.pista': 'El plan en el tiempo, con el camino crítico',
  'tab.equipo': 'Equipo',
  'tab.equipo.pista': 'De qué está hecha la capacidad: calendario, dedicación, ausencias y tarifa de cada persona',
  'tab.calendario': 'Calendario',
  'tab.calendario.pista': 'Quién está fuera, cuándo, y qué capacidad le queda al equipo cada día',
  'tab.competencias': 'Competencias',
  'tab.competencias.pista': 'Quién sabe hacer qué, y dónde el equipo tiene un único especialista',
  'tab.documentos': 'Documentos',
  'tab.documentos.pista':
    'Qué entregables hay y cuál es condición necesaria de cuál. Se declara una vez y vale para todos los proyectos',
  'tab.informes': 'Informes',
  'tab.informes.pista': 'El resumen y el detalle de uno o varios proyectos, en el periodo que elijas',
  'tab.reparto': 'Reparto',
  'tab.reparto.pista': 'Qué trabajo se podría mover, a quién, y qué arreglaría. Propuestas, no decisiones',
  'tab.hallazgos': 'Hallazgos',
  'tab.hallazgos.pista': 'Todo lo que el motor quiere decirte',
  'tab.comparar': 'Comparar',
  'tab.comparar.pista': 'En qué se diferencia el plan de hoy del que congelaste',
  'tab.registro': 'Registro',
  'tab.registro.pista': 'Quién cambió qué y cuándo, con su comentario',
  'tab.admin': 'Administración',
  'tab.admin.pista': 'Quién entra, qué rol tiene y qué deja hacer cada rol',

  // --- La nota del panel -----------------------------------------------------
  'nota.admin': '✎ lo que marques aquí es lo que la API deja hacer',
  'nota.documentos': '✎ la fila es condición necesaria de la columna',
  'nota.registro': '🔒 sólo lectura · el registro lo escribe la base de datos, no la aplicación',
  'nota.declarado': '✎ todo declarado · cada cambio recalcula el plan',
  'nota.plan': '✎ declarado · 🔒 derivado, no editable',
  'nota.derivado': '🔒 columnas derivadas · no editables',

  // --- Las tarjetas de arriba ------------------------------------------------
  'stat.planificado': 'Trabajo planificado',
  'stat.planificado.sobre': 'sobre %s h de capacidad en esos meses',
  'stat.planificado.recortado': 'en los proyectos que puedes ver',
  'stat.ocupacion': 'Ocupación del equipo',
  'stat.ocupacion.media': 'media de los meses con trabajo',
  'stat.ocupacion.sinCapacidad':
    'la capacidad es de todo el equipo: hace falta ver la carga en toda la herramienta',
  'stat.sobrecargadas': 'Personas sobrecargadas',
  'stat.sobrecargadas.pista': 'en al menos un mes',
  'stat.sobrecargadas.sinCapacidad': 'sólo con la carga de toda la herramienta',
  'stat.coste': 'Coste comprometido',
  'stat.coste.pista': 'horas por la tarifa vigente de cada día',
  'stat.coste.cero': 'sale a cero: al equipo le faltan tarifas',
  'stat.criticas': 'Tareas críticas',
  'stat.criticas.pista': 'sin holgura: retrasarlas retrasa el plan',

  // --- Estados vacíos --------------------------------------------------------
  'vacio.nada.titulo': 'Aquí no hay nada todavía',
  'vacio.nada.texto':
    'El orden que funciona es este: primero el Equipo, porque de ahí sale la capacidad y el coste; después el plan, importando un CSV o creándolo a mano.',
  'vacio.nada.irEquipo': 'Ir al equipo',
  'vacio.nada.plantilla': 'Descargar la plantilla CSV',
  'vacio.nada.demo': '¿Sólo quieres verla funcionar? %s carga tres proyectos que se solapan.',
  'vacio.sinPermisos.titulo': 'Tu cuenta no tiene todavía ningún permiso',
  'vacio.sinPermisos.texto':
    'Has entrado bien, pero nadie te ha concedido aún un rol. Quien administre la herramienta puede hacerlo desde Administración → Usuarios y roles.',

  // --- La instalación abierta ------------------------------------------------
  'abierta.aviso':
    'Esta instalación no tiene ningún usuario dado de alta, así que está abierta a cualquiera que llegue a ella. Crea el primero con %s.',

  // --- La puerta -------------------------------------------------------------
  'login.correo': 'Correo',
  'login.contrasena': 'Contraseña',
  'login.entrar': 'Entrar',
  'login.entrando': 'Entrando…',
  'login.error': 'No se pudo entrar',
  'login.pie':
    '¿No tienes cuenta? Te la da quien administre la herramienta. Si acabas de instalarla y no hay ninguna, créate la primera con %s.',

  // --- Cambiar la contraseña -------------------------------------------------
  'clave.titulo': 'Cambiar mi contraseña',
  'clave.cerrar': 'Cerrar',
  'clave.actual': 'Contraseña actual',
  'clave.nueva': 'Contraseña nueva (%s caracteres o más)',
  'clave.repite': 'Repite la nueva',
  'clave.corta': 'La nueva tiene que tener %s caracteres o más.',
  'clave.distintas': 'Las dos copias de la nueva no coinciden.',
  'clave.igual': 'La nueva tiene que ser distinta de la actual.',
  'clave.aviso':
    'Al cambiarla se cierran todas tus sesiones, ésta incluida: tendrás que volver a entrar con la nueva. Es a propósito — si la cambias porque alguien más la conocía, dejar sesiones vivas no arregla nada.',
  'clave.enviar': 'Cambiar y volver a entrar',
  'clave.enviando': 'Cambiando…',
  'clave.error': 'No se pudo cambiar la contraseña',

  // --- Informes --------------------------------------------------------------
  'informe.proyectos': 'Proyectos',
  'informe.todos': 'Todos',
  'informe.desde': 'Desde',
  'informe.hasta': 'Hasta',
  'informe.generar': 'Ver el informe',
  'informe.generando': 'Calculando…',
  'informe.copiar': 'Copiar el resumen',
  'informe.copiado': 'Copiado',
  'informe.periodo.todo': 'Todo el plan',
  'informe.periodo.trimestre': 'Este trimestre',
  'informe.periodo.semestre': 'Seis meses',
  'informe.periodo.anio': 'Este año',
  'informe.pie': 'Ejecución %s · periodo del %s al %s · a día %s',
  'informe.vacio': 'No hay nada de lo que informar en ese periodo. Prueba con otras fechas o con otros proyectos.',
  'informe.sinCostes': 'Sin permiso para ver importes: este informe llega sin ellos. No es que cuesten cero.',
  'informe.sinPersonas': 'Sin permiso para ver la carga: este informe llega sin el reparto por persona. No es que nadie vaya pasado.',
  'informe.seccion.resumen': 'En corto',
  'informe.seccion.meses': 'Mes a mes',
  'informe.nota.capacidad': 'La capacidad es la de las personas que trabajan en los proyectos elegidos, no la del equipo entero.',
  'informe.seccion.proyectos': 'Por proyecto',
  'informe.seccion.personas': 'Por persona',
  'informe.seccion.riesgos': 'Lo que va con retraso',
  'informe.seccion.hallazgos': 'Lo que dice el motor',
  'informe.riesgo.fecha-limite': 'fuera de plazo por %s día(s)',
  'informe.riesgo.holgura-negativa': 'sin holgura: %s',
  'informe.riesgo.retraso': 'debería estar terminada hace %s día(s)',
  'informe.tldr.alcance': '%s proyecto(s), %s tarea(s) con fechas dentro del periodo, repartidas en %s mes(es).',
  'informe.tldr.trabajo': '%s h comprometidas, sobre %s h de capacidad de quien trabaja en ellos: el %s.',
  'informe.tldr.avance': 'El trabajo del periodo va al %s: %s terminadas, %s en curso, %s sin empezar.',
  'informe.tldr.coste': '%s comprometidos en el periodo.',
  'informe.tldr.sobrecarga': '%s persona(s) pasan del 100 % en algún mes; la peor, %s en %s con un %s.',
  'informe.tldr.riesgo': '%s tarea(s) en riesgo: %s fuera de su fecha límite, %s sin holgura y %s que deberían estar terminadas.',
  'informe.tldr.hallazgos': 'El último cálculo dejó %s bloqueante(s), %s error(es) y %s aviso(s).',
  'informe.tldr.sin-fechas': '%s tarea(s) sin fechas calculadas: no entran en ningún total de este informe.',

  // --- Hallazgos: la voz del motor ------------------------------------------
  // La frase se construye del `code` y del `payload`, nunca del texto que
  // manda el servidor. Ese texto es el respaldo, para un hallazgo de una
  // ejecución antigua cuyo código ya no esté en el catálogo.
  'hallazgo.gravedad.blocking': 'bloqueante',
  'hallazgo.gravedad.error': 'error',
  'hallazgo.gravedad.warning': 'aviso',
  'hallazgo.gravedad.info': 'información',
  'hallazgo.sinCapacidad': 'sin capacidad ese día',
  'hallazgo.vacio.titulo': 'Ningún hallazgo',
  'hallazgo.vacio.detalle':
    'El plan no tiene ciclos, ni conflictos de restricción, ni nadie por encima de su capacidad.',

  'hallazgo.DEPENDENCY_CYCLE': 'Hay un ciclo de dependencias: %s. El cálculo no puede continuar; rompe uno de los enlaces.',
  'hallazgo.CONSTRAINT_CONFLICT.start_no_later_than': '«%s» no puede empezar antes del %s: sus predecesoras la empujan a %s.',
  'hallazgo.CONSTRAINT_CONFLICT.finish_no_later_than': '«%s» terminaría el %s, después del límite %s.',
  'hallazgo.CONSTRAINT_CONFLICT.must_start_on': '«%s» tiene que empezar el %s, pero sus predecesoras no lo permiten hasta %s. Gana la restricción y el conflicto queda visible.',
  'hallazgo.CONSTRAINT_CONFLICT.must_finish_on': '«%s» tiene que terminar el %s, lo que exige empezar el %s, antes de lo que permiten sus predecesoras.',
  'hallazgo.RESOURCE_OVERALLOCATED': '«%s» supera su capacidad %s día(s) de %s. El peor, el %s: %s.',
  'hallazgo.RESOURCE_NO_CAPACITY': '«%s» no tiene ningún día laborable dentro de la tarea, así que su trabajo no se puede repartir. Revisa su calendario o las fechas de la tarea.',
  'hallazgo.DEADLINE_MISSED': '«%s» termina el %s, después de su fecha objetivo %s.',
  'hallazgo.BUDGET_EXCEEDED': '«%s» planifica %s h frente a las %s h del esfuerzo estándar.',
  'hallazgo.TASK_UNASSIGNED': '«%s» tiene trabajo estimado pero nadie asignado.',
  'hallazgo.SKILL_MISSING': '«%s» está en «%s», que pide %s, y no la tiene declarada.',
  'hallazgo.SKILL_BELOW_LEVEL': '«%s» está en «%s» con %s de nivel %s; la tarea pide %s.',
  'hallazgo.TASK_NO_WORK': '«%s» ocupa %s h de calendario pero no consume trabajo de nadie.',
  'hallazgo.ORPHAN_TASK': 'Esta rama del plan no cuelga de ningún proyecto.',
  'hallazgo.CONTOUR_MISMATCH': 'El reparto manual de «%s» suma %s h y la asignación declara %s h. Se respeta el reparto manual.',
  'hallazgo.LEVELING_IMPOSSIBLE.no-cabe-en-la-jornada': '%s día(s) entre el %s y el %s tienen una sola asignación de «%s» que ya no cabe en la jornada. El peor, el %s: pide %s h y la persona tiene %s h. Moverla de fecha no arregla nada: hay que cambiar la dedicación, la duración o el calendario.',
  'hallazgo.LEVELING_IMPOSSIBLE.restriccion-dura': 'La nivelación no puede resolver la sobrecarga de «%s» del %s: todas las tareas implicadas tienen una restricción dura. La sobrecarga se deja visible en vez de esconderla.',
  'hallazgo.LEVELING_IMPOSSIBLE.retraso-maximo': 'La nivelación no puede resolver la sobrecarga de «%s» del %s: «%s» ya acumula el retraso máximo permitido. La sobrecarga se deja visible en vez de esconderla.',
  'hallazgo.LEVELING_IMPOSSIBLE.fuera-del-horizonte': 'La nivelación no puede resolver la sobrecarga de «%s» del %s: el retraso necesario se sale del horizonte del cálculo. La sobrecarga se deja visible en vez de esconderla.',
  'hallazgo.LEVELING_IMPOSSIBLE.iteraciones-agotadas': 'La nivelación no puede resolver la sobrecarga de «%s» del %s: se agotaron las %s iteraciones. La sobrecarga se deja visible en vez de esconderla.',
  'hallazgo.LEVELING_DELAYED': 'Para que quepa en la capacidad del equipo, «%s» se retrasa %s día(s) laborable(s).',
  'hallazgo.REBALANCE_NO_CANDIDATE': '«%s» está sobrecargado y no hay nadie que pueda recoger su trabajo: o falta la competencia, o el resto tampoco tiene hueco.',

  // Qué significa cada uno, para que el hallazgo enseñe además de avisar.
  'hallazgo.que.DEPENDENCY_CYCLE': 'Hay un ciclo de dependencias. El motor se detiene en vez de romper un enlace por su cuenta.',
  'hallazgo.que.CONSTRAINT_CONFLICT': 'Una restricción dura contradice a las dependencias. Gana la restricción y el conflicto queda visible.',
  'hallazgo.que.RESOURCE_OVERALLOCATED': 'La carga supera la capacidad. El dato es diario; aquí se resume por mes.',
  'hallazgo.que.RESOURCE_NO_CAPACITY': 'Hay trabajo asignado en días sin capacidad.',
  'hallazgo.que.DEADLINE_MISSED': 'La fecha objetivo es blanda: no mueve la tarea, sólo avisa.',
  'hallazgo.que.BUDGET_EXCEEDED': 'El trabajo planificado supera el esfuerzo estándar del paquete.',
  'hallazgo.que.TASK_UNASSIGNED': 'Hay trabajo estimado sin nadie asignado.',
  'hallazgo.que.SKILL_MISSING': 'Quien está asignado no tiene declarada una competencia que la tarea pide.',
  'hallazgo.que.SKILL_BELOW_LEVEL': 'La competencia está declarada, pero por debajo del nivel que la tarea pide.',
  'hallazgo.que.TASK_NO_WORK': 'La tarea ocupa tiempo pero no consume trabajo de nadie.',
  'hallazgo.que.ORPHAN_TASK': 'Una rama del árbol sin proyecto. No entra en ningún total.',
  'hallazgo.que.CONTOUR_MISMATCH': 'El reparto manual no suma el trabajo declarado. Se respeta el reparto manual.',
  'hallazgo.que.LEVELING_IMPOSSIBLE': 'Retrasar tareas no arregla esta sobrecarga. Se deja visible en vez de esconderla.',
  'hallazgo.que.LEVELING_DELAYED': 'La nivelación retrasó esta tarea. El plan declarado no se ha tocado.',
  'hallazgo.que.REBALANCE_NO_CANDIDATE': 'No hay a quién pasarle el trabajo: o falta la competencia, o nadie tiene hueco.',
} as const
