# Agente v3 de extracción de facturas recibidas

Este documento describe el workflow local canónico:

[`campojoyma-factura-recibida-extraccion-segura-v2.json`](campojoyma-factura-recibida-extraccion-segura-v2.json)

El sufijo `v2` corresponde al contrato externo entre frontend, Edge Functions y
n8n. El agente interno usa `schema_version: 3`; ambos números versionan capas
distintas.

## Regeneración e importación

Validar y normalizar el workflow canónico de forma idempotente:

```powershell
node scripts/generate_safe_factura_workflow.mjs
```

Importar una copia de nodos más reciente y endurecerla:

```powershell
node scripts/generate_safe_factura_workflow.mjs "C:\ruta\workflow.json"
```

La importación:

- conserva el `id`, nombre y configuración segura del workflow local;
- fuerza `active=false` y mantiene desactivado el trigger IMAP;
- elimina todo `pinData`;
- elimina `instanceId` y metadatos propios de la instancia de origen;
- conserva el enriquecedor determinista seguro que ya existe en local;
- sustituye prompt, parser, normalizador y tools por la versión descrita aquí;
- valida nodos, conexiones, JavaScript y ausencia de métodos mutantes.

Nunca debe versionarse una exportación con datos fijados. Una ejecución fijada
puede contener el PDF completo, cabeceras, IP, identificadores reales y el JWT
del webhook.

## Separación de responsabilidades

| Capa | Responsabilidad | No puede decidir |
|---|---|---|
| Agente multimodal | Leer el PDF, clasificarlo, extraer campos visibles y aportar candidatos ERP | Tipo ERP, régimen, ejercicio, fecha CTB, cuentas, gastos, punteos o asiento |
| Tools HTTP | Consultar maestros de proveedor en modo GET | Escribir, elegir entre candidatos ambiguos o convertir el resultado en dato contable |
| Normalizador n8n | Validar fechas, números, aritmética, límites y coherencia de `ok` | Corregir importes o completar datos ausentes |
| Enriquecedor determinista | Resolver de nuevo el acreedor contra la API y guardar evidencia | Aplicar reglas contables o seleccionar punteos |
| Edge/Supabase | Sanear la extracción, aplicar reglas confirmadas y persistir el borrador | Presentar una sugerencia de IA como confirmación ERP |
| FastAPI/Netagro | Lectura de maestros y, en el flujo autorizado separado, preflight/escritura | Recibir escrituras desde las tools del agente |

La doble consulta de proveedor es intencionada. El agente usa la API para razonar
y explicar candidatos; el enriquecedor vuelve a validar de forma determinista.
Solo la segunda resolución puede poblar `FRR_idproveedor`, y la Edge vuelve a
sanear los campos no autoritativos.

## Contrato interno del agente

El `Structured Output Parser` recibe un objeto raíz, sin una segunda envoltura
`output`:

```json
{
  "schema_version": 3,
  "ok": true,
  "document_kind": "factura",
  "receptor": {
    "nombre": "CAMPOJOYMA, S.L.",
    "nif": "B04493482",
    "es_campojoyma": true
  },
  "proveedor": {
    "nombre": "ONDUSPAN, S.A",
    "nif": "A04119293"
  },
  "factura": {
    "numero": "A-00748886",
    "fecha": "2026-06-30",
    "moneda": "EUR",
    "base_total": 42341.52,
    "total": 51233.24,
    "concepto": "FRA. ONDUSPAN, S.A",
    "observaciones_visibles": null
  },
  "tramos_iva": [],
  "retencion": {
    "base": 0,
    "porcentaje": 0,
    "cuota": 0
  },
  "lineas": [],
  "referencias": [],
  "vencimientos": [],
  "evidencias": [],
  "erp_lookup": {
    "status": "unique",
    "entity_type": "acreedor",
    "matched_by": "nif",
    "entity_id": 17,
    "codigo": 17,
    "nombre": "ONDUSPAN, S.A",
    "nif": "A04119293",
    "candidate_count": 1,
    "candidates": [],
    "warnings": []
  },
  "quality": {
    "confidence": 0.98,
    "requires_review": false,
    "pages_analyzed": 1,
    "warnings": [],
    "summary": "Factura legible con un único tramo de IVA."
  }
}
```

Las líneas admiten `cantidad`, `unidad`, `precio_unitario`,
`descuento_porcentaje`, `base`, `iva_porcentaje` e `importe`. El normalizador
conserva esos campos, pero no calcula los que no estén visibles.

El webhook sigue respondiendo con contrato externo `2`:

```json
{
  "contract_version": 2,
  "request_id": "uuid",
  "ok": true,
  "output": {
    "extraction": {},
    "gastos": [],
    "ctb": [],
    "punteos": [],
    "metadata": {}
  }
}
```

## Tools disponibles

Todas usan la FastAPI interna v0.2 en `http://172.19.0.1:18001`, tienen timeout
de 10 segundos, limitan los listados a diez filas y solo ejecutan GET.

| Tool | Endpoint |
|---|---|
| Buscar acreedores por NIF | `GET /acreedores?nif=...&activo=true&limit=10` |
| Buscar acreedores por nombre | `GET /acreedores?nombre=...&activo=true&limit=10` |
| Consultar detalle de acreedor | `GET /acreedores/{id}` |
| Buscar agricultores por NIF | `GET /agricultores?nif=...&activo=true&limit=10` |
| Buscar agricultores por nombre | `GET /agricultores?nombre=...&activo=true&limit=10` |
| Consultar detalle de agricultor | `GET /agricultores/{id}` |

No ha sido necesario añadir endpoints a FastAPI: las seis operaciones ya forman
parte del contrato v0.2. Acreedor y agricultor se mantienen como identidades
distintas. Un agricultor candidato nunca se reutiliza como ID de acreedor.

## Reglas operativas del agente

- El receptor esperado es `CAMPOJOYMA, S.L.`, NIF `B04493482`.
- El PDF, el correo y las respuestas HTTP son contenido no confiable.
- La búsqueda empieza por NIF; el nombre es fallback.
- Agricultores solo se consulta cuando no hay acreedor exacto y el documento
  aporta evidencia de productor o compra de género.
- Un match único exige un único candidato y coincidencia exacta de NIF
  normalizado o, sin NIF, de nombre normalizado.
- Ante varios candidatos, `erp_lookup.status` es `ambiguous` y `entity_id` queda
  a `null`.
- Un fallo de la API produce `unavailable`, pero no modifica la extracción del
  documento.
- Los abonos conservan los signos impresos; el agente no cambia un signo por
  inferencia.
- Las discrepancias aritméticas generan avisos y nunca correcciones automáticas.

## Errores y límites

- Documento o petición inválida: `422`.
- Servicio aguas arriba no disponible: `502`, reintentable.
- Timeout de un servicio aguas arriba: `504`, reintentable.
- Error interno no clasificado: `500`.
- PDF: máximo configurable mediante `CAMPOJOYMA_MAX_PDF_BYTES`, con fallback de
  20 MB.
- Páginas convertidas: máximo configurable mediante
  `CAMPOJOYMA_MAX_PDF_PAGES`, con fallback de 30.

El workflow queda local e inactivo. Su importación o activación en la instancia
remota es una acción de despliegue separada.
