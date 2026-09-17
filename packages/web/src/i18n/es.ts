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
} as const
