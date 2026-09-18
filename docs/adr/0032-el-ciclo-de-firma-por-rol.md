# ADR-0032 — El ciclo de firma de cada entregable, por rol y nunca por persona

**Estado:** aceptada · **Fecha:** 2026-09-18 · **Principios:** P1, P2, P5, P6

## Contexto

Los dos procedimientos del departamento traen la misma tabla, columna a columna:

| Entregable | Autor | Verificador 1 | Verificador 2 | Aprobador | Revisores |
|---|---|---|---|---|---|
| Plan RAM | Ing. RAMS | Ing. Sistemas | Jefe RAMS | PrEM | Calidad, Compras… |
| Informes de reparto | Ing. RAMS 1 | Ing. RAMS 2 | Ing. Sistemas | PrEM | |

La herramienta no sabía nada de eso. Sabía que un documento espera a otro y
nada más: para ella un entregable era trabajo de una sola persona, y una
verificación —que es esfuerzo de una segunda— no existía en ninguna parte.

Es la capacidad que los procedimientos exponen y que el catálogo no podía
modelar. La decisión D-DATOS la enmarcó: **ninguna información concreta entra,
pero sí la maquinaria para manejar lo que el libro expone**.

## Decisión

Un entregable declara su ciclo de firma: quién lo escribe, quién lo verifica
—hasta dos veces—, quién lo aprueba y a quién se convoca. **Por rol.**

### El rol, y sólo el rol

No hay ninguna referencia a `resource` en `document_signature`, y no la va a
haber. Quién ocupa hoy el puesto de «Jefe RAMS» es un dato de personas que
cambia, se discute y no pinta nada en un catálogo que describe **cómo trabaja
el equipo**. El catálogo dice que hace falta un jefe RAMS distinto del autor;
quién sea ese día lo dice el plan del proyecto.

Eso resuelve además lo que D-DATOS pedía sin tener que pedir permiso: la
maquinaria se puede construir, probar, importar y enseñar sin un solo dato
personal. Los datos de demostración llevan roles inventados —«Ing. de
seguridad», «Jefe de ingeniería»— y ni un nombre de nadie.

### La independencia se mide entre nombres de rol

Y eso no es una simplificación: es exactamente como lo escriben los
procedimientos. Cuando hace falta que verifique otra persona del mismo puesto
ponen «RAMS Engineer 1» y «RAMS Engineer 2», que son dos roles distintos aunque
sea el mismo puesto. Un catálogo que pone el mismo texto en las dos casillas
está diciendo que firma dos veces el mismo, y eso es lo que se avisa.

`checkSignatureCycle` comprueba cinco cosas, y todas salieron de leer los
procedimientos, no de imaginar qué podría fallar:

| Código | Qué caza |
|---|---|
| `SIGNATURE_NO_AUTHOR` | Alguien verifica lo que nadie escribe |
| `SIGNATURE_NO_APPROVER` | El entregable no se puede cerrar |
| `SIGNATURE_NOT_INDEPENDENT` | El autor se verifica o se aprueba a sí mismo |
| `SIGNATURE_ROLE_REPEATED` | Una firma escrita dos veces, no dos firmas |
| `SIGNATURE_ON_CONTAINER` | Una fase o un hito con ciclo: fila mal tipada |

**Un entregable sin ninguna firma no da ningún problema.** No está mal
rellenado: está sin rellenar, y son dos cosas distintas.

### Avisa, no impide

Un ciclo mal repartido **se guarda**. Es la misma decisión que ADR-0016 tomó con
los ciclos de la matriz y por el mismo motivo: un catálogo a medio rellenar es
el estado normal de un catálogo el primer día, y una herramienta que se niega a
guardarlo es una herramienta que no se usa. Lo único que se rechaza es la
casilla repetida —dos firmas para el mismo paso y la misma posición—, porque eso
no es un catálogo incompleto sino un cuerpo que se contradice, y guardarlo
dejaría una de las dos en la base sin decir cuál.

### El servidor calcula, el diccionario escribe

Los problemas se calculan en la API y viajan como **código + datos**, igual que
los hallazgos, los permisos y los errores. La alternativa era que el paquete
`web` se trajera `domain` para repetir la comprobación en el cliente, y una
regla escrita dos veces es una regla que se separa.

Los avisos de la **importación** sí llevan la frase hecha en castellano, igual
que los de ciclo de la matriz: el resumen de una importación es un texto que se
lee una vez y se cierra, no una pantalla que vive en cuatro idiomas.

### El CSV lleva los roles; los minutos, no

Cinco columnas nuevas —`autor`, `verificador_1`, `verificador_2`, `aprobador`,
`revisores`— con la misma regla que `espera_a`: **las columnas ausentes no tocan
el ciclo, las columnas vacías lo borran.** Exportar, corregir en la hoja y
volver a importar da el mismo catálogo; hay una prueba que lo comprueba.

Los minutos de cada firma no viajan en el CSV. Serían cinco columnas más para un
dato que casi nadie tiene el primer día y que se rellena mejor en la ficha, una
a una, que en una hoja de ochenta filas.

### Lo que este ADR NO hace

**El esfuerzo de las firmas no entra en la carga de nadie.** El dato se declara
y se puede ver; el motor no lo suma. Meterlo en el cálculo cambia las cifras de
todas las pantallas —la ocupación, el hueco, quién va pasado— y eso es una
decisión con su propio ADR, no un efecto secundario de una migración.

Tampoco se reparte una firma entre personas ni se crea una tarea por rol. Para
eso hace falta primero decidir cómo se traduce un rol a una persona en un
proyecto concreto, que es justo lo que el catálogo se niega a saber.

## Alternativas descartadas

**Una enumeración de roles en la base.** Cada sitio tiene los suyos y añadir uno
obligaría a migrar. Texto libre, igual que `discipline`, por la misma razón.

**Firmas apuntando a `resource`.** Es lo que D-DATOS descartó explícitamente, y
además rompería el catálogo: es del equipo y no de un proyecto, y las personas
entran y salen.

**Una tabla de firmas que crece sin límite en la pantalla.** La base admite
cualquier número de verificadores; la ficha ofrece cuatro casillas fijas y la
lista de revisores, porque es lo que tienen los procedimientos que dieron pie a
esto. El día que haga falta un tercer verificador, el dato ya cabe y lo que
cambia es la pantalla.

## Consecuencias

`checkSignatureCycle` vive en `domain` con quince pruebas, la escritura tiene
cinco contra PostgreSQL y el recorrido entero —importar, exportar, reimportar,
permisos— otras seis. Son veintiséis porque la regla de independencia es la
clase de cosa que parece obvia hasta que alguien escribe «RAMS Engineer 2» y hay
que decidir si eso es el mismo rol.

Queda abierto y anotado: si un día las firmas entran en la carga, la pregunta
que habrá que contestar antes es cómo se convierte un rol en una persona.
