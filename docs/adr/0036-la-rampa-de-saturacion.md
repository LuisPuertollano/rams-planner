# ADR-0036 — La rampa de saturación se mide, no se mira

**Estado:** aceptada · **Fecha:** 2026-09-18 · **Principios:** P1, P4, P6

## Contexto

La tabla de saturación pinta cada mes de cada persona con uno de cinco colores
—`--util-low`, `--util-ok`, `--util-full`, `--util-over`, `--util-critical`— y
escribe dentro el porcentaje. Es la vista que más se mira y la que peor estaba
pintada. La rampa que había:

```
#9ec3e6  #7fc4a8  #e8c98a  #e59a72  #cf6b5a
 azul     verde    ámbar    naranja   rojo
```

Tiene tres defectos, y los tres se pueden medir:

1. **Ámbar en el centro.** Una escala divergente dice «por debajo» a un lado,
   «por encima» al otro y «en la raya» en medio. El medio tiene que ser neutro:
   un tono ahí compite con los dos polos por la atención y el ojo deja de saber
   hacia dónde mirar. `#e8c98a` tiene croma 0,088 en OKLab.
2. **La luminosidad daba un paso atrás.** En una divergente sobre papel el
   centro es el más claro y la luminosidad cae hacia los dos polos sin volver
   atrás. La vieja iba `0,802 · 0,766 · 0,848 · 0,752 · 0,640`: de «holgado» a
   «equilibrado» **bajaba**, y en el centro pegaba un salto hacia arriba. La
   escala se leía torcida justo en el tramo que más se mira.
3. **Verde / ámbar / naranja / rojo seguidos.** Es exactamente la secuencia que
   una deuteranopia o una protanopia —en torno al 8 % de los hombres— convierte
   en cuatro tonos de la misma cosa. Cuatro de los cinco escalones.

Y un cuarto que apareció al medir el **repintado**, no la rampa vieja: el primer
`--util-critical` que dibujé, `#c55247`, daba 3,95:1 con el texto oscuro, por
debajo del 4,5:1 de WCAG AA. **La celda que más urge leer iba a ser la que peor
se leyera**, y eso no se ve mirando: se ve contando.

### Una corrección de algo que dije antes

En el primer análisis apunté que la rampa fallaba el suelo ΔE ≥ 15 entre
vecinos. **Ese criterio no aplica aquí.** El ΔE ≥ 15 es para **paletas
categóricas**, donde dos series no tienen nada que ver y confundirlas es
confundir dos cosas distintas. En una rampa los vecinos se parecen **a
propósito**, porque representan cantidades vecinas: 59 % y 61 % deben verse
parecidos. Lo que sí hay que exigir —y se exige— es que **los dos polos** se
separen de sobra. Los tres defectos de arriba son reales; aquél no lo era.

## Decisión

**Dos tonos y un gris, con la luminosidad caminando hacia el centro sin volver
atrás.**

| | claro | oscuro |
|---|---|---|
| `--util-low` (< 60 %) | `#418ad1` | `#2d6ca8` |
| `--util-ok` (equilibrado) | `#88b1db` | `#2f4e6e` |
| `--util-full` (~100 %) | `#d3dae1` | `#2e3237` |
| `--util-over` (pasado) | `#de9480` | `#7b3d2e` |
| `--util-critical` (> 130 %) | `#d35e52` | `#b44238` |

Azul hacia abajo, rojo hacia arriba, gris en la raya. El verde desaparece: era
la mitad de la trampa de la 3, y además decía «bien» de un 20 % de ocupación,
que no es bien, es hueco.

**En oscuro la rampa es la misma decisión al revés.** No es un volteo
automático: sobre fondo negro el centro es el **más oscuro** y los polos
levantan. Los cinco pasos oscuros están elegidos uno a uno y medidos contra el
fondo oscuro, no derivados de los claros.

`--util-idle` queda fuera de la rampa a propósito: no es «poca saturación», es
**ninguna** —cero o sin dato—, y por eso es gris y no un azul pálido.

### El número de dentro pasa WCAG AA en los diez pasos

`--util-critical` se movió hasta que el porcentaje se leyera: `#d35e52` da
4,64:1 en claro y `#b44238` da 4,61:1 en oscuro. El peor de los diez escalones
está en 4,56:1. La celda lleva la cifra escrita **porque el color no puede ser
la única forma de saber qué pone** —quien no distingue el rojo del gris sigue
leyendo 131 %—, y un número que no se lee deja la celda en color a secas.

### Una regla más en `tools/`, la séptima

`pnpm check:rampa` lee `packages/web/src/styles.css`, saca las **tres** rampas
—el claro, el `prefers-color-scheme: dark` y el tema oscuro explícito— y mide
cada una:

| código | qué caza |
|---|---|
| `escalon-que-falta` | un bloque que declara cuatro de los cinco |
| `centro-con-tono` | croma del centro ≥ 0,03 |
| `luminosidad-torcida` | la luminosidad no camina hacia el centro |
| `numero-que-no-se-lee` | un escalón bajo 4,5:1 con el `--text` de su bloque |
| `polos-juntos` | los dos extremos a menos de ΔE 20 |

Las tres rampas se miden por separado porque **repintar y olvidarse de una es el
fallo que iba a pasar**. Y hay una prueba que comprueba que la rampa vieja
**falla**, y falla diciendo sus dos razones: si esa prueba deja de fallar, la
regla ya no está midiendo nada.

### Un anillo en la casilla de la leyenda

El centro neutro se hunde en el fondo a propósito —eso es lo que se quiere
dentro de la tabla, para que el ojo se vaya a los extremos— y en la leyenda eso
lo convertía en un hueco donde debería haber una casilla. Un `inset` de 1 px con
el color del borde lo devuelve a ser una casilla sin tocar el color.

## Alternativas descartadas

**Semáforo verde-ámbar-rojo.** Es lo que todo el mundo espera y lo que menos
gente puede leer. Además no es divergente: no tiene centro, y aquí el centro
—el 100 %— es el dato.

**Voltear la rampa clara para el oscuro.** Sale sola y sale mal: los colores
claros sobre fondo oscuro deslumbran y el contraste del número se va al garete.
Diez pasos elegidos, no cinco y un `invert()`.

**Dejarlo en el ojo y no escribir la regla.** Es lo que llevó a la rampa vieja.
El color es de lo poco de una interfaz que se puede calcular; lo que se puede
calcular no se discute.

**Añadir textura a los extremos** para el caso daltónico. La casilla ya lleva el
número dentro, que es la segunda codificación que hace falta. La textura queda
apuntada para cuando la vista se imprima.

## Consecuencias

La rampa dejó de poder repintarse a ojo: cualquier cambio en los cinco
`--util-*` pasa por `check:rampa` en CI, en el mismo sitio que las otras seis
reglas. Mirado en el navegador —Chromium, porque el navegador interno de Claude
no está disponible en este contenedor— en los dos temas, con cero errores de
consola.

Queda fuera de este ADR el resto de la paleta: los colores de severidad
(`--severity-*`) y el acento no se han tocado, y no están medidos por nada.
