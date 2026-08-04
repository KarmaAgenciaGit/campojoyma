# Agente v4.3 de extracción de facturas recibidas

La ruta de esta guía se mantiene por compatibilidad. La versión canónica es
v4.3 y sustituye a v4.2.

Artefacto importable:

[`CAMPOJOYMA - Entrada segura de facturas recibidas v4.3 (webhook v2).json`](<CAMPOJOYMA - Entrada segura de facturas recibidas v4.3 (webhook v2).json>)

La exportación queda deliberadamente con `active=false` y el trigger IMAP
desactivado. Generarla no la importa, despliega ni activa en n8n.

## Contratos y autoridad

Hay tres versiones distintas y compatibles:

- `schema_version: 4`: salida documental del modelo.
- `contract_version: 2`: intercambio de extracción entre Edge y n8n.
- contrato ERP `v3`: validación, alta e idempotencia del writer FastAPI.

El modelo solo transcribe lo visible en las imágenes. No tiene tools ERP y no
puede buscar proveedores, regímenes, cuentas ni albaranes. `erp_lookup` sale
siempre como `not_consulted`, sin IDs ni candidatos. Esta separación impide que
un texto hostil dentro del PDF pueda dirigir consultas al ERP.

Después del modelo, `Enriquecer por API Campojoyma` realiza lecturas GET
deterministas. Supabase/Edge vuelve a resolver y validar todos los campos
sensibles antes de persistir. El enlace físico de albaranes y cualquier alta en
Netagro solo ocurren en el writer, nunca en n8n.

## Flujo canónico

1. Recibe exactamente un PDF mediante webhook v2 o email.
2. Valida contrato, UUID, base64, firma `%PDF-` y tamaño antes de decodificar.
3. Calcula SHA-256 y deriva un `request_id` estable cuando no viene informado.
4. Renderiza el PDF y acepta como máximo 30 páginas.
5. Limita cada imagen y el total, y comprueba la firma real JPEG, PNG o WebP.
6. El modelo extrae exclusivamente el contenido documental con esquema 4.
7. El normalizador rechaza cualquier esquema anterior, incluso con `ok=true`.
8. El enriquecedor confirma proveedor y empresa, consulta duplicados, observa
   régimen y gasto histórico y resuelve referencias documentadas.
9. Para webhook devuelve el contrato v2. Para email llama a
   `factura-recibida-ingest` con credencial dedicada. Los fallos de transporte
   se reintentan tres veces con el mismo `request_id`; la idempotencia Edge
   evita crear una segunda factura si la primera respuesta se perdió.

La topología v4.3 tiene 27 nodos y cero `httpRequestTool` conectadas al agente.

## Cuenta y desglose de gasto

No existe una cuenta fija `60200000001` en el flujo.

Tras confirmar el acreedor, n8n consulta de forma informativa:

`GET /facturasrecibidas/cuentas-gasto-historicas`

La propuesta queda únicamente en
`metadata.match_evidence.cuenta_gasto_proposal`, con
`authoritative: false`. No se copia a `FRR_ctagasto*`, `FRR_igasto*` ni
`gastos`.

Edge repite la consulta y solo aplica la cuenta cuando se cumplen todas estas
condiciones:

- misma empresa, proveedor y circuito confirmados;
- al menos tres facturas históricas;
- líder único;
- presencia mínima del 98 %;
- cuenta de exactamente 11 dígitos;
- cuenta existente y no bloqueada en el catálogo;
- respuesta completa y coherente, sin filtros temporales inesperados.

Una distribución manual válida o una regla específica del proveedor se
conservan. Una regla general de empresa no asigna gasto a todos los acreedores.
Si no puede resolverse una pareja cuenta+importe válida, la factura queda en
revisión y `send-erp` la bloquea. Los cuatro importes `0` con cuentas vacías se
consideran slots vacíos y no impiden consultar el histórico.

## Albaranes y punteos

El modelo conserva las referencias externas visibles, pero nunca devuelve IDs
ERP con autoridad.

El enriquecedor:

- admite como máximo 25 referencias;
- consulta `GET /albaranes-gastos/punteables` fuera del modelo;
- usa concurrencia máxima 5 y un presupuesto global de lecturas ERP;
- exige `source_table=albmaterial`, empresa y proveedor exactos;
- solo propone selección si todas las referencias tienen una coincidencia
  exacta, única, completa y uno-a-uno;
- ante una referencia ambigua o incompleta no selecciona ninguna.

Edge repite la comprobación. El writer v3 bloquea y vuelve a comprobar los
punteos dentro de la operación de alta antes de crear los enlaces.

## Límites y variables n8n

- `CAMPOJOYMA_MAX_PDF_BYTES`: por defecto 20 MiB.
- `CAMPOJOYMA_MAX_PDF_PAGES`: por defecto 30.
- `CAMPOJOYMA_MAX_RENDERED_IMAGE_BYTES`: por defecto 10 MiB por página.
- `CAMPOJOYMA_MAX_RENDERED_TOTAL_BYTES`: por defecto 60 MiB.
- `CAMPOJOYMA_ERP_READ_BUDGET_MS`: entre 5 y 25 segundos; por defecto 25.
- `CAMPOJOYMA_API_BASE_URL`: opcional; fallback interno autorizado.
- `CAMPOJOYMA_API_BEARER_TOKEN`: bearer de lectura si la API lo exige.
- `CAMPOJOYMA_EMPRESA_ID`: empresa a validar; fallback 1.
- `CAMPOJOYMA_CARGAR_PUNTEOS`: permite desactivar las lecturas de punteos.

Las credenciales de renderer, OpenAI e ingesta se asignan desde el almacén de
credenciales de n8n. No se admiten secretos literales ni
`$env.HISPATEC_API_KEY`.

## Despliegue

Estado verificado el 4 de agosto de 2026 para la prueba local:

- la migración `20260804115934_stop_global_expense_account_default.sql` está
  aplicada en el proyecto Supabase `CAMPOJOYMA` (`adbprpemmbspntbttziz`);
- están desplegadas y activas las funciones `factura-recibida-extraer` v22,
  `factura-recibida-ingest` v26, `factura-recibida-update` v24 y
  `factura-recibida-send-erp` v29;
- el frontend de este repositorio se ejecuta mediante Vite en
  `http://localhost:8080` y utiliza ese mismo proyecto Supabase;
- no se ha modificado ni desplegado ningún workflow n8n para esta prueba local.

Los pasos siguientes corresponden únicamente a una futura activación del flujo
n8n, no al entorno local actual.

El JSON depende de los cambios Edge v4.3. Antes de activarlo:

1. revisar y aplicar la migración
   `20260804115934_stop_global_expense_account_default.sql`;
2. desplegar `factura-recibida-extraer`, `factura-recibida-ingest`,
   `factura-recibida-update` y `factura-recibida-send-erp`;
3. importar y validar `api-pdf-imagen.json` v2, conservar el webhook
   autenticado `pdf-imagen` y activar este renderer antes del canario;
4. importar el JSON v4.3 conservando o reasignando sus credenciales;
5. verificar las variables y mantener IMAP deshabilitado si no se usará;
6. ejecutar un canario por webhook con una factura ficticia en TEST;
7. comprobar proveedor, gasto, duplicado, albaranes, estado documental y
   bloqueo de envío cuando falte cualquier dato;
8. activar el workflow solo después de esa prueba E2E.

La activación de escritura de Netagro es un gate separado. Importar este flujo
no habilita `write_mode` ni la contabilización.

La ruta de producción preparada es el webhook v2. El trigger IMAP permanece
deshabilitado: antes de habilitarlo hay que asignar en n8n un workflow de error
o alerta sanitizada para los fallos que agoten los tres reintentos, sin guardar
el PDF ni los datos completos de la factura en el historial de ejecuciones.

## Regeneración y validación

```powershell
node scripts/generate_safe_factura_workflow.mjs "RUTA_AL_EXPORT_N8N.json"
node scripts/harden_pdf_renderer_workflow.mjs
node scripts/validate_pdf_renderer_workflow.mjs
node scripts/validate_factura_workflow_v4.mjs
npm run test:edge
npx tsc --noEmit
npm run build
```

El generador elimina `pinData`, fuerza `active=false`, reconstruye la topología
permitida y debe producir el mismo SHA-256 en ejecuciones repetidas.

La exportación v4.2 queda solo como histórico y no debe reactivarse.
