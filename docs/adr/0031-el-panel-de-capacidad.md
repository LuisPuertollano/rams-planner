# ADR-0031 — El panel de capacidad, copiado del libro que ya se usaba

**Estado:** aceptada · **Fecha:** 2026-09-18 · **Principios:** P1, P2, P5, P7

## Contexto

El departamento lleva años planificando con un libro de Excel. Su primera hoja,
`01_Dashboard_Overview`, es lo que la gente mira: seis cifras arriba, dos
segmentadores (proyecto y tipo de compromiso), y debajo dos tablas que en el
libro están **vacías**, con un rótulo que dice lo que tendrían que contener:

- «PRÓXIMAS TAREAS (10–20 en próximos 15 días) – tabla placeholder»
- «TABLA DETALLE (para planners) – placeholder»

Esas dos tablas no se rellenaron nunca porque rellenarlas a mano, cada semana,
para veintitantas personas, no lo hace nadie. Son exactamente lo que un motor
que ya calcula la carga día a día puede escribir solo.

La herramienta, mientras tanto, tenía las tres pantallas del detalle —Carga,
Saturación, Reparto— pero ninguna portada del grupo: había que saber en cuál
mirar antes de saber si había un problema.

## Decisión

**El panel reproduce la hoja, no la reinventa.** Mismas seis cifras
—Capacidad · Demanda · Ocupación · Hueco · Por encima · Por debajo—, mismos
umbrales —`< 80 %` por debajo, `> 100 %` por encima—, mismos segmentadores, y
las dos tablas del libro rellenadas con lo que el motor ya sabe. Quien venía del
Excel reconoce la pantalla; lo que cambia es que ahora está entera.

Va **primero** en el grupo Capacidad: contesta «¿cabe el trabajo?» de un
vistazo, y las otras tres pantallas son el detalle de esa misma pregunta.

### Tres decisiones que la aritmética obliga a tomar

**Filtrar por proyecto acota la demanda, no la capacidad.** La capacidad es de
la persona, no del proyecto: nadie tiene «180 h de CBTC-L3». Al filtrar, la
demanda baja y la ocupación con ella; es correcto y es confuso, así que la
pantalla lo dice en una línea bajo el filtro en vez de dejar que se adivine.

**Solo cuentan los meses con trabajo.** Promediar la ocupación sobre meses
vacíos la diluye hasta que no significa nada. Un mes sin demanda no es un mes
al 0 %: es un mes que no entra en la media.

**Capacidad cero no es ocupación infinita.** `proporcion()` devuelve `null`, y
la pantalla escribe un guion. Una persona sin calendario no está sobrecargada:
está sin calendario, que es otro problema y de otra pantalla.

### El panel no lleva la fila global de cifras

`nav.ts` lo marca con `sinCifras: true`. La fila global cuenta personas
sobrecargadas **por día** a partir de los hallazgos; el panel cuenta personas
por encima **por mes**. Ambas son correctas y dan números distintos, y dejarlas
juntas ponía «Personas sobrecargadas 6» diez centímetros encima de «Por encima
0». Es la misma contradicción que ADR-0029 arregló en la portada, resuelta aquí
al revés: la portada unificó la medida; el panel, que tiene seis cifras propias
y su propia línea de frescura, se queda con las suyas y retira la ajena.

### Las gráficas usan un solo tono, no la rampa de Saturación

La rampa actual de utilización **no pasa** el suelo de separación para visión
normal: entre `#9ec3e6` (holgado) y `#7fc4a8` (equilibrado) hay ΔE 10,1, por
debajo del mínimo de 15, y el suelo de croma falla en tres escalones. Repintarla
es repintar una pantalla que ya se usa a diario, así que aquí **no se toca**: el
panel es nuevo y puede nacer bien, con un solo tono por magnitud y líneas de
referencia en el 80 % y el 100 % para la polaridad. Queda anotado como hallazgo
abierto sobre Saturación, no resuelto de tapadillo.

## Consecuencias

La aritmética vive en `panel-cifras.ts`, aparte de la pantalla, porque una
media ponderada que nadie puede probar es una media en la que nadie confía: once
pruebas cubren los dos criterios de arriba, los umbrales, la capacidad nula, el
orden y la ventana de quince días.

Lo que el panel **no** hace: no guarda estado, no tiene ajustes y no inventa
ninguna cifra que no salga de un `run`. Todo lo que muestra se puede rastrear
hasta las celdas de `load` y `utilization` del cálculo que tiene delante, y la
línea de frescura dice de cuándo es ese cálculo.

Queda pendiente y anotado: proponer el re-escalado de la rampa de utilización
—decisión suya, porque cambia una pantalla que ya mira todos los días.
