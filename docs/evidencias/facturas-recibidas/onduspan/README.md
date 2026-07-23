# Evidencias del caso Onduspan y liquidación de agricultor

Estos archivos fueron facilitados por el usuario como contexto funcional para el
diagnóstico de facturas recibidas. Se conservan en el repositorio para que futuras
sesiones puedan contrastar PDF, pantalla ERP, correo y modelo de la aplicación sin
depender de adjuntos temporales de Codex.

## Archivos

### `factura-onduspan-A-00748886.pdf`

Factura escaneada de cuatro páginas de `ONDUSPAN, S.A.` a Campojoyma.

Datos principales visibles:

```text
Factura:       A-00748886
Fecha:         30/06/2026
Base:          42.341,52 EUR
IVA 21 %:       8.891,72 EUR
Total:         51.233,24 EUR
Vencimiento:   29/08/2026, según el PDF
```

SHA-256 del original recibido:

```text
9EAE6AF985B21C34986B8D522A7BCFEBE3F5EAE307BBAE91E98C5FE3D2C8AF7F
```

### `pantalla-erp-onduspan-A-00748886.png`

Captura del registro ya contabilizado/registrado en el ERP. Permite contrastar
entrada, ejercicio, proveedor, régimen, gasto, albaranes, asiento y total con la
API.

SHA-256 del original recibido:

```text
A50DB6A45CCB8DD2326C6FE5620A911112860F85BD5E2D51F5A5BC123A58CAE8
```

### `correo-campojoyma-tipos-y-cuentas-2026-07-07.txt`

Cadena de correo en la que Campojoyma proporciona descripciones parciales de los
tipos `OT`, `GE`, `MA`, `GV`, `GC`, `FZ` y `CX`, y explica las cuentas utilizadas
en liquidaciones de agricultores.

El correo no define reglas completas para decidir cada tipo y deja `FI`, `CE` y
`GM` sin explicación suficiente. También escribe la cuenta de comisión como
`6000000010`, mientras la captura muestra aparentemente `60000000010`; debe
prevalecer el dato confirmado por API/ERP.

SHA-256 del original recibido:

```text
525F969AAF67B2571685F0D3EBB3CC2D8A5C4133CEC6CB055A96614E0177FB4A
```

### `captura-liquidacion-agricultor-desglose.png`

Captura de una liquidación de agricultor que muestra dos líneas utilizadas para
construir la base:

```text
40090002095     79.278,36
60000000010     -3.171,13
Base            76.107,23
IVA 4 %          3.044,29
Total           79.151,52
```

No debe interpretarse automáticamente como un asiento oficial Debe/Haber ni como
CTB. Es un caso diferente al proveedor acreedor Onduspan.

El usuario adjuntó dos imágenes distintas por nombre, pero eran copias binarias
idénticas. Se conserva una sola para evitar duplicidad. Ambas tenían este SHA-256:

```text
4A59E42F5C484BE49C553F121048928CD48FBFD18AD095D50FCFDCF41C4621B3
```

## Resultado API contrastado

La aceptación de solo lectura confirmó para Onduspan:

```text
FRR_id:             49305
FRR_numero:         5052
FRR_ejercicio:      25
FRR_idproveedor:    17
FRR_idregimen:      2110
FRR_tipofactura:    OT
FRR_idcuenta:       41000000017
FRR_igasto1:        42341.52
FRR_ctagasto1:      60200000001
FRR_totalfac:       51233.24
Punteos:            17 albmaterial / 21 líneas
CTB:                0 líneas
Asiento:            reference_only
```

El plan de trabajo completo está en
[`../../../PLAN_SANEAMIENTO_FACTURAS_RECIBIDAS_2026-07-22.md`](../../../PLAN_SANEAMIENTO_FACTURAS_RECIBIDAS_2026-07-22.md).

