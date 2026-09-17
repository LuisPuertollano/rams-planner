# ADR-0021 — El catálogo de permisos, en cuatro idiomas

**Estado:** aceptada · **Fecha:** 2026-09-17 · **Principios:** P1

## Contexto

[ADR-0020](0020-hallazgos-traducidos.md) resolvió los hallazgos y dejó dos
cosas: las etiquetas del catálogo de permisos y los errores de la API. Esto es
la primera.

La hoja de permisos es **lo que lee quien reparte el acceso**: treinta y dos
funciones, cada una con su etiqueta y con el detalle que explica por qué
importa. Una casilla cuyo texto no entiendes es una casilla que marcas a
ciegas, y lo que hay al otro lado no es cosmético: es lo que la API deja o no
deja hacer.

## Decisión

El mismo mecanismo que ADR-0020, sin inventar nada nuevo: **el código es el
contrato**. El servidor manda el catálogo con su `code`, su `scope` y su
pantalla, y la etiqueta castellana como respaldo; el texto que se lee sale del
diccionario, con la clave `permiso.<code>` y `permiso.<code>.detalle`.

La regla que lo mantiene al día es la gemela de la de los hallazgos:
`pnpm check:permisos`, en `tools/`, leyendo `permissions.ts` y el diccionario
del disco, en los dos sentidos y sin compilar nada.

### La etiqueta castellana sigue viviendo en el catálogo

Podría haberse quitado de `permissions.ts` al tenerla en el diccionario, y no
se quita por dos razones. Es el **respaldo** para un permiso que esta versión de
la interfaz no conozca todavía, igual que en los hallazgos. Y es la
**documentación del catálogo**: quien lee `permissions.ts` para añadir un
permiso tiene que entender ahí mismo qué significan los de al lado, sin ir a
buscar cuatro ficheros de traducciones.

### Los nombres de los roles **no** se traducen

Y no es un olvido. `Lectura`, `Planificación`, `Responsable` son datos de la
base: los pone el equipo, los cambia el equipo y pueden ser cinco o quince. Lo
mismo con los códigos de proyecto y los nombres de las personas.

Traducirlos exigiría una tabla de traducciones por fila, que nadie mantendría,
para acabar enseñando un nombre que su dueño no reconoce. Un rol que el equipo
llamó `Verantwortlicher` se llama así en las cuatro pantallas (P1: lo declarado
es de quien lo declara).

### La pantalla entera, no media

Se traducen también los nombres de las diez pantallas que agrupan las
funciones, y el resto del armazón de la vista: las dos pestañas, los párrafos
que explican cómo se suman los roles, las cabeceras, los botones y los
`prompt` de alta de usuario y de rol.

Dejar la segunda pestaña en castellano dentro de una primera en alemán habría
sido peor que no empezar: media pantalla traducida se lee como un error, no
como un trabajo en curso.

## Alternativas descartadas

**Servir el catálogo ya traducido**, según el idioma de la sesión. El catálogo
es el mismo objeto que usa el guardián para decidir si una petición pasa;
hacerlo depender del idioma de quien pregunta mete una variable en el sitio
donde menos conviene tenerla.

**Mover las etiquetas al diccionario y quitarlas del catálogo.** Deja
`permissions.ts` —que es la fuente única de lo que se puede hacer— sin una
palabra que explique qué es cada cosa.

## Coste aceptado

- Un permiso nuevo obliga a tocar el catálogo y cuatro diccionarios. Lo obliga
  CI.
- El detalle es lo más largo de traducir y es lo que más importa: es la
  diferencia entre marcar una casilla y decidir.
- Queda el último trozo de ADR-0017: los errores de la API. Son el más
  incómodo, porque muchos no tienen todavía un `code` estable y hay que dárselo
  antes de poder traducirlos.
