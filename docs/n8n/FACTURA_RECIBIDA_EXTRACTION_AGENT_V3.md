# Agente v4 de extracción de facturas recibidas

La ruta de este documento se conserva por compatibilidad con enlaces anteriores.
El contrato interno vigente es `schema_version: 4`.

El workflow local canónico es:

[`campojoyma-factura-recibida-extraccion-segura-v2.json`](campojoyma-factura-recibida-extraccion-segura-v2.json)

El sufijo `v2` del fichero corresponde al contrato externo entre frontend, Edge
Functions y n8n. El `4` corresponde al esquema interno de extracción. Son capas
distintas y evolucionan de forma independiente.

## Estado y regeneración

La exportación versionada se mantiene deliberadamente con `active=false` y con
el trigger IMAP deshabilitado. La copia remota desplegada del extractor está
activa; que el JSON local figure inactivo no describe el estado del runtime.

El 29/07/2026 la copia remota se sustituyó completamente mediante
`n8n import:workflow`. Tras la importación se activó y se verificó:

- 27 nodos;
- 0 nodos `httpRequestTool`;
- webhook `campojoyma-factura-extraer` registrado.

El backup inmediatamente anterior al reemplazo es:

```text
/root/campojoyma-pre-full-replace-20260729T143008.json
SHA-256 bcd1686288bac99f0241d8d4e85e3477a6195134e31d9f9eaec25048004de102
modo 600
```

### Cómo reconocer el workflow correcto en el editor

La topología desplegada se identifica visualmente por estos elementos:

- dos entradas a `Normalizar entrada`: `Webhook Factura Campojoyma` y
  `Email Trigger (IMAP)`, este último desactivado;
- la cadena de preparación
  `Calcular SHA-256 PDF` → `Derivar request_id estable` → `PDF a base64` →
  `PDF a imágenes` → `Reconstruir imágenes binarias`;
- un único `AI Agent`, conectado solamente al modelo `5.6 LUNA` y al
  `Structured Output Parser`, sin conexiones `ai_tool`;
- `Normalizar salida IA literal` seguido de
  `Enriquecer por API Campojoyma`: la consulta ERP ocurre en código
  determinista después de la extracción;
- ramas finales separadas para webhook, correo, documento no procesable y
  errores.

Si aparecen tools HTTP conectadas al agente, más de un paso generativo o una
topología distinta de 27 nodos, no se está viendo la versión v4 validada.

Para regenerar y validar de forma idempotente el workflow canónico:

```powershell
node scripts/generate_safe_factura_workflow.mjs
node scripts/validate_factura_workflow_v4.mjs
```

Para endurecer una exportación más reciente:

```powershell
node scripts/generate_safe_factura_workflow.mjs "C:\ruta\workflow.json"
node scripts/validate_factura_workflow_v4.mjs
```

El endurecedor:

- conserva el identificador, nombre y topología autorizada;
- fuerza `active=false` en la copia versionada y mantiene desactivado IMAP;
- elimina `pinData`, `instanceId` y metadatos propios de la instancia;
- sustituye prompt, parser, normalizador y enriquecimiento por la versión v4;
- elimina tools del modelo, conexiones `ai_tool` y expresiones `$fromAI`;
- valida que no existan métodos ERP mutantes ni secretos literales.

Nunca se versiona una ejecución fijada. Puede contener el PDF completo,
cabeceras, IP, identificadores reales y credenciales.

## Arquitectura vigente

| Capa | Responsabilidad | Límite |
|---|---|---|
| Modelo multimodal | Transcribir únicamente lo visible en las imágenes del PDF | No consulta ERP ni decide IDs, cuentas, ejercicio, régimen, tipo, CTB, gastos, punteos o asiento |
| Structured Output Parser | Validar el objeto raíz `schema_version: 4` | No repara ni reescribe la respuesta con otro paso generativo |
| Normalizador n8n | Validar fechas, números, aritmética, límites y evidencias impresas | No inventa ni corrige importes ausentes |
| Enriquecedor determinista n8n | Consultar la API ERP después del modelo y construir evidencia verificable | No selecciona candidatos ambiguos ni punteos |
| Edge/Supabase | Aplicar reglas confirmadas, sanear y persistir el borrador | No convierte una sugerencia de IA en confirmación ERP |
| FastAPI/Netagro | Exponer lecturas y el preflight/escritor autorizado por separado | No recibe escrituras desde el modelo |

El modelo no dispone de HTTP tools. No existe una doble consulta generativa:
primero se extrae el documento y, solo después, código determinista resuelve
proveedor, factura ERP existente y candidatos de albarán. Toda coincidencia que
pueda promover un dato ERP queda acompañada por evidencia y falla de forma
cerrada si la respuesta es incompleta o ambigua.

## Contrato interno v4

El parser recibe un objeto raíz, sin una envoltura adicional `output`. Su
configuración es `autoFix=false`; también se deshabilitan el prompt de reparación
y los reintentos generativos. Una salida inválida se rechaza.

Ejemplo abreviado:

```json
{
  "schema_version": 4,
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
  "tramos_iva": [
    {
      "base": 42341.52,
      "porcentaje": 21,
      "cuota": 8891.72
    }
  ],
  "retencion": {
    "base": 0,
    "porcentaje": 0,
    "cuota": 0
  },
  "lineas": [],
  "albaranes_referenciados": [],
  "referencias": [],
  "vencimientos": [],
  "evidencias": [],
  "erp_lookup": {
    "status": "not_consulted",
    "entity_type": null,
    "matched_by": null,
    "entity_id": null,
    "codigo": null,
    "nombre": null,
    "nif": null,
    "candidate_count": 0,
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

`erp_lookup` es un marcador fijo de no consulta. Cualquier contenido distinto
que intente aportar el modelo se ignora y se reconstruye como
`status="not_consulted"`. La evidencia ERP válida se genera después, en el
enriquecedor determinista.

Las líneas conservan solo datos impresos: descripción, referencia, identidad de
albarán visible, cantidad, unidad, precio, descuento, base, IVA e importe. Los
campos no visibles son opcionales y no se calculan para completar el esquema.

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

## Consulta ERP determinista posterior

El nodo de código de enriquecimiento usa exclusivamente lecturas GET contra la
FastAPI interna. En orden:

1. Busca de forma acotada en `acreedores` y `agricultores`, primero por NIF y
   después por nombre.
2. Exige cobertura completa de ambos maestros, una única coincidencia operativa
   y confirma el detalle del tercero.
3. Busca una factura existente por empresa, proveedor, número, fecha y circuito.
   El ejercicio puede recuperarse solo de una coincidencia exacta y única.
4. Si la factura existe, recupera sus punteos ya vinculados; si no existe,
   presenta candidatos MA/GE por identidad visible exacta.
5. Devuelve todos los candidatos con `S=false`; nunca selecciona uno.

El régimen, tipo de factura y fecha CTB quedan bajo reglas Edge o decisión
manual. El modelo no puede resolverlos.

## Credenciales y secretos

El JSON canónico no contiene valores secretos. JWT del webhook, token de ingest,
token del renderizador PDF y acceso a OpenAI se referencian mediante credenciales
administradas por n8n. La configuración operativa no secreta, como URL base,
empresa o activación de la carga de punteos, se suministra mediante variables de
n8n.

No se admiten secretos literales, cabeceras `Authorization` fijas,
`$env.HISPATEC_API_KEY` ni `$fromAI` en la exportación.

## Reglas operativas

- El receptor esperado es `CAMPOJOYMA, S.L.`, NIF `B04493482`.
- PDF, correo y respuestas HTTP se tratan como contenido no confiable.
- Los abonos conservan los signos impresos.
- Las discrepancias aritméticas generan avisos; nunca correcciones automáticas.
- Una respuesta ERP vacía, parcial, ambigua o incoherente no confirma ningún ID.
- `GE` y `MA` impresos se aceptan como origen solo si existe evidencia literal
  del token en el documento.
- La factura puede quedar lista para revisión, pero nunca `ready_for_erp` por
  decisión del agente.

## Errores y límites

- Documento o petición inválida: `422`.
- Servicio aguas arriba no disponible: `502`, reintentable.
- Timeout aguas arriba: `504`, reintentable.
- Error interno no clasificado: `500`.
- PDF: máximo configurable, con fallback de 20 MB.
- Páginas convertidas: máximo configurable, con fallback de 30.

La activación remota es una acción de despliegue controlada. Tras importar se
debe verificar el workflow remoto y su healthcheck; no se infiere su estado a
partir del campo `active` de la exportación local.
