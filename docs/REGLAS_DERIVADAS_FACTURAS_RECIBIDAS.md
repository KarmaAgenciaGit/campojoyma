# Reglas derivadas de facturas recibidas, medidas sobre el histórico real

Fecha de medición: 23 de julio de 2026.

Este documento se diferencia del resto de `docs/` en un punto esencial: **no contiene
hipótesis reconstruidas a partir de una factura y un correo, sino frecuencias medidas
sobre el histórico del ERP.** Cada afirmación lleva su denominador. Cuando los datos
refutan una intuición previa, se dice expresamente.

## 1. Método

Camino de lectura utilizado, el mismo que `scripts/verify-facturas-recibidas-api.mjs`:

```text
JWT HS256 efímero (300 s) -> webhook n8n de lectura -> FastAPI interna de Netagro
```

Dos barridos, ambos de **solo lectura**. Ningún `INSERT`, `UPDATE` ni DDL.

| Barrido | Fuente | Volumen | Llamadas |
|---|---|---:|---:|
| Listado | `facturasrecibidas?ejercicio=NN` | 30.301 facturas (ejercicios 22–25) | 310 |
| Cabeceras | `facturasrecibidas/{id}` | 285 cabeceras completas | 285 |

El listado devuelve 19 campos resumidos. Las cabeceras devuelven 82. La muestra de
cabeceras está **estratificada por `tipo_factura`** para no medir solo `OT`, que domina
el histórico; por eso sus proporciones por tipo no son representativas del volumen real,
pero sí lo son sus valores por columna.

`facturasrecibidas/tipos` y `regimenes` se leyeron sobre el histórico completo
(48.821 facturas).

### Límites de validez

- Solo **empresa 1**. Es la única presente: 30.301/30.301.
- Solo ejercicios **22–25**. Las reglas anteriores a 2019 no se han medido.
- Copia de pruebas de Netagro, no producción.
- `limit` de la API topa en **100**; por encima devuelve HTTP 500.

## 2. Catálogos reales del histórico completo

`FRR_tipofactura`, 48.821 facturas:

```text
OT   30734   2013-10-01 -> 2026-08-01
GE    8136   2020-01-02 -> 2026-07-06
MA    4919   2020-04-27 -> 2026-04-07
GV    2705   2020-06-30 -> 2026-07-06
FI    1279   2021-06-22 -> 2026-04-20
GC     361   2020-08-31 -> 2026-06-22
CE     356   2021-08-10 -> 2025-10-31
FZ     308   2020-02-08 -> 2021-05-20
CX      14   2020-07-30 -> 2021-03-03
GM       8   2022-10-31 -> 2024-04-30
null     1   1900-01-01
```

`FZ` y `CX` están **descatalogados de hecho**: ninguno posterior a 2021.

`FRR_idregimen`, 18 valores. Los relevantes:

```text
2110   31295      1110    5060      4110    3957
2117    2841      2112    2588      2113     970
2114     610      2115     565      2118     389
2111     271      3111     136      1111     116
```

No existe tabla maestra de regímenes ni de tipos en `netagrocomer`; la propia API lo
declara: `distinct facturasrecibidas.FRR_idregimen; no populated regimen master table found`.
Por tanto **estos catálogos son valores observados, no un maestro descriptivo.**

Matiz importante: la interfaz del ERP **sí resuelve la descripción**. En la captura
[`pantalla-erp-onduspan-A-00748886.png`](evidencias/facturas-recibidas/onduspan/pantalla-erp-onduspan-A-00748886.png)
el campo `Tipo IVA` muestra `2110` con la etiqueta `R. G. GASTOS` al lado, y la cuenta
`60200000001` aparece como `COMPRAS ENVASES Y…`.

Corrección respecto a la primera redacción, que suponía «una fuente de descripciones que
la API no está leyendo». Se buscó el maestro el 23 de julio de 2026 con `/meta/tables`
ampliado, sobre los dos esquemas accesibles:

```text
contabilidad   q=cuenta   -> cuentas (12.884 filas)   <- control positivo
contabilidad   q=regimen  -> []
contabilidad   q=tipo|clave|maestro|param|general -> []
netagrocomer   q=regim    -> []
netagrocomer   q=clave    -> []
netagrocomer   q=tipo     -> facturasrecibidastipo (0 filas), entre otras
```

El control positivo demuestra que la búsqueda funciona, así que los vacíos son negativos
verdaderos. **El maestro de regímenes no existe en la base accesible.** La etiqueta
`R. G. GASTOS` la resuelve el cliente Windows del ERP, no la base de datos, o vive en un
esquema no expuesto a esta copia.

Consecuencia: la interfaz no puede mostrar descripciones de régimen sin que el cliente las
facilite como tabla de negocio. **No traducir códigos de régimen por intuición.**

Descripción conocida, procedente solo de la captura:

```text
2110   R. G. GASTOS
```

## 3. Reglas confirmadas

### 3.1 Constantes de empresa

| Campo | Valor | Evidencia |
|---|---|---|
| `FRR_Idempresa` | `1` | 30.301/30.301 |
| `FRR_idcentro` | `1` | 285/285 |
| `FRR_idpuntoventa` | `1` | 285/285 |

### 3.2 Concepto y observaciones AEAT

```text
FRR_Concepto = "FRA. " + <nombre del acreedor>      (cortado a 50 caracteres)
FRR_ObservacionesAEAT = FRR_Concepto
```

Evidencia:

- **100,0%** de los conceptos empiezan por `FRA`: 28.553/28.557.
- Coincidencia exacta con `"FRA. " + proveedor_nombre` del listado: 79,3% (22.632/28.557).
- Añadiendo los truncados a 50: 81,8%.
- Usando `acreedor_nombre` del maestro en la muestra de cabeceras: **87,2%** (239/274).
- `FRR_ObservacionesAEAT` es **idéntico** a `FRR_Concepto` en **253/253** de los casos
  rellenos (100,0%). Está vacío en 32/285 (11,2%).

El 18,3% restante mantiene el formato `FRA. <texto>` pero con otro nombre comercial;
por ejemplo concepto `FRA. UNICA FRESH S.L.` para el acreedor
`INTERFRONTERAS AREAS SERV. S.L.`. El formato es universal; el contenido admite el
nombre de la entidad que realmente factura.

Solo 4 de 28.557 no empiezan por `FRA`.

### 3.3 Régimen: función de (proveedor + IVA)

Acierto del valor mayoritario del histórico, grupos con n>=3:

| Predictor | Acierto | n |
|---|---:|---:|
| `iva1` solo | 80,9% | 30.300 |
| proveedor solo | 89,3% | 29.496 |
| **proveedor + `iva1`** | **98,6%** | 29.220 |
| proveedor + tipo + `iva1` | 98,7% | 29.120 |

El par es la regla utilizable. Añadir el tipo no aporta nada (+0,1 pp).

### 3.4 Sección y actividad

`FRR_IdSeccion` == `FRR_IdActividad` en **276/285 (96,8%)**. Ambos dependen del tipo:

| Tipo | Valor | Evidencia |
|---|---|---|
| `FI` | `1` | 39/39 (100%) |
| `GE` | `0` | 38/38 (100%) |
| `GM` | `0` | 8/8 (100%) |
| `CE` | `1` | 39/40 (97,5%) |
| `GV`, `MA` | `1` | ~73% |
| `GC` | `0` | 30/46 (65%) |
| `OT` | indeterminado | 1:20, 0:18, 2:7 |

### 3.5 Los vencimientos no se usan

El ERP **nunca** almacena vencimientos en estas columnas:

```text
FechaVto          "0000-00-00"   285/285
FRR_FechaVto1..3  "1900-01-01"   285/285
ImporteVto        "0.00"         285/285
FRR_FechaPrevPago "1900-01-01"   285/285
FRR_ImporteVto1   distinto de 0 en 2/285 (0,7%)
```

Esto **cierra definitivamente** la duda abierta sobre el vencimiento `29/08/2026` del PDF
de Onduspan: no se traslada, porque el ERP no guarda vencimientos en ninguna factura.

### 3.6 Columnas constantes

Estas 27 columnas tienen un único valor en las 285 cabeceras y dejan de ser incógnitas:

```text
"N"            FRR_CancelarporCtb
"S"            FRR_Contabilizar          (histórico: todas contabilizadas)
""             FRR_Modificable  FRR_ClaveIRPF  FRR_CtaCartera  FRR_CtaSuplido
""             FRR_ctagasto4
"0.00"         FRR_CuotaNoDeducible  FRR_ImpSuplido  FRR_igasto4  FRR_iva5
"0.00"         FRR_cuota5  FRR_ImporteVto2  FRR_ImporteVto3
0              FRR_IdAgricultorDto  FRR_IdTipoDoc  FRR_idpago  FRR_IdfacturaRec
1              FRR_Idempresa  FRR_idcentro  FRR_idpuntoventa
fechas/importes de vencimiento: ver 3.5
```

`FRR_GeneraCartera` vale `""` (225) o `"N"` (60). **Nunca `"S"`.**

## 4. Hipótesis refutadas

Cuatro atajos tentadores que los datos descartan. Documentados para que nadie los
reintroduzca.

### 4.1 El régimen NO se deriva del porcentaje de IVA

| IVA | Regímenes observados |
|---:|---|
| 21% | 2110:18658 · 2112:1844 · 2113:443 · 2111:188 · 2114:170 · 3111:78 · 2210:8 … |
| 4% | 1110:2621 · 2115:181 · 1111:102 · 2110:5 … |
| 0% | 2117:2836 · 4110:2670 · 2110:31 · 1110:18 … |

Con IVA 21% el régimen es 2110 solo en el 87,2%. Contraejemplo directo entre dos
facturas reales, ambas al 21%: Onduspan (prov 17) usa **2110**; Ruiz Salazar
(prov 345) usa **2114**.

### 4.2 El ejercicio NO se deriva de la fecha

Los rangos de fecha por ejercicio se solapan masivamente:

```text
ej22   n=10170   2019-03-15 -> 2023-08-31
ej23   n= 8203   2013-10-01 -> 2024-09-12
ej24   n= 6824   2023-03-02 -> 2025-09-01
ej25   n= 5104   2023-01-31 -> 2026-08-01
```

Se probó también la hipótesis de campaña agrícola (sep→ago) por el `2026-08-01` del
ejercicio 25. **Queda refutada** por el solape. El ejercicio es la asignación contable
que decide quien contabiliza, y admite facturas antiguas. Debe venir de configuración.

### 4.3 La cuenta contable NO se calcula desde el proveedor

`"41" + proveedor a 9 dígitos` acierta solo el **73,1%** (22.146/30.301). Hay dos familias:

```text
410xxxxxxxx    24556   81,0%
400xxxxxxxx     5745   19,0%
```

Y el sufijo tampoco es fiable: la cuenta termina en el `proveedor_id` en 92,1%.
Casos como `prov=10225 -> 41001000225` rompen el rellenado con ceros.

**`FRR_idcuenta` se toma siempre de `acreedores/{id}`.** Nunca se calcula.

### 4.4 La escalera de IVA no depende de la versión, pero sí es del ERP

Se observó `FRR_iva2=10`, `FRR_iva3=4`, `FRR_iva4=5` incluso con base y cuota a cero. Se
comprobó si dependía de la versión, por ejercicio y por año de alta:

```text
ej22 51,2%   ej23 54,1%   ej24 54,3%   ej25 52,2%
2022 69,4%   2023 47,2%   2024 56,1%   2025 51,6%   2026 38,5%
```

Plano en torno al 52%: **no es un cambio de versión del ERP.**

Corrección respecto a la primera redacción de este documento, que la calificaba de
hipótesis refutada: la captura
[`pantalla-erp-onduspan-A-00748886.png`](evidencias/facturas-recibidas/onduspan/pantalla-erp-onduspan-A-00748886.png)
muestra en "Desglose de IVA" los tipos `21,00`, `10,00`, `4,00`, `5,00` con las bases
vacías. **La escalera es la plantilla del propio formulario del ERP**, no un artefacto.

Las dos cosas son compatibles: el formulario la presenta siempre y se persiste en algo más
de la mitad de los casos.

Verificado después contra el registro real de ONDUSPAN `49305`, que **sí la tiene
persistida**:

```text
FRR_iva1 = "21.00"    FRR_iva2 = "10.00"
FRR_iva3 = "4.00"     FRR_iva4 = "5.00"     FRR_iva5 = "0.00"
```

Coincide exactamente con la captura. Por tanto el borrador local de esa factura, que
tiene `iva2..5` a `0.00`, **no es una copia fiel** del registro histórico en esos tres
campos. Es una diferencia de presentación sin efecto sobre bases ni cuotas, que siguen a
cero, pero conviene no presentar ese borrador como réplica exacta.

Consecuencia práctica: dejar `iva2..5` a cero es válido y es lo que hace hoy el código,
pero rellenar la escalera tampoco sería una invención. No se toca hasta que el cliente
confirme cuál de las dos formas quiere en las altas nuevas.

## 5. Lo que sigue exigiendo decisión humana

### 5.1 Tipo de factura: techo del 84%

| Predictor | Acierto |
|---|---:|
| proveedor | 83,3% |
| proveedor + régimen | 84,5% |
| proveedor + `iva1` | 84,4% |

El techo no se mueve porque el tipo depende de **qué se compró**, información que vive en
las líneas y en el albarán de origen, no en la cabecera. Esto explica por fin la anomalía
de Onduspan: vende material, sus punteos son de origen `MA`, y su cabecera es `OT` porque
lo decidió una persona.

Debe seguir siendo elección manual con sugerencia.

### 5.2 Fecha CTB: sin regla

```text
delta 0 días respecto a la fecha de factura   12729/30301   42,0%
último día del mes                             6030/30301   19,9%
```

Copiar la fecha de factura sería incorrecto en el 58% de los casos. Los valores más
repetidos de `FRR_fechactb` son fines de mes (`2023-10-31`, `2023-08-31`, `2024-04-30`).
Mantener `fecha_ctb_policy = manual` hasta que el cliente confirme la política.

### 5.3 Cuenta de gasto: depende del tipo

`FRR_ctagasto1` coincide con `acreedor_cuenta_gasto` del maestro en solo **112/219 (51,1%)**.

Todas las discrepancias observadas son de **tipo `GE`** con cuenta `40090…`:

```text
ctagasto1=40090001847   maestro=62100061040   prov 1847   GE
ctagasto1=40090001858   maestro=62900000007   prov 1858   GE
ctagasto1=40090001903   maestro=21500000004   prov 1903   GE
```

Confirma con datos lo que el correo de Campojoyma solo describía: en compras de género la
cuenta de gasto es la **cuenta del agricultor** (`4009…`), no la cuenta de gasto del
maestro. En 66 casos hay `ctagasto1` sin cuenta en el maestro.

Regla operativa: para `GE`, la cuenta sale de la relación del agricultor; para el resto,
el maestro es el punto de partida y sigue siendo revisable.

`FRR_ctagasto2` vale `60000000010` en 27 casos: es la **comisión descontada** de la
liquidación de agricultor. Confirma que el `6000000010` del correo tenía un cero de menos;
la cuenta real tiene 11 dígitos.

### 5.4 Las referencias del PDF cruzan por `Ref`, no por `Albaran`

En la captura del ERP, la tabla de albaranes a puntear distingue dos columnas numéricas:

```text
Albaran   2058   2055   2069   2070   2068   2087   ...
Ref     478897 478947 479007 478974 478934 479069  ...
```

El PDF de Onduspan cita `Albarán 478678`, `Albarán 478750`, `Albarán 478797`… y esos
valores se guardaron en `extraction.referencias_punteo`. Coinciden con la columna **`Ref`**,
no con `Albaran`.

Por tanto, para **presentar candidatos** hay que cruzar las referencias del PDF contra `Ref`.
Cruzarlas contra `Albaran` devuelve cero coincidencias. Recordatorio del contrato: la PK
estable del punteo sigue siendo `AMA_idalb` y ningún candidato se selecciona
automáticamente; esto solo mejora el orden en que se le ofrecen al usuario.

### 5.5 Cobertura práctica de las sugerencias

Simulación sobre las 5.104 facturas del ejercicio 25, usando solo el histórico anterior:

```text
sin historial suficiente (<3 previas)       573   11,2%   -> manual, sin sugerencia
tipo_factura, proveedor de valor único     2122   -> acierto real 98,7% (2094/2122)
tipo_factura ambiguo                       2409   -> exigir confirmación
regimen_id, proveedor de valor único       1551   -> acierto real 96,5% (1496/1551)
regimen_id ambiguo                         2980   -> usar el par proveedor+IVA (98,6%)
```

La sugerencia debe llevar su confianza visible. `OT — 47 de 47 facturas previas` no es lo
mismo que `OT (62%) / MA (38%)`, y la interfaz no debe presentarlas igual.

## 6. Qué muestra el ERP que la API no devuelve

Cruce campo a campo de la captura
[`pantalla-erp-onduspan-A-00748886.png`](evidencias/facturas-recibidas/onduspan/pantalla-erp-onduspan-A-00748886.png)
contra los **82 campos** que devuelve `facturasrecibidas/49305`.

La pantalla está cubierta casi por completo. Los huecos reales son:

| Pantalla | Estado en la API |
|---|---|
| Asiento visible `48732` | Solo existe `FRR_IdAsientoNet = 390305`. Ningún campo contiene `48732`. |
| `R. G. GASTOS` | `regimenes` devuelve `descripcion: null` para `2110`; `tipos-iva` no incluye `2110`. |
| `Importaciones` | Sin campo entre los 82. |
| Rejilla `Pagos` | Sin endpoint ni campo. Vacía en este caso, contenido desconocido. |
| Radio `Compras de Género` / `Acreedores` | Sin campo. No es `FRR_tipofactura`, que aquí vale `OT`. |
| Usuario de `FRR_IdUsuarioLog = 61` | Se devuelve el identificador, no hay forma de resolver el nombre. |

`Guardar Como`, `Abono`, `Modificar` y `Filtrar albaranes por empresa` son acciones o
filtros de interfaz, no datos persistidos.

### 6.1 Descripciones que sí existen, pero en otro endpoint

No son huecos de capacidad, solo requieren una llamada adicional:

```http
GET cuentas-contables?cuenta=60200000001
```

```json
{
  "cuenta": "60200000001",
  "descripcion": "COMPRAS ENVASES Y EMBALAJES",
  "iva_soportado_id": 1,
  "clave_irpf": "",
  "porcentaje_irpf": "0.00",
  "forma_pago_id": 0,
  "banco_id": 0,
  "bloqueo_pagos": "N",
  "bloqueo_facturas": "N"
}
```

`descripcion` es el texto exacto que muestra la pantalla junto a la cuenta de gasto.

`formas-pago` también devuelve descripciones útiles:

```text
100  CHEQUE       dias_vencimiento 0    genera_cartera S
200  PAGARÉ 30    dias_vencimiento 30   genera_cartera S
201  PAGARÉ 60    dias_vencimiento 60   genera_cartera S
```

Dato relevante para la política de vencimientos: el PDF de ONDUSPAN indica pagaré a 60
días, que corresponde a la forma de pago `201`. El registro real del ERP guarda
`FRR_IdFormaPago = 0` y `FRR_GeneraCartera = ""`. **No se deduce del PDF.**

## 7. Discrepancias con el código actual

Detectadas al contrastar `normalizeFrrPayload()` en
`supabase/functions/_shared/facturas-recibidas-erp.ts` con el histórico:

| Campo | Código actual | Histórico | Acción |
|---|---|---|---|
| `FRR_Modificable` | default `"S"` | `""` en 285/285 | corregir a vacío |
| `FRR_idcentro` | sin default | `1` en 285/285 | añadir default `1` |
| `FRR_idpuntoventa` | sin default | `1` en 285/285 | añadir default `1` |
| `FRR_Concepto` | descripción del PDF | `"FRA. " + nombre` | aplicar convención |
| `FRR_ObservacionesAEAT` | vacío | copia de `FRR_Concepto` | copiar |
| `FRR_GeneraCartera` | default `"N"` | `""` 79% / `"N"` 21% | aceptable |
| `FRR_CancelarporCtb` | default `"N"` | `"N"` 285/285 | correcto |

`FRR_Contabilizar` vale `"S"` en las 285 cabeceras históricas porque todas están
contabilizadas. Esto **no** autoriza a enviar `"S"`: el mecanismo oficial de
contabilización sigue sin estar disponible y la API bloquea ese envío. El default `"N"`
del código es correcto para un alta nueva.

## 8. Reproducir la medición

Los scripts de minado no forman parte del árbol del proyecto; viven en el scratchpad de
la sesión y se apoyan en `.env` para las credenciales de lectura. El crudo se persiste
para reanalizar sin volver a llamar a la API:

```text
raw-listado.json      30.301 filas del listado
raw-cabeceras.json       285 cabeceras completas
```

Para repetirlo basta con reutilizar el mecanismo de `signJwt` y `apiGet` de
`scripts/verify-facturas-recibidas-api.mjs`, paginando con `limit=100`.
