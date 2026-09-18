# ADR-0030 — Ni una frase de la interfaz escrita a mano

**Estado:** aceptada · **Fecha:** 2026-09-18 · **Principios:** P1, P6

## Contexto

La herramienta tiene cuatro idiomas y un diccionario tipado en el que una
traducción incompleta **no compila**. Eso garantiza que ninguna clave falte. No
garantiza nada sobre las frases que nunca llegaron a ser clave.

Y eran muchas: **296 sitios** repartidos por diecisiete pantallas —245 cadenas
distintas—, escritas directamente en el JSX:

```tsx
<th>Recurso</th>
<button title="Quitar de la tarea">✕</button>
<h3>Todavía no hay carga que mostrar</h3>
```

Más los mapas de etiquetas, que eran el mismo problema con otra ropa: el nombre
de cada regla en el panel «¿por qué?», el de cada tabla en el registro de
cambios, el de cada tipo de ausencia, el de cada nivel de competencia.

Todo eso compila, pasa las pruebas, y se queda en castellano en medio de una
pantalla en alemán. Nadie lo ve hasta que lo ve un cliente.

Traducirlo es trabajo de una tarde. Lo que cuesta es que la columna número 297
no vuelva a nacer escrita a mano, que es como nacieron las 296.

## Decisión

**Las 296 van al diccionario**, en los cuatro idiomas. Las que se repetían
—`Recurso`, `Persona`, `Desde`, `Hasta`, `Guardar`— pasan a una familia
`col.*` y `boton.*` compartida: la misma columna llamada de dos maneras en dos
pantallas es la clase de detalle que hace dudar de si son la misma cosa.

**Los mapas de etiquetas pasan al patrón que ya usaban los hallazgos, los
permisos y los errores**: el código es el contrato —`FS_LINK`, `wbs_node`,
`vacation`— y la frase la escribe el diccionario, con `existeClave()` como
respaldo. Lo que no esté traducido sale con su nombre técnico, que es feo pero
no miente; y un código nuevo del motor aparece con el suyo en vez de
desaparecer.

**Y una sexta regla en `tools/`, `check:literales`**, que falla la compilación
si alguien vuelve a escribir una frase en el JSX. Es la cuarta de la misma
familia —hallazgos, permisos, errores, literales— y la que faltaba: las otras
tres vigilan lo que el servidor manda; ésta, lo que la pantalla escribe por su
cuenta.

Tiene coartada, y se pide con razón escrita:

```tsx
{/* texto-fijo: es el código del hallazgo, el mismo en los cuatro idiomas */}
<div className="finding__code">REBALANCE_NO_CANDIDATE</div>
```

`texto-fijo:` sin motivo detrás no vale. La excepción sin razón es la puerta por
la que vuelve a entrar todo.

## Consecuencias

**Esta regla usa el analizador de TypeScript, y las otras cinco no.** Las demás
leen el fuente del disco con expresiones regulares y lo dicen como una virtud:
no compilan nada y no cruzan paquetes. Aquí no se puede. Con expresiones
regulares, `<th>Recurso</th>` es indistinguible de `Promise<void>` y de
`if (a > b && c < d)`: los dos son «un `>`, letras, un `<`». La primera versión
de esta regla, con regex, daba dieciséis falsos positivos sobre diecisiete
ficheros. Una regla que avisa de lo que no es se desactiva en una semana, y
entonces no hay regla. `ts.createSourceFile` sigue leyendo un fichero del disco
—no compila el proyecto ni importa nada de otro paquete—, así que el espíritu de
`tools/` se respeta y la letra se ajusta.

La coartada se busca **por líneas**, no por el árbol. En JSX, un
`{/* … */}` no es trivia del nodo siguiente sino un hermano, así que subir por
los padres no lo encuentra nunca; mirar la línea del literal y la de arriba, sí,
y es donde lo escribe quien lo escribe.

El contrato de las importaciones (ADR-0028) sigue siendo la excepción conocida:
su prosa vive en la API y llega en castellano, con el mismo respaldo
`existeClave()`. No es un literal de la interfaz, y por eso esta regla no lo ve.

## Alternativas descartadas

**Un trinquete, como la cobertura.** La regla fallaría sólo si el número sube,
y el barrido se haría poco a poco. Es la opción cómoda y es la que deja 296
frases sin traducir durante un año: un trinquete que empieza en 296 no
convence a nadie de bajarlo a 295.

**Una librería de i18n con extracción automática.** Extrae las cadenas del
código y genera los ficheros, que es exactamente lo que este repositorio ya hace
a mano en cincuenta líneas sin dependencias. Y no resuelve el problema de fondo:
extraer no impide volver a escribir.

**Marcar las cadenas con una función `sinTraducir('…')`.** Hace explícito lo que
no se traduce, pero convierte cada cabecera de tabla en una llamada a función y
no impide nada: quien escribe `<th>Recurso</th>` no iba a escribir
`<th>{sinTraducir('Recurso')}</th>` tampoco.
