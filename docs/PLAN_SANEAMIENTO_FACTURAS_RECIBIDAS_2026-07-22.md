# Plan de relevo: saneamiento de facturas recibidas Campojoyma

Fecha de corte: 22 de julio de 2026.

Este documento es autocontenido. Su finalidad es que un chat nuevo pueda retomar
el trabajo sin depender del historial de conversaciones anterior.

## 1. Encargo para el nuevo chat

Trabaja sobre este repositorio:

```text
C:\Users\Moises-Karma\Desktop\Karmabox\Karmabox\Automatizaciones\Repositorios\campojoyma
```

Objetivo principal:

1. Eliminar `acreedores_cache` como fuente de datos y como fallback de todo el
   código activo.
2. Resolver y completar los acreedores exclusivamente mediante la API del ERP,
   usando el ID del proveedor como referencia.
3. Corregir la validación y los avisos de facturas para que no mezclen conceptos
   contables ni generen falsos positivos.
4. Mantener separados y correctamente modelados:
   - gastos de cabecera;
   - CTB analítico;
   - punteos de albaranes;
   - asiento oficial Debe/Haber.
5. Corregir reglas, pruebas y documentación para ejercicio ERP, tipo de factura,
   régimen, fecha CTB, duplicados y cuentas de agricultor.
6. Dejar el cambio probado y desplegable. No publicar ni ejecutar una operación
   destructiva en producción sin la autorización correspondiente.

Antes de tocar código:

- Lee por completo `AGENTS.md`.
- Ejecuta `git status --short` y conserva todos los cambios existentes del usuario.
- Revisa este documento contra el código actual; no des por hecho que el árbol no
  ha cambiado desde la fecha de corte.
- Inspecciona primero los flujos existentes y reutilízalos; no crees un circuito
  paralelo.

## 2. Estado del working tree en el momento del relevo

Había cambios ajenos a este plan que deben preservarse:

```text
A  .dockerignore
A  deploy-front.ps1
A  deploy-front.sh
A  docker-compose.windows.yml
M  src/components/PdfViewer.tsx
M  src/index.css
M  src/pages/FacturasRecibidas.tsx
```

`src/pages/FacturasRecibidas.tsx` será probablemente necesario para este trabajo,
pero ya contiene cambios del usuario. Antes de editarlo hay que revisar su diff y
trabajar de forma incremental, sin sobrescribirlo.

## 3. Contexto técnico y autoridades

- Stack: Vite, React, TypeScript y Supabase.
- Proyecto Supabase: `CAMPOJOYMA`, referencia `adbprpemmbspntbttziz`.
- La fuente autorizada de FastAPI es el repositorio separado
  `KarmaAgenciaGit/api-campojoyma`. Este repositorio de frontend conserva el
  contrato, OpenAPI, workflows y parches sincronizados, pero no sustituye a la
  fuente real de FastAPI.
- MariaDB de pruebas de Netagro es estructuralmente inmutable. Nunca ejecutar DDL
  contra ella: nada de `CREATE`, `ALTER`, `DROP` o `TRUNCATE`.
- La cadena de lectura prevista es:

```text
Frontend autenticado
  -> Supabase Edge facturas-recibidas-erp-read
  -> webhook n8n con JWT HS256 efímero generado en servidor
  -> FastAPI interna de Netagro
```

- FastAPI no es pública. El webhook anónimo devuelve `401` y no debe exponerse
  al frontend ni usarse con una passphrase estática.
- Los secretos ya configurados se leen desde entornos de servidor. No imprimirlos,
  copiarlos a documentación ni incluirlos en commits.
- En código JavaScript de n8n no introducir `$env.HISPATEC_API_KEY`. Las reglas de
  negocio tampoco deben quedar escondidas en variables globales de n8n.

## 4. Decisión de producto ya tomada

No debe existir un maestro espejo de acreedores en Supabase.

Comportamiento objetivo:

- El borrador conserva el ID ERP del proveedor.
- Al buscar o abrir el proveedor, la UI consulta la API:
  - `acreedores?...` para búsqueda;
  - `acreedores/{id}` para detalle;
  - `acreedores/{id}/gastos` cuando se necesite la relación de gastos.
- Nombre, NIF, cuenta de proveedor, cuenta de gasto, cuenta de cartera, IVA y
  demás datos maestros se hidratan desde la API.
- Si la API no está disponible se muestra un error operativo. No se usa una copia
  local silenciosamente.
- Se puede conservar en la factura su payload y readback transaccional para
  auditoría. Eso no es un maestro de acreedores ni debe emplearse para resolver
  otros proveedores o nuevas facturas.

La tabla `public.acreedores_cache` todavía existe en Supabase y contenía 5 filas en
la fecha de corte. No fue eliminada porque el borrado es destructivo y todavía hay
dependencias activas.

## 5. Hechos verificados contra la API

Los archivos originales usados para este contraste están archivados en
[`docs/evidencias/facturas-recibidas/onduspan/`](evidencias/facturas-recibidas/onduspan/README.md):

- factura PDF de Onduspan;
- pantalla de esa factura en el ERP;
- correo de Campojoyma sobre tipos y cuentas;
- captura del desglose de una liquidación de agricultor.

Las dos últimas capturas de liquidación facilitadas por el usuario eran
binariamente idénticas, por lo que se conserva una sola copia y se documenta su
SHA-256 en el índice de evidencias.

La prueba de aceptación real se ejecutó correctamente:

```text
npm run verify:facturas-api
OK: aceptación de lectura ONDUSPAN completada; contabilidad en reference_only.
```

### 5.1 Factura Onduspan de referencia

PDF y pantalla ERP estudiados:

```text
Proveedor:             ONDUSPAN, S.A.
FRR_id:                49305
Entrada/FRR_numero:    5052
Ejercicio ERP:         25
Proveedor ERP:         17
Cuenta proveedor:      41000000017
Factura:               A-00748886
Fecha factura:         2026-06-30
Fecha CTB:             2026-06-30
FRR_idregimen:         2110
FRR_tipofactura:       OT
Base/FRR_igasto1:      42.341,52
IVA:                   21 % / 8.891,72
Total:                 51.233,24
Cuenta gasto:          60200000001
FRR_IdAsientoNet:      390305 (ID técnico)
Contabilizar:          S
```

Punteos y contabilidad:

- 17 punteos de `albmaterial`.
- 21 líneas de material.
- La suma de los punteos es `42.341,52`, igual a la base.
- El origen de esos punteos es `MA`.
- CTB real: cero líneas.
- Asiento: `reference_only`, `created=false`, número visible `null`, cero
  apuntes verificables.
- La pantalla ERP muestra el número de asiento `48732`, pero la API no puede
  acreditarlo con el diario oficial. No equipararlo con el ID técnico `390305`.

Campos de pago:

- El PDF indica pagaré con vencimiento `29/08/2026` por `51.233,24`.
- El registro ERP devuelve forma de pago `0`, banco `0`, importe de vencimiento
  `0` y fecha técnica vacía/`1900-01-01`.
- No trasladar automáticamente el vencimiento del PDF al ERP sin una regla de
  negocio confirmada.

### 5.2 Acreedor Onduspan

`acreedores/17` devuelve, entre otros:

```text
nombre:            ONDUSPAN, S.A.
nif:               A04119293
cuenta_id:         41000000017
cuenta_gasto:      60200000001
cuenta_cartera:    41100000017
porcentaje_iva:    21.00
forma_pago_id:     0
```

Por tanto, estos datos no necesitan una caché local.

`acreedores/17/gastos` existe en FastAPI y devolvió un registro válido, pero la
allowlist actual de la Edge Function no admite aún esa ruta.

### 5.3 Caso de liquidación de agricultor

La captura entregada muestra:

```text
Base:                76.107,23
IVA 4 %:              3.044,29
Total:               79.151,52
40090002095:         79.278,36
60000000010:         -3.171,13
```

La relación cuadra:

```text
79.278,36 - 3.171,13 = 76.107,23
76.107,23 * 4 %       =  3.044,29
76.107,23 + 3.044,29 = 79.151,52
```

El correo de Campojoyma explicó:

- la cuenta `4009...` es la cuenta del agricultor donde se contabilizan los
  albaranes de entrada de género;
- la cuenta `600...` es la comisión descontada de su liquidación.

El correo escribió `6000000010`, mientras la captura y otros casos apuntan a
`60000000010`. No corregir ni hardcodear el número por intuición: obtener la
cuenta exacta de la API/regla ERP correspondiente.

Estas dos líneas construyen el desglose de la base de una liquidación. No son el
asiento oficial Debe/Haber y no deben modelarse como CTB si no existen filas
`FRC_*` reales.

## 6. Errores y riesgos conocidos

### 6.1 Dependencias activas de `acreedores_cache`

En la fecha de corte existían referencias de runtime, al menos en:

- `supabase/functions/_shared/facturas-recibidas-erp.ts`:
  `getValidationErrorsForFactura()` valida proveedor y cuenta contra la caché.
- `src/services/facturas.ts`: `localizarProveedorERP()` usa la caché como fallback
  cuando falla la función/API.
- `src/services/agroirisAcreedores.ts`: lista, búsqueda y detalle usan caché como
  fuente predeterminada para varios consumidores.
- `src/components/AcreedorCombobox.tsx`: el valor por defecto de `source` es
  `cache`, aunque la pantalla de facturas ya pasa explícitamente `source="erp"`.
- Otros consumidores de pedidos/cambios llaman `getAcreedorById()` sin especificar
  origen y, por tanto, siguen usando caché.
- Los tipos generados y documentación siguen incluyendo la tabla.

La pantalla de facturas ya busca acreedores con `source="erp"`; eso debe
preservarse. El problema restante es la validación y los fallbacks, además de los
consumidores generales.

### 6.2 Falso positivo de proveedor

El flujo puede resolver correctamente un proveedor mediante la API y después
mostrar:

```text
El proveedor no existe en acreedores_cache/ERP.
```

La causa es que la validación vuelve a consultar una tabla local incompleta. Debe
eliminarse esa consulta y la mención a `acreedores_cache` del mensaje.

### 6.3 Conceptos contables mezclados

No mezclar:

1. `FRR_igasto1..4` + `FRR_ctagasto1..4`: desglose de gastos de cabecera.
2. `facturasrecibidas_ctb` + `FRC_*`: imputación contable/analítica real.
3. Punteos: enlaces a albaranes u otros documentos de origen.
4. Asiento: líneas oficiales Debe/Haber leídas del diario.

La UI actual ya separa “Desglose de Gastos”, CTB, punteos y asiento. No revertir
esa mejora. Un CTB vacío no autoriza a fabricar una fila a partir del gasto.

### 6.4 Tipo de factura

El correo solo aportó descripciones parciales:

```text
OT = OTROS
GE = COMPRAS GENERO
MA = MATERIALES
GV = GASTOS VENTAS
GC = GASTOS COMPRAS
FZ = FIANZA
CX = COSTES EXTERNOS
FI, CE y GM sin explicación completa
```

No aportó reglas para decidir cuándo usar cada código.

Caso que impide inferencias agresivas:

- Onduspan vende materiales y tiene punteos cuyo origen es `MA`.
- Sin embargo, su cabecera real tiene `FRR_tipofactura="OT"`.

Por tanto:

- el radio “Acreedores” de la pantalla ERP no es `FRR_tipofactura`;
- el origen `MA` del punteo tampoco es `FRR_tipofactura`;
- no deducir el tipo solo por descripción del PDF, proveedor o tabla de origen;
- usar una regla explícita confirmada o pedir selección manual.

### 6.5 Régimen frente a porcentaje IVA

En Onduspan:

```text
FRR_idregimen = 2110
FRR_iva1      = 21
```

Son campos distintos. Nunca construir `2110` a partir del porcentaje ni asumir
que todo IVA 21 % usa el mismo régimen. `/regimenes` solo enumera valores
observados y no constituye por sí solo un maestro descriptivo fiable.

### 6.6 Ejercicio ERP

El ejercicio ERP real de la factura de 2026 es `25`, no `2026` ni `26`.

- La búsqueda exacta con ejercicio `25` encuentra la factura.
- Con ejercicio `26` no la encuentra.
- No derivar el ejercicio del año natural.
- El fixture de Onduspan en `src/services/facturas.test.ts` contiene actualmente
  `FRR_ejercicio: 2026`; está mal y debe corregirse a `25`.

### 6.7 Fecha CTB

En `A-00748886`, fecha CTB y fecha de factura coinciden. Eso no demuestra una
regla general. Otra factura real de Onduspan tenía fecha de factura `2026-06-15`
y fecha CTB `2026-06-22`.

No copiar siempre la fecha de factura. La política debe quedar configurada y
confirmada. Si no existe regla, el campo debe quedar pendiente de revisión.

### 6.8 Duplicados

El duplicado ERP debe comprobarse por:

```text
empresa + ejercicio ERP + proveedor + número de factura
```

El endpoint correcto es `facturasrecibidas/buscar`.

- Un duplicado ERP real es bloqueante.
- Debe mostrar el candidato encontrado.
- No debe eliminarse para reducir avisos.
- La comprobación debe repetirse dentro de la transacción de escritura.
- Una factura local descartada no debe producir un enlace de duplicado válido.
- Usar el ejercicio ERP correcto; derivar `26` de 2026 rompe la búsqueda.

### 6.9 Avisos duplicados y severidad

En el caso analizado se mostraban siete mensajes, pero varias causas estaban
duplicadas:

- fecha CTB aparecía dos veces;
- régimen aparecía como “Falta Tipo IVA” y como falta de regla;
- proveedor de caché era un falso positivo;
- duplicado ERP sí era real;
- la UI mezclaba errores bloqueantes y avisos operativos en una sola caja ámbar.

Cada causa debe mostrarse una vez y conservar su severidad:

- `error`: impide enviar;
- `warning`: requiere revisión o informa, pero no se presenta como fallo técnico;
- información: estado o evidencia sin acción obligatoria.

### 6.10 Punteos

- 17 punteos no equivalen a 21 líneas; son métricas distintas.
- `MA` es origen del punteo, no tipo de factura.
- Los candidatos deben mostrarse con tabla e ID de origen.
- No seleccionar ni enlazar automáticamente por similitud.
- Para nuevas facturas, cargar candidatos y exigir confirmación manual.
- La suma debe compararse con la base/gasto y cualquier diferencia debe quedar
  visible.

### 6.11 Asiento

La copia de pruebas no expone el diario oficial completo.

- No inventar número visible, Debe, Haber ni líneas.
- `FRR_IdAsientoNet` es técnico y no el número visible.
- Mientras la API responda `reference_only`, la UI debe explicar la limitación.
- No declarar una contabilización como creada si no existe readback oficial.

### 6.12 Allowlist de la Edge Function

`isAllowedERPConsulta()` permite:

```text
acreedores
acreedores/{id}
```

pero no permite actualmente:

```text
acreedores/{id}/gastos
```

Aunque FastAPI sí tiene la ruta. La Edge devuelve `422 Consulta no permitida`.

### 6.13 Prueba de aceptación incompleta

`scripts/verify-facturas-recibidas-api.mjs` valida actualmente importes, cuentas,
CTB, punteos y estado contable, pero debe añadir aserciones para:

```text
FRR_ejercicio = 25
FRR_idregimen = 2110
FRR_tipofactura = OT
```

## 7. Arquitectura objetivo

### 7.1 Fuente de verdad de acreedores

```text
ID proveedor en borrador/factura
       |
       v
GET acreedores/{id}
       |
       +--> nombre/NIF
       +--> cuenta proveedor
       +--> cuenta gasto
       +--> cuenta cartera
       +--> IVA/forma de pago disponibles
```

No debe haber un segundo maestro en Supabase.

### 7.2 Validación segura

Separar dos niveles:

1. Validación estructural local:
   - ID de proveedor presente;
   - cuenta requerida presente;
   - importes coherentes;
   - campos obligatorios completos.
2. Validación autoritativa ERP:
   - proveedor existe;
   - cuenta coincide con el maestro;
   - duplicado no existe;
   - IDs de reglas son válidos;
   - punteos siguen disponibles.

La validación autoritativa debe ejecutarse contra la API inmediatamente antes de
enviar y repetirse en el writer cuando corresponda. No confiar únicamente en una
evidencia enviada por el cliente ni en un snapshot antiguo.

### 7.3 Reglas contables

Las decisiones confirmadas deben almacenarse como reglas administrables, no en
variables globales de n8n ni en la caché de proveedores.

Modelo recomendado:

- regla por empresa ERP;
- especialización opcional por proveedor;
- prioridad: proveedor específico sobre regla general de empresa;
- campos posibles:
  - ejercicio ERP activo;
  - tipo de factura;
  - régimen;
  - política de fecha CTB;
  - política de gasto/cuenta cuando proceda;
  - activo y evidencia/nota de aprobación.

Si existe una relación real y estable con `cliente_behavior_rules`, reutilizarla y
actualizar migración, tipos, servicio y `AdminSettings`. Si las facturas no tienen
una relación de `clienteid`, no forzar ese modelo: crear una configuración
específica de facturas, con migración nueva e interfaz de administración.

No crear reglas automáticas para OT/MA, régimen o fecha CTB sin evidencia de
negocio suficiente.

## 8. Plan de implementación, en orden

### Fase 0. Proteger el estado actual y obtener baseline

1. Leer `AGENTS.md` completo.
2. Ejecutar y guardar resultados de:

   ```text
   git status --short
   git diff -- src/pages/FacturasRecibidas.tsx
   npx tsc --noEmit
   npm run build
   npm run verify:facturas-api
   ```

3. Distinguir errores preexistentes de errores introducidos por el trabajo.
4. No limpiar, resetear ni sobrescribir cambios ajenos.

### Fase 1. Inventario completo de la caché

1. Buscar referencias activas con `rg "acreedores_cache"`.
2. Clasificarlas en:
   - runtime frontend;
   - Edge Functions;
   - tipos;
   - migraciones históricas;
   - documentación.
3. Inspeccionar qué componentes usan por defecto `source="cache"`.
4. Comprobar en Supabase, solo lectura:
   - número de filas;
   - políticas y grants;
   - funciones, vistas o FK dependientes.
5. No borrar todavía la tabla.

### Fase 2. Sustituir los accesos de runtime por API

1. Hacer que `agroirisAcreedores` use ERP por defecto.
2. Retirar:
   - `fetchAcreedores()` desde Supabase;
   - `searchAcreedoresCache()`;
   - detalle desde la tabla;
   - fallback silencioso de `localizarProveedorERP()`.
3. Migrar todos los consumidores de pedidos, cambios y facturas a origen ERP.
4. Mantener búsqueda paginada y con debounce; no descargar un maestro completo si
   no es necesario.
5. Si falla la API, devolver un error claro y reintentable.
6. Al seleccionar proveedor, hidratar los campos visibles desde `acreedores/{id}`.
7. No usar nombres o cuentas almacenados en otra factura para completar una nueva.

### Fase 3. Completar la Edge Function de lectura

1. Añadir a la allowlist una regla exacta para:

   ```text
   ^acreedores/\d+/gastos$
   ```

   admitiendo únicamente los parámetros realmente soportados, por ejemplo
   `schema` si corresponde.
2. Añadir tests positivos y negativos de allowlist.
3. Mantener bloqueadas URL absolutas, `..`, rutas desconocidas y parámetros no
   permitidos.
4. Desplegar la Edge Function solo después de probar el paquete local.
5. Verificar con usuario autenticado `acreedores/17` y
   `acreedores/17/gastos`.

### Fase 4. Eliminar la validación contra caché

1. Cambiar `getValidationErrorsForFactura()` para que no consulte
   `acreedores_cache`.
2. Conservar validación estructural local.
3. Ejecutar validación de proveedor/cuenta contra API en el preflight autoritativo
   y antes de escribir.
4. Eliminar los mensajes que mencionen `acreedores_cache/ERP`.
5. Distinguir:
   - proveedor no encontrado por la API;
   - API no disponible;
   - cuenta diferente a la devuelta por ERP.
6. Añadir tests para los tres casos.

### Fase 5. Corregir ejercicio, tipo, régimen y fecha CTB

1. Ejercicio:
   - no derivarlo del año;
   - usar la configuración ERP activa;
   - corregir el fixture de Onduspan a `25`;
   - asegurar que el duplicado consulta con `25`.
2. Tipo:
   - no usar `Origen=MA` como `FRR_tipofactura`;
   - Onduspan debe conservar `OT`;
   - si no hay regla aprobada, selección manual.
3. Régimen:
   - no derivarlo del 21 %;
   - mantener `2110` como caso verificado de Onduspan;
   - si no hay regla, selección manual/revisión.
4. Fecha CTB:
   - eliminar copias automáticas no confirmadas;
   - aplicar una política configurada;
   - si no existe, una sola advertencia de revisión.
5. Exponer y administrar las reglas desde `AdminSettings` cuando se cree o amplíe
   una capacidad configurable.

### Fase 6. Sanear avisos y duplicados

1. Normalizar errores por campo/código para evitar duplicados.
2. Mostrar cada causa una sola vez.
3. Conservar y representar `severity`.
4. El duplicado ERP real sigue siendo bloqueante.
5. Mostrar empresa, ejercicio, proveedor, número y `FRR_id` del candidato.
6. Evitar que una fila local descartada actúe como duplicado válido.
7. Probar específicamente el caso que antes mostraba siete mensajes.

### Fase 7. Preservar la semántica contable

1. Mantener “Desglose de Gastos” para `FRR_igasto*/FRR_ctagasto*`.
2. Mantener CTB solo para filas `FRC_*` reales.
3. Mantener punteos como candidatos/enlaces a documentos de origen.
4. Mantener asiento como readback oficial Debe/Haber.
5. No fabricar CTB ni asiento desde gastos.
6. Modelar la liquidación de agricultor como desglose de base, usando cuentas y
   reglas devueltas/confirmadas por ERP.
7. No autocorregir la cantidad de ceros de `6000000010`/`60000000010`.
8. Mantener los punteos sin seleccionar por defecto.
9. No crear vencimientos desde el PDF sin política aprobada.

### Fase 8. Ampliar pruebas de aceptación

1. En `verify-facturas-recibidas-api.mjs`, afirmar también:

   ```text
   ejercicio 25
   régimen 2110
   tipo OT
   ```

2. Pruebas de frontend/mapeo:
   - Onduspan mantiene esos valores;
   - 17 punteos y 21 líneas no se confunden;
   - CTB vacío no crea líneas falsas;
   - asiento técnico y visible no se mezclan;
   - gastos siguen en su bloque.
3. Pruebas de liquidación de agricultor:
   - positivo + comisión negativa = base;
   - no se etiqueta como asiento real;
   - cuenta exacta procede de API/regla.
4. Pruebas de proveedor:
   - búsqueda y detalle por API;
   - error explícito si API cae;
   - cero fallback a Supabase.
5. Prueba de duplicado con ejercicio `25` y control negativo con `26`.

### Fase 9. Retirar físicamente `acreedores_cache`

Esta fase es destructiva y requiere un punto de control explícito.

1. Demostrar primero que no quedan accesos de runtime:

   ```text
   rg "acreedores_cache" src supabase/functions
   ```

   El resultado debe ser cero, salvo comentarios históricos justificados.
2. Preparar una migración nueva e idempotente en `supabase/migrations`.
3. Revisar dependencias, políticas, índices, grants, tipos y documentación.
4. Guardar una exportación recuperable de las 5 filas fuera de la base si se
   considera necesaria para rollback.
5. Detenerse y pedir al usuario confirmación expresa antes de ejecutar el
   `DROP TABLE` remoto.
6. Solo tras confirmación:
   - aplicar la migración;
   - comprobar que la tabla ya no existe;
   - regenerar tipos TypeScript;
   - verificar que frontend y Edge Functions siguen funcionando.
7. No reescribir migraciones históricas ya aplicadas; crear una migración nueva.

### Fase 10. Validación final y despliegue

Ejecutar como mínimo:

```text
npx tsc --noEmit
npm run build
npm run verify:facturas-api
```

Ejecutar también las pruebas unitarias específicas disponibles del módulo de
facturas.

Después:

1. Revisar el diff completo y separar cambios ajenos.
2. Documentar cualquier limitación externa que continúe, especialmente
   `reference_only` del asiento.
3. Si el usuario autoriza despliegue:
   - desplegar Edge Function;
   - desplegar frontend con el mecanismo existente del repositorio;
   - comprobar commit remoto y proceso/HTTP en el servidor;
   - probar la pantalla con un usuario autenticado.
4. No publicar secretos ni afirmar que el asiento se ha creado sin readback.

## 9. Criterios de aceptación

El trabajo no está terminado hasta cumplir todo lo siguiente:

- La UI de facturas no consulta `acreedores_cache`.
- Ningún servicio usa la caché como fallback silencioso.
- Los demás consumidores de acreedores también usan la API o han quedado
  explícitamente migrados dentro del alcance acordado.
- Un proveedor resuelto por API no recibe el falso error de caché.
- `/acreedores/{id}/gastos` atraviesa la Edge Function con autenticación.
- La caída de API se muestra como caída de API, no como proveedor inexistente.
- Onduspan conserva:
  - ejercicio `25`;
  - tipo `OT`;
  - régimen `2110`;
  - cuenta proveedor `41000000017`;
  - gasto `42.341,52` en `60200000001`;
  - 17 punteos y 21 líneas;
  - CTB vacío;
  - asiento `reference_only` sin líneas inventadas.
- `MA` de los punteos no modifica `FRR_tipofactura`.
- El porcentaje IVA no genera el régimen.
- La fecha CTB no se fuerza sin política.
- El duplicado usa empresa, ejercicio ERP, proveedor y número.
- Los avisos no aparecen duplicados y su severidad es visible.
- Gastos, CTB, punteos y asiento permanecen separados.
- No se generan vencimientos automáticamente desde el PDF sin regla.
- La prueba de aceptación cubre ejercicio, régimen y tipo.
- TypeScript, build y pruebas pasan.
- La tabla remota solo se elimina después de aprobación expresa y verificación de
  cero dependencias.

## 10. Archivos relevantes para empezar

```text
AGENTS.md
src/services/facturas.ts
src/services/agroirisAcreedores.ts
src/components/AcreedorCombobox.tsx
src/pages/FacturasRecibidas.tsx
src/components/facturas/AsientoContableTable.tsx
src/services/facturas.test.ts
supabase/functions/_shared/facturas-recibidas-erp.ts
supabase/functions/facturas-recibidas-erp-read/index.ts
scripts/verify-facturas-recibidas-api.mjs
docs/FACTURAS_RECIBIDAS_API_CONTRACT.md
docs/FACTURAS_RECIBIDAS_API_V2_STAGING.md
docs/CIERRE_PUNTEOS_CREDENCIALES_2026-07-21.md
docs/openapi/netagro-test-api-v0.2.0.json
docs/evidencias/facturas-recibidas/onduspan/README.md
docs/evidencias/facturas-recibidas/onduspan/factura-onduspan-A-00748886.pdf
docs/evidencias/facturas-recibidas/onduspan/pantalla-erp-onduspan-A-00748886.png
docs/evidencias/facturas-recibidas/onduspan/correo-campojoyma-tipos-y-cuentas-2026-07-07.txt
docs/evidencias/facturas-recibidas/onduspan/captura-liquidacion-agricultor-desglose.png
```

Rutas API de lectura relevantes:

```text
acreedores?nombre=ONDUSPAN&limit=10
acreedores/17
acreedores/17/gastos
facturasrecibidas?numero_factura=A-00748886&limit=20
facturasrecibidas/buscar?empresa_id=1&ejercicio=25&proveedor_id=17&numero_factura=A-00748886
facturasrecibidas/49305
facturasrecibidas/49305/ctb
facturasrecibidas/49305/punteos?include_lines=true
facturasrecibidas/49305/asiento
```

## 11. Límites que no se deben cruzar

- No ejecutar DDL contra MariaDB Netagro.
- No borrar `acreedores_cache` antes de retirar dependencias y obtener aprobación.
- No usar `git reset --hard`, `git checkout --` ni limpiar cambios del usuario.
- No exponer el JWT secreto del webhook.
- No llamar el webhook directamente desde el navegador.
- No usar una passphrase como si fuera un JWT.
- No inventar IDs de régimen o tipo.
- No interpretar `MA` como tipo de factura.
- No convertir gastos en CTB ni CTB en asiento.
- No seleccionar punteos automáticamente.
- No confundir ejercicio ERP con año natural.
- No declarar que la contabilización está completa mientras siga
  `reference_only`.

## 12. Resultado esperado del nuevo chat

El nuevo chat debe entregar:

1. Diagnóstico inicial del estado encontrado y diferencias respecto a este corte.
2. Plan actualizado si el código cambió.
3. Implementación por fases, preservando cambios ajenos.
4. Migración preparada para retirar la tabla, pero sin aplicar el borrado remoto
   hasta recibir confirmación expresa.
5. Pruebas y resultados verificables.
6. Lista de archivos modificados.
7. Estado de despliegue y limitaciones externas restantes.

## 13. Resultado de ejecución del 22/07/2026

El corte descrito en este plan se contrastó antes de implementar. Se confirmó
que todavía existían dependencias de runtime de <code>acreedores_cache</code> y
que las Edge Functions remotas no contenían el saneamiento; ambas diferencias
se resolvieron por fases sin descartar cambios del working tree.

- Se eliminaron todos los accesos de runtime y fallbacks a
  <code>acreedores_cache</code> en frontend y Edge Functions.
- Tras la confirmación expresa del usuario, se exportaron sus cinco filas y se
  aplicó la migración nueva
  <code>20260722190000_retire_acreedores_cache.sql</code>. La tabla, sus
  políticas y sus índices ya no existen en Supabase.
- La auditoría posterior detectó que <code>authenticated</code> todavía heredaba
  <code>TRUNCATE</code>, <code>REFERENCES</code> y <code>TRIGGER</code> en
  cabecera, CTB y punteos. La migración
  <code>20260722192000_revoke_facturas_recibidas_residual_table_privileges.sql</code>
  cerró esos privilegios; la lectura autenticada y el acceso operativo de
  <code>service_role</code> permanecen activos.
- La copia recuperable está en
  <code>docs/evidencias/facturas-recibidas/acreedores-cache-backup-2026-07-22.json</code>
  y tiene SHA-256
  <code>79F49160CA74A3B2CAE88C026627B258FB10D69F27B38B7EB28E389152E4B5BC</code>.
- Se desplegaron <code>facturas-recibidas-erp-read</code> v8,
  <code>factura-recibida-update</code> v9,
  <code>factura-recibida-ingest</code> v11,
  <code>factura-recibida-extraer</code> v7 y
  <code>factura-recibida-send-erp</code> v11. Las cinco quedaron activas y
  conservaron su política de JWT o autenticación propia.
- Los smokes anónimos confirmaron el rechazo esperado: <code>401</code> en las
  rutas protegidas y en el token propio de ingestión. La prueba autenticada
  queda pendiente por falta de una sesión o credenciales operativas utilizables.
- El frontend y el workflow n8n no se desplegaron: los hosts requieren acceso
  SSH o API no disponible en este entorno, y n8n exige exportar primero el
  workflow remoto para reemplazarlo de forma recuperable.
- La API de escritura continúa en <code>reference_only</code>; por tanto, este
  resultado no declara creado ningún asiento.

## 14. Continuación y prueba operativa del 23/07/2026

La factura ONDUSPAN `A-00748886` se utilizó exclusivamente como fixture de
mapeo y como prueba negativa de duplicado. No se importó la cabecera histórica
del ERP como sustitución del borrador y no se ejecutó ninguna escritura contra
Netagro.

- El workflow remoto `FIO92NfGcsWYsHC5` está activo con el nombre
  `CAMPOJOYMA - Entrada segura de facturas recibidas v2`. Su topología coincide
  con el artefacto seguro: calcula el SHA-256, deriva un `request_id` estable,
  extrae únicamente datos visibles, enriquece por la API y entrega un borrador
  a Supabase para revisión.
- `docs/n8n/campojoyma-factura-recibida-extraccion-final.json` permanece solo
  como plantilla legacy del generador. No debe importarse. El artefacto
  desplegable es
  `docs/n8n/campojoyma-factura-recibida-extraccion-segura-v2.json`.
- El workflow de escritura `4wu0VF2RiwT4eyJC`,
  `Campojoyma - Facturas recibidas write v2 (DESACTIVADO)`, permanece inactivo.
- El borrador local de prueba conserva todos los campos contrastados, pero sigue
  en `pendiente_revision`/`draft`, con `FRR_Contabilizar=N`,
  `remote_frr_id=null`, CTB y punteos vacíos y cero intentos de sincronización.
- El borrador de prueba de EJIDO CARTON `26140889` quedó descartado mediante la
  aplicación. Nunca tuvo `remote_frr_id` ni intentos de escritura ERP.
- El preflight autenticado bloqueó correctamente el envío al localizar el
  duplicado real `FRR_id=49305` con empresa `1`, ejercicio `25`, proveedor `17`
  y número `A-00748886`.
- La prueba de contrato para una factura PDF nueva confirma que se trasladan
  cabecera, cinco tramos de IVA y cuatro gastos; admite hasta cuatro
  vencimientos solo si fueron confirmados explícitamente en revisión. Nunca
  envía `FRR_id`, `FRR_numero` ni `FRR_IdAsientoNet`; CTB y punteos solo se
  envían cuando existen de forma explícita y manual.
- Pasaron `npx tsc --noEmit`, 42 pruebas Vitest, 48 pruebas Deno, la build de
  producción y la aceptación de lectura real de ONDUSPAN. Esta última mantiene
  la contabilidad en `reference_only`.

El siguiente bloqueo es operativo: antes de una alta real deben desplegarse y
verificarse FastAPI v0.2, su almacén de idempotencia, el túnel `18001 → 8001`,
los grants sin DDL y una ventana controlada de escritura. Después se necesita
un PDF con número de factura realmente nuevo; ONDUSPAN no puede reutilizarse
para una alta porque ya existe en el ERP.
