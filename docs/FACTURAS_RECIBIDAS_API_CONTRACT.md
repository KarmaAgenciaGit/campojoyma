# Contratos canónicos de facturas recibidas

Versiones vigentes:

- extracción e ingestión: `contract_version=2`;
- validación y alta de gestión ERP: `contract_version=3`.

Esta especificación define el intercambio entre frontend, Supabase/Edge Functions,
n8n y la FastAPI de la copia de Netagro. Su objetivo es conservar la factura sin
pérdidas, impedir duplicados y no afirmar que existe un asiento mientras no pueda
verificarse en el diario oficial.

Referencias:

- [OpenAPI FastAPI v0.3.2](openapi/netagro-test-api-v0.3.2.json)
- [OpenAPI FastAPI v0.3.1 histórico y rollback](openapi/netagro-test-api-v0.3.1.json)
- [OpenAPI FastAPI v0.3.0 histórico](openapi/netagro-test-api-v0.3.0.json)
- [Plan maestro vigente](PLAN_MAESTRO_FACTURAS_RECIBIDAS_2026-07-30.md)
- [Acta de despliegue v3](DESPLIEGUE_FACTURAS_RECIBIDAS_V3_2026-07-31.md)
- [Runbook v2 histórico](FACTURAS_RECIBIDAS_API_V2_STAGING.md)
- [OpenAPI v0.2.4 histórico](openapi/netagro-test-api-v0.2.0.json)
- [Workflow n8n write v2 desactivado](n8n/campojoyma-facturas-recibidas-write-v2.disabled.json)
- [Agente de extracción v4 y regeneración segura](n8n/FACTURA_RECIBIDA_EXTRACTION_AGENT_V3.md)

El OpenAPI v0.3.2 es la fuente verificable del runtime actual. Los ficheros
v0.3.1, v0.3.0 y v0.2.0, junto con el runbook v2, se conservan como evidencia histórica
y no deben usarse para activar escrituras. La resolución canónica del proveedor, la lectura de
albaranes GE y la búsqueda exacta de facturas sin conocer previamente el
ejercicio continúan formando parte del contrato vigente.

## Principios del modelo

- La factura es el documento recibido del proveedor.
- `FRR_tipofactura` identifica el circuito de la factura. En la evidencia
  contrastada, `GE` corresponde a `Compras de Género` y resuelve el tercero en
  `agricultores`; `OT` y los demás tipos muestreados corresponden al circuito de
  acreedores.
- `Origen` identifica la familia del albarán o gasto punteado y es un eje
  diferente. Una factura `OT` puede contener punteos `MA`; nunca se copia
  `Origen` a `FRR_tipofactura`.
- `FRR_idproveedor` no es global entre maestros: un mismo número puede existir
  en `acreedores` y `agricultores`. Toda lectura debe conservar el tipo de
  entidad y resolver por el maestro correcto.
- Los campos `FRR_igasto*/FRR_ctagasto*` son las cuatro posiciones de gasto de la
  cabecera.
- Las filas `FRC_*` son el desglose CTB real. No se fabrican a partir de los gastos.
- Un asiento es el conjunto verificable de apuntes Debe/Haber del diario oficial.
- `FRR_IdAsientoNet` es solo el identificador técnico. No es el número visible.
- La copia actual permite leer el diario y verificar asientos históricos, pero no
  contiene el mecanismo oficial para crear un asiento nuevo. `created` solo es
  válido tras readback exacto; el POST escritor sigue bloqueando
  `FRR_Contabilizar="S"`.

## Alta o preflight

### Operación

```http
POST /facturasrecibidas
Content-Type: application/json
```

El cliente v2 debe enviar siempre el siguiente sobre:

```json
{
  "contract_version": 2,
  "request_id": "a1bd3078-c5e8-42a6-a90b-37f2c5869197",
  "dry_run": true,
  "cabecera": {},
  "ctb": [],
  "punteos": []
}
```

| Campo | Tipo | Regla |
|---|---|---|
| `contract_version` | entero | Debe ser `2`. |
| `request_id` | UUID | Obligatorio en v2; identifica el intento de extremo a extremo. |
| `dry_run` | booleano | Debe enviarse expresamente. Primero `true`; después, si procede, `false` con el mismo UUID y payload funcional. |
| `cabecera` | objeto | Campos de la factura `FRR_*` y vencimientos permitidos. |
| `ctb` | array | Solo filas `FRC_*` reales. Puede ser `[]`. |
| `punteos` | array | Enlaces seleccionados por el usuario o solicitudes MA exactas verificadas en dos capas. Una marca del modelo o del origen no es autoridad por sí sola. |

Las selecciones recibidas desde extracción se consideran no confiables y se
sanean primero a `S=false`. Edge solo vuelve a activar el conjunto cuando todas
las referencias MA documentadas son exactas, únicas, completas, pendientes,
coherentes con empresa/acreedor y uno-a-uno, con un máximo de 25. Cualquier
respuesta parcial, ambigua o discordante deja todos los candidatos sin
seleccionar. Los vínculos de una factura ya existente son evidencia de lectura
y tampoco se vuelven a seleccionar.

Por compatibilidad, la FastAPI aún acepta el parámetro query `dry_run` y el contrato
v1 sin los campos nuevos. En v2, `dry_run` del cuerpo tiene prioridad. Todo consumidor
nuevo debe usar exclusivamente el sobre v2.

### Cabecera

La API conserva las 74 columnas del contrato físico de `facturasrecibidas`, entre
ellas:

- Identidad funcional: empresa, ejercicio, centro, proveedor, cuenta y número de
  factura del proveedor.
- Fechas: factura, CTB, previsión de pago y vencimientos.
- Hasta cinco bases, tipos y cuotas de IVA.
- Base, porcentaje y cuota de retención; clave IRPF y cuota no deducible.
- Cuatro importes/cuentas de gasto.
- Forma de pago, banco, cartera, suplidos y agricultor a descontar.
- Concepto de asiento, observaciones generales y observaciones AEAT.
- Controles ERP `S/N`, total y datos de cartera.

Campojoyma confirmó el 28/07/2026 que `Agricultor descontar` no se utiliza.
`FRR_IdAgricultorDto` continúa en las 74 columnas por compatibilidad con el
contrato físico, pero no se expone como dato editable ni se deduce en el
frontend. El payload hacia Netagro conserva el valor neutro requerido por el
contrato. La evidencia está en
[la carpeta funcional del 28/07/2026](evidencias/facturas-recibidas/actualizacion-proyecto-2026-07-28/).

Campos mínimos para detectar duplicados:

```text
FRR_Idempresa
FRR_ejercicio
FRR_idproveedor
FRR_numerofactura
FRR_tipofactura (circuito canónico)
```

La unicidad física de staging usa empresa, ejercicio, proveedor, número de
factura sin espacios exteriores (`btrim`) y circuito canónico. `GE` pertenece
al circuito `agricultor`; cualquier otro código no vacío pertenece a
`acreedor`; un tipo nulo o vacío queda en `desconocido`, separado de los dos
anteriores. Edge aplica además una normalización alfanumérica para comparar
identidades visibles antes de persistir. No debe confundirse esa comparación
más estricta con la expresión del índice de Supabase. De este modo, un mismo
identificador numérico puede existir legítimamente en los maestros de
agricultores y acreedores sin desactivar la protección contra duplicados dentro
de cada circuito.

`FRR_tipofactura` también se requiere para generar el número interno.

El cliente v2 no puede inyectar:

```text
FRR_id
FRR_numero
FRR_IdAsientoNet
FRR_IdUsuarioLog
FRR_FechaLog
FRR_HoraLog
FRR_IdfacturaRec
```

Los valores no vacíos se rechazan y estos campos se eliminan del payload antes de
generar la propuesta. `FRR_id` y `FRR_numero` los genera la API; el identificador de
asiento solo puede devolverlo el mecanismo oficial del ERP.

Mientras el mecanismo oficial no esté disponible, un request v2 con
`FRR_Contabilizar="S"` se bloquea durante el dry-run. No se crea una factura que
quede falsamente presentada como contabilizada.

### CTB

Una fila de entrada puede contener:

```json
{
  "FRC_Importe": 42341.52,
  "FRC_Cuenta": "60200000001",
  "FRC_IdActividad": null,
  "FRC_Idseccion": null,
  "FRC_Iddepartamento": null,
  "FRC_Idsubdepartamento": null
}
```

El cliente no puede fijar:

```text
FRC_id
FRC_idfacturarecibida
FRC_IdUsuarioLog
FRC_FechaLog
FRC_HoraLog
```

Si la factura no tiene CTB real, debe enviarse `ctb: []`. Los gastos de cabecera no
se convierten en CTB.

### Punteos

Forma de cada selección:

```json
{
  "source_table": "albmaterial",
  "source_id": 23265,
  "importe_factura": 1056.0
}
```

Valores admitidos para `source_table`:

```text
albsalida_gastos
albentrada_hisgastos
albaranescompra_gastos
facturas_gastos
albarancoste
albmaterial
```

`albentrada_his` no se admite en este catálogo de escritura. En v0.2.2 se
consulta únicamente para reconstruir los albaranes de género que Netagro ya
ligó a una factura mediante `AEH_idfacturafirme`; no es un candidato ni puede
enviarse en `punteos`.

Reglas:

- `source_id` debe ser positivo, existir y estar sin enlazar.
- En `albmaterial`, la tabla física no tiene `AMA_id`. La PK estable es
  `AMA_idalb`; por tanto `source_id=AMA_idalb` y el origen visual es `MA`.
- Para MA, `importe_factura` puede omitirse o coincidir con `AMA_importe` completo
  con tolerancia de `0,01`. Se rechazan repartos parciales o diferentes.
- La API no cambia importes de MA; únicamente enlaza `AMA_idfactura` cuando los
  permisos y la capacidad estén habilitados.
- La escritura de MA permanece bloqueada hasta que el usuario de escritura tenga
  `SELECT, UPDATE` sobre `netagrocomer.albmaterial` y se active
  `ALBMATERIAL_WRITES_ENABLED=true`.

## Respuesta normalizada

Todos los resultados v2 usan la siguiente forma:

```json
{
  "ok": false,
  "contract_version": 2,
  "request_id": "a1bd3078-c5e8-42a6-a90b-37f2c5869197",
  "dry_run": true,
  "would_create": false,
  "factura": {
    "FRR_id": 49399,
    "FRR_numero": 1,
    "FRR_IdAsientoNet": 0
  },
  "ctb": [],
  "punteos": [],
  "validations": {
    "errors": [
      {
        "field": "cabecera.FRR_Contabilizar",
        "error": "official Netagro accounting mechanism is unavailable in the test copy; invoice and journal entry were not created"
      }
    ],
    "warnings": []
  },
  "accounting": {
    "requested": true,
    "created": false,
    "status": "unavailable",
    "technical_id": null,
    "visible_number": null,
    "date": "2026-06-30",
    "concept": "FRA. ONDUSPAN, S.A",
    "balanced": null,
    "total_debit": null,
    "total_credit": null
  },
  "duplicate": null,
  "readback_confirmed": false,
  "FRR_id": 49399,
  "FRR_numero": 1,
  "FRR_IdAsientoNet": 0,
  "ids_punteos_enlazados": [],
  "punteos_requested": [],
  "validation_errors": [],
  "erp_errors": []
}
```

Semántica:

- `ok=true` en dry-run significa que no hay errores de validación.
- `would_create=true` significa que la propuesta podría pasar a escritura; no
  confirma que se haya escrito.
- En una escritura, `ok=true` requiere al menos lectura posterior de la cabecera.
- `validations.errors` contiene errores bloqueantes y `warnings` avisos operativos.
- `factura`, `ctb` y `punteos` representan la propuesta en dry-run y el resultado
  leído/enlazado después de una escritura.
- El workflow n8n no finaliza hasta consultar también CTB, punteos y asiento.

### Compatibilidad temporal

Se conservan en el nivel superior:

```text
FRR_id
FRR_numero
FRR_IdAsientoNet
ids_punteos_enlazados
punteos_requested
validation_errors
erp_errors
```

Son aliases de transición. Los clientes nuevos deben consumir `factura`, `punteos`,
`validations` y `accounting`.

## Dry-run, idempotencia y reconciliación

Secuencia obligatoria:

1. Generar un UUID `request_id`.
2. Enviar el payload con `dry_run=true`.
3. Mostrar y resolver todos los errores.
4. Si el usuario confirma, enviar el mismo contenido funcional y el mismo UUID con
   `dry_run=false`.
5. Leer cabecera, CTB, punteos y asiento antes de finalizar en Supabase.

El dry-run no reserva el UUID porque no escribe.

En escritura v2:

- Se calcula un hash estable del payload funcional, incluyendo operación y esquema
  Netagro para impedir replays cruzados; se excluyen `dry_run` y el propio UUID.
- Un UUID nuevo queda `in_progress`.
- Si termina y se confirma la lectura, queda `completed` con la respuesta guardada.
- Repetir el mismo UUID y payload completado devuelve exactamente la respuesta
  persistida.
- Reutilizar el UUID con otro payload devuelve `409`.
- Un estado `in_progress` o `needs_reconciliation` devuelve `409` y nunca dispara
  otra alta a ciegas.

El diario se guarda fuera de Netagro en un SQLite lateral provisionado
explícitamente durante el despliegue. La ruta es obligatoria y absoluta:

```text
FACTURAS_IDEMPOTENCY_DB=/var/lib/netagro-api/idempotency.sqlite3
```

Reglas obligatorias del runtime:

- Solo abre el fichero existente con URI SQLite `mode=rw`; nunca `mode=rwc`.
- No crea directorios, ficheros, tablas ni migra esquemas al importar, arrancar o
  atender una petición.
- Valida `PRAGMA user_version=1`, columnas, tipos, nulabilidad, clave primaria,
  restricción de estados y huella exacta de `factura_requests`.
- Con escrituras habilitadas, un almacén ausente, vacío, incompatible, bloqueado o
  no escribible impide el arranque.
- Si el almacén falla al reservar una petición, responde
  `503 idempotency_store_unavailable` antes de abrir una conexión de escritura a
  MariaDB.
- Una escritura real con `contract_version=1` se rechaza; toda escritura exige v2
  y `request_id`.

El único lugar autorizado para crear la tabla es la herramienta explícita de
despliegue del working tree local de `KarmaAgenciaGit/api-campojoyma`. En Linux,
el directorio debe crearse antes con propietario igual al usuario del servicio y
modo `0700`; el script se ejecuta como ese usuario y crea el fichero con `0600`:

```bash
install -d -m 0700 -o netagro-api -g netagro-api /var/lib/netagro-api
sudo -u netagro-api python scripts/provision_idempotency_store.py \
  /var/lib/netagro-api/idempotency.sqlite3
```

El script no crea el directorio y el servicio debe usar `UMask=0077` para proteger
los ficheros WAL/SHM. La herramienta solo conoce SQLite y nunca se conecta a
MariaDB. El usuario lector admite únicamente `USAGE`/`SELECT` en las allowlists de
negocio y contabilidad; el escritor separado admite además `INSERT`/`UPDATE` solo
en su allowlist propia. La API y el gate de despliegue verifican sus grants mediante
`SHOW GRANTS` en cada conexión y fallan ante scopes globales/ajenos, DDL, roles, `ALL PRIVILEGES` o
`GRANT OPTION`; no intentan corregir los permisos.

Una escritura solo pasa a `completed` si el readback confirma la cabecera, todas las
filas CTB y cada punteo (incluido el importe cuando aplica). Si la escritura pudo
confirmarse en MariaDB pero cualquier lectura falta o difiere, responde
`503 readback_unconfirmed`, guarda `needs_reconciliation` y declara
`retry_safe=false`.

Este backend SQLite solo es válido si existe un único writer lógico y todos los
workers comparten el mismo fichero persistente. No puede quedar la v0.1 escribiendo
en paralelo ni desplegarse otra réplica con store local independiente. La herramienta
`scripts/reconcile_factura_request.py`, incorporada en `api-campojoyma@a4bdc53`,
solo permite completar un estado `needs_reconciliation` con writes apagadas, el
payload original, el mismo hash, una única coincidencia y readback completo. Los
estados ambiguos nunca se desbloquean editando el SQLite a mano.

Ante timeout o resultado incierto, el consumidor debe buscar por empresa, ejercicio,
proveedor y número de factura; después debe leer el detalle y solo entonces decidir
si el intento requiere intervención manual.

## Lectura de factura y CTB

### Cabecera

```http
GET /facturasrecibidas/{factura_id}
```

Desde v0.2.2, listado y detalle devuelven las columnas ERP junto a una identidad
normalizada:

```text
proveedor_tipo
proveedor_id
proveedor_nombre
proveedor_nif
acreedor_id / acreedor_nombre / acreedor_nif
agricultor_id / agricultor_nombre / agricultor_nif
```

Para `FRR_tipofactura="GE"`, el proveedor canónico se obtiene de
`agricultores`; para los demás tipos observados, de `acreedores`. Los campos
específicos del maestro no aplicable quedan a `null`. Esto evita falsos matches
cuando ambos maestros contienen el mismo identificador numérico.

### CTB

```http
GET /facturasrecibidas/{factura_id}/ctb
GET /facturasrecibidas_ctb?factura_id={factura_id}
```

Respuesta:

```json
{
  "items": []
}
```

Un array vacío significa que no existen filas CTB. No autoriza a generarlas desde
los gastos.

## Lectura de punteos

### Punteos ya vinculados

```http
GET /facturasrecibidas/{factura_id}/punteos?limit=200&offset=0&include_lines=true
```

Respuesta:

```json
{
  "items": [
    {
      "id_interno_estable": "AMA:23265",
      "source_table": "albmaterial",
      "source_id": 23265,
      "factura_recibida_id": 49305,
      "Origen": "MA",
      "Serie": "A26",
      "Albaran": 2108,
      "Ref": "479628",
      "Fecha": "2026-06-29",
      "Importe P": "0.00",
      "Importe": "87.40",
      "S": "S",
      "Ver": "S",
      "line_count": 1,
      "lines": [
        {
          "line_id": 1,
          "position": 1,
          "article_id": 123,
          "description": "Material",
          "reference": null,
          "quantity": "1.0000",
          "unit_price": "87.400000",
          "purchase_price": "87.400000",
          "discount_pct": "0.00",
          "plastic_amount": "0.000000",
          "amount": "87.40",
          "observations": null,
          "unit_id": 1
        }
      ]
    }
  ],
  "limit": 200,
  "offset": 0,
  "total": 17,
  "include_lines": true
}
```

`lines` solo se incorpora cuando `include_lines=true`. Para fuentes distintas de MA
o GE es `[]`; `line_count` sigue disponible.

La API v0.2.2 añade a esta lectura los albaranes GE ya vinculados:

- `source_table="albentrada_his"` y `Origen="GE"`;
- enlace histórico por `AEH_idfacturafirme=FRR_id`;
- referencia a la cabecera mediante `AEH_idalbaran`;
- líneas leídas de `albentrada_hislineas` cuando `include_lines=true`;
- proveedor canónico de tipo `agricultor`.

Estas filas exponen tres importes con semántica explícita:

- `importe_origen`: base registrada en el histórico del albarán;
- `importe_factura`: parte de la base de la factura atribuida a esa fila;
- `importe_metodo`: `base_historica` o `prorrateo_base_factura`.

Cuando la suma histórica difiere de la base de la factura, v0.2.2 reparte esta
última proporcionalmente y conserva ambos importes; no sobrescribe ni
reinterpreta el histórico. La suma de `importe_factura` representa la factura y
la de `importe_origen` conserva la evidencia ERP. Para evitar residuos por
redondeo en GE multi-albarán, todas las filas salvo la de mayor `AEH_id` se
redondean a céntimos y esa última absorbe la diferencia; así la suma coincide
exactamente con la base de la factura.

En los orígenes legacy `albsalida_gastos` y `facturas_gastos`,
`importe_origen` conserva el gasto bruto (`Importe`) e `importe_factura` usa el
importe realmente asignado (`Importe P`). En ese caso
`importe_metodo=importe_asignado_factura`.

### Candidatos

```http
GET /albaranes-gastos/punteables
```

Filtros:

```text
source_table
proveedor_id
empresa_id
referencia
fecha_desde
fecha_hasta
solo_pendientes
limit
offset
```

La respuesta es `{items, limit, offset, total}`.

`referencia` es opcional, elimina únicamente los espacios exteriores y exige
igualdad exacta contra el campo `Ref`. Se combina mediante `AND` con
`source_table`, proveedor, empresa, fechas y estado pendiente; no hace búsqueda
parcial ni selecciona por sí sola un albarán.

`albentrada_his` queda expresamente fuera de este endpoint y de todas las
mutaciones. La evidencia disponible solo autoriza a leer vínculos GE ya
existentes, no a proponer, seleccionar o enlazar nuevos albaranes de género.

### Líneas MA bajo demanda

La FastAPI v0.2.4 desplegada incorpora:

```http
GET /albaranes/material/{material_id}/lineas
```

`material_id` es el `AMA_idalb` positivo de la cabecera `albmaterial`. La
respuesta es `{items}` y conserva la proyección de `albmateriallineas`:
artículo, descripción, referencia, cantidad, precios, descuento, plástico,
importe, observaciones y unidad.

El frontend consulta esta ruta únicamente al desplegar una fila MA y mantiene
la respuesta en memoria durante esa vista. `punteables` sigue devolviendo solo
cabeceras; el payload de guardado conserva `source_table`, `source_id` y, cuando
aplica a GE, `albaran_id`, pero nunca persiste `lines` ni `source_lines`.

## Lectura del asiento

```http
GET /facturasrecibidas/{factura_id}/asiento
```

Forma:

```json
{
  "factura_id": 49305,
  "accounting": {
    "requested": true,
    "created": true,
    "status": "created",
    "technical_id": 390305,
    "visible_number": "48732",
    "date": "2026-06-30",
    "concept": "FRA. ONDUSPAN, S.A",
    "balanced": true,
    "total_debit": "51233.24",
    "total_credit": "51233.24"
  },
  "entries": [
    {"position": 1, "account": "41000000017", "debit": "0.00", "credit": "51233.24"},
    {"position": 2, "account": "60200000001", "debit": "42341.52", "credit": "0.00"},
    {"position": 3, "account": "47200000008", "debit": "8891.72", "credit": "0.00"}
  ],
  "source": {
    "schema": "netagrocomer",
    "account_schema": "contabilidad",
    "mechanism": "ledger_readback",
    "creation_mechanism": "unavailable",
    "ledger_available": true,
    "available_accounting_tables": [
      "asientos",
      "asientolineas",
      "ivasoportado",
      "cuentas"
    ],
    "missing_capability": "Endpoint o procedimiento oficial de Netagro para crear el asiento"
  },
  "warnings": []
}
```

Estados admitidos:

| Estado | Significado |
|---|---|
| `not_requested` | La factura no solicita contabilización. |
| `pending` | Reservado para un mecanismo oficial que haya aceptado el trabajo pero aún no lo confirme. |
| `created` | Asiento del diario leído, origen `FR` coincidente y Debe/Haber cuadrado. |
| `reference_only` | Existe ID técnico, pero no diario para verificar número visible ni Debe/Haber. |
| `unavailable` | Se solicitó contabilización, pero el mecanismo oficial no está disponible. |
| `error` | El mecanismo oficial devolvió un error confirmado. |

La copia puede devolver `created=true` para asientos históricos verificados. Esto
no implica que la API pueda crear asientos nuevos.

## Listados, búsqueda y catálogos

Operaciones principales:

| Operación | Uso |
|---|---|
| `GET /facturasrecibidas` | Listado paginado y filtrado de facturas recibidas. |
| `GET /facturasrecibidas/buscar` | Búsqueda exacta por empresa, proveedor, número y circuito; acepta ejercicio o fecha de factura. |
| `GET /facturasrecibidas/tipos` | Valores históricos de tipo de factura. |
| `GET /acreedores` | Búsqueda por NIF, texto o código. |
| `GET /acreedores/{id}` | Detalle del acreedor. |
| `GET /acreedores/{id}/gastos` | Reglas/cuentas de gasto del acreedor. |
| `GET /agricultores` | Búsqueda explícita de productores; no se mezcla su identidad con acreedores. |
| `GET /agricultores/{id}` | Detalle autoritativo del agricultor. |
| `GET /agricultores/{id}/gastos` | Gastos configurados para agricultor. |
| `GET /empresas` | Empresas disponibles. |
| `GET /cuentas-contables` | Cuenta, descripción, NIF, contrapartida, IVA, IRPF, pago y banco. `q` busca solo por cuenta/descripción; `nif` exige parámetro explícito. |
| `GET /tipos-iva` | Tipos de IVA observados en las tablas maestras. |
| `GET /regimenes` | Regímenes observados en facturas recibidas. |
| `GET /formas-pago` | Formas de pago. |
| `GET /bancos` | Bancos. |
| `GET /series-factura` | Series auxiliares; no mapear automáticamente a tipo de factura. |
| `GET /conceptos-factura` | Conceptos auxiliares; no sustituir automáticamente `FRR_Concepto`. |

Desde FastAPI 0.3.2, el texto libre `q` de `/cuentas-contables` no busca en el
NIF. Para localizar un tercero por NIF hay que enviar `nif` de forma explícita.
La comprobación de release obtuvo `total=0` con `cuenta=603` y 10 resultados
con `q=603`, sin CANALEX entre ellos.

La búsqueda exacta requiere siempre `empresa_id`, `proveedor_id` y
`numero_factura`. `ejercicio` es opcional desde v0.2.4:

- con `ejercicio`, la consulta filtra ese ejercicio exacto;
- sin `ejercicio`, `fecha_factura` pasa a ser obligatoria;
- `tipo_factura` acota el circuito canónico y evita confundir `GE` con
  acreedores;
- una petición sin ejercicio ni fecha devuelve `422`.

Aunque la API conserva `tipo_factura` como filtro opcional para compatibilidad,
el flujo Campojoyma debe enviarlo siempre que conozca el circuito.

El consumidor debe validar también empresa, proveedor, número, fecha y circuito
de cada candidato. Una respuesta vacía, múltiple o incoherente no permite
recuperar el ejercicio ni declarar un duplicado único.

## Errores y códigos HTTP

| HTTP | Caso |
|---:|---|
| `200` | Lectura correcta o dry-run procesado. Puede contener `ok=false` con errores de negocio. |
| `400` | Esquema/columna no permitidos o parámetro funcional inválido. |
| `403` | Escrituras deshabilitadas para la API o esquema. |
| `404` | Factura, acreedor u otro recurso no encontrado. |
| `409` | UUID en uso o con payload distinto, reconciliación pendiente, lock no adquirido o duplicado concurrente. |
| `422` | JSON/Pydantic inválido o conflicto detectado durante la transacción de punteos. |
| `500` | Error inesperado. El consumidor no debe reintentar una escritura sin reconciliar. |

Los errores de validación funcional se devuelven como:

```json
{
  "field": "punteos[0].importe_factura",
  "error": "albmaterial only accepts its full AMA_importe; partial or different allocation is not supported"
}
```

## Flujo n8n y finalización

Hay dos workflows con estados distintos:

- el extractor v4 remoto está activo y entrega borradores a Supabase;
- el escritor v2 permanece desactivado hasta cerrar los bloqueos de
  contabilización del runbook.

Cuando se autorice el escritor:

1. Validar formato, UUID y arrays.
2. Enviar siempre el preflight con `dry_run=true`.
3. Si `ok=false`, responder sin escribir.
4. Si el request original era dry-run, devolver el preflight.
5. Para escritura confirmada, enviar `dry_run=false` una sola vez.
6. Exigir `ok=true` y `FRR_id` positivo.
7. Leer de nuevo:
   - `/facturasrecibidas/{id}`
   - `/facturasrecibidas/{id}/ctb`
   - `/facturasrecibidas/{id}/punteos?include_lines=true`
   - `/facturasrecibidas/{id}/asiento`
8. Si falta una lectura o el asiento solicitado no está en `created`, devolver
   `reconciliation_required`/`accounting_unverified`, con `retry_safe=false`.

Las exportaciones versionadas:

- usan autenticación JWT administrada por n8n;
- no contienen secretos: JWT, ingest, renderizador PDF y OpenAI se resuelven
  mediante credenciales n8n;
- no tienen `pinData`;
- no guardan ejecuciones correctas, erróneas ni manuales con payloads.

La exportación local del extractor conserva `active=false` para que importarla
no active nada por accidente. Esto no contradice que la copia remota desplegada
esté activa.

## Estado operativo trazado

- API v3 vigente: FastAPI 0.3.2 en `karma-box:8001`, expuesta al VPS por
  `18001` y por el gateway HTTPS autenticado. El runtime mantiene
  `write_mode=disabled` y `accounting_mode=unavailable`.
- Release activa: `29effcccaccf` sobre el cambio funcional `060484b`, verificada
  con 196 pruebas y OpenAPI de 46 rutas/47 operaciones. La release 0.3.1 se
  conserva como rollback inmediato.
- La búsqueda contable 0.3.2 limita `q` a cuenta/descripción y reserva `nif`
  para el parámetro explícito; el smoke `q=603` devolvió 10 resultados sin
  CANALEX.
- Extractor n8n v4.2: declarado activo en remoto el 29/07/2026 con 32 nodos,
  cinco `httpRequestTool` GET y el webhook
  `campojoyma-factura-extraer` registrado. El validador local supera 18
  escenarios y la exportación canónica permanece inactiva para evitar una
  activación accidental.
- Escritor n8n v2: inactivo y archivado tras una ventana controlada.
- La cabecera no contabilizada `TEST-A-00748886-01` se creó exactamente una vez
  durante esa ventana (`FRR_id=49681`, `FRR_numero=5425`) y se reconcilió por
  readback sin repetir el POST. Esta evidencia no homologa todavía una operación
  continua.
- Escritura MA deshabilitada por falta de grants mínimos y por
  `ALBMATERIAL_WRITES_ENABLED=false`.
- Contabilización v2 bloqueada por ausencia del mecanismo oficial de creación
  del asiento. El diario sí permite readback de asientos históricos.
- Producción no se ha modificado.

El estado de la API 0.3.2 fue verificado el 31/07/2026. Los estados de n8n y la
evidencia de altas de prueba de los puntos siguientes proceden de las tareas
del 29/07/2026 y se conservan como historia, no como habilitación del writer.

El lote final de diez facturas superó la extracción e ingesta sin errores
bloqueantes. Todas quedaron con fecha CTB igual a la fecha de factura,
ejercicio 25, régimen 2110 y tipo OT. Esta aceptación valida el flujo de
borrador y revisión; no altera las restricciones del escritor ni acredita la
creación de un asiento.

El backup previo al reemplazo remoto está en
`/root/campojoyma-pre-full-replace-20260729T143008.json`, modo `600`, SHA-256
`bcd1686288bac99f0241d8d4e85e3477a6195134e31d9f9eaec25048004de102`.

La recuperación, futuras promociones y rollback vigentes están detallados en
el [acta de despliegue v3](DESPLIEGUE_FACTURAS_RECIBIDAS_V3_2026-07-31.md).
