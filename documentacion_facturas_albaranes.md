# Documentacion tecnica: facturas y albaranes Netagro

> Copia sincronizada del documento canonico en el repositorio local
> `api-campojoyma/docs/documentacion_facturas_albaranes.md`. Sus secciones de estado
> y despliegue son una fotografia historica del 15 de julio de 2026 y no autorizan
> activar escrituras. Para el estado actual, consultar el informe de relevo y el
> runbook v2 de `docs/`.

Generado a partir de la copia local `netagrocomer` el `2026-06-29T16:01:26Z`.
Actualizado el `2026-07-15` con auditoria completa de la FastAPI, sus 41 operaciones,
los endpoints de agricultores y catalogos, el contrato de escritura y el estado real
de despliegue.

## Alcance y cautelas

- Esta documentacion se ha generado contra la copia local del VPS intermedio (`karma-box`), no contra produccion.
- MariaDB no declara claves foraneas para estas tablas: `information_schema.REFERENTIAL_CONSTRAINTS` devuelve 0 filas. Las relaciones descritas son relaciones logicas inferidas y validadas con datos.
- Los nombres de columnas siguen prefijos historicos del ERP: `FRA` factura cliente, `ASA` albaran salida, `AEN` albaran entrada, etc.
- La base no contiene comentarios de columna. El significado se infiere por nombre, tipo, indices y uso en consultas reales; los campos funcionales finos deben validarse con usuarios de negocio antes de escribir en produccion.
- Fechas `1900-01-01`, `1900-01-01T00:00:00` o `0000-00-00` aparecen como valor nulo funcional/heredado.
- La API de pruebas apunta exclusivamente a la copia MariaDB del servidor intermedio
  (`karma-box`). Las lecturas usan `netagro_api`; el unico endpoint de escritura usa
  `netagro_api_write`, esta limitado a `netagrocomer` y nunca debe apuntar a produccion.
- La referencia canonica funcional vive en el repositorio local `api-campojoyma`;
  este archivo es una copia de consumo para el frontend.

## Actualizacion de copia de pruebas 2026-07-08

La copia local del VPS intermedio se actualizo con un nuevo dump de produccion el `2026-07-08T10:21:09Z`, manteniendo la base original como solo lectura desde el procedimiento de dump.

Ficheros generados en el intermedio:

| Fichero | Uso | Tamano | SHA256 |
|---|---|---:|---|
| `/home/karma/db_clone/local-before-20260708-102109.sql.gz` | Backup de la copia local anterior antes del restore | 790 MB | `b93cf43ebbd2069a6874499c6d14f948e066f0ee7dfe3a19c8c1a97856d54a28` |
| `/home/karma/db_clone/prod-nonsystem-20260708-102109.sql.gz` | Nuevo dump de produccion restaurado en pruebas | 793 MB | `ebd5c97c7df682080cdd514e23a4e00ce11df79108c406649d732d729582977e` |
| `/home/karma/db_clone/validation-local-20260708-102109.txt` | Informe de validacion posterior | 613 B | n/d |
| `/home/karma/db_clone/update-20260708-102109.log` | Log del proceso completo | 4.5 KB | n/d |

Validacion posterior en `karma-box`:

| Metrica | Valor |
|---|---:|
| Esquemas de aplicacion | 47 |
| Tablas | 3471 |
| Vistas | 95 |
| Rutinas | 88 |
| `netagrocomer.acreedores` | 1836 |
| `netagrocomer.empresas` | 1 |
| `netagrocomer.facturasrecibidas` | 48820 |
| `netagrocomer.facturasrecibidas_ctb` | 37027 |
| `netagrocomer.clientes` | 1205 |
| `netagrocomer.facturas` | 180616 |

Endpoints probados desde n8n despues del restore:

```text
GET http://172.19.0.1:18000/health -> 200
GET http://172.19.0.1:18000/acreedores?limit=1 -> total 1836
GET http://172.19.0.1:18000/facturasrecibidas?limit=1 -> total 48820
GET http://172.19.0.1:18000/facturasrecibidas/tipos -> 11 tipos observados
GET http://172.19.0.1:18000/empresas -> total 1
```

## Resumen ejecutivo

Hay cinco bloques principales:

1. **Clientes**: `clientes` es el maestro que resuelve `CLI_Idcliente`, nombre, NIF/VAT, direccion, email, idioma/divisa y estado. Es la primera tabla a consultar cuando llega un PDF por OCR.
2. **Proveedores/acreedores y facturas recibidas**: `empresas` identifica la empresa propietaria, `acreedores` identifica proveedor por `ACR_Codigo`; `facturasrecibidas` es la cabecera real Netagro de factura recibida, y `facturasrecibidas_ctb` es su desglose contable.
3. **Facturas a clientes**: `facturas` como cabecera, `facturaslineasvar` como conceptos/lineas, `facturas_gastos` como gastos y `albsalida` como albaranes facturados.
4. **Albaranes de salida**: `albsalida` como cabecera, `albsalida_lineas`, `albsalida_gastos`, `albsalida_palets` y `albsalida_lineas_desglose` como detalle.
5. **Albaranes de entrada y facturas de agricultores**: `albentrada` y sus lineas/gastos/clasificaciones; `facturaagr` y `facturaagr_lineas` liquidan genero de agricultores.

## Esquema relacional practico

```text
clientes.CLI_Idcliente
  -> facturas.FRA_idcliente
  -> albsalida.ASA_idcliente
  -> clientesdescargas.CLD_IdCliente (domicilios/destinos de descarga)

acreedores.ACR_Codigo
  -> facturasrecibidas.FRR_idproveedor

empresas.EMP_idempresa
  -> facturasrecibidas.FRR_Idempresa

facturasrecibidas.FRR_id
  -> facturasrecibidas_ctb.FRC_idfacturarecibida

facturas.FRA_idfactura
  -> albsalida.ASA_idfactura
  -> facturaslineasvar.FLV_idfactura
  -> facturas_gastos.FGC_idfactura

albsalida.ASA_idalbaran
  -> albsalida_lineas.ASL_idalbaran
  -> albsalida_gastos.ASG_idalbaran
  -> albsalida_palets.ASP_idalbaran
  -> albsalida_lineas_desglose.ASD_IdAlbaran / ASD_IdLineaAlbSalida

albentrada.AEN_idalbaran
  -> albentrada_lineas.AEL_idalbaran
  -> albentrada_gastos.AEG_idalbaran
  -> albentrada_lineascla.ALC_idalbaran / ALC_idlineaentrada
  -> albentrada_lineaskilos.ALK_idlineaentrada / ALK_IdLinea

facturaagr.FGR_idfactura
  -> facturaagr_lineas.FAL_idfactura
facturaagr_lineas.FAL_idpartida
  -> normalmente albentrada_lineas.AEL_idlinea (validado como candidato mayoritario)
```

## Cardinalidades validadas

| Relacion | Resultado en copia local | Lectura |
|---|---:|---|
| `clientes_to_facturas` | clientes=1190, facturas=179532, clientes_usados=772, facturas_cliente_huerfano=0 | Todas las facturas emitidas apuntan a un cliente existente. |
| `clientes_to_albsalida` | clientes=1190, albaranes=110048, clientes_usados=365, albaranes_cliente_huerfano=0 | Los albaranes de salida con cliente distinto de 0 apuntan a cliente existente. |
| `acreedores_to_facturasrecibidas` | acreedores=1831, facturas=48641, proveedores_usados=1738, proveedor_match=45672, proveedor_cero=4, proveedor_no_cero_huerfano=2965 | `FRR_idproveedor` apunta logicamente a `ACR_Codigo`, pero hay historico con proveedor inexistente en `acreedores` dentro de `netagrocomer`. |
| `facturasrecibidas_to_ctb` | apuntes=37027, facturas_con_ctb=29783, apuntes_match=36621, factura_cero=38, factura_no_cero_huerfana=368 | `FRC_idfacturarecibida` apunta logicamente a `FRR_id`; hay apuntes contables historicos sin cabecera local. |
| `facturas_to_albsalida` | albaranes_con_factura=108912, facturas_con_albaranes=103560, albaranes_huerfanos=0 | Albaranes de salida facturados; `ASA_idfactura=0` indica pendiente/no facturado. |
| `facturas_to_lineasvar` | lineas=149032, facturas_con_lineas=75335, lineas_huerfanas=0 | Lineas o conceptos variables de factura emitida. |
| `facturas_to_gastos` | gastos=109513, facturas_con_gastos=57460, gastos_huerfanos=0 | Gastos asociados a factura emitida. |
| `albsalida_to_lineas` | lineas=256951, albaranes_con_lineas=110026, lineas_huerfanas=0 | Lineas de genero del albaran de salida. |
| `albsalida_to_gastos` | gastos=353511, albaranes_con_gastos=105802, gastos_huerfanos=0 | Gastos imputados al albaran de salida. |
| `albsalida_to_palets` | palets=406107, albaranes_con_palets=109244, palets_huerfanos=7 | Palets vinculados al albaran; hay pocos huérfanos historicos. |
| `albentrada_to_lineas` | lineas=85917, albaranes_con_lineas=81708, lineas_huerfanas=12 | Lineas de genero de entrada; hay pocos huérfanos historicos. |
| `albentrada_to_gastos` | gastos=32401, albaranes_con_gastos=30815, gastos_huerfanos=0 | Gastos de entrada. |
| `facturaagr_to_lineas` | lineas=73437, facturas_con_lineas=8163, lineas_huerfanas=0 | Lineas de factura/liquidacion a agricultor. |
| `facturaagr_lineas_to_albentrada_lineas_candidate` | lineas_facturaagr=73437, matches_por_fal_idpartida_ael_idlinea=73322, matches_por_fal_idpartida_aen_idalbaran=69449 | Relacion candidata de lineas de factura agraria con partidas de entrada. |

## Volumen por tabla

Las cifras de esta tabla pertenecen al snapshot inicial del `2026-06-29`. Sirven para
dimensionar el modelo, pero no son parte del contrato API ni deben interpretarse como
conteos actuales. Las metricas verificadas tras el restore del 8 de julio aparecen en
`Actualizacion de copia de pruebas 2026-07-08`; cualquier cifra operativa debe
consultarse de nuevo contra la copia vigente.

| Tabla | Filas exactas | MB aprox. | Descripcion |
|---|---:|---:|---|
| `clientes` | 1190 | n/d | Maestro de clientes: nombre, NIF/VAT, direccion, emails, idioma/divisa, EDI y estado. |
| `empresas` | 1 | n/d | Maestro de empresas/razones sociales. Resuelve `facturasrecibidas.FRR_Idempresa`. |
| `acreedores` | 1831 | 0.47 | Maestro de proveedores/acreedores: nombre, NIF, cuenta contable, cuenta de gasto, forma de pago y estado. |
| `facturas` | 179532 | 88.72 | Cabecera de facturas emitidas a clientes. |
| `facturaslineasvar` | 149032 | 24.06 | Lineas variables/conceptos de factura emitida. |
| `facturas_gastos` | 109513 | 18.58 | Gastos asociados a facturas emitidas. |
| `facturaagr` | 8163 | 2.61 | Cabecera de facturas/liquidaciones a agricultores. |
| `facturaagr_lineas` | 73437 | 10.55 | Lineas de facturas/liquidaciones a agricultores. |
| `facturasrecibidas` | 48641 | 30.59 | Cabecera de facturas recibidas de proveedores/acreedores. |
| `facturasrecibidas_ctb` | 37027 | 3.88 | Desglose contable de facturas recibidas. |
| `albsalida` | 110048 | 66.20 | Cabecera de albaranes de salida, normalmente entrega/venta a cliente. |
| `albsalida_lineas` | 256951 | 77.13 | Lineas de producto de albaranes de salida. |
| `albsalida_gastos` | 353511 | 66.63 | Gastos aplicados a albaranes de salida. |
| `albsalida_palets` | 406107 | 45.09 | Palets vinculados a albaranes de salida. |
| `albsalida_lineas_desglose` | 190037 | 21.55 | Desglose de venta de lineas de albaran de salida. |
| `observacionesalbsalida` | 1 | 0.03 | Observaciones auxiliares de albaranes de salida. |
| `albentrada` | 81717 | 27.61 | Cabecera de albaranes de entrada, normalmente recepcion de genero/agricultor. |
| `albentrada_lineas` | 85929 | 41.66 | Lineas de producto de albaranes de entrada. |
| `albentrada_gastos` | 32402 | 5.86 | Gastos aplicados a albaranes de entrada. |
| `albentrada_lineascla` | 159875 | 31.58 | Clasificacion/valoracion por linea de entrada. |
| `albentrada_lineaskilos` | 355323 | 66.61 | Detalle de pesadas, bultos, palets y kilos de lineas de entrada. |
| `albentrada_his` | 83658 | 22.61 | Historico de cabeceras de albaran de entrada. |
| `albentrada_hislineas` | 162602 | 39.13 | Historico de lineas de albaran de entrada. |
| `albentrada_hisgastos` | 46819 | 18.09 | Historico de gastos de albaran de entrada. |

## API Netagro de pruebas: referencia completa

La FastAPI usa la copia local y separa credenciales de lectura y escritura. Desde n8n
en el VPS se consume con:

```text
http://172.19.0.1:18000
```

Inventario exhaustivo del codigo en disco (`41` operaciones sobre `40` paths; `GET` y
`POST` comparten `/facturasrecibidas`):

| Endpoint | Uso |
|---|---|
| `GET /` | Identidad del servicio, esquema por defecto y esquemas permitidos. |
| `GET /health` | Estado de API y conexion a BD local. |
| `GET /meta/tables` | Tablas de facturas/albaranes detectadas. |
| `GET /empresas` | Lista paginada de empresas. Sirve para poblar combo de `FRR_Idempresa`. |
| `GET /empresas/{empresa_id}` | Ficha completa de empresa por `EMP_idempresa`. |
| `GET /clientes` | Lista/busqueda paginada de clientes. Filtros: `q`, `nombre`, `nif`, `codigo_edi`, `activo`, `schema`, `limit`, `offset`. |
| `GET /clientes/{cliente_id}` | Ficha de cliente por `CLI_Idcliente`. Incluye datos fiscales, direccion, emails de albaranes/pedidos y estado. |
| `GET /acreedores` | Lista/busqueda paginada de proveedores/acreedores. Filtros: `q`, `nombre`, `nif`, `codigo`, `activo`, `schema`, `limit`, `offset`. |
| `GET /acreedores/{acreedor_id}` | Ficha de acreedor/proveedor por `ACR_Codigo`. |
| `GET /acreedores/{acreedor_id}/gastos` | Origenes de gasto configurados en `acreedores_gastos`. **En disco; pendiente de reiniciar el servicio vivo.** |
| `GET /agricultores` | Maestro de agricultores con filtros `q`, `nombre`, `nif`, `codigo`, `tipo` y `activo`. **En disco; pendiente de reinicio.** |
| `GET /agricultores/{agricultor_id}` | Ficha fiscal, contable y operativa del agricultor. **En disco; pendiente de reinicio.** |
| `GET /agricultores/{agricultor_id}/gastos` | Reglas de gasto de `agricultorgastos`. **En disco; pendiente de reinicio.** |
| `GET /facturasrecibidas/tipos` | Catalogo observado de `FRR_tipofactura` desde datos reales. No hay descripciones oficiales cargadas en la copia local. |
| `GET /facturasrecibidas/buscar` | Busqueda exacta de factura recibida existente por `empresa_id`, `ejercicio`, `proveedor_id` y `numero_factura`. |
| `GET /facturasrecibidas` | Lista paginada de facturas recibidas. Filtros: `fecha_desde`, `fecha_hasta`, `proveedor_id`, `proveedor_nif`, `numero_factura`, `ejercicio`, `tipo_factura`, `schema`. |
| `GET /facturasrecibidas/{factura_id}` | Cabecera `FRR_*` completa de factura recibida por `FRR_id`, con datos del acreedor asociado. |
| `GET /facturasrecibidas/{factura_id}/ctb` | Apuntes contables reales `FRC_*` de `facturasrecibidas_ctb`. No genera lineas desde `FRR_ctagasto*`. |
| `GET /facturasrecibidas_ctb?factura_id={id}` | Alias para consultar apuntes `FRC_*` por query string. |
| `GET /facturasrecibidas/{factura_id}/punteos` | Punteos/gastos reales enlazados a una factura recibida. Devuelve `source_table`, `source_id`, `Origen`, `Serie`, `Albaran`, `Ref`, `Fecha`, `Importe P`, `Importe`, `S`, `Ver`, empresa, acreedor y cuenta gasto si aplica. |
| `GET /albaranes-gastos/punteables` | Lista de gastos/albaranes punteables, por defecto pendientes de factura recibida. Filtros: `source_table`, `proveedor_id`, `empresa_id`, `fecha_desde`, `fecha_hasta`, `solo_pendientes`, `limit`, `offset`. |
| `GET /cuentas-contables` | Catalogo de cuentas con descripcion desde `contabilidad*.cuentas`. Filtros: `account_schema`, `q`, `cuenta`, `nif`, `limit`, `offset`. |
| `GET /tipos-iva` | Catalogo de IVA desde `tiposivacli` y `tiposiva` si estuviera poblada. |
| `GET /regimenes` | Catalogo observado de `FRR_idregimen`; no se ha encontrado tabla maestra poblada de regimenes. |
| `GET /formas-pago` | Catalogo `formaspagocli`. **En disco; pendiente de reinicio.** |
| `GET /bancos` | Catalogo `bancosalm`. **En disco; pendiente de reinicio.** |
| `GET /series-factura` | Catalogo `seriefacturas`. **En disco; pendiente de reinicio.** |
| `GET /conceptos-factura` | Catalogo `conceptosfactura`. **En disco; pendiente de reinicio.** |
| `POST /facturasrecibidas` | Alta transaccional en la copia local. Por defecto `dry_run=true`; con `dry_run=false` inserta `FRR_*`, `FRC_*` reales y enlaza punteos seleccionados. |
| `GET /facturas` | Lista paginada de facturas emitidas. Filtros: `fecha_desde`, `fecha_hasta`, `cliente_id`, `serie`, `numero`, `schema`. |
| `GET /facturas/{factura_id}` | Cabecera de factura emitida. |
| `GET /facturas/{factura_id}/lineas` | Lineas/conceptos de `facturaslineasvar`. |
| `GET /facturas/{factura_id}/gastos` | Gastos de `facturas_gastos`. |
| `GET /facturas/{factura_id}/albaranes` | Albaranes de salida asociados por `ASA_idfactura`. |
| `GET /albaranes/salida` | Lista paginada de albaranes de salida. |
| `GET /albaranes/salida/{albaran_id}` | Cabecera de albaran de salida. |
| `GET /albaranes/salida/{albaran_id}/lineas` | Lineas de albaran de salida. |
| `GET /albaranes/entrada` | Lista paginada de albaranes de entrada. |
| `GET /albaranes/entrada/{albaran_id}` | Cabecera de albaran de entrada. |
| `GET /albaranes/entrada/{albaran_id}/lineas` | Lineas de albaran de entrada. |
| `GET /facturas-agricultores` | Lista paginada de facturas/liquidaciones a agricultores. |

Los listados paginados nuevos de `empresas`, `acreedores` y `facturasrecibidas` devuelven:

```json
{
  "items": [],
  "limit": 50,
  "offset": 0,
  "total": 0
}
```

Los endpoints de detalle devuelven un objeto JSON. Los desgloses contables devuelven `{ "items": [] }`. El catalogo observado `GET /facturasrecibidas/tipos` devuelve `{ "items": [], "source": "..." }`.

Ejemplos desde n8n:

```text
GET http://172.19.0.1:18000/acreedores?limit=50
GET http://172.19.0.1:18000/acreedores?nif=B04243655
GET http://172.19.0.1:18000/acreedores/1941
GET http://172.19.0.1:18000/empresas
GET http://172.19.0.1:18000/facturasrecibidas/tipos
GET http://172.19.0.1:18000/facturasrecibidas?proveedor_id=1941&numero_factura=FCD26%2F2820
GET http://172.19.0.1:18000/facturasrecibidas/49165
GET http://172.19.0.1:18000/facturasrecibidas/34602/ctb
GET http://172.19.0.1:18000/facturasrecibidas_ctb?factura_id=34602
GET http://172.19.0.1:18000/facturasrecibidas/43753/punteos?limit=50
GET http://172.19.0.1:18000/albaranes-gastos/punteables?proveedor_id=2073&source_table=albsalida_gastos
GET http://172.19.0.1:18000/cuentas-contables?cuenta=4009
GET http://172.19.0.1:18000/tipos-iva
GET http://172.19.0.1:18000/regimenes
GET http://172.19.0.1:18000/facturasrecibidas/buscar?empresa_id=1&ejercicio=24&proveedor_id=2073&numero_factura=80032863
```

Alta de factura recibida en pruebas:

```http
POST http://172.19.0.1:18000/facturasrecibidas?dry_run=true
Content-Type: application/json
```

```json
{
  "cabecera": {
    "FRR_Idempresa": 1,
    "FRR_ejercicio": 25,
    "FRR_idproveedor": 2073,
    "FRR_numerofactura": "DRYRUN-001",
    "FRR_fechafactura": "2025-07-08",
    "FRR_fechactb": "2025-07-08",
    "FRR_tipofactura": "OT",
    "FRR_idregimen": 2110,
    "FRR_idcuenta": "40090002073",
    "FRR_base1": "10.00",
    "FRR_iva1": "21.00",
    "FRR_cuota1": "2.10",
    "FRR_totalfac": "12.10",
    "FRR_Concepto": "DRY RUN API"
  },
  "ctb": [
    {
      "FRC_Importe": "12.10",
      "FRC_Cuenta": "40090002073"
    }
  ],
  "punteos": [
    {
      "source_table": "albsalida_gastos",
      "source_id": 429016,
      "importe_factura": "6.14"
    }
  ]
}
```

Reglas del alta:

- `dry_run=true` no escribe; valida duplicados, columnas y devuelve `FRR_id`/`FRR_numero` previstos.
- `dry_run=false` escribe solo en la copia local del VPS intermedio, usando usuario MariaDB de escritura limitado.
- `FRR_id` y `FRC_id` los genera la API; no se aceptan ids manuales.
- `ctb` solo acepta columnas reales `FRC_*`; no se fabrican apuntes desde `FRR_ctagasto*`.
- `punteos` se enlaza por `source_table` + `source_id`; si un punteo ya esta enlazado a otra factura, devuelve error de validacion y no inserta nada.

Nota sobre webhook externo: estos endpoints existen en la FastAPI interna del VPS intermedio. Si se quiere consumir mediante el webhook actual:

```text
https://n8nbecarios.srv894901.hstgr.cloud/webhook/apiCampojoyma?consulta=...
```

el workflow de n8n debe traducir `query.consulta` a llamadas HTTP contra `http://172.19.0.1:18000`. La autenticacion JWT Bearer, si se usa, pertenece a la capa del webhook/n8n; la FastAPI interna queda accesible por el tunel privado y no se expone publicamente.

### Estado verificado el 2026-07-15

| Elemento | Estado |
|---|---|
| Titulo OpenAPI | `Netagro Test API` |
| Version OpenAPI | `0.1.0` (valor por defecto de FastAPI) |
| Codigo en VPS e intermedio | Mismo `main.py`, SHA256 `9f9615dc74cea4e72172006dd7d4bad08fdc9a4e91f27ab7446c5595a00c363b` |
| Superficie del codigo en disco | `41` operaciones sobre `40` paths distintos |
| Superficie del proceso vivo | `33` operaciones sobre `32` paths distintos |
| Servicio vivo | `netagro-api.service`, activo desde el 2026-07-08 |
| Codigo nuevo en disco | Modificado el 2026-07-14; Uvicorn aun no lo ha recargado |
| Lecturas | Usuario `netagro_api` sobre las copias permitidas |
| Escrituras | `DB_WRITES_ENABLED=true`, usuario `netagro_api_write`, solo esquema `netagrocomer` |
| Seguridad del POST | `dry_run=true` por defecto; `dry_run=false` escribe realmente en la copia de pruebas |

Las ocho operaciones ausentes del proceso vivo son:

```text
GET /agricultores
GET /agricultores/{agricultor_id}
GET /agricultores/{agricultor_id}/gastos
GET /acreedores/{acreedor_id}/gastos
GET /formas-pago
GET /bancos
GET /series-factura
GET /conceptos-factura
```

Estan desplegadas en disco y se han ejercitado directamente contra la copia de pruebas,
pero el puerto `8000` no las publicara hasta reiniciar `netagro-api.service`. Esta
documentacion describe el contrato completo del codigo en disco y marca esa diferencia
operativa de forma explicita.

Prueba de humo del codigo nuevo, ejecutada sin escribir el 2026-07-15:

| Operacion | Resultado |
|---|---:|
| `GET /agricultores` | OK; 1197 filas en la instantanea actual |
| `GET /agricultores/{id}` | OK |
| `GET /agricultores/{id}/gastos` | OK |
| `GET /acreedores/{id}/gastos` | OK |
| `GET /formas-pago` | OK; 10 filas |
| `GET /bancos` | OK; 9 filas |
| `GET /series-factura` | OK; 104 filas |
| `GET /conceptos-factura` | OK; 40 filas |

Las cantidades son una fotografia de la copia y no forman parte del contrato.

### Arquitectura, URLs y acceso

```text
n8n (Docker en el VPS)
  -> http://172.19.0.1:18000
  -> netagro-api-tunnel.service en 82.25.119.150
  -> SSH a karma@88.30.71.235:2222
  -> http://127.0.0.1:8000 en karma-box
  -> MariaDB local de pruebas
```

URLs segun el punto de acceso:

| Consumidor | Base URL |
|---|---|
| n8n dentro del VPS | `http://172.19.0.1:18000` |
| Shell del VPS | `http://127.0.0.1:18000` |
| Servidor intermedio | `http://127.0.0.1:8000` |
| Exterior | No se expone FastAPI directamente; usar el webhook controlado de n8n |

Documentacion generada por FastAPI:

| Recurso | Ruta |
|---|---|
| Swagger UI | `/docs` |
| ReDoc | `/redoc` |
| Especificacion OpenAPI | `/openapi.json` |

Estas tres rutas auxiliares no se cuentan entre las 41 operaciones de negocio.

La FastAPI interna no implementa autenticacion ni autorizacion. Uvicorn escucha solo en
loopback y la barrera actual es la red privada/tunel. El JWT Bearer pertenece al webhook
de n8n, no a FastAPI. No se debe publicar el puerto `8000` o `18000` en Internet sin
incorporar autenticacion, TLS, rate limiting y registro de auditoria.

### Convenciones comunes

#### Seleccion de esquema

Casi todas las operaciones aceptan `schema` opcional:

| Valor | Uso |
|---|---|
| `netagrocomer` | Esquema predeterminado y unico permitido para escritura |
| `netagrocomer_2` | Copia permitida para lectura |
| `netagrocomer_au` | Copia permitida para lectura |

Un valor fuera de la allowlist devuelve `400`. `GET /cuentas-contables` usa en su lugar
`account_schema`; admite `contabilidad`, `contabilidad_2`, `contabilidad_6`,
`contabilidad_7`, `contabilidad_10`, `contabilidad_11`, `contabilidad_12`,
`contabilidad_13`, `contabilidad_14`, `contabilidad_15` y `contabilidad_99`.

#### Paginacion y filtros

- `limit`: entero entre `1` y `200`; valor habitual `50`.
- `offset`: entero mayor o igual que `0`; valor predeterminado `0`.
- `/facturasrecibidas/{id}/punteos` usa `limit=200` por defecto.
- Fechas: `YYYY-MM-DD`; `fecha_desde` y `fecha_hasta` son inclusivas.
- Todos los filtros distintos de una peticion se combinan con `AND`.
- Los filtros `q` aplican `OR` entre las columnas documentadas para cada maestro.
- Las busquedas parciales usan `LIKE` de MariaDB; no son busqueda difusa.
- Los identificadores, series y numeros indicados como exactos usan igualdad.
- Los booleanos aceptan los formatos que reconoce FastAPI (`true`, `false`, `1`, `0`).

#### Formatos de respuesta

No todos los listados tienen el mismo contrato:

| Forma | Operaciones |
|---|---|
| `{items, limit, offset, total}` | empresas, acreedores, agricultores, facturas recibidas, busqueda de recibidas, cuentas contables y gastos punteables |
| `{items, limit, offset}` | clientes, facturas emitidas, albaranes, facturas de agricultores y punteos de una recibida |
| `{items}` | lineas, gastos, CTB y catalogos simples |
| Objeto directo | endpoints de detalle |

Normalizacion de tipos:

- `Decimal` se serializa como string para no perder precision.
- Fechas, horas y timestamps se serializan en ISO.
- Bytes se decodifican como UTF-8 con reemplazo de caracteres invalidos.
- Los valores heredados `1900-01-01`, `0000-00-00`, cadena vacia y cero no se
  reinterpretan automaticamente como `null`.
- Los detalles que usan `SELECT *` conservan los nombres ERP originales (`EMP_*`,
  `ASA_*`, `AEN_*`, `FRR_*`).
- OpenAPI muestra respuestas genericas porque el codigo no declara modelos Pydantic de
  salida. Este documento define el contrato observable real.

#### Errores

| HTTP | Causa habitual |
|---:|---|
| `400` | `schema`, `account_schema` o esquema de escritura fuera de la allowlist |
| `403` | Escritura deshabilitada mediante `DB_WRITES_ENABLED` |
| `404` | Recurso no encontrado en endpoints de detalle |
| `409` | No se obtiene en 10 segundos el bloqueo de creacion de factura |
| `422` | Query/path/body invalido o punteo inexistente/ya enlazado durante escritura |
| `500` | Error SQL o fallo interno no traducido |

Los errores semanticos del `POST` (columnas desconocidas, campos requeridos ausentes o
duplicado) se devuelven con HTTP `200`, `ok=false` y `validation_errors`. Los
subrecursos de un identificador inexistente suelen devolver `items=[]`, no `404`.

Ejemplos de error:

```json
{"detail":"schema not allowed: produccion"}
```

```json
{
  "ok": false,
  "dry_run": true,
  "would_create": false,
  "validation_errors": [
    {"field":"FRR_Idempresa","error":"required for duplicate detection"}
  ]
}
```

### Referencia de las 41 operaciones

#### Servicio y metadatos

| Operacion | Parametros | Respuesta | Fuente/efecto |
|---|---|---|---|
| `GET /` | Ninguno | `{service, default_schema, allowed_schemas}` | No consulta tablas |
| `GET /health` | Ninguno | `{status:"ok", database:{ok, db_host, db_version}}` | `SELECT 1`, hostname y version de MariaDB |
| `GET /meta/tables` | `schema` | `{schema, tables:[{TABLE_NAME,TABLE_TYPE,TABLE_ROWS}]}` | `information_schema.TABLES`; filtra nombres de facturas y albaranes |

`/meta/tables` es un inventario filtrado, no un listado de todas las tablas. Por eso no
debe usarse para concluir que un maestro como `acreedores` o `agricultores` no existe.

#### Empresas y clientes

| Operacion | Parametros | Respuesta | Fuente |
|---|---|---|---|
| `GET /empresas` | `schema`, `limit=50`, `offset=0` | `{items,limit,offset,total}`. Cada item: `id`, `empresa_id`, `nombre`, `cif`, domicilio, poblacion, provincia, CP, pais, email, web, ejercicio predeterminado y demo | `empresas` |
| `GET /empresas/{empresa_id}` | `empresa_id:int`, `schema` | Objeto con todas las columnas `EMP_*`; `404` si no existe | `empresas` |
| `GET /clientes` | `schema`, `limit=50`, `offset=0`, `q`, `nombre`, `nif`, `codigo_edi`, `activo` | `{items,limit,offset}` sin `total`; identificacion, contacto, domicilio, pago, divisa, idioma, empresa y estado | `clientes` |
| `GET /clientes/{cliente_id}` | `cliente_id:int`, `schema` | Detalle normalizado; incluye EDI, pagos, vendedor, comisionista, emails de pedidos/albaranes, observaciones y bloqueos; `404` si no existe | `clientes` |

Busqueda de clientes:

- `q`: coincidencia parcial sobre nombre, NIF, codigo EDI, numero de identificacion o email.
- `nombre`, `nif`, `codigo_edi`: coincidencia parcial sobre su campo.
- `activo=true`: `CLI_bloqueo='N'` y `CLI_InactivoRGPD='N'`.
- `activo=false`: alguna de esas condiciones no se cumple.

#### Acreedores y agricultores

| Operacion | Parametros | Respuesta | Fuente |
|---|---|---|---|
| `GET /acreedores` | `schema`, `limit=50`, `offset=0`, `q`, `nombre`, `nif`, `codigo`, `activo` | `{items,limit,offset,total}`; identidad, contacto, cuentas, forma de pago, banco, divisa, pais, retencion, IVA y estado | `acreedores` |
| `GET /acreedores/{acreedor_id}` | `acreedor_id:int`, `schema` | Detalle fiscal, bancario, contable, operativo y de auditoria; `404` si no existe | `acreedores` |
| `GET /acreedores/{acreedor_id}/gastos` | `acreedor_id:int`, `schema` | `{items:[{id,acreedor_id,origen_gasto_id}],acreedor_id}` | `acreedores_gastos` |
| `GET /agricultores` | `schema`, `limit=50`, `offset=0`, `q`, `nombre`, `nif`, `codigo`, `tipo`, `activo` | `{items,limit,offset,total}`; identidad, cuenta, tipo, banco, pago, serie, empresa y estado | `agricultores` |
| `GET /agricultores/{agricultor_id}` | `agricultor_id:int`, `schema` | Detalle fiscal, contacto, cuenta, banco, pago, serie, empresa, numeracion, observaciones, estado y auditoria; `404` si no existe | `agricultores` |
| `GET /agricultores/{agricultor_id}/gastos` | `agricultor_id:int`, `schema` | `{items,agricultor_id}`; cada item contiene gasto, valor, fijo, pedir entrada, acreedor, tipo FC, centro, familia y visibilidad | `agricultorgastos` |

Busqueda de acreedores:

- `codigo`: igualdad exacta sobre `ACR_Codigo`.
- `q`: parcial sobre nombre, NIF, email, cuenta contable o cuenta de gasto.
- `nombre` y `nif`: coincidencia parcial.
- `activo=true`: no bloqueado y no inactivo por RGPD.

Busqueda de agricultores:

- `codigo`: igualdad exacta sobre `AGR_Idagricultor`.
- `tipo`: igualdad exacta sobre `AGR_idtipo`.
- `q`: parcial sobre nombre, NIF, email o cuenta.
- `nombre` y `nif`: coincidencia parcial.
- `activo=true`: `AGR_Activo='S'` y `AGR_bloqueado='N'`.

Los endpoints de gastos no validan primero la existencia del padre: una ID sin filas
devuelve `items=[]`.

Semantica obligatoria:

- `agricultores` no es un alias de `acreedores`; hay agricultores que no aparecen en
  el maestro de acreedores.
- `/facturas-agricultores` devuelve liquidaciones/facturas emitidas al agricultor; no
  sustituye al maestro `/agricultores`.
- Ante una factura recibida, el resolver debe probar `acreedores` y, solo cuando la
  naturaleza del proveedor lo justifique y no haya match, buscar en `agricultores`.
  No debe reinterpretar automaticamente un tipo de proveedor como el otro.

#### Catalogos contables y de facturacion

| Operacion | Parametros | Respuesta | Fuente |
|---|---|---|---|
| `GET /facturasrecibidas/tipos` | `schema` | `{items:[{tipo_factura,descripcion:null,total,fecha_min,fecha_max}],source}` | Valores observados de `facturasrecibidas.FRR_tipofactura` |
| `GET /cuentas-contables` | `account_schema=contabilidad`, `limit=50`, `offset=0`, `q`, `cuenta`, `nif` | `{items,limit,offset,total,source}`; cuenta, descripcion, NIF, contrapartida, IVA, IRPF, pago, banco y bloqueos | `{account_schema}.cuentas` |
| `GET /tipos-iva` | `schema` | `{items}` con `id`, `nombre`, `iva`, `recargo_equivalencia`, `cuenta`, `source` | `tiposivacli` + `tiposiva` |
| `GET /regimenes` | `schema` | `{items:[{regimen_id,descripcion:null,total,fecha_min,fecha_max}],source}` | Valores observados de `facturasrecibidas.FRR_idregimen` |
| `GET /formas-pago` | `schema` | `{items}` con `id`, `nombre`, `dias_vencimiento`, `genera_cartera`, `tipo_doc_id`, `codigo_edi` | `formaspagocli` |
| `GET /bancos` | `schema` | `{items}` con `id`, `nombre`, `cuenta_contable`, `iban`, `bic` | `bancosalm` |
| `GET /series-factura` | `schema` | `{items}` con `id`, `nombre`, `tipo_iva_id` | `seriefacturas` |
| `GET /conceptos-factura` | `schema` | `{items}` con `id`, `nombre`, `tipo_iva_id` | `conceptosfactura` |

Filtros de cuentas:

- `cuenta`: busqueda por prefijo.
- `nif`: coincidencia parcial.
- `q`: coincidencia parcial sobre numero, descripcion o NIF.

No confundir catalogos:

- `/facturasrecibidas/tipos` son codigos observados en `FRR_tipofactura`.
- `/series-factura` es el maestro `seriefacturas`; no es la misma dimension.
- `/conceptos-factura` es un catalogo; `/facturas/{id}/lineas` son lineas reales.
- IDs de forma de pago, banco, serie o concepto deben seleccionarse mediante match
  explicito; no se deben inferir por parecido de texto sin confirmacion.

#### Facturas recibidas, CTB y punteos

| Operacion | Parametros | Respuesta | Fuente/efecto |
|---|---|---|---|
| `GET /facturasrecibidas` | `schema`, `limit=50`, `offset=0`, `fecha_desde`, `fecha_hasta`, `proveedor_id`, `proveedor_nif`, `numero_factura`, `ejercicio`, `tipo_factura` | `{items,limit,offset,total}`; resumen `FRR_*` mas nombre/NIF del acreedor | `facturasrecibidas` + `acreedores` |
| `GET /facturasrecibidas/buscar` | Obligatorios: `empresa_id`, `ejercicio`, `proveedor_id`, `numero_factura`; opcionales: `schema`, `limit=50`, `offset=0` | `{items,limit,offset,total}` con columnas `FRR_*` crudas | Busqueda exacta y criterio de duplicado |
| `GET /facturasrecibidas/{factura_id}` | `factura_id:int`, `schema` | Todos los campos `FRR_*` mas datos del acreedor; `404` si no existe | `facturasrecibidas` + `acreedores` |
| `GET /facturasrecibidas/{factura_id}/ctb` | `factura_id:int`, `schema` | `{items}` con los 11 campos `FRC_*` | `facturasrecibidas_ctb` |
| `GET /facturasrecibidas_ctb` | Query obligatorio `factura_id:int`; `schema` | Igual que la ruta `/ctb` | Alias por query string |
| `GET /facturasrecibidas/{factura_id}/punteos` | `factura_id:int`, `schema`, `limit=200`, `offset=0` | `{items,limit,offset}` sin `total` | Union de cinco origenes, solo los enlazados a la factura |
| `GET /albaranes-gastos/punteables` | `schema`, `limit=50`, `offset=0`, `source_table`, `proveedor_id`, `empresa_id`, fechas, `solo_pendientes=true` | `{items,limit,offset,total}` | Misma union; por defecto solo registros sin factura recibida |
| `POST /facturasrecibidas` | `schema`, `dry_run=true`, body JSON | Validacion o alta transaccional descrita abajo | Puede insertar cabecera/CTB y enlazar punteos en `netagrocomer` |

Filtros de facturas recibidas:

- Fechas, `proveedor_id`, `ejercicio` y `tipo_factura`: exactos/inclusivos.
- `proveedor_nif` y `numero_factura`: coincidencia parcial.
- `/buscar` usa igualdad exacta en empresa + ejercicio + proveedor + numero externo.

Campos resumidos del listado: `id`, `frr_id`, `numero`, `fecha_factura`,
`numero_factura`, `ejercicio`, proveedor, `base1`, `iva1`, `cuota1`, total, tipo,
regimen, cuenta, concepto, empresa y fecha contable.

##### Contrato de punteos

`source_table` solo admite:

```text
albsalida_gastos
albentrada_hisgastos
albaranescompra_gastos
facturas_gastos
albarancoste
```

La union normaliza estos campos:

```text
id_interno_estable, source_table, source_id, factura_recibida_id,
Origen, Serie, Albaran, Ref, Fecha, Importe P, Importe, S, Ver,
empresa, acreedor_id, acreedor_nombre, gasto_id, gasto_nombre,
cuenta_gasto, albaran_id
```

`Importe P` conserva un espacio y varias claves conservan mayusculas por compatibilidad
con la pantalla ERP.

Con `solo_pendientes=true`, se exige `factura_recibida_id=0`. Con `false` se incluyen
registros pendientes y ya enlazados. Los cinco origenes y relaciones exactas son:

| `source_table` | Tabla principal | Campo enlace a factura recibida | Campo de importe actualizable |
|---|---|---|---|
| `albsalida_gastos` | `albsalida_gastos` | `ASG_idfactura` | `ASG_importefactura` |
| `albentrada_hisgastos` | `albentrada_hisgastos` | `AHG_idfacturaproveedor` | No se actualiza |
| `albaranescompra_gastos` | `albaranescompra_gastos` | `AGT_IdFactura` | No se actualiza |
| `facturas_gastos` | `facturas_gastos` | `FGC_idfacturaReci` | `FGC_importefacturaReci` |
| `albarancoste` | `albarancoste` | `ALB_IdFactura` | No se actualiza |

##### Contrato de `POST /facturasrecibidas`

Body:

```json
{
  "cabecera": {"FRR_Idempresa": 1},
  "ctb": [{"FRC_Importe": "12.10", "FRC_Cuenta": "40090002073"}],
  "punteos": [
    {
      "source_table": "albsalida_gastos",
      "source_id": 429016,
      "importe_factura": "6.14"
    }
  ]
}
```

Reglas estructurales:

- `cabecera` es obligatoria; `ctb` y `punteos` valen `[]` por defecto.
- No se aceptan propiedades extra en el nivel superior ni dentro de un punteo.
- `cabecera` solo admite las 74 columnas declaradas en `FRR_COLUMNS`; la seccion
  `facturasrecibidas` de este documento enumera el contrato completo.
- Cada fila CTB solo admite las 11 columnas `FRC_COLUMNS` documentadas.
- Cada punteo exige `source_id > 0`; `importe_factura` es decimal opcional.

Campos semanticos obligatorios:

```text
FRR_Idempresa
FRR_ejercicio
FRR_idproveedor
FRR_numerofactura
FRR_tipofactura
```

Generacion y duplicados:

- `FRR_id`, `FRC_id` y `FRC_idfacturarecibida` los genera la API.
- Si llega `FRR_numero` distinto de cero se conserva; de lo contrario se calcula
  `MAX(FRR_numero)+1` para tipo + ejercicio + empresa.
- El duplicado se detecta por empresa + ejercicio + proveedor + numero de factura del
  proveedor.
- La API no crea un asiento contable. `FRR_IdAsientoNet` se conserva si llega o se
  devuelve como `0`.

Con `dry_run=true` o errores semanticos no se escribe y se devuelve HTTP `200`:

```json
{
  "ok": true,
  "dry_run": true,
  "would_create": true,
  "FRR_id": 50000,
  "FRR_numero": 125,
  "FRR_IdAsientoNet": 0,
  "punteos_requested": [],
  "ids_punteos_enlazados": [],
  "validation_errors": [],
  "duplicate": null
}
```

El dry run no comprueba que los punteos existan o esten libres; esa validacion ocurre
dentro de la transaccion real.

Con `dry_run=false`, payload valido y escrituras habilitadas:

1. Obtiene un bloqueo MariaDB de 10 segundos.
2. Repite la comprobacion de duplicado dentro de la transaccion.
3. Genera IDs y numero interno.
4. Inserta cabecera `facturasrecibidas`.
5. Inserta las filas `facturasrecibidas_ctb`.
6. Bloquea y enlaza cada punteo; aborta si falta o pertenece a otra factura.
7. Confirma todo conjuntamente; cualquier fallo provoca rollback.

Respuesta de exito real:

```json
{
  "ok": true,
  "dry_run": false,
  "FRR_id": 50000,
  "FRR_numero": 125,
  "FRR_IdAsientoNet": 0,
  "ids_punteos_enlazados": [],
  "validation_errors": [],
  "erp_errors": []
}
```

La clave `erp_errors` es un nombre historico del contrato; no significa que se haya
escrito en produccion.

#### Facturas emitidas

| Operacion | Parametros | Respuesta | Fuente |
|---|---|---|---|
| `GET /facturas` | `schema`, `limit=50`, `offset=0`, fechas, `cliente_id`, `serie`, `numero` | `{items,limit,offset}`; id, serie, numero, fecha, cliente, empresa, tipo, total, cambio y vencimiento | `facturas` |
| `GET /facturas/{factura_id}` | `factura_id:int`, `schema` | Detalle con bases/cuotas 1-4, vencimiento, observaciones y referencia; `404` si no existe | `facturas` |
| `GET /facturas/{factura_id}/lineas` | `factura_id:int`, `schema` | `{items}` con tipo, codigo, concepto, cantidad, precio, kilos, bultos, palets e importe | `facturaslineasvar` |
| `GET /facturas/{factura_id}/gastos` | `factura_id:int`, `schema` | `{items}` con gasto, tipos, valor, importes y acreedor | `facturas_gastos` |
| `GET /facturas/{factura_id}/albaranes` | `factura_id:int`, `schema` | `{items}` con ejercicio, serie, numero, fecha, cliente, pedido, referencia, factura y empresa | `albsalida` |

#### Albaranes y liquidaciones de agricultores

| Operacion | Parametros | Respuesta | Fuente |
|---|---|---|---|
| `GET /albaranes/salida` | `schema`, `limit=50`, `offset=0`, fechas, `cliente_id`, `factura_id`, `serie`, `numero` | `{items,limit,offset}` sin `total` | `albsalida` |
| `GET /albaranes/salida/{albaran_id}` | `albaran_id:int`, `schema` | Todas las columnas `ASA_*`; `404` si no existe | `albsalida` |
| `GET /albaranes/salida/{albaran_id}/lineas` | `albaran_id:int`, `schema` | `{items}` con genero, categoria, kilos, palets, bultos, piezas, precio e importe | `albsalida_lineas` |
| `GET /albaranes/entrada` | `schema`, `limit=50`, `offset=0`, fechas, `agricultor_id`, `serie`, `numero` | `{items,limit,offset}`; campana, agricultor, punto de venta, centro, referencia y empresa | `albentrada` |
| `GET /albaranes/entrada/{albaran_id}` | `albaran_id:int`, `schema` | Todas las columnas `AEN_*`; `404` si no existe | `albentrada` |
| `GET /albaranes/entrada/{albaran_id}/lineas` | `albaran_id:int`, `schema` | `{items}` con genero, categoria, kilos, palets, bultos, piezas, precio e importe | `albentrada_lineas` |
| `GET /facturas-agricultores` | `schema`, `limit=50`, `offset=0`, fechas, `agricultor_id`, `serie`, `numero` | `{items,limit,offset}`; id, serie, numero, fecha, agricultor, empresa, total, base, IVA y retencion | `facturaagr` |

Los filtros de estas operaciones son exactos salvo los rangos de fecha, que son
inclusivos. La API actual no ofrece detalle ni lineas para `/facturas-agricultores`;
las tablas `facturaagr` y `facturaagr_lineas` quedan documentadas mas adelante para
consulta SQL y futura evolucion del contrato.

### Despliegue, activacion y rollback

Ubicaciones:

| Elemento | Ruta |
|---|---|
| Codigo de desarrollo en el VPS | `/root/fastapi-netagro/app/main.py` |
| Codigo ejecutable en el intermedio | `/home/karma/fastapi-netagro/app/main.py` |
| Entorno del servicio | `/home/karma/fastapi-netagro/.env` |
| Servicio FastAPI | `netagro-api.service` en `karma-box` |
| Servicio de tunel | `netagro-api-tunnel.service` en el VPS |
| Documento canonico | `documentacion_facturas_albaranes.md` en este repositorio |
| Copia documental del VPS | `/root/netagro_docs/documentacion_facturas_albaranes.md` |

Activacion pendiente de las ocho rutas nuevas:

```bash
# En karma-box; requiere sudo del usuario karma.
sudo systemctl restart netagro-api.service
sudo systemctl status netagro-api.service --no-pager
```

Comprobaciones posteriores desde el VPS:

```bash
curl -fsS http://127.0.0.1:18000/health
curl -fsS 'http://127.0.0.1:18000/agricultores?limit=1'
curl -fsS http://127.0.0.1:18000/openapi.json
```

Tras el reinicio, OpenAPI debe mostrar `41` operaciones y `40` paths. Antes de darlo
por valido se debe comprobar tambien que `/docs` carga y que el servicio sigue
conectado a `db_host=karma-box`.

Backups disponibles:

```text
/root/fastapi-netagro/app/main.py.bak-20260714-152705
/home/karma/fastapi-netagro/app/main.py.bak-20260714-152728
```

Rollback en el intermedio:

```bash
cp /home/karma/fastapi-netagro/app/main.py.bak-20260714-152728 \
  /home/karma/fastapi-netagro/app/main.py
sudo systemctl restart netagro-api.service
```

El rollback elimina las ocho rutas nuevas del proceso, pero no revierte datos. Las
pruebas realizadas para estos endpoints fueron de lectura y no generaron datos.

### Integracion recomendada para facturas recibidas

Resolucion de proveedor:

1. Normalizar NIF y texto en el flujo de origen; corregir extraccion/parseo antes de
   introducir compensaciones locales.
2. Consultar `/acreedores?nif=...` y, si no hay match, `/acreedores?q=...`.
3. Cuando el documento corresponda a un productor/agricultor y no exista acreedor,
   consultar `/agricultores?nif=...` y despues `/agricultores?q=...`.
4. Mantener la identidad semantica del resultado: acreedor y agricultor no son el
   mismo tipo de entidad.
5. Si persiste la ambiguedad, dejar seleccion manual en la UI; no elegir por similitud
   debil.
6. Cargar reglas de gasto con el subrecurso que corresponda al tipo resuelto.
7. Poblar forma de pago, banco, IVA y regimen solo mediante catalogos con mapeo
   confirmado; no inventar IDs. `/series-factura` y `/conceptos-factura` son
   referencias auxiliares: no mapearlos automaticamente a `FRR_tipofactura` o al
   texto libre `FRR_Concepto` sin validacion funcional explicita.
8. Ejecutar siempre primero `POST /facturasrecibidas?dry_run=true`.
9. Mostrar `validation_errors` al usuario y requerir confirmacion explicita antes de
   cualquier `dry_run=false`.

El resolver n8n documentado en julio solo consultaba `/acreedores`. Debe incorporar el
fallback explicito a `/agricultores` para aprovechar los endpoints nuevos.

### Limitaciones conocidas

- FastAPI no tiene autenticacion propia; depende del aislamiento de red.
- Los modelos de respuesta son diccionarios genericos y OpenAPI no enumera sus campos.
- Algunos listados no devuelven `total`, aunque acepten `limit` y `offset`.
- Catalogos simples no tienen paginacion ni filtros.
- Los subrecursos vacios no distinguen entre padre inexistente y padre sin filas.
- El dry run del POST no valida existencia ni disponibilidad de punteos.
- El nombre `erp_errors` persiste en la respuesta de alta por compatibilidad historica.
- No hay detalle ni lineas HTTP de facturas de agricultores.
- No hay rate limiting ni auditoria HTTP dentro de FastAPI.
- Los IDs `MAX+1` quedan protegidos frente a esta API por un lock, pero deben revisarse
  si aparece otro escritor concurrente sobre la copia.
- Las ocho rutas nuevas no estan activas en el proceso vivo hasta su reinicio.

### Mantenimiento de esta documentacion

Ante cualquier cambio en `app/main.py`:

1. Generar `app.openapi()` desde el codigo que se va a desplegar y contar operaciones.
2. Compararlo con `/openapi.json` del proceso vivo.
3. Actualizar este inventario, parametros, respuestas, fuentes y changelog.
4. Probar rutas nuevas contra la copia de pruebas sin datos personales en los ejemplos.
5. Sincronizar este archivo al Escritorio y al VPS y comprobar que los SHA256 coinciden.
6. No marcar una ruta como viva hasta verificarla a traves del puerto `18000`.

### Changelog documental

| Fecha | Cambio |
|---|---|
| 2026-06-29 | Inventario inicial generado desde la copia local |
| 2026-07-08 | Nuevo dump de pruebas; endpoints de facturas recibidas, CTB, punteos, catalogos contables y POST |
| 2026-07-14 | Codigo de ocho endpoints para agricultores, gastos y catalogos desplegado en disco y probado en puerto temporal |
| 2026-07-15 | Referencia completa de 41 operaciones; arquitectura, seguridad, escritura, errores, despliegue y estado vivo documentados |

## Flujo OCR para PDFs de facturas en correos

El OCR no debe confiar solo en el texto extraido. El flujo recomendable es extraer candidatos del PDF y contrastarlos contra la copia local con varios niveles de evidencia.

### 1. Resolver cliente

Extraer del PDF, si existen:

| Dato OCR | Endpoint/campo de contraste | Comentario |
|---|---|---|
| NIF/VAT/CIF | `GET /clientes?nif=...` -> `clientes.CLI_Nif` | Es el identificador mas fuerte si el PDF lo trae limpio. |
| Nombre fiscal/comercial | `GET /clientes?q=...` o `GET /clientes?nombre=...` -> `CLI_Nombre` | Usar busqueda flexible porque puede haber abreviaturas, puntos o pais. |
| Email | `GET /clientes?q=...` -> `CLI_Mail`, `CLI_emailalba*`, `CLI_emailped*` | Util para correos recurrentes, aunque no siempre aparece en factura. |
| Direccion/poblacion/pais | `GET /clientes/{id}` -> `CLI_Domicilio`, `CLI_Poblacion`, `CLI_IdPais` | Sirve para desempatar nombres parecidos. |
| Codigo EDI/VAT alternativo | `GET /clientes?q=...` o `codigo_edi=...` -> `CLI_CodigoEdi`, `CLI_NumeroIdentificacion` | Util en clientes con integraciones EDI. |

Ejemplos:

```text
GET http://172.19.0.1:18000/clientes?nif=PL8952015591
GET http://172.19.0.1:18000/clientes?q=AGRI%20GEM&limit=3
GET http://172.19.0.1:18000/clientes/633
```

Resultado real abreviado:

```json
{
  "id": 633,
  "nombre": "AGRI GEM SP. Z.O.O.",
  "nif": "PL8952015591",
  "domicilio": "UL NOWOPOLNA, 8",
  "poblacion": "WSCHOWA - LUBUSZ",
  "pais_id": 11,
  "bloqueo": "N",
  "inactivo_rgpd": "N"
}
```

### 2. Resolver factura

Una vez identificado el cliente candidato, extraer del PDF:

| Dato OCR | Campo de contraste | Peso |
|---|---|---:|
| Serie | `facturas.FRA_serie` | Alto |
| Numero de factura | `facturas.FRA_factura` | Alto |
| Fecha factura | `facturas.FRA_fecha` o `FRA_FechaExpedicion` | Alto |
| Cliente | `facturas.FRA_idcliente` | Alto |
| Total factura | `facturas.FRA_totalfactura` | Alto |
| Base imponible | `FRA_base1..FRA_base4` | Medio/alto |
| IVA/cuotas | `FRA_iva1..FRA_iva4`, `FRA_cuota1..FRA_cuota4` | Medio/alto |
| Vencimiento | `FRA_fechavto` | Medio |
| Referencia cliente | `FRA_RefCliente` | Medio |
| Referencia ventas/pedido | `FRA_RefVentas` | Medio |

Busqueda recomendada:

```text
GET /facturas?cliente_id=633&serie=CI26&numero=158
```

Validacion fuerte:

```text
cliente_id + serie + numero + fecha + total
```

Si el OCR no detecta serie/numero con fiabilidad, usar una ventana de fechas y cliente:

```text
GET /facturas?cliente_id=633&fecha_desde=2026-04-01&fecha_hasta=2026-04-30&limit=50
```

Luego comparar totales y referencias en n8n.

### 3. Resolver albaranes asociados

Con `facturas.FRA_idfactura`, los albaranes facturados se obtienen por:

```text
albsalida.ASA_idfactura = facturas.FRA_idfactura
```

Llamada:

```text
GET /facturas/{factura_id}/albaranes
```

Campos utiles para OCR:

| Dato OCR | Campo |
|---|---|
| Numero/serie de albaran | `ASA_serie`, `ASA_albaran` |
| Fecha de entrega/salida | `ASA_fechasalida` |
| Cliente | `ASA_idcliente` |
| Pedido | `ASA_idpedido` |
| Referencia | `ASA_referencia` |
| Referencia valoracion/ventas | `ASA_refvaloracion` |
| Estado facturado | `ASA_idfactura`; `0` suele indicar pendiente/no facturado |

### 4. Validar lineas, genero, gastos y totales

Para cada albaran:

```text
GET /albaranes/salida/{albaran_id}/lineas
```

Campos de contraste:

| Dato OCR | Campo |
|---|---|
| Producto/genero | `ASL_idgenero` |
| Categoria/calidad | `ASL_idcategoria`, `ASL_categoria` |
| Kilos netos/brutos | `ASL_kilosnetos`, `ASL_kilosbrutos` |
| Bultos | `ASL_bultos` |
| Palets | `ASL_palets` |
| Precio | `ASL_precio` |
| Importe genero | `ASL_importegenero` |

Para conceptos directamente en factura:

```text
GET /facturas/{factura_id}/lineas
```

Campos:

```text
FLV_concepto, FLV_cantidad, FLV_precio, FLV_kilos, FLV_bultos, FLV_palets, FLV_ImporteGenero
```

Para gastos:

```text
GET /facturas/{factura_id}/gastos
```

Actualmente devuelve ids y valores de gasto. Para que OCR pueda mostrar nombres legibles de portes, envases, suplidos, descuentos u otros conceptos, conviene exponer tambien el maestro de gastos como siguiente endpoint.

### 5. Reglas practicas de confianza

| Confianza | Condicion recomendada |
|---|---|
| Alta | Coinciden NIF/nombre cliente, serie, numero, fecha y total; los albaranes recuperados coinciden con referencias o fechas del PDF. |
| Media | Coincide cliente y total/fecha, pero falta serie o numero fiable; resolver con ventana de fechas y revisar manualmente. |
| Baja | Solo coincide nombre aproximado o total; requiere revision humana antes de aceptar. |
| Rechazo | Cliente no encontrado, factura duplicada ambigua o total/impuestos no cuadran. |

### Facturas recibidas de proveedores

Si el PDF entrante es una factura recibida de proveedor/acreedor, no debe forzarse el flujo por `clientes`. La estructura real de Netagro en la copia local es:

```text
acreedores.ACR_Codigo
  -> facturasrecibidas.FRR_idproveedor

empresas.EMP_idempresa
  -> facturasrecibidas.FRR_Idempresa

facturasrecibidas.FRR_id
  -> facturasrecibidas_ctb.FRC_idfacturarecibida
```

Lectura funcional:

| Tabla | Papel |
|---|---|
| `empresas` | Maestro de empresas/razones sociales. Resuelve `FRR_Idempresa`. |
| `acreedores` | Maestro de proveedores/acreedores. Resuelve nombre, NIF, cuenta contable, cuenta de gasto, forma de pago y estado. |
| `facturasrecibidas` | Cabecera real de factura recibida en Netagro. Tiene 74 columnas `FRR_*`/vencimientos/contabilidad. |
| `facturasrecibidas_ctb` | Lineas de desglose contable de la factura recibida. Tiene 11 columnas `FRC_*`. |

La tabla staging/OCR creada fuera de Netagro con unas 97 columnas no debe confundirse con la tabla real. Esa tabla mezcla:

| Bloque de columnas staging | Naturaleza |
|---|---|
| `id`, `archivo_pdf_id`, `duplicada_de`, `estado`, `created_at`, `updated_at` | Control interno de la app OCR/Supabase. No existe asi en Netagro. |
| `proveedor_nombre`, `proveedor_nif`, `source_pdf_name`, `email_*`, `confidence`, `extraction`, `validation_errors` | Metadatos de extraccion OCR y correo. No existe asi en Netagro. |
| Columnas `FRR_*`, `FechaVto`, `ImporteVto` | Borrador/copia nullable de los campos reales de `netagrocomer.facturasrecibidas`. |
| `netagro_sent_at`, `netagro_response`, `netagro_error` | Estado de sincronizacion hacia Netagro. No existe en Netagro. |

Conclusion: esa tabla staging puede ser correcta como bandeja de trabajo para OCR, pero la documentacion de integracion debe tratarla como capa intermedia. El modelo real de destino es `facturasrecibidas` + `facturasrecibidas_ctb` + `acreedores`.

Para OCR de facturas recibidas, contrastar:

| Dato OCR | Tabla/campo Netagro |
|---|---|
| Nombre proveedor | `acreedores.ACR_Nombre` |
| NIF/CIF/VAT proveedor | `acreedores.ACR_Nif` |
| Numero factura proveedor | `facturasrecibidas.FRR_numerofactura` |
| Fecha factura | `facturasrecibidas.FRR_fechafactura` |
| Ejercicio | `facturasrecibidas.FRR_ejercicio` |
| Total factura | `facturasrecibidas.FRR_totalfac` |
| Bases/IVA/cuotas | `FRR_base1..5`, `FRR_iva1..5`, `FRR_cuota1..5` |
| Retencion | `FRR_baseret`, `FRR_ret`, `FRR_cuotaret`, `FRR_ClaveIRPF` |
| Cuenta proveedor | `FRR_idcuenta`, `acreedores.ACR_IdCuenta` |
| Cuenta de gasto | `FRR_ctagasto1..4`, `acreedores.ACR_Cuentagasto`, `facturasrecibidas_ctb.FRC_Cuenta` |
| Vencimientos | `FechaVto`/`ImporteVto`, `FRR_FechaVto1..3`, `FRR_ImporteVto1..3` |
| Tipo/serie interna | `FRR_tipofactura`, `FRR_numero`, `FRR_IdTipoDoc` |

En la copia local no hay duplicados para la combinacion `FRR_Idempresa + FRR_ejercicio + FRR_idproveedor + FRR_numerofactura` excluyendo numero vacio. Por tanto, esa combinacion es buena para detectar duplicados en staging, aunque Netagro no declara esa restriccion unica en su DDL.

### Catalogos para combos de facturas recibidas

#### `FRR_Idempresa`

`FRR_Idempresa` sale del maestro real `empresas`:

```text
empresas.EMP_idempresa = facturasrecibidas.FRR_Idempresa
```

Endpoint:

```text
GET http://172.19.0.1:18000/empresas
GET http://172.19.0.1:18000/empresas/1
```

Valores vistos en la copia local:

| `EMP_idempresa` | Nombre | CIF | Ejercicio predeterminado |
|---:|---|---|---:|
| 1 | CAMPOJOYMA, S.L. | B04493482 | 25 |

Para el combo debe usarse `empresa_id`/`EMP_idempresa` como valor y `nombre` como etiqueta. En la copia dumpeada solo hay una empresa.

#### `FRR_tipofactura`

`FRR_tipofactura` es un codigo corto de tipo/serie interna de factura recibida. En la copia local existe una tabla candidata llamada `facturasrecibidastipo`, pero esta vacia; por tanto no hay descripciones oficiales cargadas para mostrar en combo.

El endpoint disponible devuelve el catalogo observado desde las facturas reales:

```text
GET http://172.19.0.1:18000/facturasrecibidas/tipos
```

Respuesta:

```json
{
  "items": [
    {
      "tipo_factura": "OT",
      "descripcion": null,
      "total": 30570,
      "fecha_min": "2013-10-01",
      "fecha_max": "2026-08-01"
    }
  ],
  "source": "distinct facturasrecibidas.FRR_tipofactura; facturasrecibidastipo exists but has 0 rows"
}
```

Valores observados:

| `FRR_tipofactura` | Facturas | Fecha min | Fecha max | Descripcion |
|---|---:|---|---|---|
| OT | 30570 | 2013-10-01 | 2026-08-01 | Sin descripcion oficial en la copia local. |
| GE | 8121 | 2020-01-02 | 2026-06-26 | Sin descripcion oficial en la copia local. |
| MA | 4919 | 2020-04-27 | 2026-04-07 | Sin descripcion oficial en la copia local. |
| GV | 2704 | 2020-06-30 | 2026-06-09 | Sin descripcion oficial en la copia local. |
| FI | 1279 | 2021-06-22 | 2026-04-20 | Sin descripcion oficial en la copia local. |
| GC | 361 | 2020-08-31 | 2026-06-22 | Sin descripcion oficial en la copia local. |
| CE | 356 | 2021-08-10 | 2025-10-31 | Sin descripcion oficial en la copia local. |
| FZ | 308 | 2020-02-08 | 2021-05-20 | Sin descripcion oficial en la copia local. |
| CX | 14 | 2020-07-30 | 2021-03-03 | Sin descripcion oficial en la copia local. |
| GM | 8 | 2022-10-31 | 2024-04-30 | Sin descripcion oficial en la copia local. |
| vacio/null | 1 | 1900-01-01 | 1900-01-01 | Registro historico sin tipo informado. |

No se ha visto `FRR_tipofactura = '1'` en la copia MariaDB dumpeada. Si aparece `1` en staging/OCR, debe tratarse como valor pendiente de validacion o como confusion con `FRR_Idempresa = 1` hasta que negocio confirme lo contrario.

## Ejemplos reales

### Cliente maestro usado por el ejemplo

Clientes reales de la copia local:

| `CLI_Idcliente` | `CLI_Nombre` | `CLI_Nif` | `CLI_Mail` | `CLI_Domicilio` | `CLI_Poblacion` | `CLI_IdPais` | `CLI_bloqueo` | `CLI_InactivoRGPD` |
|---|---|---|---|---|---|---:|---|---|
| 187 | IBERIANA FRUCHT GMBH | DE811672269 | albaran@iberiana.es | HANNS MARTIN-SCHLEYER STRASSE, 2 | OFFERNBURG D-77656 | 4 | N | N |
| 633 | AGRI GEM SP. Z.O.O. | PL8952015591 |  | UL NOWOPOLNA, 8 | WSCHOWA - LUBUSZ | 11 | N | N |

### Factura recibida con acreedor

Acreedores reales de la copia local:

| `ACR_Codigo` | `ACR_Nombre` | `ACR_Nif` | `ACR_IdCuenta` | `ACR_Cuentagasto` | `ACR_Bloqueado` | `ACR_InactivoRGPD` |
|---:|---|---|---|---|---|---|
| 345 | RUIZ SALAZAR RAMON | 34841811P | 41000000345 |  | N | N |
| 1174 | LA JABEGA PLAYA, S.L. | B13832399 | 41000001174 |  | N | N |
| 1941 | MONTAJES ELÉCTRICOS ÁVILA SL | B04243655 | 41000001941 | 62200059050 | N | N |

Factura recibida real:

| Campo | Valor |
|---|---|
| `FRR_id` | 49165 |
| `FRR_numero` | 4912 |
| `FRR_fechafactura` | 2026-06-25 |
| `FRR_numerofactura` | FCD26/2820 |
| `FRR_ejercicio` | 25 |
| `FRR_idproveedor` | 1941 |
| `ACR_Nombre` | MONTAJES ELÉCTRICOS ÁVILA SL |
| `ACR_Nif` | B04243655 |
| `FRR_base1` | 13350.49 |
| `FRR_iva1` | 4.00 |
| `FRR_cuota1` | 534.02 |
| `FRR_totalfac` | 13884.51 |
| `FRR_tipofactura` | GE |
| `FRR_idregimen` | 1110 |
| `FRR_idcuenta` | 40000001941 |
| `FRR_Concepto` | FRA. AGRODOLORES EL MIRADOR S.L. |

Ejemplo real con desglose contable en `facturasrecibidas_ctb`:

| Campo | Valor |
|---|---|
| `FRR_id` | 34602 |
| `FRR_fechafactura` | 2024-05-13 |
| `FRR_numerofactura` | 24-0010 |
| `FRR_idproveedor` | 1924 |
| `ACR_Nombre` | CRISTOBAL HUGO RODOLFO |
| `FRR_totalfac` | 31261.19 |
| `FRR_tipofactura` | GE |
| `FRR_idcuenta` | 40000001924 |

Lineas contables:

| `FRC_id` | `FRC_idfacturarecibida` | `FRC_Importe` | `FRC_Cuenta` | `FRC_IdActividad` | `FRC_Idseccion` |
|---:|---:|---:|---|---:|---:|
| 37032 | 34602 | 34734.65 | 40090001924 | 0 | 0 |
| 37033 | 34602 | -3473.46 | 60000000010 | 0 | 0 |

### Factura emitida con albaran asociado

Candidatos reales encontrados con factura, albaranes y alguna linea/concepto:

| `FRA_idfactura` | `FRA_serie` | `FRA_factura` | `FRA_fecha` | `FRA_idcliente` | `FRA_totalfactura` | `albaranes` | `lineas` | `gastos` |
|---|---|---|---|---|---|---|---|---|
| 175449 | CI26 | 158 | 2026-04-07 | 633 | 2432.40 | 1 | 1 | 0 |
| 175090 | CI26 | 157 | 2026-04-01 | 633 | 6188.80 | 1 | 1 | 0 |
| 175089 | CI26 | 156 | 2026-04-01 | 633 | 3751.20 | 1 | 1 | 0 |
| 175088 | CI26 | 155 | 2026-04-01 | 633 | 2550.40 | 1 | 1 | 0 |
| 174514 | CI26 | 151 | 2026-03-31 | 633 | 1922.00 | 1 | 1 | 0 |

Factura documentada:

| Campo | Valor |
|---|---|
| `FRA_idfactura` | 175449 |
| `FRA_serie` | CI26 |
| `FRA_factura` | 158 |
| `FRA_fecha` | 2026-04-07 |
| `FRA_idcliente` | 633 |
| `FRA_clientealbaranes` | 633 |
| `FRA_totalfactura` | 2432.40 |
| `FRA_base1` | 2272.40 |
| `FRA_base3` | 160.00 |
| `FRA_RefCliente` | agrigem 300626 |
| `FRA_RefVentas` | PO 25667 |
| `FRA_idasientonet` | 376750 |
| `FRA_FechaExpedicion` | 2026-04-13 |

Linea/concepto de factura:

| `FLV_idlinea` | `FLV_idfactura` | `FLV_tipoGEC` | `FLV_codigo` | `FLV_concepto` | `FLV_cantidad` | `FLV_precio` | `FLV_ImporteGenero` |
|---|---|---|---|---|---|---|---|
| 146844 | 175449 | C | 23 | TRANSPORTE  | 2.00 | 80.000000 | 0.00 |

Albaran de salida asociado por `albsalida.ASA_idfactura = facturas.FRA_idfactura`:

| `ASA_idalbaran` | `ASA_serie` | `ASA_albaran` | `ASA_fechasalida` | `ASA_idcliente` | `ASA_idfactura` | `ASA_idpedido` | `ASA_referencia` | `ASA_refvaloracion` |
|---|---|---|---|---|---|---|---|---|
| 107054 | C26 | 745 | 2026-03-30 | 633 | 175449 | 114703 | agrigem 300626 | PO 25667 |

### Albaran de salida con lineas, gastos y palets

| Campo | Valor |
|---|---|
| `ASA_idalbaran` | 107054 |
| `ASA_serie` | C26 |
| `ASA_albaran` | 745 |
| `ASA_ejercicio` | 25 |
| `ASA_fechasalida` | 2026-03-30 |
| `ASA_idcliente` | 633 |
| `ASA_idpedido` | 114703 |
| `ASA_idfactura` | 175449 |
| `ASA_idfacturaestimativa` | 174960 |
| `ASA_idfacturanegativa` | 175526 |
| `ASA_referencia` | agrigem 300626 |
| `ASA_refvaloracion` | PO 25667 |

Lineas:

| `ASL_idlinea` | `ASL_idalbaran` | `ASL_idgenero` | `ASL_categoria` | `ASL_kilosnetos` | `ASL_bultos` | `ASL_palets` | `ASL_precio` | `ASL_importegenero` | `ASL_precioventa` |
|---|---|---|---|---|---|---|---|---|---|
| 354605 | 107054 | 101001 | I G | 1320.00 | 220 | 2 | 2.3000 | 3036.0000 | 1.7215 |

Gastos:

| `ASG_id` | `ASG_idalbaran` | `ASG_idgasto` | `ASG_tipokbp` | `ASG_tipofc` | `ASG_valorgasto` | `ASG_importegastoeuros` | `ASG_idacreedor` |
|---|---|---|---|---|---|---|---|
| 411392 | 107054 | 6101 | K | C | 0.030000 | 39.6000 | 2561 |
| 411393 | 107054 | 6101 | K | C | 0.020000 | 26.4000 | 2731 |
| 412539 | 107054 | 5000 | I | C | 155.000000 | 155.0000 | 10205 |
| 412540 | 107054 | 5000 | I | C | -80.000000 | -80.0000 | 9999 |

Palets:

| `ASP_id` | `ASP_idalbaran` | `ASP_idpalet` | `ASP_PosicionSalida` | `ASP_PosicionCamion` |
|---|---|---|---|---|
| 398675 | 107054 | 402157 |  |  |
| 398676 | 107054 | 402161 |  |  |

### Albaran de entrada

| Campo | Valor |
|---|---|
| `AEN_idalbaran` | 82196 |
| `AEN_serie` | A26 |
| `AEN_albaran` | 8104 |
| `AEN_campa` | 25 |
| `AEN_fecha` | 2026-06-29 |
| `AEN_idagricultor` | 1891 |
| `AEN_idpuntoventa` | 1 |
| `AEN_idcentro` | 1 |
| `AEN_tipofcs` | C |
| `AEN_referencia` |  |

Lineas:

| `AEL_idlinea` | `AEL_idalbaran` | `AEL_idgenero` | `AEL_idenvase` | `AEL_idcategoria` | `AEL_kilosbrutos` | `AEL_kilosnetos` | `AEL_bultos` | `AEL_precio` | `AEL_Importe` |
|---|---|---|---|---|---|---|---|---|---|
| 86729 | 82196 | 121002 | 702 | 0 | 0.00 | 0.00 | 0 | 0.00000 | 0.00 |

Clasificacion/valoracion de la linea:

| `ALC_id` | `ALC_idlineaentrada` | `ALC_idalbaran` | `ALC_idgenero` | `ALC_kilosnetos` | `ALC_bultos` | `ALC_precio` | `ALC_Importe` |
|---|---|---|---|---|---|---|---|
| 340761 | 86729 | 82196 | 121002 | 0.00 | 0 | 0.00000 | 0.00 |

### Factura/liquidacion de agricultor

| Campo | Valor |
|---|---|
| `FGR_idfactura` | 8837 |
| `FGR_serie` | 26 |
| `FGR_numerofactur` | 841 |
| `FGR_fecha` | 2026-07-01 |
| `FGR_idagricultor` | 1542 |
| `FGR_Igenero` | 32671.60 |
| `FGR_BaseImponible` | 31038.02 |
| `FGR_iva` | 12.00 |
| `FGR_cuotaiva` | 3724.56 |
| `FGR_retencion` | 2.00 |
| `FGR_cuotaretencion` | 695.25 |
| `FGR_totalfactura` | 34067.33 |
| `FGR_DeFecha` | 2026-04-23 |
| `FGR_AFecha` | 2026-04-23 |

Lineas:

| `FAL_id` | `FAL_idfactura` | `FAL_idgenero` | `FAL_idcategoria` | `FAL_bultos` | `FAL_kilos` | `FAL_precio` | `FAL_importe` | `FAL_idpartida` | `FAL_FechaLinea` |
|---|---|---|---|---|---|---|---|---|---|
| 81120 | 8837 | 161100 | 99100 | 62 | 15783.00 | 1.0400 | 16414.32 | 84896 | 2026-04-23 |
| 81121 | 8837 | 161100 | 99100 | 62 | 15632.00 | 1.0400 | 16257.28 | 84899 | 2026-04-23 |
| 81122 | 8837 | 161100 | 99999 | 2 | 542.00 | 0.0000 | 0.00 | 84896 | 2026-04-23 |
| 81123 | 8837 | 161100 | 99999 | 2 | 537.00 | 0.0000 | 0.00 | 84899 | 2026-04-23 |

## SQL canonico para trabajar con facturas y albaranes

Buscar cliente por NIF/VAT:

```sql
SELECT CLI_Idcliente, CLI_Nombre, CLI_Nif, CLI_Mail,
       CLI_Domicilio, CLI_Poblacion, CLI_IdPais,
       CLI_bloqueo, CLI_InactivoRGPD
FROM netagrocomer.clientes
WHERE CLI_Nif LIKE ?;
```

Buscar cliente por texto flexible:

```sql
SELECT CLI_Idcliente, CLI_Nombre, CLI_Nif, CLI_Mail,
       CLI_Domicilio, CLI_Poblacion, CLI_IdPais
FROM netagrocomer.clientes
WHERE CLI_Nombre LIKE ?
   OR CLI_Nif LIKE ?
   OR CLI_CodigoEdi LIKE ?
   OR CLI_NumeroIdentificacion LIKE ?
   OR CLI_Mail LIKE ?
ORDER BY CLI_Nombre, CLI_Idcliente
LIMIT 50;
```

Factura con cliente:

```sql
SELECT f.FRA_idfactura, f.FRA_serie, f.FRA_factura, f.FRA_fecha,
       f.FRA_idcliente, c.CLI_Nombre, c.CLI_Nif,
       f.FRA_totalfactura, f.FRA_RefCliente, f.FRA_RefVentas
FROM netagrocomer.facturas f
JOIN netagrocomer.clientes c ON c.CLI_Idcliente = f.FRA_idcliente
WHERE f.FRA_idcliente = ?
  AND f.FRA_serie = ?
  AND f.FRA_factura = ?;
```

Factura con sus albaranes de salida:

```sql
SELECT f.FRA_idfactura, f.FRA_serie, f.FRA_factura, f.FRA_fecha,
       f.FRA_idcliente, f.FRA_totalfactura,
       a.ASA_idalbaran, a.ASA_serie, a.ASA_albaran,
       a.ASA_fechasalida, a.ASA_idpedido, a.ASA_referencia
FROM netagrocomer.facturas f
JOIN netagrocomer.albsalida a ON a.ASA_idfactura = f.FRA_idfactura
WHERE f.FRA_idfactura = ?;
```

Albaran de salida completo:

```sql
SELECT a.*, l.*
FROM netagrocomer.albsalida a
JOIN netagrocomer.albsalida_lineas l ON l.ASL_idalbaran = a.ASA_idalbaran
WHERE a.ASA_idalbaran = ?;
```

Albaran de entrada completo:

```sql
SELECT e.*, l.*
FROM netagrocomer.albentrada e
JOIN netagrocomer.albentrada_lineas l ON l.AEL_idalbaran = e.AEN_idalbaran
WHERE e.AEN_idalbaran = ?;
```

Factura de agricultor con partidas:

```sql
SELECT f.*, l.*
FROM netagrocomer.facturaagr f
JOIN netagrocomer.facturaagr_lineas l ON l.FAL_idfactura = f.FGR_idfactura
WHERE f.FGR_idfactura = ?;
```

Buscar acreedor/proveedor por NIF:

```sql
SELECT ACR_Codigo, ACR_Nombre, ACR_Nif, ACR_Mail,
       ACR_IdCuenta, ACR_Cuentagasto, ACR_Bloqueado, ACR_InactivoRGPD
FROM netagrocomer.acreedores
WHERE ACR_Nif LIKE ?;
```

Factura recibida con acreedor:

```sql
SELECT f.FRR_id, f.FRR_numero, f.FRR_fechafactura, f.FRR_numerofactura,
       f.FRR_ejercicio, f.FRR_idproveedor,
       a.ACR_Nombre, a.ACR_Nif,
       f.FRR_base1, f.FRR_iva1, f.FRR_cuota1, f.FRR_totalfac,
       f.FRR_tipofactura, f.FRR_idcuenta, f.FRR_Concepto
FROM netagrocomer.facturasrecibidas f
LEFT JOIN netagrocomer.acreedores a ON a.ACR_Codigo = f.FRR_idproveedor
WHERE f.FRR_idproveedor = ?
  AND f.FRR_numerofactura = ?;
```

Desglose contable de una factura recibida:

```sql
SELECT c.FRC_id, c.FRC_idfacturarecibida, c.FRC_Importe, c.FRC_Cuenta,
       c.FRC_IdActividad, c.FRC_Idseccion,
       c.FRC_Iddepartamento, c.FRC_Idsubdepartamento
FROM netagrocomer.facturasrecibidas_ctb c
WHERE c.FRC_idfacturarecibida = ?
ORDER BY c.FRC_id;
```

Deteccion de duplicados para staging OCR:

```sql
SELECT FRR_Idempresa, FRR_ejercicio, FRR_idproveedor, FRR_numerofactura,
       COUNT(*) AS repeticiones
FROM netagrocomer.facturasrecibidas
WHERE FRR_numerofactura <> ''
GROUP BY FRR_Idempresa, FRR_ejercicio, FRR_idproveedor, FRR_numerofactura
HAVING COUNT(*) > 1;
```

## Catalogo completo de campos

Las lineas `Filas exactas en copia local` y los tamanos de las fichas siguientes
corresponden tambien al snapshot del `2026-06-29`. El DDL y los nombres de campo son
la referencia estructural; las volumetrias deben recalcularse despues de cada restore.

### `clientes`

Maestro de clientes usado por facturas emitidas y albaranes de salida.

- Filas exactas en copia local: `1190`
- Tamano aproximado: `n/d`
- Clave tecnica: `CLI_Idcliente`.
- Identificadores fuertes para OCR: `CLI_Nif`, `CLI_Nombre`, `CLI_CodigoEdi`, `CLI_NumeroIdentificacion`, `CLI_Mail`.
- Estado operativo: `CLI_bloqueo = 'N'` y `CLI_InactivoRGPD = 'N'` indican cliente activo/no bloqueado en los ejemplos analizados.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `CLI_Idcliente` |
| `indice_UNIQUE` | Si | `CLI_Idcliente` |
| `idx_CLI_TPC` | No | `CLI_Idtipo` |
| `idx_CLI_NIF` | No | `CLI_Nif` |
| `idx_CLI_NOM` | No | `CLI_Nombre` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `CLI_Idcliente` | `int(11)` | NO | PRI | id interno del cliente; se cruza con `FRA_idcliente` y `ASA_idcliente` |
| `CLI_Nombre` | `varchar(100)` | NO | MUL | nombre fiscal/comercial del cliente |
| `CLI_Nif` | `varchar(20)` | NO | MUL | NIF/CIF/VAT; dato mas fuerte para resolver cliente por OCR |
| `CLI_Idtipo` | `int(11)` | NO | MUL | tipo/clase de cliente |
| `CLI_ididioma` | `int(11)` | NO |  | idioma documental/comercial del cliente |
| `CLI_iddivisa` | `int(11)` | NO |  | divisa habitual del cliente |
| `CLI_idvendedor` | `int(11)` | NO |  | vendedor asignado |
| `CLI_Domicilio` | `varchar(150)` | NO |  | domicilio fiscal/principal |
| `CLI_Poblacion` | `varchar(50)` | NO |  | poblacion/localidad |
| `CLI_Provincia` | `varchar(50)` | NO |  | provincia/region |
| `CLI_CPostal` | `varchar(12)` | NO |  | codigo postal |
| `CLI_IdZona` | `int(11)` | NO |  | zona comercial/logistica |
| `CLI_Telefono1` | `varchar(25)` | NO |  | telefono principal |
| `CLI_Telefono2` | `varchar(25)` | NO |  | telefono secundario |
| `CLI_Fax` | `varchar(25)` | NO |  | fax |
| `CLI_Mail` | `varchar(250)` | NO |  | email general |
| `CLI_IdPais` | `int(11)` | NO |  | pais |
| `CLI_fechaalta` | `date` | NO |  | fecha de alta |
| `CLI_bloqueo` | `varchar(1)` | NO |  | indicador de bloqueo |
| `CLI_bloqueocausa` | `varchar(50)` | NO |  | causa de bloqueo |
| `CLI_idcomisionista` | `int(11)` | NO |  | comisionista asociado |
| `CLI_FC` | `varchar(1)` | NO |  | marca operativa historica FC |
| `CLI_QuincenasFax` | `varchar(1)` | NO |  | marca historica de envio/quincenas |
| `CLI_KB` | `varchar(1)` | NO |  | marca operativa historica KB |
| `CLI_Facturaenvasecomercio` | `varchar(1)` | NO |  | marca de facturacion de envase/comercio |
| `CLI_observacionesfactura` | `varchar(50)` | NO |  | observaciones que pueden aparecer en factura |
| `CLI_Contrato` | `varchar(1)` | NO |  | marca de contrato |
| `CLI_IdFormaPago` | `int(11)` | NO |  | forma de pago habitual |
| `CLI_Idtipoporte` | `int(11)` | NO |  | tipo de porte/transporte |
| `CLI_origendestino` | `varchar(1)` | NO |  | marca origen/destino |
| `CLI_emailalba1` | `varchar(50)` | NO |  | email para albaranes 1 |
| `CLI_emailalba2` | `varchar(50)` | NO |  | email para albaranes 2 |
| `CLI_emailalba3` | `varchar(50)` | NO |  | email para albaranes 3 |
| `CLI_emailped1` | `varchar(50)` | NO |  | email para pedidos 1 |
| `CLI_emailped2` | `varchar(50)` | NO |  | email para pedidos 2 |
| `CLI_emailped3` | `varchar(50)` | NO |  | email para pedidos 3 |
| `CLI_DatosActualizadosSN` | `varchar(1)` | NO |  | marca de datos actualizados |
| `CLI_Asegurado` | `varchar(1)` | NO |  | marca de asegurado/riesgo |
| `CLI_Numerocontrato` | `varchar(20)` | NO |  | numero de contrato |
| `CLI_FechaSolicitud` | `date` | NO |  | fecha de solicitud de riesgo/credito |
| `CLI_ImporteSolicitado` | `decimal(12,2)` | NO |  | importe de riesgo solicitado |
| `CLI_ImporteConcedido` | `decimal(12,2)` | NO |  | importe de riesgo concedido |
| `CLI_RiesgoMaximo` | `decimal(12,2)` | NO |  | riesgo maximo permitido |
| `CLI_DesglosarLotes` | `varchar(1)` | NO |  | configuracion de desglose de lotes |
| `CLI_DetallarNormaCalidad` | `varchar(1)` | NO |  | configuracion de detalle de norma/calidad |
| `CLI_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico |
| `CLI_FechaLog` | `date` | NO |  | fecha de auditoria |
| `CLI_HoraLog` | `varchar(8)` | NO |  | hora de auditoria |
| `CLI_Detallartipopalet` | `varchar(1)` | NO |  | configuracion de detalle tipo palet |
| `CLI_Detallarmarca` | `varchar(1)` | NO |  | configuracion de detalle marca |
| `CLI_IdEmpresa` | `int(11)` | NO |  | empresa asociada |
| `CLI_DetallarBxP` | `varchar(1)` | NO |  | configuracion de detalle bultos por palet |
| `CLI_CodigoEdi` | `varchar(17)` | NO |  | codigo EDI del cliente |
| `CLI_IdBanco` | `int(11)` | NO |  | banco asociado |
| `CLI_FormatoEdi` | `int(11)` | NO |  | formato EDI |
| `CLI_PorcentajeRiesgo` | `int(11)` | NO |  | porcentaje de riesgo |
| `CLI_CompradorEDI` | `varchar(17)` | NO |  | comprador EDI |
| `CLI_PagadorEDI` | `varchar(17)` | NO |  | pagador EDI |
| `CLI_NumeroIdentificacion` | `varchar(50)` | NO |  | identificacion alternativa |
| `CLI_SerieVentaIntermediacion` | `varchar(5)` | NO |  | serie de venta para intermediacion |
| `CLI_SerieCompraIntermediacion` | `varchar(5)` | NO |  | serie de compra para intermediacion |
| `CLI_BloqueoRiesgo` | `varchar(1)` | NO |  | bloqueo por riesgo |
| `CLI_DetallarObs` | `varchar(1)` | NO |  | configuracion de detalle de observaciones |
| `CLI_CodigoCLVi` | `varchar(17)` | NO |  | codigo CLVi |
| `CLI_IdtarifaSubasta` | `int(11)` | NO |  | tarifa de subasta |
| `CLI_DesglosarOrigenGenero` | `varchar(1)` | NO |  | configuracion de desglose de origen de genero |
| `CLI_InactivoRGPD` | `varchar(1)` | NO |  | marca de inactividad RGPD |
| `CLI_CopiarObs` | `varchar(1)` | NO |  | configuracion de copia de observaciones |
| `CLI_RegistroSanitario` | `varchar(150)` | NO |  | registro sanitario |
| `CLI_GastoPuntoVerde` | `varchar(1)` | NO |  | configuracion de gasto punto verde |
| `CLI_XmlEdi` | `varchar(100)` | NO |  | configuracion XML/EDI |
| `CLI_CIP` | `varchar(17)` | NO |  | codigo CIP |
| `CLI_SolicitarSSCC` | `varchar(1)` | NO |  | marca para solicitar SSCC |
| `CLI_ComisionSubasta` | `decimal(10,5)` | NO |  | comision de subasta |
| `CLI_TipoEnvioEmailsAlbaranes` | `varchar(1)` | NO |  | tipo de envio de emails de albaranes |
| `CLI_TipoEnvioEmailsFacturas` | `varchar(1)` | NO |  | tipo de envio de emails de facturas |
| `CLI_FechaVerificadoNIF` | `date` | NO |  | fecha de verificacion del NIF |
| `CLI_ModeloPedidosIA` | `varchar(100)` | NO |  | modelo/configuracion IA para pedidos |

### `acreedores`

Maestro de proveedores/acreedores usado por facturas recibidas.

- Filas exactas en copia local: `1831`
- Tamano aproximado: `0.47 MB`
- Clave tecnica: `ACR_Codigo`.
- Relacion principal: `facturasrecibidas.FRR_idproveedor = acreedores.ACR_Codigo`.
- Identificadores fuertes para OCR: `ACR_Nif`, `ACR_Nombre`, `ACR_Mail`, `ACR_IdCuenta`.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `ACR_Codigo` |
| `indice_UNIQUE` | Si | `ACR_Codigo` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `ACR_Codigo` | `int(11)` | NO | PRI | id interno del acreedor/proveedor |
| `ACR_Nombre` | `varchar(100)` | NO |  | nombre fiscal/comercial |
| `ACR_Nif` | `varchar(15)` | NO |  | NIF/CIF/VAT del proveedor |
| `ACR_Domicilio` | `varchar(150)` | NO |  | domicilio |
| `ACR_Poblacion` | `varchar(50)` | NO |  | poblacion |
| `ACR_Provincia` | `varchar(50)` | NO |  | provincia |
| `ACR_CPostal` | `varchar(7)` | NO |  | codigo postal |
| `ACR_Telefono1` | `varchar(15)` | NO |  | telefono principal |
| `ACR_Telefono2` | `varchar(15)` | NO |  | telefono secundario |
| `ACR_Fax` | `varchar(15)` | NO |  | fax |
| `ACR_Mail` | `varchar(250)` | NO |  | email |
| `ACR_IdCuenta` | `varchar(15)` | NO |  | cuenta contable del acreedor/proveedor |
| `ACR_PorceRet` | `decimal(18,2)` | NO |  | porcentaje de retencion habitual |
| `ACR_PorceIva` | `decimal(18,2)` | NO |  | porcentaje de IVA habitual |
| `ACR_Cuentagasto` | `varchar(15)` | NO |  | cuenta de gasto habitual |
| `ACR_IdBanco` | `int(11)` | NO |  | banco asociado |
| `ACR_IdTipo` | `int(11)` | NO |  | tipo de acreedor/proveedor |
| `ACR_Dias` | `int(11)` | NO |  | dias de pago/vencimiento |
| `ACR_IBAN` | `varchar(50)` | NO |  | IBAN |
| `ACR_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico |
| `ACR_FechaLog` | `date` | NO |  | fecha de auditoria |
| `ACR_HoraLog` | `varchar(8)` | NO |  | hora de auditoria |
| `ACR_CuentaCartera` | `varchar(15)` | NO |  | cuenta de cartera |
| `ACR_FormaPago` | `int(11)` | NO |  | forma de pago habitual |
| `ACR_CodigoFianza` | `varchar(70)` | NO |  | codigo de fianza |
| `ACR_Bloqueado` | `varchar(1)` | NO |  | indicador de bloqueo |
| `ACR_MensajeBloqueado` | `varchar(100)` | NO |  | mensaje/causa de bloqueo |
| `ACR_IdDivisa` | `int(11)` | NO |  | divisa |
| `ACR_IdActividad` | `int(11)` | NO |  | actividad |
| `ACR_IdSeccion` | `int(11)` | NO |  | seccion |
| `ACR_IdPais` | `int(11)` | NO |  | pais |
| `ACR_InactivoRGPD` | `varchar(1)` | NO |  | marca de inactividad RGPD |
| `ACR_Documentacion` | `varchar(1)` | NO |  | marca documental |

### `facturas`

Cabecera de facturas emitidas a clientes.

- Filas exactas en copia local: `179532`
- Tamano aproximado: `88.72 MB`
- Clave de negocio: `FRA_idfactura` es la clave tecnica. La identidad de negocio suele ser `FRA_serie` + `FRA_factura` + `FRA_fecha`/`FRA_campa`.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `FRA_idfactura` |
| `idx_FRA_CLI` | No | `FRA_idcliente` |
| `idx_FRA_EMPFEC` | No | `FRA_idempresa`, `FRA_fecha` |
| `idx_FRA_FACENV` | No | `FRA_FacturaEnvases` |
| `idx_FRA_FACGAS` | No | `FRA_FacturaGasto` |
| `idx_FRA_PRO` | No | `FRA_IdAcreedor` |
| `idx_FRA_SERFAC` | No | `FRA_serie`, `FRA_factura` |
| `idx_FRA_VAL` | No | `FRA_idvaleenvase` |
| `indice_UNIQUE` | Si | `FRA_idfactura` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `FRA_idfactura` | `int(11)` | NO | PRI | id interno de factura relacionada (factura emitida a cliente) |
| `FRA_serie` | `varchar(5)` | NO | MUL | serie documental (factura emitida a cliente) |
| `FRA_factura` | `int(11)` | NO |  | numero de factura dentro de la serie (factura emitida a cliente) |
| `FRA_fecha` | `date` | NO |  | fecha principal del documento (factura emitida a cliente) |
| `FRA_idcliente` | `int(11)` | NO | MUL | id del cliente (factura emitida a cliente) |
| `FRA_idpuntoventa` | `int(11)` | NO |  | id de punto de venta (factura emitida a cliente) |
| `FRA_campa` | `int(11)` | NO |  | campana/ejercicio agricola (factura emitida a cliente) |
| `FRA_tipofactura` | `varchar(1)` | NO |  | numero de factura dentro de la serie (factura emitida a cliente) |
| `FRA_cdpais` | `int(11)` | NO |  | codigo/id de pais (factura emitida a cliente) |
| `FRA_cddivisa` | `int(11)` | NO |  | codigo/id de divisa (factura emitida a cliente) |
| `FRA_valorcambio` | `decimal(10,6)` | NO |  | tipo de cambio aplicado (factura emitida a cliente) |
| `FRA_totalfactura` | `decimal(10,2)` | NO |  | numero de factura dentro de la serie (factura emitida a cliente) |
| `FRA_idasientonet` | `int(11)` | NO |  | id de asiento contable (factura emitida a cliente) |
| `FRA_base1` | `decimal(10,2)` | NO |  | base imponible por tramo de IVA (factura emitida a cliente) |
| `FRA_base2` | `decimal(10,2)` | NO |  | base imponible por tramo de IVA (factura emitida a cliente) |
| `FRA_base3` | `decimal(10,2)` | NO |  | base imponible por tramo de IVA (factura emitida a cliente) |
| `FRA_base4` | `decimal(10,2)` | NO |  | base imponible por tramo de IVA (factura emitida a cliente) |
| `FRA_iva1` | `decimal(10,2)` | NO |  | porcentaje/tipo de IVA (factura emitida a cliente) |
| `FRA_iva2` | `decimal(10,2)` | NO |  | porcentaje/tipo de IVA (factura emitida a cliente) |
| `FRA_iva3` | `decimal(10,2)` | NO |  | porcentaje/tipo de IVA (factura emitida a cliente) |
| `FRA_iva4` | `decimal(10,2)` | NO |  | porcentaje/tipo de IVA (factura emitida a cliente) |
| `FRA_cuota1` | `decimal(10,2)` | NO |  | cuota/importes de impuesto (factura emitida a cliente) |
| `FRA_cuota2` | `decimal(10,2)` | NO |  | cuota/importes de impuesto (factura emitida a cliente) |
| `FRA_cuota3` | `decimal(10,2)` | NO |  | cuota/importes de impuesto (factura emitida a cliente) |
| `FRA_cuota4` | `decimal(10,2)` | NO |  | cuota/importes de impuesto (factura emitida a cliente) |
| `FRA_re1` | `decimal(10,2)` | NO |  | campo operativo inferido por nombre: re1 (factura emitida a cliente) |
| `FRA_re2` | `decimal(10,2)` | NO |  | campo operativo inferido por nombre: re2 (factura emitida a cliente) |
| `FRA_re3` | `decimal(10,2)` | NO |  | campo operativo inferido por nombre: re3 (factura emitida a cliente) |
| `FRA_re4` | `decimal(10,2)` | NO |  | campo operativo inferido por nombre: re4 (factura emitida a cliente) |
| `FRA_cuotare1` | `decimal(10,2)` | NO |  | cuota/importes de impuesto (factura emitida a cliente) |
| `FRA_cuotare2` | `decimal(10,2)` | NO |  | cuota/importes de impuesto (factura emitida a cliente) |
| `FRA_cuotare3` | `decimal(10,2)` | NO |  | cuota/importes de impuesto (factura emitida a cliente) |
| `FRA_cuotare4` | `decimal(10,2)` | NO |  | cuota/importes de impuesto (factura emitida a cliente) |
| `FRA_idvaleenvase` | `int(11)` | NO | MUL | campo operativo inferido por nombre: idvaleenvase (factura emitida a cliente) |
| `FRA_FacturaEnvases` | `varchar(2)` | NO | MUL | marca o referencia de factura de envases (factura emitida a cliente) |
| `FRA_FacturaGasto` | `varchar(2)` | NO | MUL | marca o referencia de factura de gastos (factura emitida a cliente) |
| `FRA_clientealbaranes` | `int(11)` | NO |  | numero de albaran dentro de la serie/campana (factura emitida a cliente) |
| `FRA_idformadepago` | `int(11)` | NO |  | campo operativo inferido por nombre: idformadepago (factura emitida a cliente) |
| `FRA_fechavto` | `date` | NO |  | fecha de vencimiento (factura emitida a cliente) |
| `FRA_cuentaventas1` | `varchar(11)` | NO |  | cuenta contable de ventas (factura emitida a cliente) |
| `FRA_cuentaventas2` | `varchar(11)` | NO |  | cuenta contable de ventas (factura emitida a cliente) |
| `FRA_cuentaventas3` | `varchar(11)` | NO |  | cuenta contable de ventas (factura emitida a cliente) |
| `FRA_alhcom` | `varchar(1)` | NO |  | campo operativo inferido por nombre: alhcom (factura emitida a cliente) |
| `FRA_idcentro` | `int(11)` | NO |  | id de centro (factura emitida a cliente) |
| `FRA_obs1` | `varchar(100)` | NO |  | campo operativo inferido por nombre: obs1 (factura emitida a cliente) |
| `FRA_obs2` | `varchar(100)` | NO |  | campo operativo inferido por nombre: obs2 (factura emitida a cliente) |
| `FRA_RefCliente` | `varchar(50)` | NO |  | referencia del cliente (factura emitida a cliente) |
| `FRA_idempresa` | `int(11)` | NO | MUL | id de empresa (factura emitida a cliente) |
| `FRA_Suplido` | `decimal(10,2)` | NO |  | importe suplido (factura emitida a cliente) |
| `FRA_IdAcreedor` | `int(11)` | NO | MUL | id del acreedor (factura emitida a cliente) |
| `FRA_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro (factura emitida a cliente) |
| `FRA_FechaLog` | `date` | NO |  | fecha principal del documento (factura emitida a cliente) |
| `FRA_HoraLog` | `varchar(8)` | NO |  | hora de auditoria (factura emitida a cliente) |
| `FRA_Clave` | `varchar(10)` | NO |  | campo operativo inferido por nombre: clave (factura emitida a cliente) |
| `FRA_PorRetencion` | `decimal(12,2)` | NO |  | retencion (factura emitida a cliente) |
| `FRA_IdRegimenIva` | `int(11)` | NO |  | porcentaje/tipo de IVA (factura emitida a cliente) |
| `FRA_ObsAeat` | `varchar(100)` | NO |  | observaciones para AEAT (factura emitida a cliente) |
| `FRA_FechaDevengo` | `date` | NO |  | fecha de devengo (factura emitida a cliente) |
| `FRA_RefVentas` | `varchar(50)` | NO |  | referencia de venta (factura emitida a cliente) |
| `FRA_DocSuplido` | `varchar(30)` | NO |  | importe suplido (factura emitida a cliente) |
| `FRA_DefinitivaEstimativa` | `varchar(1)` | NO |  | porcentaje/tipo de IVA (factura emitida a cliente) |
| `FRA_IdDomicilio` | `int(11)` | NO |  | id de domicilio/direccion del tercero (factura emitida a cliente) |
| `FRA_FactuTipo` | `varchar(1)` | NO |  | campo operativo inferido por nombre: factutipo (factura emitida a cliente) |
| `FRA_Iplastico` | `decimal(10,2)` | NO |  | importe/impuesto de plastico (factura emitida a cliente) |
| `FRA_ObsInternas` | `varchar(1000)` | NO |  | observaciones internas (factura emitida a cliente) |
| `FRA_IdfacturaRec` | `int(11)` | NO |  | id de factura recibida relacionada (factura emitida a cliente) |
| `FRA_fechaquincena` | `date` | NO |  | fecha principal del documento (factura emitida a cliente) |
| `FRA_Firma` | `text` | YES |  | firma digital/texto asociado (factura emitida a cliente) |
| `FRA_FechaEnvioEmail` | `datetime` | NO |  | fecha/hora de envio por email (factura emitida a cliente) |
| `FRA_FechaImpresion` | `datetime` | NO |  | fecha/hora de impresion (factura emitida a cliente) |
| `FRA_FechaGeneraEdi` | `datetime` | NO |  | fecha/hora de generacion EDI (factura emitida a cliente) |
| `FRA_TipoRectificativa` | `text` | YES |  | porcentaje/tipo de IVA (factura emitida a cliente) |
| `FRA_FechaExpedicion` | `date` | NO |  | fecha de expedicion (factura emitida a cliente) |

### `facturaslineasvar`

Lineas variables/conceptos de factura emitida.

- Filas exactas en copia local: `149032`
- Tamano aproximado: `24.06 MB`
- Clave de negocio: ver clave primaria e indices; tabla auxiliar dependiente de cabecera.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `FLV_idlinea` |
| `indice_UNIQUE` | Si | `FLV_idlinea` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `FLV_idlinea` | `int(11)` | NO | PRI | clave tecnica primaria del registro (linea/concepto variable de factura emitida) |
| `FLV_idfactura` | `int(11)` | NO |  | id interno de factura relacionada (linea/concepto variable de factura emitida) |
| `FLV_tipoGEC` | `varchar(1)` | NO |  | campo operativo inferido por nombre: tipogec (linea/concepto variable de factura emitida) |
| `FLV_codigo` | `int(11)` | NO |  | campo operativo inferido por nombre: codigo (linea/concepto variable de factura emitida) |
| `FLV_cantidad` | `decimal(10,2)` | NO |  | cantidad (linea/concepto variable de factura emitida) |
| `FLV_precio` | `decimal(12,6)` | NO |  | precio unitario (linea/concepto variable de factura emitida) |
| `FLV_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro (linea/concepto variable de factura emitida) |
| `FLV_FechaLog` | `date` | NO |  | fecha principal del documento (linea/concepto variable de factura emitida) |
| `FLV_HoraLog` | `varchar(8)` | NO |  | hora de auditoria (linea/concepto variable de factura emitida) |
| `FLV_concepto` | `varchar(50)` | NO |  | concepto o descripcion (linea/concepto variable de factura emitida) |
| `FLV_IdPresentacion` | `int(11)` | NO |  | campo operativo inferido por nombre: idpresentacion (linea/concepto variable de factura emitida) |
| `FLV_IdTipoPalet` | `int(11)` | NO |  | id de tipo de palet (linea/concepto variable de factura emitida) |
| `FLV_IdCategoria` | `int(11)` | NO |  | id de categoria (linea/concepto variable de factura emitida) |
| `FLV_Categoria` | `varchar(15)` | NO |  | categoria/calibre/clase (linea/concepto variable de factura emitida) |
| `FLV_kilos` | `decimal(10,2)` | NO |  | kilos (linea/concepto variable de factura emitida) |
| `FLV_palets` | `int(11)` | NO |  | numero de palets (linea/concepto variable de factura emitida) |
| `FLV_bultos` | `int(11)` | NO |  | numero de bultos (linea/concepto variable de factura emitida) |
| `FLV_piezas` | `int(11)` | NO |  | numero de piezas (linea/concepto variable de factura emitida) |
| `FLV_PrecioKBP` | `varchar(15)` | NO |  | precio unitario (linea/concepto variable de factura emitida) |
| `FLV_ImporteGenero` | `decimal(10,2)` | NO |  | importe de genero (linea/concepto variable de factura emitida) |
| `FLV_IdMarca` | `int(11)` | NO |  | campo operativo inferido por nombre: idmarca (linea/concepto variable de factura emitida) |
| `FLV_IdMarcaMaterial` | `int(11)` | NO |  | campo operativo inferido por nombre: idmarcamaterial (linea/concepto variable de factura emitida) |
| `FLV_IdMarcaEtiqueta` | `int(11)` | NO |  | campo operativo inferido por nombre: idmarcaetiqueta (linea/concepto variable de factura emitida) |
| `FLV_PosicionSalida` | `varchar(15)` | NO |  | posicion de salida/carga (linea/concepto variable de factura emitida) |
| `FLV_IdNorma` | `int(11)` | NO |  | campo operativo inferido por nombre: idnorma (linea/concepto variable de factura emitida) |
| `FLV_IdTipoCultivo` | `int(11)` | NO |  | id de tipo de cultivo (linea/concepto variable de factura emitida) |
| `FLV_kilosbrutos` | `decimal(10,2)` | NO |  | kilos brutos (linea/concepto variable de factura emitida) |

### `facturas_gastos`

Gastos asociados a facturas emitidas.

- Filas exactas en copia local: `109513`
- Tamano aproximado: `18.58 MB`
- Clave de negocio: ver clave primaria e indices; tabla auxiliar dependiente de cabecera.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `FGC_id` |
| `idx_FGC_FAC` | No | `FGC_idfactura` |
| `idx_FGC_FACREC` | No | `FGC_idfacturaReci` |
| `idx_FGC_PRO` | No | `FGC_idacreedor` |
| `indice_UNIQUE` | Si | `FGC_id` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `FGC_id` | `int(11)` | NO | PRI | clave tecnica primaria del registro (gasto de factura emitida) |
| `FGC_idfactura` | `int(11)` | NO | MUL | id interno de factura relacionada (gasto de factura emitida) |
| `FGC_idgasto` | `int(11)` | NO |  | gasto (gasto de factura emitida) |
| `FGC_tipokbp` | `varchar(1)` | NO |  | unidad de calculo K/B/P: kilos, bultos o piezas/palets segun catalogo (gasto de factura emitida) |
| `FGC_tipoFc` | `varchar(1)` | NO |  | tipo funcional/facturacion/cargo (gasto de factura emitida) |
| `FGC_valorgasto` | `decimal(20,6)` | NO |  | valor/base del gasto (gasto de factura emitida) |
| `FGC_importegastodivisa` | `decimal(18,4)` | NO |  | importe de gasto en divisa (gasto de factura emitida) |
| `FGC_importegastoeuros` | `decimal(18,4)` | NO |  | importe de gasto en euros (gasto de factura emitida) |
| `FGC_idacreedor` | `int(11)` | NO | MUL | id del acreedor (gasto de factura emitida) |
| `FGC_suplido` | `decimal(18,4)` | NO |  | importe suplido (gasto de factura emitida) |
| `FGC_idfacturaReci` | `int(11)` | NO | MUL | id de factura recibida relacionada (gasto de factura emitida) |
| `FGC_importefacturaReci` | `decimal(18,2)` | NO |  | numero de factura dentro de la serie (gasto de factura emitida) |
| `FGC_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro (gasto de factura emitida) |
| `FGC_FechaLog` | `date` | NO |  | fecha principal del documento (gasto de factura emitida) |
| `FGC_HoraLog` | `varchar(8)` | NO |  | hora de auditoria (gasto de factura emitida) |

### `facturaagr`

Cabecera de facturas/liquidaciones a agricultores.

- Filas exactas en copia local: `8163`
- Tamano aproximado: `2.61 MB`
- Clave de negocio: `FGR_idfactura` es la clave tecnica. La identidad de negocio suele ser `FGR_serie` + `FGR_numerofactur` + `FGR_ejercicio`.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `FGR_idfactura` |
| `indice_UNIQUE` | Si | `FGR_idfactura` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `FGR_idfactura` | `int(11)` | NO | PRI | id interno de factura relacionada (factura/liquidacion de agricultor) |
| `FGR_ejercicio` | `int(11)` | NO |  | ejercicio fiscal/comercial (factura/liquidacion de agricultor) |
| `FGR_serie` | `varchar(8)` | NO |  | serie documental (factura/liquidacion de agricultor) |
| `FGR_numerofactur` | `int(11)` | NO |  | numero de factura dentro de la serie (factura/liquidacion de agricultor) |
| `FGR_fecha` | `date` | NO |  | fecha principal del documento (factura/liquidacion de agricultor) |
| `FGR_idagricultor` | `int(11)` | NO |  | id del agricultor/proveedor agricola (factura/liquidacion de agricultor) |
| `FGR_idagricultoralb` | `int(11)` | NO |  | id del agricultor del albaran (factura/liquidacion de agricultor) |
| `FGR_idsemana` | `int(11)` | NO |  | campo operativo inferido por nombre: idsemana (factura/liquidacion de agricultor) |
| `FGR_Igenero` | `decimal(12,2)` | NO |  | importe de genero (factura/liquidacion de agricultor) |
| `FGR_GastosAlbaranes` | `decimal(12,2)` | NO |  | numero de albaran dentro de la serie/campana (factura/liquidacion de agricultor) |
| `FGR_BaseImponible` | `decimal(12,2)` | NO |  | base imponible (factura/liquidacion de agricultor) |
| `FGR_iva` | `decimal(12,2)` | NO |  | porcentaje/tipo de IVA (factura/liquidacion de agricultor) |
| `FGR_cuotaiva` | `decimal(12,2)` | NO |  | porcentaje/tipo de IVA (factura/liquidacion de agricultor) |
| `FGR_baseretencion` | `decimal(12,2)` | NO |  | base sobre la que se calcula la retencion (factura/liquidacion de agricultor) |
| `FGR_retencion` | `decimal(12,2)` | NO |  | retencion (factura/liquidacion de agricultor) |
| `FGR_tiporetencion` | `varchar(1)` | NO |  | retencion (factura/liquidacion de agricultor) |
| `FGR_cuotaretencion` | `decimal(12,2)` | NO |  | cuota/importes de impuesto (factura/liquidacion de agricultor) |
| `FGR_totalfactura` | `decimal(12,2)` | NO |  | numero de factura dentro de la serie (factura/liquidacion de agricultor) |
| `FGR_idasiento` | `int(11)` | NO |  | id de asiento contable (factura/liquidacion de agricultor) |
| `FGR_idliquidacion` | `int(11)` | NO |  | campo operativo inferido por nombre: idliquidacion (factura/liquidacion de agricultor) |
| `FGR_idempresa` | `int(11)` | NO |  | id de empresa (factura/liquidacion de agricultor) |
| `FGR_idcentro` | `int(11)` | NO |  | id de centro (factura/liquidacion de agricultor) |
| `FGR_GeneraIva` | `varchar(1)` | NO |  | porcentaje/tipo de IVA (factura/liquidacion de agricultor) |
| `FGR_NombreGasto1` | `varchar(15)` | NO |  | gasto (factura/liquidacion de agricultor) |
| `FGR_gasto1` | `decimal(12,2)` | NO |  | gasto (factura/liquidacion de agricultor) |
| `FGR_TipoGasto1` | `varchar(2)` | NO |  | gasto (factura/liquidacion de agricultor) |
| `FGR_Vgasto1` | `decimal(12,6)` | NO |  | gasto (factura/liquidacion de agricultor) |
| `FGR_Esfianza1` | `varchar(1)` | NO |  | campo operativo inferido por nombre: esfianza1 (factura/liquidacion de agricultor) |
| `FGR_NombreGasto2` | `varchar(15)` | NO |  | gasto (factura/liquidacion de agricultor) |
| `FGR_gasto2` | `decimal(12,2)` | NO |  | gasto (factura/liquidacion de agricultor) |
| `FGR_TipoGasto2` | `varchar(2)` | NO |  | gasto (factura/liquidacion de agricultor) |
| `FGR_Vgasto2` | `decimal(12,6)` | NO |  | gasto (factura/liquidacion de agricultor) |
| `FGR_Esfianza2` | `varchar(1)` | NO |  | campo operativo inferido por nombre: esfianza2 (factura/liquidacion de agricultor) |
| `FGR_NombreGasto3` | `varchar(15)` | NO |  | gasto (factura/liquidacion de agricultor) |
| `FGR_gasto3` | `decimal(12,2)` | NO |  | gasto (factura/liquidacion de agricultor) |
| `FGR_TipoGasto3` | `varchar(2)` | NO |  | gasto (factura/liquidacion de agricultor) |
| `FGR_Vgasto3` | `decimal(12,6)` | NO |  | gasto (factura/liquidacion de agricultor) |
| `FGR_Esfianza3` | `varchar(1)` | NO |  | campo operativo inferido por nombre: esfianza3 (factura/liquidacion de agricultor) |
| `FGR_NombreGasto4` | `varchar(15)` | NO |  | gasto (factura/liquidacion de agricultor) |
| `FGR_gasto4` | `decimal(12,2)` | NO |  | gasto (factura/liquidacion de agricultor) |
| `FGR_TipoGasto4` | `varchar(2)` | NO |  | gasto (factura/liquidacion de agricultor) |
| `FGR_Vgasto4` | `decimal(12,6)` | NO |  | gasto (factura/liquidacion de agricultor) |
| `FGR_Esfianza4` | `varchar(1)` | NO |  | campo operativo inferido por nombre: esfianza4 (factura/liquidacion de agricultor) |
| `FGR_idfinca` | `int(11)` | NO |  | campo operativo inferido por nombre: idfinca (factura/liquidacion de agricultor) |
| `FGR_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro (factura/liquidacion de agricultor) |
| `FGR_FechaLog` | `date` | NO |  | fecha principal del documento (factura/liquidacion de agricultor) |
| `FGR_HoraLog` | `varchar(8)` | NO |  | hora de auditoria (factura/liquidacion de agricultor) |
| `FGR_CtbCompraLiqui` | `varchar(1)` | NO |  | campo operativo inferido por nombre: ctbcompraliqui (factura/liquidacion de agricultor) |
| `FGR_DeFecha` | `date` | NO |  | fecha principal del documento (factura/liquidacion de agricultor) |
| `FGR_AFecha` | `date` | NO |  | fecha principal del documento (factura/liquidacion de agricultor) |
| `FGR_DtoFacturas` | `decimal(12,2)` | NO |  | numero de factura dentro de la serie (factura/liquidacion de agricultor) |
| `FGR_Observaciones` | `varchar(100)` | NO |  | observaciones (factura/liquidacion de agricultor) |
| `FGR_GastosAlbBT` | `varchar(1)` | NO |  | gasto (factura/liquidacion de agricultor) |
| `FGR_EmitidoPago` | `varchar(1)` | NO |  | campo operativo inferido por nombre: emitidopago (factura/liquidacion de agricultor) |
| `FGR_IdRegimen` | `int(11)` | NO |  | id de regimen fiscal (factura/liquidacion de agricultor) |
| `FGR_ObsSII` | `varchar(100)` | NO |  | campo operativo inferido por nombre: obssii (factura/liquidacion de agricultor) |
| `FGR_FechaVto` | `date` | NO |  | fecha de vencimiento (factura/liquidacion de agricultor) |
| `FGR_RefFactura` | `varchar(20)` | NO |  | numero de factura dentro de la serie (factura/liquidacion de agricultor) |
| `FGR_RefSerie` | `varchar(5)` | NO |  | serie documental (factura/liquidacion de agricultor) |
| `FGR_FechaOperacion` | `date` | NO |  | fecha de operacion (factura/liquidacion de agricultor) |
| `FGR_RetenEnFactura` | `varchar(1)` | NO |  | numero de factura dentro de la serie (factura/liquidacion de agricultor) |
| `FGR_DtoAnticipos` | `decimal(12,2)` | NO |  | descuento de anticipos (factura/liquidacion de agricultor) |
| `FGR_idpventa` | `int(11)` | NO |  | id de punto de venta (factura/liquidacion de agricultor) |
| `FGR_FechaDevengo` | `date` | NO |  | fecha de devengo (factura/liquidacion de agricultor) |
| `FGR_Firma` | `text` | YES |  | firma digital/texto asociado (factura/liquidacion de agricultor) |
| `FGR_FechaEnvioApp` | `date` | NO |  | fecha principal del documento (factura/liquidacion de agricultor) |

### `facturaagr_lineas`

Lineas de facturas/liquidaciones a agricultores.

- Filas exactas en copia local: `73437`
- Tamano aproximado: `10.55 MB`
- Clave de negocio: ver clave primaria e indices; tabla auxiliar dependiente de cabecera.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `FAL_id` |
| `idx_FGL_FGR` | No | `FAL_idfactura` |
| `indice_UNIQUE` | Si | `FAL_id` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `FAL_id` | `int(11)` | NO | PRI | clave tecnica primaria del registro (linea de factura/liquidacion de agricultor) |
| `FAL_idfactura` | `int(11)` | NO | MUL | id interno de factura relacionada (linea de factura/liquidacion de agricultor) |
| `FAL_idgenero` | `int(11)` | NO |  | id de genero/producto (linea de factura/liquidacion de agricultor) |
| `FAL_idcategoria` | `int(11)` | NO |  | id de categoria (linea de factura/liquidacion de agricultor) |
| `FAL_bultos` | `int(11)` | NO |  | numero de bultos (linea de factura/liquidacion de agricultor) |
| `FAL_kilos` | `decimal(10,2)` | NO |  | kilos (linea de factura/liquidacion de agricultor) |
| `FAL_precio` | `decimal(8,4)` | NO |  | precio unitario (linea de factura/liquidacion de agricultor) |
| `FAL_importe` | `decimal(12,2)` | NO |  | importe (linea de factura/liquidacion de agricultor) |
| `FAL_idpartida` | `int(11)` | NO |  | campo operativo inferido por nombre: idpartida (linea de factura/liquidacion de agricultor) |
| `FAL_idtipocultivo` | `int(11)` | NO |  | id de tipo de cultivo (linea de factura/liquidacion de agricultor) |
| `FAL_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro (linea de factura/liquidacion de agricultor) |
| `FAL_FechaLog` | `date` | NO |  | fecha principal del documento (linea de factura/liquidacion de agricultor) |
| `FAL_HoraLog` | `varchar(8)` | NO |  | hora de auditoria (linea de factura/liquidacion de agricultor) |
| `FAL_Piezas` | `int(11)` | NO |  | numero de piezas (linea de factura/liquidacion de agricultor) |
| `FAL_TipoPrecio` | `varchar(1)` | NO |  | tipo de precio K/B/P (linea de factura/liquidacion de agricultor) |
| `FAL_IdGensal` | `int(11)` | NO |  | id de genero de salida (linea de factura/liquidacion de agricultor) |
| `FAL_DtoXkilo` | `decimal(6,4)` | NO |  | descuento por kilo (linea de factura/liquidacion de agricultor) |
| `FAL_Concepto` | `varchar(50)` | NO |  | concepto o descripcion (linea de factura/liquidacion de agricultor) |
| `FAL_FechaLinea` | `date` | NO |  | fecha de la linea (linea de factura/liquidacion de agricultor) |

### `facturasrecibidas`

Cabecera de facturas recibidas de proveedores/acreedores.

- Filas exactas en copia local: `48641`
- Tamano aproximado: `30.59 MB`
- Columnas reales en Netagro: `74`.
- Clave tecnica: `FRR_id`.
- Relacion con proveedor: `FRR_idproveedor = acreedores.ACR_Codigo`.
- Relacion con empresa: `FRR_Idempresa = empresas.EMP_idempresa`.
- Identidad documental: `FRR_tipofactura` + `FRR_ejercicio` + `FRR_numero` es la numeracion interna; `FRR_numerofactura` es el numero de factura del proveedor.
- Catalogo de tipo: no hay tabla maestra poblada para `FRR_tipofactura`; usar `GET /facturasrecibidas/tipos` como lista observada hasta que negocio aporte descripciones.
- Clave practica para duplicados OCR: `FRR_Idempresa + FRR_ejercicio + FRR_idproveedor + FRR_numerofactura`.

Bloques funcionales:

| Bloque | Campos principales | Uso |
|---|---|---|
| Identidad interna | `FRR_id`, `FRR_numero`, `FRR_tipofactura`, `FRR_ejercicio`, `FRR_IdTipoDoc` | Numeracion y clasificacion interna de Netagro. `FRR_tipofactura` son codigos observados, no descripciones. |
| Documento proveedor | `FRR_numerofactura`, `FRR_fechafactura`, `FRR_idproveedor`, `FRR_Concepto` | Lo que debe casar con OCR del PDF. |
| Proveedor/cuenta | `FRR_idproveedor`, `FRR_idcuenta`, `FRR_IdBanco`, `FRR_IdFormaPago` | Relacion con `acreedores` y datos de pago/contabilidad. |
| Impuestos | `FRR_base1..5`, `FRR_iva1..5`, `FRR_cuota1..5` | Bases y cuotas por tramos de IVA. |
| Retencion/IRPF | `FRR_baseret`, `FRR_ret`, `FRR_cuotaret`, `FRR_ClaveIRPF` | Retenciones aplicadas. |
| Gastos/cuentas | `FRR_igasto1..4`, `FRR_ctagasto1..4`, `FRR_CtaSuplido`, `FRR_ImpSuplido`, `FRR_CuotaNoDeducible` | Desglose resumido de gastos/suplidos/no deducible. |
| Vencimientos | `FechaVto`, `ImporteVto`, `FRR_FechaVto1..3`, `FRR_ImporteVto1..3`, `FRR_FechaPrevPago`, `FRR_BancoPrevPago` | Plan de pagos/vencimientos. |
| Contabilidad | `FRR_fechactb`, `FRR_IdAsientoNet`, `FRR_CtaCartera`, `FRR_Contabilizar`, `FRR_CancelarporCtb` | Asiento, cartera y contabilizacion. |
| Organizacion | `FRR_Idempresa`, `FRR_idcentro`, `FRR_idpuntoventa`, `FRR_IdSeccion`, `FRR_IdActividad` | Empresa, centro y dimensiones internas. `FRR_Idempresa` apunta a `empresas.EMP_idempresa`. |
| Auditoria | `FRR_IdUsuarioLog`, `FRR_FechaLog`, `FRR_HoraLog` | Trazabilidad de cambios. |

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `FRR_id` |
| `idx_FRR_CTA` | No | `FRR_idcuenta` |
| `idx_FRR_EMPFEC` | No | `FRR_Idempresa`, `FRR_fechafactura` |
| `idx_FRR_NUMFAC` | No | `FRR_numerofactura` |
| `idx_FRR_PRO` | No | `FRR_idproveedor` |
| `idx_FRR_TIPEJENUM` | No | `FRR_tipofactura`, `FRR_ejercicio`, `FRR_numero` |
| `indice_UNIQUE` | Si | `FRR_id` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `FRR_id` | `int(11)` | NO | PRI | clave tecnica primaria del registro (factura recibida) |
| `FRR_numero` | `int(11)` | NO |  | campo operativo inferido por nombre: numero (factura recibida) |
| `FRR_fechafactura` | `date` | NO |  | numero de factura dentro de la serie (factura recibida) |
| `FRR_numerofactura` | `varchar(20)` | NO | MUL | numero de factura dentro de la serie (factura recibida) |
| `FRR_ejercicio` | `int(11)` | NO |  | ejercicio fiscal/comercial (factura recibida) |
| `FRR_idcentro` | `int(11)` | NO |  | id de centro (factura recibida) |
| `FRR_idproveedor` | `int(11)` | NO | MUL | id del proveedor (factura recibida) |
| `FRR_idregimen` | `int(11)` | NO |  | id de regimen fiscal (factura recibida) |
| `FRR_fechactb` | `date` | NO |  | fecha de contabilizacion (factura recibida) |
| `FRR_base1` | `decimal(10,2)` | NO |  | base imponible por tramo de IVA (factura recibida) |
| `FRR_base2` | `decimal(10,2)` | NO |  | base imponible por tramo de IVA (factura recibida) |
| `FRR_base3` | `decimal(10,2)` | NO |  | base imponible por tramo de IVA (factura recibida) |
| `FRR_base4` | `decimal(10,2)` | NO |  | base imponible por tramo de IVA (factura recibida) |
| `FRR_iva1` | `decimal(10,2)` | NO |  | porcentaje/tipo de IVA (factura recibida) |
| `FRR_iva2` | `decimal(10,2)` | NO |  | porcentaje/tipo de IVA (factura recibida) |
| `FRR_iva3` | `decimal(10,2)` | NO |  | porcentaje/tipo de IVA (factura recibida) |
| `FRR_iva4` | `decimal(10,2)` | NO |  | porcentaje/tipo de IVA (factura recibida) |
| `FRR_cuota1` | `decimal(10,2)` | NO |  | cuota/importes de impuesto (factura recibida) |
| `FRR_cuota2` | `decimal(10,2)` | NO |  | cuota/importes de impuesto (factura recibida) |
| `FRR_cuota3` | `decimal(10,2)` | NO |  | cuota/importes de impuesto (factura recibida) |
| `FRR_cuota4` | `decimal(10,2)` | NO |  | cuota/importes de impuesto (factura recibida) |
| `FRR_baseret` | `decimal(10,2)` | NO |  | base de retencion (factura recibida) |
| `FRR_ret` | `decimal(10,2)` | NO |  | campo operativo inferido por nombre: ret (factura recibida) |
| `FRR_cuotaret` | `decimal(10,2)` | NO |  | cuota/importes de impuesto (factura recibida) |
| `FRR_igasto1` | `decimal(10,2)` | NO |  | gasto (factura recibida) |
| `FRR_ctagasto1` | `varchar(11)` | NO |  | gasto (factura recibida) |
| `FRR_igasto2` | `decimal(10,2)` | NO |  | gasto (factura recibida) |
| `FRR_ctagasto2` | `varchar(11)` | NO |  | gasto (factura recibida) |
| `FRR_igasto3` | `decimal(10,2)` | NO |  | gasto (factura recibida) |
| `FRR_ctagasto3` | `varchar(11)` | NO |  | gasto (factura recibida) |
| `FRR_igasto4` | `decimal(10,2)` | NO |  | gasto (factura recibida) |
| `FRR_ctagasto4` | `varchar(11)` | NO |  | gasto (factura recibida) |
| `FRR_totalfac` | `decimal(12,2)` | NO |  | total de factura (factura recibida) |
| `FRR_tipofactura` | `varchar(2)` | NO | MUL | codigo de tipo/serie interna de factura recibida; valores observados en `/facturasrecibidas/tipos` |
| `FRR_idcuenta` | `varchar(11)` | NO | MUL | cuenta contable (factura recibida) |
| `FRR_idpuntoventa` | `int(11)` | NO |  | id de punto de venta (factura recibida) |
| `FRR_ClaveIRPF` | `varchar(5)` | NO |  | campo operativo inferido por nombre: claveirpf (factura recibida) |
| `FRR_IdAsientoNet` | `int(11)` | NO |  | id de asiento contable (factura recibida) |
| `FRR_CtaCartera` | `varchar(11)` | NO |  | cuenta de cartera (factura recibida) |
| `FRR_IdBanco` | `int(11)` | NO |  | id de banco (factura recibida) |
| `FRR_IdFormaPago` | `int(11)` | NO |  | id de forma de pago (factura recibida) |
| `FechaVto` | `date` | NO |  | fecha de vencimiento |
| `ImporteVto` | `decimal(18,2)` | NO |  | importe |
| `FRR_Modificable` | `varchar(1)` | NO |  | indicador de registro modificable (factura recibida) |
| `FRR_Idempresa` | `int(11)` | NO | MUL | id de empresa propietaria; relaciona con `empresas.EMP_idempresa` |
| `FRR_idpago` | `int(11)` | NO |  | id de pago (factura recibida) |
| `FRR_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro (factura recibida) |
| `FRR_FechaLog` | `date` | NO |  | fecha principal del documento (factura recibida) |
| `FRR_HoraLog` | `varchar(8)` | NO |  | hora de auditoria (factura recibida) |
| `FRR_Concepto` | `varchar(50)` | NO |  | concepto o descripcion (factura recibida) |
| `FRR_GeneraCartera` | `varchar(1)` | NO |  | campo operativo inferido por nombre: generacartera (factura recibida) |
| `FRR_FechaVto1` | `date` | NO |  | fecha de vencimiento (factura recibida) |
| `FRR_ImporteVto1` | `decimal(18,2)` | NO |  | importe (factura recibida) |
| `FRR_FechaVto2` | `date` | NO |  | fecha de vencimiento (factura recibida) |
| `FRR_ImporteVto2` | `decimal(18,2)` | NO |  | importe (factura recibida) |
| `FRR_FechaVto3` | `date` | NO |  | fecha de vencimiento (factura recibida) |
| `FRR_ImporteVto3` | `decimal(18,2)` | NO |  | importe (factura recibida) |
| `FRR_IdTipoDoc` | `int(11)` | NO |  | campo operativo inferido por nombre: idtipodoc (factura recibida) |
| `FRR_IdAgricultorDto` | `int(11)` | NO |  | id del agricultor/proveedor agricola (factura recibida) |
| `FRR_CtaSuplido` | `varchar(11)` | NO |  | importe suplido (factura recibida) |
| `FRR_ImpSuplido` | `decimal(18,2)` | NO |  | importe suplido (factura recibida) |
| `FRR_CuotaNoDeducible` | `decimal(18,2)` | NO |  | cuota/importes de impuesto (factura recibida) |
| `FRR_CancelarporCtb` | `varchar(1)` | NO |  | campo operativo inferido por nombre: cancelarporctb (factura recibida) |
| `FRR_Observaciones` | `varchar(50)` | NO |  | observaciones (factura recibida) |
| `FRR_FechaPrevPago` | `date` | NO |  | fecha prevista de pago (factura recibida) |
| `FRR_BancoPrevPago` | `int(11)` | NO |  | campo operativo inferido por nombre: bancoprevpago (factura recibida) |
| `FRR_IdSeccion` | `int(11)` | NO |  | campo operativo inferido por nombre: idseccion (factura recibida) |
| `FRR_IdActividad` | `int(11)` | NO |  | campo operativo inferido por nombre: idactividad (factura recibida) |
| `FRR_ObservacionesAEAT` | `varchar(50)` | NO |  | observaciones para AEAT (factura recibida) |
| `FRR_base5` | `decimal(12,2)` | NO |  | base imponible por tramo de IVA (factura recibida) |
| `FRR_iva5` | `decimal(10,2)` | NO |  | porcentaje/tipo de IVA (factura recibida) |
| `FRR_cuota5` | `decimal(10,2)` | NO |  | cuota/importes de impuesto (factura recibida) |
| `FRR_Contabilizar` | `varchar(1)` | NO |  | indicador de contabilizacion (factura recibida) |
| `FRR_IdfacturaRec` | `int(11)` | NO |  | id de factura recibida relacionada (factura recibida) |

### `facturasrecibidas_ctb`

Desglose contable de facturas recibidas.

- Filas exactas en copia local: `37027`
- Tamano aproximado: `3.88 MB`
- Columnas reales en Netagro: `11`.
- Clave tecnica: `FRC_id`.
- Relacion logica: `FRC_idfacturarecibida = facturasrecibidas.FRR_id`.
- Esta tabla no representa lineas OCR de producto/servicio. Representa imputaciones contables: importe, cuenta y dimensiones de actividad/seccion/departamento.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `FRC_id` |
| `indice_UNIQUE` | Si | `FRC_id` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `FRC_id` | `int(11)` | NO | PRI | clave tecnica primaria del registro (apunte/desglose contable de factura recibida) |
| `FRC_idfacturarecibida` | `int(11)` | NO |  | id de factura recibida relacionada (apunte/desglose contable de factura recibida) |
| `FRC_Importe` | `decimal(12,2)` | NO |  | importe (apunte/desglose contable de factura recibida) |
| `FRC_Cuenta` | `varchar(15)` | NO |  | cuenta contable (apunte/desglose contable de factura recibida) |
| `FRC_IdActividad` | `int(11)` | NO |  | campo operativo inferido por nombre: idactividad (apunte/desglose contable de factura recibida) |
| `FRC_Idseccion` | `int(11)` | NO |  | campo operativo inferido por nombre: idseccion (apunte/desglose contable de factura recibida) |
| `FRC_Iddepartamento` | `int(11)` | NO |  | campo operativo inferido por nombre: iddepartamento (apunte/desglose contable de factura recibida) |
| `FRC_Idsubdepartamento` | `int(11)` | NO |  | campo operativo inferido por nombre: idsubdepartamento (apunte/desglose contable de factura recibida) |
| `FRC_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro (apunte/desglose contable de factura recibida) |
| `FRC_FechaLog` | `date` | NO |  | fecha principal del documento (apunte/desglose contable de factura recibida) |
| `FRC_HoraLog` | `varchar(8)` | NO |  | hora de auditoria (apunte/desglose contable de factura recibida) |

### `albsalida`

Cabecera de albaranes de salida, normalmente entrega/venta a cliente.

- Filas exactas en copia local: `110048`
- Tamano aproximado: `66.20 MB`
- Clave de negocio: `ASA_idalbaran` es la clave tecnica. La identidad de negocio suele ser `ASA_serie` + `ASA_albaran` + `ASA_ejercicio`.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `ASA_idalbaran` |
| `idx_ASA_EMPFEC` | No | `ASA_IdEmpresa`, `ASA_fechasalida` |
| `idx_ASA_FRA` | No | `ASA_idfactura` |
| `idx_ASA_FRA_E` | No | `ASA_idfacturaestimativa` |
| `idx_ASA_FRA_N` | No | `ASA_idfacturanegativa` |
| `idx_ASA_PED` | No | `ASA_idpedido` |
| `idx_ASA_SERALB` | No | `ASA_serie`, `ASA_albaran` |
| `idx_ASA_VEV` | No | `ASA_idvaleenvase` |
| `idx_ASA_VEVMAT` | No | `ASA_idvaleenvasematerial` |
| `indice_UNIQUE` | Si | `ASA_idalbaran` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `ASA_idalbaran` | `int(11)` | NO | PRI | id interno de albaran relacionado (albaran de salida) |
| `ASA_ejercicio` | `int(11)` | NO |  | ejercicio fiscal/comercial (albaran de salida) |
| `ASA_idpuntoventa` | `int(11)` | NO |  | id de punto de venta (albaran de salida) |
| `ASA_idcentro` | `int(11)` | NO |  | id de centro (albaran de salida) |
| `ASA_albaran` | `int(11)` | NO |  | numero de albaran dentro de la serie/campana (albaran de salida) |
| `ASA_fechasalida` | `date` | NO |  | fecha de salida/entrega (albaran de salida) |
| `ASA_idcliente` | `int(11)` | NO |  | id del cliente (albaran de salida) |
| `ASA_iddomicilio` | `int(11)` | NO |  | id de domicilio/direccion del tercero (albaran de salida) |
| `ASA_idpedido` | `int(11)` | NO | MUL | id de pedido (albaran de salida) |
| `ASA_referencia` | `varchar(50)` | NO |  | referencia documental (albaran de salida) |
| `ASA_iddivisa` | `int(11)` | NO |  | id de divisa (albaran de salida) |
| `ASA_valorcambio` | `decimal(10,6)` | NO |  | tipo de cambio aplicado (albaran de salida) |
| `ASA_fechavaloracion` | `date` | NO |  | fecha de valoracion (albaran de salida) |
| `ASA_idfactura` | `int(11)` | NO | MUL | id interno de factura relacionada (albaran de salida) |
| `ASA_tipofc` | `varchar(1)` | NO |  | tipo funcional/facturacion/cargo (albaran de salida) |
| `ASA_idvaleenvase` | `int(11)` | NO | MUL | campo operativo inferido por nombre: idvaleenvase (albaran de salida) |
| `ASA_idvaleenvasematerial` | `int(11)` | NO | MUL | campo operativo inferido por nombre: idvaleenvasematerial (albaran de salida) |
| `ASA_idtransportista` | `int(11)` | NO |  | id del transportista (albaran de salida) |
| `ASA_matriculacamion` | `varchar(20)` | NO |  | matricula del camion (albaran de salida) |
| `ASA_matricularemolque` | `varchar(20)` | NO |  | matricula del remolque (albaran de salida) |
| `ASA_observaciones` | `varchar(100)` | NO |  | observaciones (albaran de salida) |
| `ASA_refvaloracion` | `varchar(20)` | NO |  | referencia de valoracion (albaran de salida) |
| `ASA_Factoring` | `varchar(1)` | NO |  | indicador de factoring (albaran de salida) |
| `ASA_IdVendedor` | `int(11)` | NO |  | id del vendedor/comercial de venta (albaran de salida) |
| `ASA_Idtipoporte` | `int(11)` | NO |  | campo operativo inferido por nombre: idtipoporte (albaran de salida) |
| `ASA_movilchofer` | `varchar(12)` | NO |  | telefono del chofer (albaran de salida) |
| `ASA_numregtemperatura` | `varchar(20)` | NO |  | registro o texto de temperatura (albaran de salida) |
| `ASA_idcarga` | `int(11)` | NO |  | id de carga (albaran de salida) |
| `ASA_HoradeSalida` | `varchar(10)` | NO |  | hora de salida (albaran de salida) |
| `ASA_idtarifaporte` | `int(11)` | NO |  | campo operativo inferido por nombre: idtarifaporte (albaran de salida) |
| `ASA_idtransportista2` | `int(11)` | NO |  | id del transportista (albaran de salida) |
| `ASA_idtarifaporte2` | `int(11)` | NO |  | campo operativo inferido por nombre: idtarifaporte2 (albaran de salida) |
| `ASA_serie` | `varchar(5)` | NO | MUL | serie documental (albaran de salida) |
| `ASA_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro (albaran de salida) |
| `ASA_FechaLog` | `date` | NO |  | fecha principal del documento (albaran de salida) |
| `ASA_HoraLog` | `varchar(8)` | NO |  | hora de auditoria (albaran de salida) |
| `ASA_observaciones2` | `varchar(100)` | NO |  | observaciones (albaran de salida) |
| `ASA_observaciones3` | `varchar(100)` | NO |  | observaciones (albaran de salida) |
| `ASA_IdEmpresa` | `int(11)` | NO | MUL | id de empresa (albaran de salida) |
| `ASA_ObsAeat` | `varchar(50)` | NO |  | observaciones para AEAT (albaran de salida) |
| `ASA_FechaLlegada` | `date` | NO |  | fecha principal del documento (albaran de salida) |
| `ASA_BESTELLNR` | `varchar(25)` | NO |  | campo operativo inferido por nombre: bestellnr (albaran de salida) |
| `ASA_PrecioEnvio1` | `decimal(10,2)` | NO |  | precio unitario (albaran de salida) |
| `ASA_PrecioPalet11` | `decimal(10,2)` | NO |  | precio de palet (albaran de salida) |
| `ASA_PrecioPalet12` | `decimal(10,2)` | NO |  | precio de palet (albaran de salida) |
| `ASA_PrecioEnvio2` | `decimal(10,2)` | NO |  | precio unitario (albaran de salida) |
| `ASA_PrecioPalet21` | `decimal(10,2)` | NO |  | precio de palet (albaran de salida) |
| `ASA_PrecioPalet22` | `decimal(10,2)` | NO |  | precio de palet (albaran de salida) |
| `ASA_idfacturaestimativa` | `int(11)` | NO | MUL | id de factura estimativa asociada (albaran de salida) |
| `ASA_idfacturanegativa` | `int(11)` | NO | MUL | id de factura negativa/rectificativa asociada (albaran de salida) |
| `ASA_NombreChofer` | `varchar(100)` | NO |  | nombre del chofer (albaran de salida) |
| `ASA_DNIChofer` | `varchar(20)` | NO |  | DNI del chofer (albaran de salida) |
| `ASA_Intermediacion` | `varchar(1)` | NO |  | indicador de intermediacion (albaran de salida) |
| `ASA_IdPais` | `int(11)` | NO |  | id de pais (albaran de salida) |
| `ASA_Firma` | `text` | YES |  | firma digital/texto asociado (albaran de salida) |
| `ASA_SubastaSN` | `varchar(1)` | NO |  | indicador de subasta (albaran de salida) |
| `ASA_ObservacionesI` | `varchar(1000)` | NO |  | observaciones (albaran de salida) |
| `ASA_ImpuestoPlastico` | `varchar(1)` | NO |  | indicador de impuesto de plastico (albaran de salida) |
| `ASA_ImprimirPlastico` | `varchar(1)` | NO |  | indicador de impresion de plastico (albaran de salida) |
| `ASA_IdExpediente` | `int(11)` | NO |  | id de expediente (albaran de salida) |
| `ASA_IdMuelle` | `int(11)` | NO |  | id de muelle (albaran de salida) |
| `ASA_FacturarClientePorte1` | `varchar(1)` | NO |  | indicador de si se factura el porte al cliente (albaran de salida) |
| `ASA_FacturarClientePorte2` | `varchar(1)` | NO |  | indicador de si se factura el porte al cliente (albaran de salida) |
| `ASA_IPorte1` | `decimal(10,2)` | NO |  | campo operativo inferido por nombre: iporte1 (albaran de salida) |
| `ASA_IPorte2` | `decimal(10,2)` | NO |  | campo operativo inferido por nombre: iporte2 (albaran de salida) |
| `ASA_IdTipoIvaPorte1` | `int(11)` | NO |  | porcentaje/tipo de IVA (albaran de salida) |
| `ASA_IdTipoIvaPorte2` | `int(11)` | NO |  | porcentaje/tipo de IVA (albaran de salida) |
| `ASA_Departamento` | `varchar(13)` | NO |  | campo operativo inferido por nombre: departamento (albaran de salida) |
| `ASA_idsubasta` | `int(11)` | NO |  | id de subasta (albaran de salida) |
| `ASA_idtraspaso` | `int(11)` | NO |  | campo operativo inferido por nombre: idtraspaso (albaran de salida) |
| `ASA_CliPrecioEnvio1` | `decimal(10,2)` | NO |  | precio unitario (albaran de salida) |
| `ASA_CliPrecioEnvio2` | `decimal(10,2)` | NO |  | precio unitario (albaran de salida) |
| `ASA_CliPrecioPalet11` | `decimal(10,2)` | NO |  | precio de palet (albaran de salida) |
| `ASA_CliPrecioPalet12` | `decimal(10,2)` | NO |  | precio de palet (albaran de salida) |
| `ASA_CliPrecioPalet21` | `decimal(10,2)` | NO |  | precio de palet (albaran de salida) |
| `ASA_CliPrecioPalet22` | `decimal(10,2)` | NO |  | precio de palet (albaran de salida) |
| `ASA_idvaletransportista` | `int(11)` | NO |  | campo operativo inferido por nombre: idvaletransportista (albaran de salida) |
| `ASA_IdAcreedorPorte` | `int(11)` | NO |  | id del acreedor del porte (albaran de salida) |
| `ASA_FirmaApp` | `text` | YES |  | firma capturada en app (albaran de salida) |
| `ASA_FechaEnvioEmail` | `datetime` | NO |  | fecha/hora de envio por email (albaran de salida) |
| `ASA_FirmaEmpresa` | `text` | YES |  | firma de empresa (albaran de salida) |
| `ASA_FechaImpresion` | `datetime` | NO |  | fecha/hora de impresion (albaran de salida) |
| `ASA_FechaGeneraEdi` | `datetime` | NO |  | fecha/hora de generacion EDI (albaran de salida) |
| `ASA_IGastoPorte1` | `decimal(10,2)` | NO |  | gasto de porte/transporte (albaran de salida) |
| `ASA_IGastoPorte2` | `decimal(10,2)` | NO |  | gasto de porte/transporte (albaran de salida) |

### `albsalida_lineas`

Lineas de producto de albaranes de salida.

- Filas exactas en copia local: `256951`
- Tamano aproximado: `77.13 MB`
- Clave de negocio: ver clave primaria e indices; tabla auxiliar dependiente de cabecera.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `ASL_idlinea` |
| `idx_ASL_ASA` | No | `ASL_idalbaran` |
| `idx_ASL_ENT` | No | `ASL_IdLineaEntConfec` |
| `indice_UNIQUE` | Si | `ASL_idlinea` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `ASL_idlinea` | `int(11)` | NO | PRI | clave tecnica primaria del registro (linea de albaran de salida) |
| `ASL_idalbaran` | `int(11)` | NO | MUL | id interno de albaran relacionado (linea de albaran de salida) |
| `ASL_idgenero` | `int(11)` | NO |  | id de genero/producto (linea de albaran de salida) |
| `ASL_idtipoconfeccion` | `int(11)` | NO |  | id de tipo de confeccion (linea de albaran de salida) |
| `ASL_idcategoria` | `int(11)` | NO |  | id de categoria (linea de albaran de salida) |
| `ASL_idmarca` | `int(11)` | NO |  | campo operativo inferido por nombre: idmarca (linea de albaran de salida) |
| `ASL_categoria` | `varchar(50)` | NO |  | categoria/calibre/clase (linea de albaran de salida) |
| `ASL_kilosbrutos` | `decimal(10,2)` | NO |  | kilos brutos (linea de albaran de salida) |
| `ASL_kilosnetos` | `decimal(10,2)` | NO |  | kilos netos (linea de albaran de salida) |
| `ASL_kiloscliente` | `decimal(10,2)` | NO |  | kilos facturados/asignados al cliente (linea de albaran de salida) |
| `ASL_palets` | `int(11)` | NO |  | numero de palets (linea de albaran de salida) |
| `ASL_bultos` | `int(11)` | NO |  | numero de bultos (linea de albaran de salida) |
| `ASL_piezas` | `int(11)` | NO |  | numero de piezas (linea de albaran de salida) |
| `ASL_precio` | `decimal(10,4)` | NO |  | precio unitario (linea de albaran de salida) |
| `ASL_tipoprecio` | `varchar(1)` | NO |  | tipo de precio K/B/P (linea de albaran de salida) |
| `ASL_importegenero` | `decimal(12,4)` | NO |  | importe de genero (linea de albaran de salida) |
| `ASL_bultosvendidos` | `int(11)` | NO |  | bultos vendidos (linea de albaran de salida) |
| `ASL_paletsvendidos` | `int(11)` | NO |  | palets vendidos (linea de albaran de salida) |
| `ASL_kilosvendidos` | `decimal(10,2)` | NO |  | kilos vendidos (linea de albaran de salida) |
| `ASL_piezasvendidas` | `int(11)` | NO |  | piezas vendidas (linea de albaran de salida) |
| `ASL_precioventa` | `decimal(10,4)` | NO |  | precio de venta (linea de albaran de salida) |
| `ASL_tipopreciovta` | `varchar(1)` | NO |  | tipo de precio de venta K/B/P (linea de albaran de salida) |
| `ASL_importegenerovta` | `decimal(12,4)` | NO |  | importe de genero (linea de albaran de salida) |
| `ASL_precioestimado` | `decimal(12,4)` | NO |  | precio estimado (linea de albaran de salida) |
| `ASL_observaciones` | `varchar(250)` | NO |  | observaciones (linea de albaran de salida) |
| `ASL_idgensal` | `int(11)` | NO |  | id de genero de salida (linea de albaran de salida) |
| `ASL_importegeneroestimado` | `decimal(12,4)` | NO |  | importe de genero (linea de albaran de salida) |
| `ASL_estructura` | `decimal(12,4)` | NO |  | coste/importe de estructura (linea de albaran de salida) |
| `ASL_manipulacion` | `decimal(12,4)` | NO |  | coste/importe de manipulacion (linea de albaran de salida) |
| `ASL_materiales` | `decimal(12,4)` | NO |  | coste/importe de materiales (linea de albaran de salida) |
| `ASL_gastof` | `decimal(12,4)` | NO |  | gasto (linea de albaran de salida) |
| `ASL_gastoc` | `decimal(12,4)` | NO |  | gasto (linea de albaran de salida) |
| `ASL_tipoprecioestimado` | `varchar(1)` | NO |  | tipo de precio estimado K/B/P (linea de albaran de salida) |
| `ASL_gastoporte` | `decimal(12,4)` | NO |  | gasto de porte/transporte (linea de albaran de salida) |
| `ASL_CoeficientePalet` | `decimal(12,4)` | NO |  | campo operativo inferido por nombre: coeficientepalet (linea de albaran de salida) |
| `ASL_IdTipoCultivo` | `int(11)` | NO |  | id de tipo de cultivo (linea de albaran de salida) |
| `ASL_BxP` | `int(11)` | NO |  | campo operativo inferido por nombre: bxp (linea de albaran de salida) |
| `ASL_PrecioCoste` | `decimal(12,4)` | NO |  | precio de coste (linea de albaran de salida) |
| `ASL_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro (linea de albaran de salida) |
| `ASL_FechaLog` | `date` | NO |  | fecha principal del documento (linea de albaran de salida) |
| `ASL_HoraLog` | `varchar(8)` | NO |  | hora de auditoria (linea de albaran de salida) |
| `ASL_idmarcaetiqueta` | `int(11)` | NO |  | campo operativo inferido por nombre: idmarcaetiqueta (linea de albaran de salida) |
| `ASL_idmarcamaterial` | `int(11)` | NO |  | campo operativo inferido por nombre: idmarcamaterial (linea de albaran de salida) |
| `ASL_idnorma` | `int(11)` | NO |  | campo operativo inferido por nombre: idnorma (linea de albaran de salida) |
| `ASL_idTipoPalet` | `int(11)` | NO |  | id de tipo de palet (linea de albaran de salida) |
| `ASL_LotePalet` | `varchar(50)` | NO |  | campo operativo inferido por nombre: lotepalet (linea de albaran de salida) |
| `ASL_PosicionSalida` | `varchar(25)` | NO |  | posicion de salida/carga (linea de albaran de salida) |
| `ASL_TipoLinea` | `varchar(1)` | NO |  | campo operativo inferido por nombre: tipolinea (linea de albaran de salida) |
| `ASL_idpaletgenero` | `int(11)` | NO |  | id de palet de genero (linea de albaran de salida) |
| `ASL_IdLineaEntConfec` | `int(11)` | NO | MUL | campo operativo inferido por nombre: idlineaentconfec (linea de albaran de salida) |
| `ASL_IdPais` | `int(11)` | NO |  | id de pais (linea de albaran de salida) |

### `albsalida_gastos`

Gastos aplicados a albaranes de salida.

- Filas exactas en copia local: `353511`
- Tamano aproximado: `66.63 MB`
- Clave de negocio: ver clave primaria e indices; tabla auxiliar dependiente de cabecera.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `ASG_id` |
| `idx_ASG_ASA` | No | `ASG_idalbaran` |
| `idx_ASG_FRR` | No | `ASG_idfactura` |
| `idx_ASG_PRO` | No | `ASG_idacreedor` |
| `indice_UNIQUE` | Si | `ASG_id` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `ASG_id` | `int(11)` | NO | PRI | clave tecnica primaria del registro (gasto de albaran de salida) |
| `ASG_idalbaran` | `int(11)` | NO | MUL | id interno de albaran relacionado (gasto de albaran de salida) |
| `ASG_idgasto` | `int(11)` | NO |  | gasto (gasto de albaran de salida) |
| `ASG_tipokbp` | `varchar(1)` | NO |  | unidad de calculo K/B/P: kilos, bultos o piezas/palets segun catalogo (gasto de albaran de salida) |
| `ASG_tipofc` | `varchar(1)` | NO |  | tipo funcional/facturacion/cargo (gasto de albaran de salida) |
| `ASG_valorgasto` | `decimal(20,6)` | NO |  | valor/base del gasto (gasto de albaran de salida) |
| `ASG_importegastodivisa` | `decimal(18,4)` | NO |  | importe de gasto en divisa (gasto de albaran de salida) |
| `ASG_importegastoeuros` | `decimal(18,4)` | NO |  | importe de gasto en euros (gasto de albaran de salida) |
| `ASG_idacreedor` | `int(11)` | NO | MUL | id del acreedor (gasto de albaran de salida) |
| `ASG_suplido` | `decimal(18,4)` | NO |  | importe suplido (gasto de albaran de salida) |
| `ASG_idfactura` | `int(11)` | NO | MUL | id interno de factura relacionada (gasto de albaran de salida) |
| `ASG_importefactura` | `decimal(18,2)` | NO |  | numero de factura dentro de la serie (gasto de albaran de salida) |
| `ASG_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro (gasto de albaran de salida) |
| `ASG_FechaLog` | `date` | NO |  | fecha principal del documento (gasto de albaran de salida) |
| `ASG_HoraLog` | `varchar(8)` | NO |  | hora de auditoria (gasto de albaran de salida) |
| `ASG_observacion` | `varchar(250)` | NO |  | campo operativo inferido por nombre: observacion (gasto de albaran de salida) |
| `ASG_IdExpediente` | `int(11)` | NO |  | id de expediente (gasto de albaran de salida) |

### `albsalida_palets`

Palets vinculados a albaranes de salida.

- Filas exactas en copia local: `406107`
- Tamano aproximado: `45.09 MB`
- Clave de negocio: ver clave primaria e indices; tabla auxiliar dependiente de cabecera.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `ASP_id` |
| `idx_ASP_ASA` | No | `ASP_idalbaran` |
| `idx_ASP_PAL` | No | `ASP_idpalet` |
| `indice_UNIQUE` | Si | `ASP_id` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `ASP_id` | `int(11)` | NO | PRI | clave tecnica primaria del registro (palet de albaran de salida) |
| `ASP_idalbaran` | `int(11)` | NO | MUL | id interno de albaran relacionado (palet de albaran de salida) |
| `ASP_idpalet` | `int(11)` | NO | MUL | id de palet (palet de albaran de salida) |
| `ASP_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro (palet de albaran de salida) |
| `ASP_FechaLog` | `date` | NO |  | fecha principal del documento (palet de albaran de salida) |
| `ASP_HoraLog` | `varchar(8)` | NO |  | hora de auditoria (palet de albaran de salida) |
| `ASP_PosicionSalida` | `varchar(25)` | NO |  | posicion de salida/carga (palet de albaran de salida) |
| `ASP_PosicionCamion` | `varchar(10)` | NO |  | posicion en camion (palet de albaran de salida) |

### `albsalida_lineas_desglose`

Desglose de venta de lineas de albaran de salida.

- Filas exactas en copia local: `190037`
- Tamano aproximado: `21.55 MB`
- Clave de negocio: ver clave primaria e indices; tabla auxiliar dependiente de cabecera.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `ASD_Id` |
| `idx_ASD_ASL` | No | `ASD_IdLineaAlbSalida` |
| `indice_UNIQUE` | Si | `ASD_Id` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `ASD_Id` | `int(11)` | NO | PRI | clave tecnica primaria del registro (desglose de linea de albaran de salida) |
| `ASD_IdLineaAlbSalida` | `int(11)` | NO | MUL | id de linea de albaran de salida relacionada (desglose de linea de albaran de salida) |
| `ASD_IdAlbaran` | `int(11)` | NO |  | id interno de albaran relacionado (desglose de linea de albaran de salida) |
| `ASD_BultosVendidos` | `int(11)` | NO |  | bultos vendidos (desglose de linea de albaran de salida) |
| `ASD_KilosVendidos` | `decimal(10,2)` | NO |  | kilos vendidos (desglose de linea de albaran de salida) |
| `ASD_PiezasVendidas` | `int(11)` | NO |  | piezas vendidas (desglose de linea de albaran de salida) |
| `ASD_PrecioVenta` | `decimal(10,4)` | NO |  | precio de venta (desglose de linea de albaran de salida) |
| `ASD_TipoKBP` | `varchar(1)` | NO |  | unidad de calculo K/B/P: kilos, bultos o piezas/palets segun catalogo (desglose de linea de albaran de salida) |
| `ASD_ImporteVenta` | `decimal(10,2)` | NO |  | importe (desglose de linea de albaran de salida) |
| `ASD_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro (desglose de linea de albaran de salida) |
| `ASD_FechaLog` | `date` | NO |  | fecha principal del documento (desglose de linea de albaran de salida) |
| `ASD_HoraLog` | `varchar(8)` | NO |  | hora de auditoria (desglose de linea de albaran de salida) |

### `observacionesalbsalida`

Observaciones auxiliares de albaranes de salida.

- Filas exactas en copia local: `1`
- Tamano aproximado: `0.03 MB`
- Clave de negocio: ver clave primaria e indices; tabla auxiliar dependiente de cabecera.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `OAS_Id` |
| `indice_UNIQUE` | Si | `OAS_Id` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `OAS_Id` | `int(11)` | NO | PRI | campo operativo inferido por nombre: oas_id |
| `OAS_TextoObservacion` | `varchar(50)` | NO |  | campo operativo inferido por nombre: oas_textoobservacion |
| `OAS_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro |
| `OAS_FechaLog` | `date` | NO |  | fecha principal del documento |
| `OAS_HoraLog` | `varchar(8)` | NO |  | hora de auditoria |

### `albentrada`

Cabecera de albaranes de entrada, normalmente recepcion de genero/agricultor.

- Filas exactas en copia local: `81717`
- Tamano aproximado: `27.61 MB`
- Clave de negocio: `AEN_idalbaran` es la clave tecnica. La identidad de negocio suele ser `AEN_serie` + `AEN_albaran` + `AEN_campa`.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `AEN_idalbaran` |
| `idx_AEN_AGR` | No | `AEN_idagricultor` |
| `idx_AEN_AGRPRI` | No | `AEN_idAgriPrincipal` |
| `idx_AEN_EMPFEC` | No | `AEN_IdEmpresaAgricultor`, `AEN_fecha` |
| `idx_AEN_SERALB` | No | `AEN_serie`, `AEN_albaran` |
| `idx_AEN_VAL` | No | `AEN_idvaleenvase` |
| `indice_UNIQUE` | Si | `AEN_idalbaran` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `AEN_idalbaran` | `int(11)` | NO | PRI | id interno de albaran relacionado (albaran de entrada) |
| `AEN_campa` | `int(11)` | NO |  | campana/ejercicio agricola (albaran de entrada) |
| `AEN_albaran` | `int(11)` | NO |  | numero de albaran dentro de la serie/campana (albaran de entrada) |
| `AEN_idagricultor` | `int(11)` | NO | MUL | id del agricultor/proveedor agricola (albaran de entrada) |
| `AEN_fecha` | `date` | NO |  | fecha principal del documento (albaran de entrada) |
| `AEN_idpuntoventa` | `int(11)` | NO |  | id de punto de venta (albaran de entrada) |
| `AEN_idcentro` | `int(11)` | NO |  | id de centro (albaran de entrada) |
| `AEN_idrecogida` | `int(11)` | NO |  | campo operativo inferido por nombre: idrecogida (albaran de entrada) |
| `AEN_idgastoporte` | `int(11)` | NO |  | gasto de porte/transporte (albaran de entrada) |
| `AEN_dtokg` | `decimal(6,4)` | NO |  | campo operativo inferido por nombre: dtokg (albaran de entrada) |
| `AEN_tipoentrada` | `varchar(2)` | NO |  | campo operativo inferido por nombre: tipoentrada (albaran de entrada) |
| `AEN_tipofcs` | `varchar(1)` | NO |  | tipo funcional/facturacion/cargo (albaran de entrada) |
| `AEN_fechahora` | `date` | NO |  | fecha principal del documento (albaran de entrada) |
| `AEN_idvaleenvase` | `int(11)` | NO | MUL | campo operativo inferido por nombre: idvaleenvase (albaran de entrada) |
| `AEN_entradaconfeccionada` | `varchar(1)` | NO |  | campo operativo inferido por nombre: entradaconfeccionada (albaran de entrada) |
| `AEN_referencia` | `varchar(15)` | NO |  | referencia documental (albaran de entrada) |
| `AEN_idbascula` | `int(11)` | NO |  | campo operativo inferido por nombre: idbascula (albaran de entrada) |
| `AEN_fechavaloracion` | `date` | NO |  | fecha de valoracion (albaran de entrada) |
| `AEN_matricula` | `varchar(15)` | NO |  | campo operativo inferido por nombre: matricula (albaran de entrada) |
| `AEN_idmedianeria` | `int(11)` | NO |  | campo operativo inferido por nombre: idmedianeria (albaran de entrada) |
| `AEN_IdTransportista` | `int(11)` | NO |  | id del transportista (albaran de entrada) |
| `AEN_serie` | `varchar(5)` | NO | MUL | serie documental (albaran de entrada) |
| `AEN_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro (albaran de entrada) |
| `AEN_FechaLog` | `date` | NO |  | fecha principal del documento (albaran de entrada) |
| `AEN_HoraLog` | `varchar(8)` | NO |  | hora de auditoria (albaran de entrada) |
| `AEN_IdEmpresaAgricultor` | `int(11)` | NO | MUL | id de empresa del agricultor (albaran de entrada) |
| `AEN_idAgriPrincipal` | `int(11)` | NO | MUL | campo operativo inferido por nombre: idagriprincipal (albaran de entrada) |
| `AEN_IdComercial` | `int(11)` | NO |  | id del comercial (albaran de entrada) |
| `AEN_AplicarTara` | `varchar(1)` | NO |  | indicador de aplicacion de tara (albaran de entrada) |
| `AEN_Intermediacion` | `varchar(1)` | NO |  | indicador de intermediacion (albaran de entrada) |
| `AEN_LocalizadorDAT` | `varchar(15)` | NO |  | campo operativo inferido por nombre: localizadordat (albaran de entrada) |
| `AEN_Firma` | `text` | YES |  | firma digital/texto asociado (albaran de entrada) |
| `AEN_IdConductor` | `int(11)` | NO |  | campo operativo inferido por nombre: idconductor (albaran de entrada) |
| `AEN_Observaciones` | `varchar(250)` | NO |  | observaciones (albaran de entrada) |
| `AEN_IdPais` | `int(11)` | NO |  | id de pais (albaran de entrada) |
| `AEN_idsubasta` | `int(11)` | NO |  | id de subasta (albaran de entrada) |
| `AEN_IdExpediente` | `int(11)` | NO |  | id de expediente (albaran de entrada) |
| `AEN_IdMuelle` | `int(11)` | NO |  | id de muelle (albaran de entrada) |
| `AEN_IdCortador` | `int(11)` | NO |  | campo operativo inferido por nombre: idcortador (albaran de entrada) |
| `AEN_IdCargador` | `int(11)` | NO |  | id de carga (albaran de entrada) |
| `AEN_Idtraspaso` | `int(11)` | NO |  | campo operativo inferido por nombre: idtraspaso (albaran de entrada) |
| `AEN_FirmaApp` | `text` | YES |  | firma capturada en app (albaran de entrada) |
| `AEN_FechaEnvioAICA` | `datetime` | NO |  | fecha principal del documento (albaran de entrada) |
| `AEN_ContradoId` | `text` | YES |  | campo operativo inferido por nombre: contradoid (albaran de entrada) |

### `albentrada_lineas`

Lineas de producto de albaranes de entrada.

- Filas exactas en copia local: `85929`
- Tamano aproximado: `41.66 MB`
- Clave de negocio: ver clave primaria e indices; tabla auxiliar dependiente de cabecera.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `AEL_idlinea` |
| `idx_AEL_AEN` | No | `AEL_idalbaran` |
| `idx_AEL_ALBFEC` | No | `AEL_idalbaran`, `AEL_fechamuestreo` |
| `idx_AEL_IdPedidoLinea` | No | `AEL_IdPedidoLinea` |
| `idx_AEL_Muestreo` | No | `AEL_muestreo` |
| `idx_AEL_fechamuestreo` | No | `AEL_fechamuestreo` |
| `indice_UNIQUE` | Si | `AEL_idlinea` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `AEL_idlinea` | `int(11)` | NO | PRI | clave tecnica primaria del registro (linea de albaran de entrada) |
| `AEL_idalbaran` | `int(11)` | NO | MUL | id interno de albaran relacionado (linea de albaran de entrada) |
| `AEL_idgenero` | `int(11)` | NO |  | id de genero/producto (linea de albaran de entrada) |
| `AEL_idenvase` | `int(11)` | NO |  | campo operativo inferido por nombre: idenvase (linea de albaran de entrada) |
| `AEL_idpalet` | `int(11)` | NO |  | id de palet (linea de albaran de entrada) |
| `AEL_kilosbrutos` | `decimal(18,2)` | NO |  | kilos brutos (linea de albaran de entrada) |
| `AEL_kilosnetos` | `decimal(18,2)` | NO |  | kilos netos (linea de albaran de entrada) |
| `AEL_palets` | `int(11)` | NO |  | numero de palets (linea de albaran de entrada) |
| `AEL_bultos` | `int(11)` | NO |  | numero de bultos (linea de albaran de entrada) |
| `AEL_idcultivo` | `int(11)` | NO |  | id de cultivo (linea de albaran de entrada) |
| `AEL_idcategoria` | `int(11)` | NO |  | id de categoria (linea de albaran de entrada) |
| `AEL_albaran` | `int(11)` | NO |  | numero de albaran dentro de la serie/campana (linea de albaran de entrada) |
| `AEL_linea` | `int(11)` | NO |  | campo operativo inferido por nombre: linea (linea de albaran de entrada) |
| `AEL_tarapalet` | `decimal(6,2)` | NO |  | tara de palet (linea de albaran de entrada) |
| `AEL_taraenvase` | `decimal(6,2)` | NO |  | tara de envase (linea de albaran de entrada) |
| `AEL_taraporce` | `decimal(6,2)` | NO |  | porcentaje de tara (linea de albaran de entrada) |
| `AEL_piezas` | `int(11)` | NO |  | numero de piezas (linea de albaran de entrada) |
| `AEL_tipoprecio` | `varchar(1)` | NO |  | tipo de precio K/B/P (linea de albaran de entrada) |
| `AEL_precio` | `decimal(11,5)` | NO |  | precio unitario (linea de albaran de entrada) |
| `AEL_precioenvase` | `decimal(6,4)` | NO |  | precio de envase (linea de albaran de entrada) |
| `AEL_preciopalet` | `decimal(6,4)` | NO |  | precio de palet (linea de albaran de entrada) |
| `AEL_observaciones` | `varchar(50)` | NO |  | observaciones (linea de albaran de entrada) |
| `AEL_muestreo` | `int(11)` | NO | MUL | campo operativo inferido por nombre: muestreo (linea de albaran de entrada) |
| `AEL_taramanual` | `decimal(12,2)` | NO |  | tara manual (linea de albaran de entrada) |
| `AEL_fechamuestreo` | `date` | NO | MUL | fecha principal del documento (linea de albaran de entrada) |
| `AEL_idprograma` | `int(11)` | NO |  | campo operativo inferido por nombre: idprograma (linea de albaran de entrada) |
| `AEL_idtipoconfeccion` | `int(11)` | NO |  | id de tipo de confeccion (linea de albaran de entrada) |
| `AEL_idtipopalet` | `int(11)` | NO |  | id de tipo de palet (linea de albaran de entrada) |
| `AEL_idmarca` | `int(11)` | NO |  | campo operativo inferido por nombre: idmarca (linea de albaran de entrada) |
| `AEL_envasepropio` | `varchar(1)` | NO |  | campo operativo inferido por nombre: envasepropio (linea de albaran de entrada) |
| `AEL_idgensal` | `int(11)` | NO |  | id de genero de salida (linea de albaran de entrada) |
| `AEL_materialpropio` | `varchar(1)` | NO |  | campo operativo inferido por nombre: materialpropio (linea de albaran de entrada) |
| `AEL_IdPedidoLinea` | `int(11)` | NO | MUL | id de linea de pedido (linea de albaran de entrada) |
| `AEL_IdMarcaEtiqueta` | `int(11)` | NO |  | campo operativo inferido por nombre: idmarcaetiqueta (linea de albaran de entrada) |
| `AEL_IdMarcaMaterial` | `int(11)` | NO |  | campo operativo inferido por nombre: idmarcamaterial (linea de albaran de entrada) |
| `AEL_Calidad` | `varchar(1)` | NO |  | campo operativo inferido por nombre: calidad (linea de albaran de entrada) |
| `AEL_BultosxPalet` | `int(11)` | NO |  | bultos por palet (linea de albaran de entrada) |
| `AEL_KilosxBulto` | `decimal(5,2)` | NO |  | kilos por bulto (linea de albaran de entrada) |
| `AEL_PiezasxBulto` | `int(11)` | NO |  | piezas por bulto (linea de albaran de entrada) |
| `AEL_KilosCliente` | `decimal(18,2)` | NO |  | kilos facturados/asignados al cliente (linea de albaran de entrada) |
| `AEL_IdUbicacionPV` | `int(11)` | NO |  | campo operativo inferido por nombre: idubicacionpv (linea de albaran de entrada) |
| `AEL_campacultivo` | `int(11)` | NO |  | campana/ejercicio agricola (linea de albaran de entrada) |
| `AEL_Controlado` | `varchar(1)` | NO |  | campo operativo inferido por nombre: controlado (linea de albaran de entrada) |
| `AEL_ObservacionesProveedor` | `varchar(80)` | NO |  | observaciones del proveedor (linea de albaran de entrada) |
| `AEL_IdValoracion` | `int(11)` | NO |  | campo operativo inferido por nombre: idvaloracion (linea de albaran de entrada) |
| `AEL_FechaValoracion` | `date` | NO |  | fecha de valoracion (linea de albaran de entrada) |
| `AEL_Idparte` | `int(11)` | NO |  | campo operativo inferido por nombre: idparte (linea de albaran de entrada) |
| `AEL_RevisadaWeb` | `varchar(1)` | NO |  | campo operativo inferido por nombre: revisadaweb (linea de albaran de entrada) |
| `AEL_IdTipoCultivo` | `int(11)` | NO |  | id de tipo de cultivo (linea de albaran de entrada) |
| `AEL_Importe` | `decimal(15,2)` | NO |  | importe (linea de albaran de entrada) |
| `AEL_PrecioNetoVenta` | `decimal(10,4)` | NO |  | precio neto de venta (linea de albaran de entrada) |
| `AEL_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro (linea de albaran de entrada) |
| `AEL_FechaLog` | `date` | NO |  | fecha principal del documento (linea de albaran de entrada) |
| `AEL_HoraLog` | `varchar(8)` | NO |  | hora de auditoria (linea de albaran de entrada) |
| `AEL_ActualizadaWeb_SN` | `varchar(1)` | NO |  | campo operativo inferido por nombre: actualizadaweb_sn (linea de albaran de entrada) |
| `AEL_ActualizadaWebPrecio_SN` | `varchar(1)` | NO |  | precio unitario (linea de albaran de entrada) |
| `AEL_kmuestreado` | `decimal(18,2)` | NO |  | kilos muestreados (linea de albaran de entrada) |
| `AEL_Mx` | `varchar(2)` | NO |  | campo operativo inferido por nombre: mx (linea de albaran de entrada) |
| `AEL_LotePalet` | `varchar(20)` | NO |  | campo operativo inferido por nombre: lotepalet (linea de albaran de entrada) |
| `AEL_RefLinea` | `varchar(50)` | NO |  | campo operativo inferido por nombre: reflinea (linea de albaran de entrada) |
| `AEL_GastoManipulacion` | `decimal(20,4)` | NO |  | gasto de manipulacion (linea de albaran de entrada) |
| `AEL_GastoManipulacionKilo` | `decimal(15,4)` | NO |  | gasto de manipulacion por kilo (linea de albaran de entrada) |
| `AEL_TaraCamion` | `int(11)` | NO |  | tara de camion (linea de albaran de entrada) |
| `AEL_TerminadaSN` | `varchar(1)` | NO |  | campo operativo inferido por nombre: terminadasn (linea de albaran de entrada) |
| `AEL_TipoCalidad1` | `int(11)` | NO |  | campo operativo inferido por nombre: tipocalidad1 (linea de albaran de entrada) |
| `AEL_TipoCalidad2` | `int(11)` | NO |  | campo operativo inferido por nombre: tipocalidad2 (linea de albaran de entrada) |
| `AEL_ObservacionesApp` | `varchar(800)` | NO |  | observaciones de app (linea de albaran de entrada) |
| `AEL_IdentradaCamion` | `int(11)` | NO |  | campo operativo inferido por nombre: identradacamion (linea de albaran de entrada) |
| `AEL_IdPaletCamion` | `int(11)` | NO |  | id de palet de camion (linea de albaran de entrada) |
| `AEL_IdEmpresaCamion` | `int(11)` | NO |  | id de empresa (linea de albaran de entrada) |
| `AEL_ExiSubasta` | `varchar(1)` | NO |  | campo operativo inferido por nombre: exisubasta (linea de albaran de entrada) |
| `AEL_ActualizadaWebAgrupada_SN` | `varchar(1)` | NO |  | campo operativo inferido por nombre: actualizadawebagrupada_sn (linea de albaran de entrada) |
| `AEL_DtoMerma` | `decimal(6,2)` | NO |  | descuento/merma (linea de albaran de entrada) |
| `AEL_KilosAgri` | `decimal(18,2)` | NO |  | kilos del agricultor (linea de albaran de entrada) |
| `AEL_DtoAplicado` | `varchar(1)` | NO |  | indicador de descuento aplicado (linea de albaran de entrada) |
| `AEL_paletpropio` | `varchar(1)` | NO |  | campo operativo inferido por nombre: paletpropio (linea de albaran de entrada) |
| `AEL_idprecioAICA` | `int(11)` | NO |  | precio unitario (linea de albaran de entrada) |

### `albentrada_gastos`

Gastos aplicados a albaranes de entrada.

- Filas exactas en copia local: `32402`
- Tamano aproximado: `5.86 MB`
- Clave de negocio: ver clave primaria e indices; tabla auxiliar dependiente de cabecera.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `AEG_id` |
| `idx_AEG_AEN` | No | `AEG_idalbaran` |
| `idx_AHG_AEN` | No | `AEG_idalbaran` |
| `indice_UNIQUE` | Si | `AEG_id` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `AEG_id` | `int(11)` | NO | PRI | clave tecnica primaria del registro (gasto de albaran de entrada) |
| `AEG_idalbaran` | `int(11)` | NO | MUL | id interno de albaran relacionado (gasto de albaran de entrada) |
| `AEG_idgasto` | `int(11)` | NO |  | gasto (gasto de albaran de entrada) |
| `AEG_gasto` | `decimal(18,4)` | NO |  | gasto (gasto de albaran de entrada) |
| `AEG_tipo` | `varchar(1)` | NO |  | campo operativo inferido por nombre: tipo (gasto de albaran de entrada) |
| `AEG_idacreedor` | `int(11)` | NO |  | id del acreedor (gasto de albaran de entrada) |
| `AEG_tipofc` | `varchar(1)` | NO |  | tipo funcional/facturacion/cargo (gasto de albaran de entrada) |
| `AEG_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro (gasto de albaran de entrada) |
| `AEG_FechaLog` | `date` | NO |  | fecha principal del documento (gasto de albaran de entrada) |
| `AEG_HoraLog` | `varchar(8)` | NO |  | hora de auditoria (gasto de albaran de entrada) |
| `AEG_Extra` | `int(11)` | NO |  | campo operativo inferido por nombre: extra (gasto de albaran de entrada) |
| `AEG_AsignarTransportista` | `varchar(1)` | NO |  | campo operativo inferido por nombre: asignartransportista (gasto de albaran de entrada) |

### `albentrada_lineascla`

Clasificacion/valoracion por linea de entrada.

- Filas exactas en copia local: `159875`
- Tamano aproximado: `31.58 MB`
- Clave de negocio: ver clave primaria e indices; tabla auxiliar dependiente de cabecera.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `IDX_ALC_idalbaran` | No | `ALC_idalbaran` |
| `IDX_ALC_idlineaentrada` | No | `ALC_idlineaentrada` |
| `PRIMARY` | Si | `ALC_id` |
| `idx_ALC_AEL` | No | `ALC_idlineaentrada` |
| `indice_UNIQUE` | Si | `ALC_id` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `ALC_id` | `int(11)` | NO | PRI | clave tecnica primaria del registro (clasificacion de linea de entrada) |
| `ALC_idlineaentrada` | `int(11)` | NO | MUL | id de linea de albaran de entrada relacionada (clasificacion de linea de entrada) |
| `ALC_idalbaran` | `int(11)` | NO | MUL | id interno de albaran relacionado (clasificacion de linea de entrada) |
| `ALC_idgenero` | `int(11)` | NO |  | id de genero/producto (clasificacion de linea de entrada) |
| `ALC_kilosnetos` | `decimal(12,2)` | NO |  | kilos netos (clasificacion de linea de entrada) |
| `ALC_bultos` | `int(11)` | NO |  | numero de bultos (clasificacion de linea de entrada) |
| `ALC_idcategoria` | `int(11)` | NO |  | id de categoria (clasificacion de linea de entrada) |
| `ALC_precio` | `decimal(11,5)` | NO |  | precio unitario (clasificacion de linea de entrada) |
| `ALC_piezas` | `int(11)` | NO |  | numero de piezas (clasificacion de linea de entrada) |
| `ALC_Importe` | `decimal(10,2)` | NO |  | importe (clasificacion de linea de entrada) |
| `ALC_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro (clasificacion de linea de entrada) |
| `ALC_FechaLog` | `date` | NO |  | fecha principal del documento (clasificacion de linea de entrada) |
| `ALC_HoraLog` | `varchar(8)` | NO |  | hora de auditoria (clasificacion de linea de entrada) |
| `ALC_GastoC` | `decimal(10,2)` | NO |  | gasto (clasificacion de linea de entrada) |
| `ALC_GastoF` | `decimal(10,2)` | NO |  | gasto (clasificacion de linea de entrada) |
| `ALC_idtipocultivo` | `int(11)` | NO |  | id de tipo de cultivo (clasificacion de linea de entrada) |
| `ALC_Muestreado` | `decimal(12,2)` | NO |  | cantidad/kilos muestreados (clasificacion de linea de entrada) |

### `albentrada_lineaskilos`

Detalle de pesadas, bultos, palets y kilos de lineas de entrada.

- Filas exactas en copia local: `355323`
- Tamano aproximado: `66.61 MB`
- Clave de negocio: ver clave primaria e indices; tabla auxiliar dependiente de cabecera.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `IDX_ALK_idlineaentrada` | No | `ALK_idlineaentrada` |
| `PRIMARY` | Si | `ALK_id` |
| `indice_UNIQUE` | Si | `ALK_id` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `ALK_id` | `int(11)` | NO | PRI | clave tecnica primaria del registro (detalle de kilos/pesadas de linea de entrada) |
| `ALK_idlineaentrada` | `int(11)` | NO | MUL | id de linea de albaran de entrada relacionada (detalle de kilos/pesadas de linea de entrada) |
| `ALK_bultos` | `int(11)` | NO |  | numero de bultos (detalle de kilos/pesadas de linea de entrada) |
| `ALK_kilos` | `decimal(12,2)` | NO |  | kilos (detalle de kilos/pesadas de linea de entrada) |
| `ALK_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro (detalle de kilos/pesadas de linea de entrada) |
| `ALK_FechaLog` | `date` | NO |  | fecha principal del documento (detalle de kilos/pesadas de linea de entrada) |
| `ALK_HoraLog` | `varchar(8)` | NO |  | hora de auditoria (detalle de kilos/pesadas de linea de entrada) |
| `ALK_palets` | `int(11)` | NO |  | numero de palets (detalle de kilos/pesadas de linea de entrada) |
| `ALK_IdPalet` | `int(11)` | NO |  | id de palet (detalle de kilos/pesadas de linea de entrada) |
| `ALK_BxP` | `int(11)` | NO |  | campo operativo inferido por nombre: bxp (detalle de kilos/pesadas de linea de entrada) |
| `ALK_kilosBrutos` | `decimal(12,2)` | NO |  | kilos brutos (detalle de kilos/pesadas de linea de entrada) |
| `ALK_Idenvase` | `int(11)` | NO |  | campo operativo inferido por nombre: idenvase (detalle de kilos/pesadas de linea de entrada) |
| `ALK_TaraEnvase` | `decimal(12,2)` | NO |  | tara de envase (detalle de kilos/pesadas de linea de entrada) |
| `ALK_TaraPalet` | `decimal(12,2)` | NO |  | tara de palet (detalle de kilos/pesadas de linea de entrada) |
| `ALK_MarcaEnvase` | `int(11)` | NO |  | campo operativo inferido por nombre: marcaenvase (detalle de kilos/pesadas de linea de entrada) |
| `ALK_Observaciones` | `varchar(50)` | NO |  | observaciones (detalle de kilos/pesadas de linea de entrada) |
| `ALK_IdLinea` | `int(11)` | NO |  | clave tecnica primaria del registro (detalle de kilos/pesadas de linea de entrada) |
| `ALK_Fecha` | `date` | NO |  | fecha principal del documento (detalle de kilos/pesadas de linea de entrada) |
| `ALK_Hora` | `varchar(5)` | NO |  | campo operativo inferido por nombre: hora (detalle de kilos/pesadas de linea de entrada) |
| `ALK_NumPalet` | `int(11)` | NO |  | campo operativo inferido por nombre: numpalet (detalle de kilos/pesadas de linea de entrada) |
| `ALK_IdPresentacion` | `int(11)` | NO |  | campo operativo inferido por nombre: idpresentacion (detalle de kilos/pesadas de linea de entrada) |
| `ALK_TipoPalet` | `int(11)` | NO |  | campo operativo inferido por nombre: tipopalet (detalle de kilos/pesadas de linea de entrada) |
| `ALK_idlineacamion` | `int(11)` | NO |  | campo operativo inferido por nombre: idlineacamion (detalle de kilos/pesadas de linea de entrada) |
| `ALK_IdPventa` | `int(11)` | NO |  | id de punto de venta (detalle de kilos/pesadas de linea de entrada) |
| `ALK_Finalizada` | `varchar(1)` | NO |  | campo operativo inferido por nombre: finalizada (detalle de kilos/pesadas de linea de entrada) |
| `ALK_kilosNetos` | `decimal(12,2)` | NO |  | kilos netos (detalle de kilos/pesadas de linea de entrada) |
| `ALK_TaraManual` | `decimal(12,2)` | NO |  | tara manual (detalle de kilos/pesadas de linea de entrada) |
| `ALK_KxB` | `decimal(6,2)` | NO |  | campo operativo inferido por nombre: kxb (detalle de kilos/pesadas de linea de entrada) |
| `ALK_IdpaletCamion` | `int(11)` | NO |  | id de palet de camion (detalle de kilos/pesadas de linea de entrada) |
| `ALK_PxB` | `int(11)` | NO |  | campo operativo inferido por nombre: pxb (detalle de kilos/pesadas de linea de entrada) |

### `albentrada_his`

Historico de cabeceras de albaran de entrada.

- Filas exactas en copia local: `83658`
- Tamano aproximado: `22.61 MB`
- Clave de negocio: ver clave primaria e indices; tabla auxiliar dependiente de cabecera.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `AEH_id` |
| `idx_AEH_AEN` | No | `AEH_idalbaran` |
| `idx_AEH_EMP` | No | `AEH_idempresa` |
| `idx_AEH_FAC` | No | `AEH_idfactura` |
| `idx_AEH_FRR` | No | `AEH_idfacturafirme` |
| `idx_AEH_PRO` | No | `AEH_idproveedor` |
| `indice_UNIQUE` | Si | `AEH_id` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `AEH_id` | `int(11)` | NO | PRI | campo operativo inferido por nombre: aeh_id |
| `AEH_idalbaran` | `int(11)` | NO | MUL | id interno de albaran relacionado |
| `AEH_idproveedor` | `int(11)` | NO | MUL | id del proveedor |
| `AEH_porcentaje` | `decimal(8,2)` | NO |  | campo operativo inferido por nombre: aeh_porcentaje |
| `AEH_idtarifa` | `int(11)` | NO |  | campo operativo inferido por nombre: aeh_idtarifa |
| `AEH_importegenero` | `decimal(8,2)` | NO |  | importe de genero |
| `AEH_tgastosfac` | `decimal(8,2)` | NO |  | gasto |
| `AEH_tgastoscom` | `decimal(8,2)` | NO |  | gasto |
| `AEH_baseimponible` | `decimal(8,2)` | NO |  | base imponible |
| `AEH_tipoiva` | `decimal(5,2)` | NO |  | porcentaje/tipo de IVA |
| `AEH_cuotaiva` | `decimal(8,2)` | NO |  | porcentaje/tipo de IVA |
| `AEH_tiporet` | `varchar(1)` | NO |  | campo operativo inferido por nombre: aeh_tiporet |
| `AEH_poret` | `decimal(5,2)` | NO |  | campo operativo inferido por nombre: aeh_poret |
| `AEH_cuotaret` | `decimal(8,2)` | NO |  | cuota/importes de impuesto |
| `AEH_totalalbaran` | `decimal(10,2)` | NO |  | numero de albaran dentro de la serie/campana |
| `AEH_idfactura` | `int(11)` | NO | MUL | id interno de factura relacionada |
| `AEH_nmed` | `int(11)` | NO |  | campo operativo inferido por nombre: aeh_nmed |
| `AEH_kilos` | `decimal(8,2)` | NO |  | kilos |
| `AEH_idempresa` | `int(11)` | NO | MUL | id de empresa |
| `AEH_idfacturafirme` | `int(11)` | NO | MUL | id interno de factura relacionada |
| `AEH_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro |
| `AEH_FechaLog` | `date` | NO |  | fecha principal del documento |
| `AEH_HoraLog` | `varchar(8)` | NO |  | hora de auditoria |
| `AEH_idasiento` | `int(11)` | NO |  | id de asiento contable |
| `AEH_EnviadoAICA` | `varchar(1)` | NO |  | campo operativo inferido por nombre: aeh_enviadoaica |
| `AEH_IdEnvioFirma` | `int(11)` | NO |  | firma digital/texto asociado |
| `AEH_FechaEnvioMail` | `date` | NO |  | fecha principal del documento |

### `albentrada_hislineas`

Historico de lineas de albaran de entrada.

- Filas exactas en copia local: `162602`
- Tamano aproximado: `39.13 MB`
- Clave de negocio: ver clave primaria e indices; tabla auxiliar dependiente de cabecera.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `AHL_id` |
| `idx_AHL_AEH` | No | `AHL_idalbhis` |
| `idx_AHL_AEL` | No | `AHL_idlineaentrada` |
| `idx_AHL_AEN` | No | `AHL_idalbaran` |
| `idx_AHL_MUE` | No | `AHL_muestreo` |
| `indice_UNIQUE` | Si | `AHL_id` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `AHL_id` | `int(11)` | NO | PRI | campo operativo inferido por nombre: ahl_id |
| `AHL_idalbhis` | `int(11)` | NO | MUL | campo operativo inferido por nombre: ahl_idalbhis |
| `AHL_idalbaran` | `int(11)` | NO | MUL | id interno de albaran relacionado |
| `AHL_idgenero` | `int(11)` | NO |  | id de genero/producto |
| `AHL_idenvase` | `int(11)` | NO |  | campo operativo inferido por nombre: ahl_idenvase |
| `AHL_idpalet` | `int(11)` | NO |  | id de palet |
| `AHL_kilos` | `decimal(10,2)` | NO |  | kilos |
| `AHL_palets` | `int(11)` | NO |  | numero de palets |
| `AHL_bultos` | `int(11)` | NO |  | numero de bultos |
| `AHL_idcategoria` | `int(11)` | NO |  | id de categoria |
| `AHL_precio` | `decimal(15,5)` | NO |  | precio unitario |
| `AHL_muestreo` | `int(11)` | NO | MUL | campo operativo inferido por nombre: ahl_muestreo |
| `AHL_idlineaentrada` | `int(11)` | NO | MUL | id de linea de albaran de entrada relacionada |
| `AHL_idtipoconfeccion` | `int(11)` | NO |  | id de tipo de confeccion |
| `AHL_idmarca` | `int(11)` | NO |  | campo operativo inferido por nombre: ahl_idmarca |
| `AHL_precioenvase` | `decimal(6,2)` | NO |  | precio de envase |
| `AHL_piezas` | `int(11)` | NO |  | numero de piezas |
| `AHL_tipoprecio` | `varchar(1)` | NO |  | tipo de precio K/B/P |
| `AHL_importegenero` | `decimal(10,2)` | NO |  | importe de genero |
| `AHL_idlineacla` | `int(11)` | NO |  | campo operativo inferido por nombre: ahl_idlineacla |
| `AHL_idtipocultivo` | `int(11)` | NO |  | id de tipo de cultivo |
| `AHL_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro |
| `AHL_FechaLog` | `date` | NO |  | fecha principal del documento |
| `AHL_HoraLog` | `varchar(8)` | NO |  | hora de auditoria |
| `AHL_kilosAg` | `decimal(10,2)` | NO |  | kilos |

### `albentrada_hisgastos`

Historico de gastos de albaran de entrada.

- Filas exactas en copia local: `46819`
- Tamano aproximado: `18.09 MB`
- Clave de negocio: ver clave primaria e indices; tabla auxiliar dependiente de cabecera.

Indices:

| Indice | Unico | Columnas |
|---|---:|---|
| `PRIMARY` | Si | `AHG_id` |
| `idx_AHG_ALB` | No | `AHG_idalbaran` |
| `idx_AHG_ALBHIS` | No | `AHG_idalbhis` |
| `idx_AHG_ALBPROGAS` | No | `AHG_idalbaran`, `AHG_idacreedor`, `AHG_idgasto` |
| `idx_AHG_FACCOM` | No | `AHG_factura_comercial` |
| `idx_AHG_FACPRO` | No | `AHG_idfacturaproveedor` |
| `idx_AHG_PRO` | No | `AHG_idacreedor` |
| `idx_AHG_TIPGAS` | No | `AHG_tipo`, `AHG_idgasto` |
| `indice_UNIQUE` | Si | `AHG_id` |
| `ix_albaran` | No | `AHG_idalbaran` |

Campos:

| Campo | Tipo | Nulo | Clave | Significado / uso |
|---|---:|---:|---:|---|
| `AHG_id` | `int(11)` | NO | PRI | campo operativo inferido por nombre: ahg_id |
| `AHG_idalbhis` | `int(11)` | NO | MUL | campo operativo inferido por nombre: ahg_idalbhis |
| `AHG_idgasto` | `int(11)` | NO |  | gasto |
| `AHG_valor` | `decimal(18,5)` | NO |  | campo operativo inferido por nombre: ahg_valor |
| `AHG_tipo` | `varchar(1)` | NO | MUL | campo operativo inferido por nombre: ahg_tipo |
| `AHG_importe` | `decimal(18,5)` | NO |  | importe |
| `AHG_factura_comercial` | `varchar(1)` | NO | MUL | numero de factura dentro de la serie |
| `AHG_idfacturaproveedor` | `int(11)` | NO | MUL | id interno de factura relacionada |
| `AHG_idalbaran` | `int(11)` | NO | MUL | id interno de albaran relacionado |
| `AHG_idacreedor` | `int(11)` | NO | MUL | id del acreedor |
| `AHG_IdUsuarioLog` | `int(11)` | NO |  | usuario que creo o modifico el registro |
| `AHG_FechaLog` | `date` | NO |  | fecha principal del documento |
| `AHG_HoraLog` | `varchar(8)` | NO |  | hora de auditoria |

## Recomendaciones para evolucionar la API

- Mantener la API contra la copia local mientras se validan contratos.
- Separar endpoints de lectura y escritura. Para escritura, usar un usuario MariaDB distinto, transacciones y validaciones de integridad previas.
- No escribir nunca en produccion usando el usuario `sa`; crear usuario de aplicacion con permisos minimos y whitelisting de IP/tunel.
- Para OCR de facturas de cliente, resolver primero `clientes` por `CLI_Nif`/`CLI_Nombre` y despues buscar `facturas` por `cliente_id`, `serie`, `numero`, `fecha` y `total`.
- Para OCR de facturas recibidas, resolver primero `acreedores` por `ACR_Nif`/`ACR_Nombre`, despues validar `facturasrecibidas` por `FRR_idproveedor`, `FRR_numerofactura`, `FRR_fechafactura`, `FRR_totalfac` y tramos de IVA.
- Para combos de facturas recibidas, usar `GET /empresas` para `FRR_Idempresa` y `GET /facturasrecibidas/tipos` para `FRR_tipofactura`. Las etiquetas de `FRR_tipofactura` quedan pendientes de confirmacion funcional porque no hay maestro poblado en la copia local.
- Mantener la tabla staging/OCR de 97 columnas como bandeja de trabajo, no como definicion del modelo Netagro. Sus metadatos (`estado`, `extraction`, `validation_errors`, `netagro_response`, etc.) son propios de la app y no deben enviarse ni asumirse como columnas ERP.
- No hacer que staging tenga mas autoridad que Netagro: las columnas `FRR_*` deben mapearse 1:1 contra `facturasrecibidas` antes de cualquier envio, y `facturasrecibidas_ctb` debe generarse como tabla hija, no embutirse en JSON si se va a sincronizar con el ERP.
- Exponer como siguientes maestros de solo lectura: `gastos` para traducir `FGC_idgasto`/`ASG_idgasto`, maestro de generos/productos para `ASL_idgenero`, paises/divisas para etiquetas legibles y `clientesdescargas` si se necesita validar direcciones de entrega.
- Si los PDFs son facturas recibidas de proveedores, documentar y exponer el flujo separado `acreedores` + `facturasrecibidas` + `facturasrecibidas_ctb`; no mezclarlo con el flujo de facturas emitidas a clientes.
- Para facturar albaranes, validar primero el flujo real del ERP: campos `ASA_idfactura`, `ASA_idfacturaestimativa`, `ASA_idfacturanegativa`, `ASA_fechavaloracion`, `FRA_DefinitivaEstimativa` y asientos contables.
- Antes de migrar cambios a produccion, crear pruebas de comparacion sobre totales: suma de lineas/gastos vs total de cabecera.
