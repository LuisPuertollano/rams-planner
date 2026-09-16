# Manual de uso

Para quien planifica, no para quien programa. Aquí no hay nada de arquitectura:
sólo qué hacer, en qué orden, y cómo leer lo que sale.

Si lo que buscas es levantar la herramienta, hacer copias de seguridad o
actualizarla, eso está en [`operacion.md`](operacion.md).

---

## 1. Las dos preguntas

La herramienta existe para contestar dos preguntas, y todo lo demás está a su
servicio:

> **¿Cuántas horas tiene comprometidas cada persona, cada mes, en cada proyecto —
> y cuánta capacidad le queda?**

> **Si acepto este proyecto nuevo, ¿quién se satura, cuándo y cuánto?**

La primera se contesta en la pestaña **Carga**. La segunda, cargando el proyecto
nuevo y comparando contra una línea base en la pestaña **Comparar**.

---

## 2. Empezar desde cero

En una base de datos recién creada el orden es este. Saltarse el paso 1 es la
causa más frecuente de que los costes salgan a cero.

### Paso 1 — El equipo

Pestaña **Equipo**. Por cada persona:

| Campo | Qué es | Si lo dejas en blanco |
|-------|--------|-----------------------|
| **Calendario** | De aquí salen los días y las horas laborables de esa persona: festivos incluidos | Se usa el calendario del proyecto |
| **Dedicación base** | El porcentaje de su jornada que dedica a proyectos, por defecto | 100 % |
| **Disponibilidad** | Tramos con fecha: una excedencia, una media jornada, un refuerzo temporal. Pisan a la dedicación base mientras duran | Se usa la dedicación base |
| **Ausencias** | Vacaciones, bajas, formación. Restan capacidad sin tocar el calendario del equipo | Nada resta |
| **Tarifas** | Coste por hora, con vigencia | **El coste de todas sus tareas sale a cero** |

Los calendarios base vienen ya cargados con los festivos de Baden-Württemberg
hasta 2035: `base_de` (jornada estándar), `base_bw` (con los festivos del land) y
`base_bw_35h` (semana de 35 horas). Un calendario hereda del que tiene encima:
cambiar un festivo en `base_de` lo cambia en los tres.

Las personas sin tarifa llevan un **⚠** en la lista. Es la única señal que vas a
tener de que sus horas no cuestan nada.

### Paso 2 — El plan

Botón **Importar CSV** de la cabecera. El formato está en el
[README](../README.md#cargar-tus-propios-datos) y la plantilla se descarga desde
la propia herramienta.

Lo importante de la importación:

- Es **todo o nada**. Una fila ilegible aborta el fichero entero y te dice qué
  fila y por qué. No existen las importaciones a medias.
- Un proyecto cuyo código ya exista **no se sobrescribe**: se rechaza la
  importación nombrando el conflicto. Si quieres reemplazarlo, cambia el código
  o borra el proyecto anterior.
- Las personas que no existan **se crean solas**, con jornada estándar y **sin
  tarifa**. La respuesta te dice cuáles. Vuelve a la pestaña Equipo y complétalas.

### Paso 3 — Mirar

Ya hay un plan calculado. Sigue leyendo.

---

## 3. Las pestañas, una por una

### Carga

La matriz: **persona × mes × proyecto**. Cada celda son horas comprometidas.
Debajo de cada persona va su capacidad del mes y su saturación.

Es la respuesta literal a la primera pregunta. Si sólo vas a mirar una pantalla
al mes, que sea esta.

### Saturación

La misma información, pero en color y sin proyectos: sólo **quién se pasa,
cuándo y por cuánto**. La escala está centrada en el 100 %:

| Color | Qué significa |
|-------|---------------|
| Gris | Sin trabajo asignado |
| Azul | Por debajo del 60 % — hay hueco |
| Verde | Entre el 60 % y el 95 % — sano |
| Amarillo | Alrededor del 100 % — al límite |
| Naranja | Hasta el 130 % — sobrecarga que se puede absorber con esfuerzo |
| Rojo | Por encima del 130 % — no va a pasar |

Un mes rojo no es un error de la herramienta: es un compromiso que alguien
adquirió y que no cabe.

### Plan

El árbol de trabajo con las fechas calculadas.

- Las columnas con **✎** son declaradas: las escribes tú y se editan en línea.
- Las columnas con **🔒** son derivadas: las calcula el motor y no se tocan. Si
  una fecha no te gusta, se cambia lo que la produce, no la fecha.
- El botón **¿por qué?** de cada tarea abre la traza completa: qué regla produjo
  cada fecha, con qué entradas, hasta el dato que alguien escribió.

En rojo, las tareas del **camino crítico**: las que no tienen holgura. Retrasar
una de ellas retrasa el proyecto entero. El camino crítico se calcula **por
proyecto**, no para toda la cartera: cada proyecto tiene el suyo.

### Cronograma

El plan en el tiempo. Barras, hitos en rombo, camino crítico en rojo. Sirve para
enseñárselo a alguien; para trabajar, la pestaña Plan tiene más información.

### Equipo

De qué está hecha la capacidad. Ver el paso 1.

**Todo lo de esta pestaña recalcula el plan al guardarlo.** Es intencionado: una
capacidad que cambia sin que cambie la carga sería una pantalla mintiendo.

### Hallazgos

Todo lo que el motor quiere decirte, ordenado por gravedad:

| Gravedad | Qué es | Qué hacer |
|----------|--------|-----------|
| **Bloqueante** | El plan no se puede calcular: un ciclo de dependencias, por ejemplo | Arreglarlo ya; hasta entonces no hay plan |
| **Error** | Una restricción imposible: una tarea que debe empezar antes de que termine su predecesora | Decidir cuál de las dos cosas cede |
| **Aviso** | Una sobrecarga, un deadline que no se cumple, un desvío de presupuesto | Decidir si se acepta |
| **Información** | Contexto del cálculo | Leer y seguir |

Un **deadline** no mueve nunca una tarea: avisa. Una **restricción** sí la mueve,
y cuando entra en conflicto con una dependencia, gana la restricción y se emite
un hallazgo visible. Nunca se te mueve una fecha en silencio.

### Comparar

El diff entre dos cálculos: qué tareas se han movido, cuántos días y cuánto
trabajo ha cambiado. Sirve para lo importante:

1. Congelas el plan de hoy con **Línea base** y le pones nombre.
2. Cargas el proyecto nuevo, o cambias lo que sea.
3. Vuelves aquí y comparas contra la línea base.

Eso es la respuesta a la segunda pregunta, con nombres y fechas.

---

## 4. Los botones de la cabecera

| Botón | Qué hace |
|-------|----------|
| **Importar CSV** | Carga un plan desde un fichero plano |
| **Exportar** | Descarga la carga mensual en CSV, con el identificador del cálculo en cada fila |
| **Línea base** | Congela el cálculo actual con un nombre. Una línea base es un cálculo congelado, no una copia aparte |
| **Nivelar** | Retrasa tareas hasta que el plan quepa en la capacidad del equipo |
| **Recalcular** | Vuelve a calcular. Se usa poco: cada cambio recalcula solo |

### Sobre **Nivelar**

Es una heurística y está declarada como tal. Tres cosas que conviene saber:

1. **No toca el plan original.** Crea un cálculo nuevo. Para ver qué ha costado
   que quepa, compara los dos en la pestaña **Comparar**.
2. **Es determinista.** La misma entrada da el mismo resultado siempre, hasta el
   desempate. No vas a obtener dos planes distintos del mismo botón.
3. **Cuando una asignación no cabe ni sola en la jornada de la persona, lo dice**
   en vez de retrasarla eternamente. Ahí lo que hay que cambiar es la dedicación,
   la duración o el calendario, no la fecha.

---

## 5. Cosas que pasan y qué significan

**«El coste de este proyecto sale a cero.»**
Alguien del equipo no tiene tarifa. Pestaña Equipo, busca el ⚠.

**«He cambiado la duración de una tarea y se ha movido media cartera.»**
Es lo correcto: esa tarea estaba en el camino crítico. El botón **¿por qué?** de
cualquier tarea movida enseña la cadena completa.

**«Ya hay un periodo de disponibilidad que se solapa con esas fechas.»**
Una persona no puede estar al 50 % y al 80 % el mismo día. Borra el tramo
anterior o ajusta las fechas. Lo mismo con las tarifas.

**«He dado de baja a alguien y sus tareas siguen ahí.»**
Correcto. La baja es lógica: la persona deja de contar en los cálculos nuevos,
pero nada se borra y los cálculos ya hechos se siguen explicando igual. Sus
tareas se quedan sin asignar y aparecen como tales.

**«El número de la pantalla no coincide con el del Excel que exporté ayer.»**
Mira el identificador de ejecución: la cabecera lo enseña y el CSV exportado lo
lleva en cada fila. Si son distintos, son dos cálculos distintos, y la pestaña
**Comparar** te dice exactamente en qué se diferencian.

---

## 6. Lo que la herramienta no hace, y no por descuido

- **No escribe ficheros `.mpp`.** Exporta CSV, que es lo que de verdad se usa.
- **No reasigna trabajo sola.** Nivelar retrasa; no decide quién hace qué. Esa
  decisión es tuya.
- **No adivina.** Un dato que no has declarado no se inventa: se queda vacío y,
  si afecta a un resultado, sale un hallazgo.
