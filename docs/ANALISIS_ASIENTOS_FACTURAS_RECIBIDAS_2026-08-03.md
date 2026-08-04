# Análisis de asientos de facturas recibidas — 3 de agosto de 2026

## Objetivo

Este documento fija la evidencia obtenida al comparar facturas recibidas y sus
asientos reales en el clon de Netagro. La investigación fue exclusivamente de
lectura. No se modificaron cabeceras, asientos, apuntes, contadores ni tablas.

La finalidad es distinguir:

- lo que puede previsualizar el frontend;
- lo que debe resolver el servidor antes de contabilizar;
- lo que todavía requiere el mecanismo oficial de Netagro.

## Patrón contable confirmado

Para una factura positiva ordinaria, el asiento visible sigue este orden:

1. Cuenta del proveedor por el total de la factura en el Haber.
2. Una línea por cada cuenta de gasto en el Debe.
3. Una línea por cada cuota de IVA no nula en el Debe.
4. Una línea de retención en el Haber cuando corresponda.

El concepto observado es `FRA. <nombre del proveedor>` y el documento coincide
con `FRR_numerofactura`.

Los abonos no intercambian Debe y Haber. Netagro conserva el lado natural y
guarda el importe con signo negativo. En la factura `C/29` (`FRR_id=49717`):

- proveedor: Haber `-417,45`;
- gasto: Debe `-345,00`;
- IVA: Debe `-72,45`.

## Facturas contrastadas

| FRR_id | Documento | Caso | Líneas relevantes |
| ---: | --- | --- | --- |
| 49305 | A-00748886 | ONDUSPAN, 21 % | proveedor `41000000017`; gasto `60200000001`; IVA `47200000008` |
| 49712 | EXP 124.007 | Sin IVA | proveedor y gasto; no crea línea de IVA con cuota cero |
| 49710 | 39/2026 | 4 % y descuento | gasto positivo, descuento como Debe negativo e IVA `47200000004` |
| 48895 | FVC26-002467 | 10 % + 21 % | crea una línea por cada cuota: `47200000005` y `47200000008` |
| 49326 | 02/2026 | 12 % + retención 2 % | IVA `47200000007`; retención `47510000000` |
| 49702 | 1 000008 | 21 % + retención 19 % | IVA `47200000008`; retención `47510000003` |
| 49717 | C/29 | Abono | mantiene valores negativos en el lado natural |

## Cuentas de IVA: dependen del régimen

No es correcto resolver la cuenta únicamente con el porcentaje. El análisis
histórico de cuotas no nulas muestra estas cuentas dominantes:

| IVA | Cuenta dominante | Usos coincidentes | Observación |
| ---: | --- | ---: | --- |
| 2 % | `47200000009` | 391 | existen 14 apuntes antiguos en `47200000004` |
| 4 % | `47200000004` | 5.435 | existen cinco excepciones históricas |
| 5 % | `47200000011` | 64 | correspondencia observada única |
| 10 % | `47200000005` | 6.218 | el régimen 2113 usa cuenta intracomunitaria |
| 12 % | `47200000007` | 11 | correspondencia observada única |
| 21 % | `47200000008` | 29.277 | no es universal |

Excepciones estructurales confirmadas para el 21 %:

- régimen `2113`: `47200000010 — IVA INTRACOMUNITARIO`;
- régimen `3111`: `47200000013 — IVA SOPORTADO 21%`;
- resto de circuitos ordinarios: normalmente `47200000008`.

Por tanto, la clave de resolución mínima es:

`empresa + régimen + porcentaje + circuito/tipo de factura`

El frontend no debe hardcodear una cuenta basándose solo en el porcentaje. La
previsualización puede dejar la cuenta pendiente; el servidor deberá resolverla
y validar que existe en el esquema contable de la empresa.

## Actividad y sección

`Act.` y `Secc.` tampoco pueden fijarse ambas globalmente a `1`.

Distribución observada en apuntes cuyo origen es `FR`:

| Actividad | Sección | Líneas |
| ---: | ---: | ---: |
| 1 | 1 | 140.408 |
| 2 | 1 | 26.788 |
| 2 | 0 | 1 |

La sección `1` es prácticamente universal. La actividad puede ser `1` o `2` y
se relaciona en gran medida con `FRR_IdActividad`, aunque las cabeceras con cero
necesitan una regla de resolución adicional. No debe imponerse `1` sin validar
el circuito y los datos maestros.

## Retenciones

La cuenta de retención tampoco depende únicamente del porcentaje:

- agricultores: `47510000000 — RETENCIONES AGRICULTORES`;
- profesionales: `47510000002 — RETENCIONES PROFESIONALES`;
- arrendamientos: `47510000003 — RETENCIONES ARRENDAMIENTO`.

Antes de contabilizar debe existir una categoría o clave IRPF inequívoca. Una
cuota y un porcentaje, por sí solos, no bastan para elegir la cuenta.

## Registro fiscal y relación con el asiento

La línea del proveedor es además el punto de enlace fiscal:

- `facturasrecibidas.FRR_IdAsientoNet -> contabilidad.asientos.IdAsiento`;
- las líneas están en `contabilidad.asientolineas`;
- `contabilidad.ivasoportado.IdRegistro` coincide con el `IdApunte` de la línea
  del proveedor y conserva hasta cinco bases, porcentajes y cuotas, además de
  retención y cuota no deducible.

Crear solamente tres filas visibles de Debe/Haber no reproduce una
contabilización completa. También intervienen numeración, apuntes, registro
fiscal, posibles vencimientos/cartera, contadores y readback.

## Estado actual del writer

Actualización del 4 de agosto de 2026: el writer v3 de FastAPI mantiene dos
transacciones independientes.

- El alta de gestión crea cabecera, CTB y punteos y fuerza
  `FRR_Contabilizar='N'`.
- Tras confirmar esa alta, `POST /facturasrecibidas/{id}/contabilizar` puede
  crear asiento, apuntes, IVA soportado y enlazar la cabecera, exclusivamente en
  el clon persistente TEST y para el perfil `ot-2110-single-21-v1`.
- La operación usa otra identidad MariaDB, una sola transacción, idempotencia
  externa y readback exacto.
- El canario `49723` confirmó el asiento técnico `394936`, visible `53344`, con
  tres apuntes y Debe/Haber de `121,00`.

La ausencia de triggers o rutina oficial sigue siendo un hecho. La decisión
actual no es permitir SQL contable general: únicamente se admite el DML exacto
homologado en el clon TEST identificado. Continúan prohibidos DDL, borrados,
producción, perfiles inferidos y permisos más amplios.

## Decisión de interfaz

La factura muestra un botón `Ver asiento` en la cabecera:

- si existe asiento real, presenta exclusivamente el readback de Netagro;
- si todavía es un borrador, construye una previsualización en memoria con
  proveedor, gastos, cuotas y retención;
- las cuentas de IVA/retención y dimensiones no demostrables permanecen sin
  inventar;
- la tabla ya no ocupa permanentemente el final del formulario.

La previsualización no es una promesa de contabilización. La validación del
servidor sigue siendo autoritativa y resuelve las cuentas, dimensiones e
identidad exactas antes de abrir el commit contable.

## Siguiente gate para contabilizar

Para que una única acción de usuario pueda registrar y contabilizar, la
orquestación interna deberá mantener dos fases:

1. alta de gestión idempotente y readback de `facturasrecibidas`;
2. contabilización oficial idempotente y readback de asiento, apuntes y fiscal.

Solo se mostrará como contabilizada cuando el asiento exista, su origen sea
`FR`, el `idorigen` coincida con la factura, Debe y Haber cuadren y el registro
de `ivasoportado` coincida con los tramos y retenciones enviados.
