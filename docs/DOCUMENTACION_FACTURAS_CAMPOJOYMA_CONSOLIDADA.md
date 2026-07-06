# Documentacion consolidada: facturas Campojoyma

Ultima actualizacion: 2026-07-06

Este documento consolida la documentacion tecnica del repo, la documentacion descargada desde el VPS intermedio y las decisiones de implementacion del modulo de facturas de compra.

Fuentes usadas:

- `C:\Users\Moises-Karma\Desktop\documentacion_facturas_albaranes.md`, descargada desde `/root/netagro_docs/documentacion_facturas_albaranes.md`.
- `documentacion_facturas_albaranes.md` del repo.
- `docs/FACTURAS_RECIBIDAS_CAMPOJOYMA.md`.
- Implementacion actual del repo en `src/pages/FacturasRecibidas.tsx`, `src/services/facturas.ts` y Edge Functions de `supabase/functions`.

## Resumen ejecutivo

La pantalla de facturas de compra trabaja contra Supabase como bandeja de revision. La base real del ERP no se escribe desde frontend ni desde n8n.

Flujo actual:

1. El usuario sube un PDF desde la UI.
2. El PDF se guarda en `archivos_pdf`.
3. La Edge Function `factura-recibida-extraer` lee el base64 y llama al webhook n8n `campojoyma-factura-extraer`.
4. n8n extrae datos visibles con IA y resuelve proveedor contra la API Campojoyma.
5. La Edge Function guarda cabecera en `facturasrecibidas` y apuntes en `facturasrecibidas_ctb`, si n8n/API devuelve apuntes explicitos.
6. La factura queda en Supabase como `validada`, `pendiente_revision` o `duplicada`.
7. El envio real al ERP queda separado y solo debe hacerse mediante el flujo de envio ERP cuando existan endpoints POST seguros.

Reglas importantes:

- n8n no escribe directamente en Supabase.
- n8n no debe usar service role hardcodeado.
- La IA no inventa proveedor, cuentas contables, `FRR_idproveedor`, `FRR_idcuenta` ni `ctb`.
- Supabase staging no es la base real del ERP.
- `FRR_id` debe quedar `null` hasta que el ERP real devuelva un id creado.
- `FRR_tipofactura = "1"` no se ha visto en la MariaDB dumpeada; no debe usarse como valor por defecto.

## Arquitectura

```text
Frontend React
  -> archivos_pdf
  -> Edge Function factura-recibida-extraer
      -> n8n webhook campojoyma-factura-extraer
          -> IA sobre imagenes del PDF
          -> API Campojoyma para proveedor/reglas
      -> Supabase facturasrecibidas
      -> Supabase facturasrecibidas_ctb

Frontend React
  -> Edge Function facturas-recibidas-erp-read
      -> n8n webhook apiCampojoyma
          -> FastAPI interna 172.19.0.1:18000
              -> copia MariaDB solo lectura
```

## API Campojoyma / VPS intermedio

La FastAPI desplegada en el VPS intermedio consulta una copia local de MariaDB con permisos de solo lectura. Produccion no se toca.

Base interna desde n8n:

```text
http://172.19.0.1:18000
```

Webhook externo de lectura:

```text
https://n8nbecarios.srv894901.hstgr.cloud/webhook/apiCampojoyma?consulta=...
```

En n8n el parametro correcto es `query.consulta`. La llamada HTTP interna se construye como:

```text
={{ 'http://172.19.0.1:18000/' + $json.query.consulta }}
```

Endpoints relevantes:

| Endpoint | Uso |
|---|---|
| `GET /health` | Estado de API y conexion a BD local. |
| `GET /empresas` | Catalogo real para `FRR_Idempresa`. |
| `GET /empresas/{empresa_id}` | Empresa por `EMP_idempresa`. |
| `GET /acreedores` | Busqueda/listado de proveedores. Filtros: `q`, `nombre`, `nif`, `codigo`, `activo`, `schema`, `limit`, `offset`. |
| `GET /acreedores/{acreedor_id}` | Ficha de proveedor por `ACR_Codigo`. |
| `GET /facturasrecibidas/tipos` | Catalogo observado de `FRR_tipofactura`. No hay descripciones oficiales en la copia. |
| `GET /facturasrecibidas` | Listado paginado de facturas recibidas. Filtros: `fecha_desde`, `fecha_hasta`, `proveedor_id`, `proveedor_nif`, `numero_factura`, `ejercicio`, `tipo_factura`, `schema`. |
| `GET /facturasrecibidas/{factura_id}` | Cabecera completa por `FRR_id`, con datos de acreedor. |
| `GET /facturasrecibidas/{factura_id}/ctb` | Desglose contable por `FRC_idfacturarecibida`. |
| `GET /facturasrecibidas_ctb?factura_id={id}` | Alias de desglose contable. |

Formato de listados:

```json
{
  "items": [],
  "limit": 50,
  "offset": 0,
  "total": 0
}
```

## Modelo real ERP

Tablas principales para facturas de compra:

| Tabla | Papel |
|---|---|
| `empresas` | Maestro de empresas. Resuelve `facturasrecibidas.FRR_Idempresa`. |
| `acreedores` | Maestro de proveedores/acreedores. Resuelve `facturasrecibidas.FRR_idproveedor`. |
| `facturasrecibidas` | Cabecera real de factura recibida en ERP. |
| `facturasrecibidas_ctb` | Apuntes/desglose contable de la factura recibida. |
| `tipoagricultor` | Reglas por tipo de agricultor/proveedor, incluyendo cuentas puente/gasto cuando aplica. |

Relaciones practicas:

```text
empresas.EMP_idempresa
  -> facturasrecibidas.FRR_Idempresa

acreedores.ACR_Codigo
  -> facturasrecibidas.FRR_idproveedor

facturasrecibidas.FRR_id
  -> facturasrecibidas_ctb.FRC_idfacturarecibida
```

Clave practica para duplicados OCR:

```text
FRR_Idempresa + FRR_ejercicio + FRR_idproveedor + FRR_numerofactura
```

En la copia local no hay duplicados para esa combinacion excluyendo numero vacio. El ERP no declara necesariamente esta restriccion como unica, pero es una buena regla de validacion en staging.

## Supabase staging

Proyecto Supabase:

```text
CAMPOJOYMA
adbprpemmbspntbttziz
```

Tablas principales:

| Tabla Supabase | Uso |
|---|---|
| `archivos_pdf` | Almacena PDF base64, hash y metadatos. |
| `facturasrecibidas` | Cabecera staging con columnas `FRR_*`, estado, PDF, extraccion, errores y respuesta ERP. |
| `facturasrecibidas_ctb` | Apuntes contables staging con columnas `FRC_*`. |
| `acreedores_cache` | Cache local para validar proveedores contra ERP/API. |

Estados principales:

| Estado | Significado |
|---|---|
| `pendiente_revision` | Faltan datos, hay warnings o requiere revision manual. |
| `validada` | Datos minimos correctos para preparar envio. |
| `duplicada` | Coincide con PDF o clave practica de proveedor/factura. |
| `enviada_erp` | La factura se ha enviado al ERP real. |
| `error_erp` | Fallo al enviar al ERP. |
| `descartada` | Factura descartada en staging. |

Regla de autoridad:

- Supabase es bandeja de trabajo.
- MariaDB/ERP es destino real final.
- `FRR_id`, `FRR_numero`, `FRC_id` y `FRC_idfacturarecibida` solo deben venir del ERP real tras el POST real.

## Edge Functions

### `factura-recibida-extraer`

Funcion responsable de extraer y guardar una factura nueva desde PDF.

Entrada principal:

```json
{
  "archivo_pdf_id": 123,
  "source": "xfuego-front",
  "pdf_nombre": "factura.pdf",
  "pdf_mime_type": "application/pdf",
  "pdf_size": 123456
}
```

Comportamiento:

- Lee `archivos_pdf.b64_contenido`.
- Llama a `N8N_CAMPOJOYMA_EXTRACT_WEBHOOK_URL`.
- Fallback actual:

```text
https://n8nbecarios.srv894901.hstgr.cloud/webhook/campojoyma-factura-extraer
```

- Recibe JSON normalizado desde n8n.
- Guarda cabecera en `facturasrecibidas`.
- Borra/reinserta `facturasrecibidas_ctb` solo con apuntes explicitos.
- No fabrica apuntes si n8n devuelve `ctb: []`.
- Devuelve `factura_id`, `estado` y `validation_errors`.

### `factura-recibida-ingest`

Funcion de ingesta por agente/email o payload externo.

Regla actual:

- Para fuentes `campojoyma-factura-extraer`, `campojoyma-front`, `campojoyma-email` o `xfuego-front`, o si llega `skip_default_ctb: true`, no genera linea contable por defecto.
- El fallback antiguo de `FRR_idcuenta + base` solo se conserva para payloads heredados sin la marca estricta.

### `facturas-recibidas-erp-read`

Proxy server-side de lectura hacia n8n/API Campojoyma. Evita exponer JWT en navegador.

Consultas permitidas actualmente:

```text
acreedores
acreedores/{id}
empresas
facturasrecibidas
facturasrecibidas/{id}
facturasrecibidas/{id}/ctb
facturasrecibidas/tipos
facturasrecibidas_ctb
```

Secrets necesarios:

```text
N8N_CAMPOJOYMA_READ_WEBHOOK_URL
N8N_CAMPOJOYMA_WEBHOOK_URL
N8N_CAMPOJOYMA_WEBHOOK_JWT_SECRET
N8N_CAMPOJOYMA_WEBHOOK_JWT_EXP_SECONDS
```

## n8n: extractor `campojoyma-factura-extraer`

Workflow exportado:

```text
C:\Users\Moises-Karma\Downloads\CAMPOJOYMA - Entrada facturas.json
```

Backup original:

```text
C:\Users\Moises-Karma\Downloads\CAMPOJOYMA - Entrada facturas.json.bak
```

Entrada esperada por webhook:

```json
{
  "factura_id": null,
  "archivo_pdf_id": 123,
  "source": "xfuego-front",
  "pdf_base64": "...",
  "pdf_nombre": "factura.pdf",
  "pdf_mime_type": "application/pdf",
  "pdf_size": 123456,
  "email": {
    "from": null,
    "subject": null,
    "date": null
  }
}
```

Salida esperada hacia la Edge Function:

```json
{
  "ok": true,
  "extraction": {
    "proveedor_nombre": null,
    "proveedor_nif": null,
    "FRR_idproveedor": null,
    "FRR_idcuenta": null,
    "FRR_numerofactura": null,
    "FRR_fechafactura": null,
    "FRR_fechactb": null,
    "FRR_Idempresa": 1,
    "FRR_base1": null,
    "FRR_iva1": null,
    "FRR_cuota1": null,
    "FRR_baseret": 0,
    "FRR_ret": 0,
    "FRR_cuotaret": 0,
    "FRR_totalfac": null,
    "FRR_tipofactura": null,
    "FRR_Concepto": null,
    "FRR_igasto1": null,
    "FRR_ctagasto1": null,
    "FRR_igasto2": null,
    "FRR_ctagasto2": null,
    "ctb": []
  },
  "metadata": {
    "provider_match": null,
    "confidence": null,
    "warnings": [],
    "raw_text_summary": null
  }
}
```

Responsabilidades de n8n:

- Preparar imagenes del PDF para IA.
- Extraer solo datos visibles.
- Buscar proveedor por NIF y fallback por nombre.
- Rellenar `FRR_idproveedor`, `FRR_idcuenta`, nombre y NIF si la API devuelve match.
- Construir reglas contables solo si la API devuelve datos suficientes.
- Devolver warnings si no resuelve proveedor o no tiene reglas contables.

n8n no debe:

- Escribir en Supabase directamente.
- Descargar PDF por URL firmada.
- Usar service role hardcodeado.
- Inventar proveedor o cuentas.
- Rellenar `FRR_tipofactura = "1"`.
- Devolver campos heredados como `albaranes`, `pendiente_pago`, `descuento_general`, `descuento_pronto_pago`.

Variables/env recomendadas en n8n:

```text
CAMPOJOYMA_API_BASE_URL=http://172.19.0.1:18000
CAMPOJOYMA_PROVEEDORES_URL=http://172.19.0.1:18000/acreedores
CAMPOJOYMA_API_TOKEN=
CAMPOJOYMA_API_KEY=
SUPABASE_URL=
CAMPOJOYMA_SUPABASE_URL=
N8N_FACTURAS_RECIBIDAS_INGEST_TOKEN=
N8N_AGENT_TOKEN=
```

## Frontend

Ruta:

```text
/facturas-recibidas
```

Copy visible:

```text
Facturas de compra
```

Comportamiento actual del popup:

1. Selecciona PDF.
2. Sube a `archivos_pdf`.
3. Llama a `factura-recibida-extraer`.
4. Navega a la factura creada/devuelta.
5. No crea una factura vacia antes de extraer.

Combos actuales:

| Campo UI | Campo ERP | Fuente |
|---|---|---|
| Empresa | `FRR_Idempresa` | `GET /empresas` via `facturas-recibidas-erp-read`. |
| Tipo factura | `FRR_tipofactura` | `GET /facturasrecibidas/tipos` via `facturas-recibidas-erp-read`. |
| Proveedor | `FRR_idproveedor`, `FRR_idcuenta` | `acreedores`/cache/API. |

Notas:

- Empresa tiene valor inicial `1`, porque la copia solo contiene `CAMPOJOYMA, S.L.`.
- Tipo factura queda vacio si no se conoce.
- Los tipos se muestran como codigo hasta que negocio aporte descripcion oficial.

## Catalogos

### Empresa: `FRR_Idempresa`

Relacion:

```text
empresas.EMP_idempresa = facturasrecibidas.FRR_Idempresa
```

Endpoints:

```text
GET http://172.19.0.1:18000/empresas
GET http://172.19.0.1:18000/empresas/1
```

Valor observado:

| `EMP_idempresa` | Nombre | CIF | Ejercicio predeterminado |
|---:|---|---|---:|
| 1 | CAMPOJOYMA, S.L. | B04493482 | 25 |

### Tipo factura: `FRR_tipofactura`

`FRR_tipofactura` es un codigo corto de tipo/serie interna de factura recibida.

Existe tabla candidata `facturasrecibidastipo`, pero esta vacia en la copia. Por tanto no hay descripciones oficiales cargadas.

Endpoint:

```text
GET http://172.19.0.1:18000/facturasrecibidas/tipos
```

Valores observados:

| `FRR_tipofactura` | Facturas | Fecha min | Fecha max | Descripcion |
|---|---:|---|---|---|
| OT | 30570 | 2013-10-01 | 2026-08-01 | Sin descripcion oficial. |
| GE | 8121 | 2020-01-02 | 2026-06-26 | Sin descripcion oficial. |
| MA | 4919 | 2020-04-27 | 2026-04-07 | Sin descripcion oficial. |
| GV | 2704 | 2020-06-30 | 2026-06-09 | Sin descripcion oficial. |
| FI | 1279 | 2021-06-22 | 2026-04-20 | Sin descripcion oficial. |
| GC | 361 | 2020-08-31 | 2026-06-22 | Sin descripcion oficial. |
| CE | 356 | 2021-08-10 | 2025-10-31 | Sin descripcion oficial. |
| FZ | 308 | 2020-02-08 | 2021-05-20 | Sin descripcion oficial. |
| CX | 14 | 2020-07-30 | 2021-03-03 | Sin descripcion oficial. |
| GM | 8 | 2022-10-31 | 2024-04-30 | Sin descripcion oficial. |
| vacio/null | 1 | 1900-01-01 | 1900-01-01 | Registro historico sin tipo. |

No se ha visto `FRR_tipofactura = "1"` en la copia MariaDB dumpeada. Si aparece `1` en staging/OCR, tratarlo como dato pendiente o confusion con `FRR_Idempresa = 1`.

## Campos principales de factura recibida

| Dato funcional | Campo ERP/Supabase | Origen recomendado |
|---|---|---|
| Empresa | `FRR_Idempresa` | Combo `/empresas`; default practico `1`. |
| Tipo factura | `FRR_tipofactura` | Combo `/facturasrecibidas/tipos`; vacio si no se sabe. |
| Proveedor | `FRR_idproveedor` | API `acreedores`, por NIF o nombre. |
| Cuenta proveedor | `FRR_idcuenta` | API `acreedores`, campo cuenta. |
| Numero proveedor | `FRR_numerofactura` | PDF/IA. |
| Fecha factura | `FRR_fechafactura` | PDF/IA. |
| Fecha contable | `FRR_fechactb` | Normalmente fecha factura, salvo regla de negocio. |
| Base | `FRR_base1` | PDF/IA. |
| IVA % | `FRR_iva1` | PDF/IA. |
| Cuota IVA | `FRR_cuota1` | PDF/IA. |
| Retencion base | `FRR_baseret` | PDF/IA si aparece; si no, 0. |
| Retencion % | `FRR_ret` | PDF/IA si aparece; si no, 0. |
| Retencion importe | `FRR_cuotaret` | PDF/IA si aparece; si no, 0. |
| Total | `FRR_totalfac` | PDF/IA. |
| Concepto | `FRR_Concepto` | PDF/IA, maximo 50 caracteres en staging. |
| Apuntes contables | `facturasrecibidas_ctb` | API/reglas, no IA inventada. |

## Contabilidad y apuntes `ctb`

`facturasrecibidas_ctb` no son lineas de producto. Son apuntes/desglose contable.

Campos principales:

| Campo | Significado |
|---|---|
| `FRC_id` | Id real de apunte en ERP, null en staging hasta POST real. |
| `FRC_idfacturarecibida` | Id real `FRR_id` de cabecera en ERP, null en staging hasta POST real. |
| `FRC_Cuenta` | Cuenta contable. |
| `FRC_Importe` | Importe del apunte. |
| `FRC_IdActividad`, `FRC_Idseccion`, `FRC_Iddepartamento`, `FRC_Idsubdepartamento` | Dimensiones contables. |

Regla actual:

- Si n8n/API devuelve `ctb`, se guarda.
- Si no devuelve `ctb`, se guarda `ctb: []` y warning.
- No se fabrica una linea por defecto con cuenta proveedor + base para el extractor nuevo.

## Caso trazado: `FV26-13`

Datos trazados en copia local:

```text
FRR_id = 49174
FRR_numerofactura = FV26-13
FRR_idproveedor = 1924
Proveedor/agricultor = HORTICOLAS LOS RUBIALES S.L.
AGR_idtipo = 3004
TPA_nombre = EMITEN SU PROPIA FACTURA
```

Cabecera:

| Campo | Valor |
|---|---:|
| `FRR_igasto1` | 15973.30 |
| `FRR_ctagasto1` | 40090001924 |
| `FRR_igasto2` | -1597.33 |
| `FRR_ctagasto2` | 60000000010 |
| `FRR_totalfac` | 14951.01 |

Desglose `facturasrecibidas_ctb`:

| `FRC_Cuenta` | `FRC_Importe` |
|---|---:|
| 40090001924 | 15973.30 |
| 60000000010 | -1597.33 |

Interpretacion:

- `40090001924` parece generarse como `tipoagricultor.TPA_ctapuente = 400900` + id proveedor/agricultor `01924`.
- `60000000010` sale de `tipoagricultor.TPA_cuentagasto1`.
- `tipoagricultor.TPA_valorgasto1 = 10.0000`.
- El importe negativo corresponde al 10%: `15973.30 * 10% = 1597.33`.
- Para este proveedor `acreedores.ACR_Cuentagasto` esta vacio; la cuenta de gasto no sale de acreedores.

Conclusion para implementacion:

- La cuenta de arriba suele ser cuenta puente/proveedor calculada por regla.
- La cuenta `60000000010` es una cuenta configurada en reglas de `tipoagricultor`, no una cuenta elegida por IA.
- No crear combobox manual de cuentas contables mientras no exista maestro descriptivo de plan contable.

## Ejemplos reales utiles

Ejemplos de staging/API usados como referencia:

```text
FCD26/2820  - MONTAJES ELECTRICOS AVILA SL      - 13.884,51
F2026/0195  - LA JABEGA PLAYA, S.L.             - 1.155,61
FV26-13     - CRISTOBAL HUGO RODOLFO            - 14.951,01
01/2026     - TRACTORES RIVAS GONZALEZ SL       - 79.151,52
1 000265    - AGROELIAN, S.L.                   - 13.596,24
```

Ejemplos de llamadas:

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
```

## Validaciones recomendadas

Antes de guardar como `validada`, comprobar:

- `FRR_idproveedor` presente.
- `FRR_numerofactura` presente.
- `FRR_fechafactura` presente.
- `FRR_totalfac` presente.
- `FRR_Idempresa` presente.
- Si hay base/cuota/retencion, total cuadra con tolerancia.
- Si hay proveedor, existe en `acreedores_cache` o API.
- Si hay `FRR_idcuenta`, coincide con cuenta del proveedor cuando la API/cache la conoce.

Si no hay proveedor resuelto:

- Crear factura en `pendiente_revision`.
- Guardar warning visible.
- No inventar proveedor ni cuenta.

Si no hay apuntes contables:

- Guardar `ctb: []`.
- Guardar warning si n8n/API no pudo calcular reglas.
- No fabricar apuntes para el extractor nuevo.

## Decisiones vigentes

- La UI usa `Facturas de compra` como etiqueta principal.
- La pantalla lista facturas de Supabase staging, no historico completo de ERP.
- El historico real solo se consulta para validar, duplicar, buscar proveedor o revisar ejemplos concretos.
- Empresa usa combo real desde `/empresas`.
- Tipo factura usa combo observado desde `/facturasrecibidas/tipos`.
- Tipo factura no tiene descripciones oficiales todavia.
- `FRR_tipofactura = "1"` se considera dato incorrecto/no confirmado.
- n8n devuelve payload listo para `factura-recibida-extraer`, no escribe.
- La Edge Function propia es la unica responsable de guardar en Supabase.

## Pendientes / preguntas a negocio o API

1. Descripcion funcional de codigos `FRR_tipofactura`: `OT`, `GE`, `MA`, `GV`, `FI`, `GC`, `CE`, `FZ`, `CX`, `GM`.
2. Confirmar si `FRR_Idempresa` siempre sera `1` en Campojoyma o si puede haber mas empresas reales.
3. Confirmar endpoint definitivo para reglas proveedor/tipo agricultor con campos:
   - `AGR_idtipo`
   - `TPA_ctapuente`
   - `TPA_cuentagasto*`
   - `TPA_valorgasto*`
4. Confirmar si existira maestro de plan contable con descripcion cuenta -> texto.
5. Definir endpoints POST reales para enviar:
   - cabecera `facturasrecibidas`
   - desglose `facturasrecibidas_ctb`
6. Definir si `FRR_fechactb` debe ser siempre igual a `FRR_fechafactura` o si debe seguir calendario contable.

## Errores a evitar

- No tratar Supabase staging como ERP real.
- No cargar el historico completo de `GET /facturasrecibidas` en la pantalla principal.
- No exponer JWT del webhook en variables `VITE_*`.
- No usar `$json.consulta` en n8n si el webhook recibe `query.consulta`.
- No rellenar `FRR_id` en staging antes de POST real.
- No mezclar facturas de compra con facturas emitidas a clientes.
- No tratar `facturasrecibidas_ctb` como lineas de producto.
- No usar `FRR_tipofactura = "1"` por defecto.
- No inventar cuentas contables desde IA.
- No mantener service role en workflows n8n exportados.

