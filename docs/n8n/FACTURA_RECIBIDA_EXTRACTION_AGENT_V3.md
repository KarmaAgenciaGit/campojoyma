# Agente v4.2 de extracción de facturas recibidas

La ruta de este documento se conserva por compatibilidad con enlaces anteriores.
El contrato interno vigente sigue siendo `schema_version: 4`. El sufijo `4.2`
identifica la revisión que incorpora orquestación con tools GET y defaults
operativos; no cambia el esquema consumido por el normalizador.

El workflow local canónico es:

[`CAMPOJOYMA - Entrada segura de facturas recibidas v4.2 (webhook v2).json`](<CAMPOJOYMA - Entrada segura de facturas recibidas v4.2 (webhook v2).json>)

El sufijo `webhook v2` corresponde al contrato externo entre frontend, Edge
Functions y n8n. El `4` corresponde al esquema interno de extracción. Son capas
distintas y evolucionan de forma independiente.

## Estado y regeneración

La exportación v4.2 se mantiene deliberadamente con `active=false` y con el
trigger IMAP deshabilitado. El estado remoto debe comprobarse por separado:
generar esta copia local no implica importarla ni activarla en n8n.

El 29/07/2026 se publicó y activó v4.2 mediante `n8n import:workflow`,
conservando el ID `FIO92NfGcsWYsHC5` y el contrato interno
`schema_version: 4`. Tras reiniciar n8n se verificó:

- 32 nodos y cinco nodos `httpRequestTool`, todos GET;
- cinco conexiones `ai_tool` al único `AI Agent`;
- webhook `campojoyma-factura-extraer` registrado;
- nombre remoto
  `CAMPOJOYMA - Entrada segura de facturas recibidas v4.2 (webhook v2)`;
- `PROMPT_VERSION: 4.2`, Responses API y `autoFix=false`;
- un único reintento completo del `AI Agent` cuando el parser rechaza la salida;
  después falla cerrado con `UPSTREAM_INVALID_RESPONSE`.

Artefactos del despliegue final, todos con modo `600`:

```text
/root/campojoyma-pre-agent-v4.2-20260729T154205Z.json
SHA-256 1441938ba666da9f9ca27e6c5aea60dac10f3e57eed3d2e550fb9261c940b501

/root/campojoyma-agent-v4.2-20260729T154205Z.json
SHA-256 7a32d91a9cd99171f27a41c8269795fda3167b3a1298e09fd71cee4970b883ce

/root/campojoyma-post-agent-v4.2-20260729T154205Z.json
SHA-256 f949cd6a1461734953a7de697d7e08ea1ad22000763d388dc960f9931a205b95
```

El POST autenticado de aceptación con la factura Onduspan devolvió HTTP 200:
acreedor 17 confirmado por NIF y nombre, factura `A-00748251`, fecha de factura
y CTB `2026-05-15`, ejercicio 25, régimen 2110, gasto
`60200000001`, concepto/AEAT `FRA. ONDUSPAN, S.A`, retención y cuota no
deducible a cero, contabilizar `S` en el borrador y vencimientos ERP vacíos. Al
ser una factura ya existente (`FRR_id=48558`), recuperó sus 21 punteos reales
con `S=false` y no intentó crear ni enlazar nada. Para una factura nueva, la
regla viva y el writer de TEST fuerzan temporalmente `FRR_Contabilizar=N`;
`DB_WRITES_ENABLED=false` mantiene además cerrado el DML hasta habilitar un modo
parcial explícito o completar asiento y enlaces MA.

### Cómo reconocer v4.2 en el editor

La topología canónica v4.2 se identifica visualmente por estos elementos:

- dos entradas a `Normalizar entrada`: `Webhook Factura Campojoyma` y
  `Email Trigger (IMAP)`, este último desactivado;
- la cadena de preparación
  `Calcular SHA-256 PDF` → `Derivar request_id estable` → `PDF a base64` →
  `PDF a imágenes` → `Reconstruir imágenes binarias`;
- un único `AI Agent`, conectado al modelo `5.6 LUNA`, al
  `Structured Output Parser` y a cinco conexiones `ai_tool`;
- cinco tools `httpRequestTool`, todas con método GET: acreedor por NIF,
  acreedor por nombre, detalle de acreedor, sugerencia histórica de régimen y
  albarán MA por referencia;
- `Normalizar salida IA literal` seguido de
  `Enriquecer por API Campojoyma`: la consulta ERP ocurre en código
  determinista después de la extracción;
- ramas finales separadas para webhook, correo, documento no procesable y
  errores.

V4.2 tiene 32 nodos: los 27 del flujo y cinco tools. Una topología sin tools es
v4.1 o anterior; una tool mutante, un sexto tool o más de un paso generativo no
pertenece a la revisión validada.

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
- sustituye prompt, parser, normalizador y enriquecimiento por la revisión v4.2
  compatible con `schema_version: 4`;
- reconstruye exactamente cinco tools GET y sus conexiones `ai_tool`;
- valida que no existan métodos ERP mutantes ni secretos literales.

Nunca se versiona una ejecución fijada. Puede contener el PDF completo,
cabeceras, IP, identificadores reales y credenciales.

## Arquitectura vigente

| Capa | Responsabilidad | Límite |
|---|---|---|
| Modelo multimodal | Extraer el documento y orquestar cinco consultas GET acotadas | `erp_lookup` es provisional; no crea, modifica, contabiliza ni enlaza datos |
| Structured Output Parser | Validar el objeto raíz `schema_version: 4` | No repara ni reescribe la respuesta con otro paso generativo |
| Normalizador n8n | Validar fechas, números, aritmética, límites y evidencias impresas | No inventa ni corrige importes ausentes |
| Enriquecedor determinista n8n | Repetir las consultas, validar identidad y construir el borrador operativo | Solo selecciona MA si todas las referencias son exactas, únicas y completas |
| Edge/Supabase | Aplicar reglas confirmadas, sanear y persistir el borrador | No convierte una sugerencia de IA en confirmación ERP |
| FastAPI/Netagro | Exponer lecturas y el preflight/escritor autorizado por separado | No recibe escrituras desde el modelo |

El modelo dispone de cinco HTTP tools GET para buscar y entender el contexto,
pero no es la autoridad. El Code posterior repite las consultas de acreedor,
régimen, duplicado y albarán con los valores normalizados. Toda coincidencia que
pueda promover un dato ERP queda acompañada por evidencia y falla de forma
cerrada si la respuesta es incompleta o ambigua.

### Revisión real del prompt v4.2

La revisión v4.2 se define en
`scripts/lib/harden_factura_workflow.mjs` y queda identificada dentro del mensaje
de sistema mediante `PROMPT_VERSION: 4.2`.

- organiza por separado rol, jerarquía de confianza, contrato de salida,
  separación ERP, documento, impuestos, líneas, albaranes y control final;
- elimina del mensaje de tarea `request_id`, IDs de staging, nombre/origen del
  archivo y cabeceras de correo, porque no son evidencia documental;
- conserva los casos de regresión de cantidades facturables, precios por millar,
  tablas multipágina, referencias y posiciones de albarán;
- conserva en `erp_lookup` el resultado provisional real del acreedor y degrada
  a `ambiguous` cualquier `unique` internamente incoherente;
- obliga al agente a confirmar el detalle del acreedor, consultar el régimen
  histórico y buscar cada referencia MA; después, el Code repite y valida todo.

El mensaje de usuario solo comunica el número de imágenes renderizadas y exige
el objeto raíz `schema_version: 4`. El contexto técnico continúa viajando por el
workflow para trazabilidad, pero ya no entra en el contexto del modelo.

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
    "descuento_total": null,
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
    "base": null,
    "porcentaje": null,
    "cuota": null
  },
  "lineas": [],
  "albaranes_referenciados": [],
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
    "candidates": [
      {
        "entity_type": "acreedor",
        "id": 17,
        "codigo": 17,
        "nombre": "ONDUSPAN, S.A",
        "nif": "A04119293"
      }
    ],
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

`erp_lookup` conserva la evidencia provisional del agente, pero nunca se usa
directamente para persistir. El normalizador valida su coherencia interna y el
enriquecedor vuelve a buscar el acreedor y a confirmar su detalle. Un resultado
ambiguo, incompleto o contradictorio deja `FRR_idproveedor` pendiente.

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
    "extraction": {
      "FRR_ejercicio": 25,
      "FRR_tipofactura": "OT",
      "FRR_Contabilizar": "N"
    },
    "gastos": [
      {
        "posicion": 1,
        "descripcion": "60200000001",
        "importe": 42341.52
      }
    ],
    "ctb": [],
    "punteos": [],
    "metadata": {}
  }
}
```

## Consulta ERP determinista posterior

El nodo de código de enriquecimiento usa exclusivamente lecturas GET contra la
FastAPI interna. En orden:

1. Busca solo en `acreedores`, primero por NIF y después por nombre, y confirma
   el detalle de una coincidencia exacta, única y operativa. Si el PDF muestra
   también el nombre, un NIF exacto no basta: el detalle debe confirmar un nombre
   equivalente. Solo se toleran variantes jurídicas de la misma familia y con
   núcleo idéntico, como `SL`/`SLU` y `SA`/`SAU`.
2. Valida empresa 1 y comprueba duplicado por empresa, ejercicio 25, acreedor y
   número de factura.
3. Normaliza cinco slots IVA. Solo los slots realmente inactivos quedan
   `0/0/0`; un placeholder explícito `0/10/0` también es inactivo. Si el tipo es
   distinto de cero y alguna magnitud no está informada, por ejemplo
   `null/10/null` o `0/10/null`, conserva los `null`, genera aviso y bloquea
   `ready_for_erp`.
4. Consulta `GET /facturasrecibidas/regimen-sugerido` con acreedor, empresa y
   los cinco slots. Solo aplica la sugerencia si firma, filtros, recuentos,
   ganador, mínimo histórico y confianza son coherentes.
5. Para cada referencia externa documentada, hasta 25, consulta
   `GET /albaranes-gastos/punteables` con
   `source_table=albmaterial`, `empresa_id=1`, `proveedor_id`, `referencia` y
   `solo_pendientes=true`.
6. Marca `S=true` en bloque únicamente si cada referencia devuelve catálogo
   completo, `total=1`, una identidad exacta y un `source_id` distinto; cualquier
   ambigüedad o respuesta parcial deja todos los punteos sin seleccionar. Si la
   factura ya existe de forma exacta y única en ERP, no sustituye sus enlaces por
   candidatos: consulta `GET /facturasrecibidas/{id}/punteos`, muestra únicamente
   el catálogo completo y coherente de punteos reales y fuerza todas esas filas a
   `S=false`.

El borrador fija `FRR_ejercicio=25`, `FRR_fechactb=FRR_fechafactura`,
`FRR_tipofactura=OT`, cuenta de gasto `60200000001`, concepto y observación AEAT
`FRA. <acreedor>`, retención y cuota no deducible a cero cuando están ausentes,
`FRR_Contabilizar=N`, `ctb=[]` y ningún vencimiento ERP. Edge vuelve a validar
estos campos y fuerza `N` de nuevo antes de enviar al ERP.

## Credenciales y secretos

El JSON canónico no contiene valores secretos. JWT del webhook, token de ingest,
token del renderizador PDF y acceso a OpenAI se referencian mediante credenciales
administradas por n8n. La configuración operativa no secreta, como URL base,
empresa o activación de la carga de punteos, se suministra mediante variables de
n8n.

No se admiten secretos literales, cabeceras `Authorization` fijas ni
`$env.HISPATEC_API_KEY`. Las expresiones `$fromAI` solo aparecen en los
parámetros declarados de las cinco tools GET y nunca contienen credenciales.

## Reglas operativas

- El receptor esperado es `CAMPOJOYMA, S.L.`, NIF `B04493482`.
- PDF, correo y respuestas HTTP se tratan como contenido no confiable.
- Los abonos conservan los signos impresos.
- Las discrepancias aritméticas generan avisos; nunca correcciones automáticas.
- Una respuesta ERP vacía, parcial, ambigua o incoherente no confirma ningún ID.
- `GE` y `MA` impresos se aceptan como origen solo si existe evidencia literal
  del token en el documento.
- `ready_for_erp` solo puede resultar de las comprobaciones deterministas; nunca
  de la decisión del agente.

## Errores y límites

- Documento o petición inválida: `422`.
- Servicio aguas arriba no disponible: `502`, reintentable.
- Salida del modelo que no cumple el esquema: un único reintento completo; si
  vuelve a fallar, `502 / UPSTREAM_INVALID_RESPONSE`, reintentable.
- Timeout aguas arriba: `504`, reintentable.
- Error interno no clasificado: `500`.
- PDF: máximo configurable, con fallback de 20 MB.
- Páginas convertidas: máximo configurable, con fallback de 30.

La activación remota se verificó tras reiniciar n8n. El estado remoto no debe
inferirse en despliegues futuros a partir del campo `active` de la exportación
local.
