# ADR-0002 · Aritmética entera en todo el núcleo

**Estado:** aceptada · **Fecha:** 2026-09-16

## Contexto

Un plan agrega miles de celdas: minutos por día, por semana, por mes, por
proyecto, por persona. Cualquier error de redondeo se acumula, y «0,4 horas de
diferencia» destruye la confianza en un informe tan eficazmente como un error
lógico, pero cuesta el triple diagnosticarlo.

## Decisión

Toda magnitud del núcleo es un entero: **minutos laborables**, **céntimos** y
**puntos base** (10000 = 100 %). Los tipos son nominales, de modo que el
compilador impide mezclarlos. Las operaciones que podrían perder exactitud en
coma flotante (`applyBasisPoints`, `distributeInteger`, el formateo) se calculan
con `BigInt` por dentro.

El reparto de un total entre cubos usa el **método de los restos mayores con
desempate por índice ascendente**, lo que garantiza dos cosas a la vez: que la
suma del reparto es exactamente el total, y que el resultado no depende del orden
de iteración (P2). Hay una prueba de propiedades que lo verifica sobre miles de
casos generados.

## Alternativas descartadas

- **`NUMERIC(10,2)` en horas.** Arrastra redondeos en cuanto se agrega.
- **Coma flotante.** Inaceptable para dinero y para sumas largas.

## Coste aceptado

Conversiones en el borde de presentación y un tipo nominal por unidad. Un único
módulo (`packages/domain/src/format.ts`) está autorizado a producir decimales.
