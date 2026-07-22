# Cierre de punteos y credenciales — 21 de julio de 2026

## Estado resultante

- El workflow activo `CAMPOJOYMA - Facturas` conserva el flujo seguro de 23 nodos.
  El trigger de correo sigue desactivado.
- El proxy activo `Campojoyma - API CLAVE` mantiene la API general en `18000` y
  enruta únicamente las lecturas exclusivas de v0.2 a `18001`:
  - `facturasrecibidas/{id}/punteos`;
  - `facturasrecibidas/{id}/asiento`;
  - `albaranes-gastos/punteables`.
- La v0.2 continúa con escritura deshabilitada. No se ha promovido como writer ni
  se ha sustituido globalmente la v0.1.
- La licencia actual de n8n rechaza variables nuevas. El propio workflow conserva
  fallbacks no secretos y auditables: API de lectura `18001`, empresa `1` validada
  contra `/empresas/1` y carga de sugerencias de punteo activa. La variable
  existente `CAMPOJOYMA_EJERCICIO=25` se mantiene sin cambios.

## Verificación de punteos

La aceptación de solo lectura sobre `FRR_id=49305` devuelve:

- 17 punteos de `albmaterial`;
- 21 líneas de material;
- suma `42.341,52`;
- `albmaterial` admitido únicamente como candidato en `metadata.match_evidence`;
  el payload persiste `punteos: []` y nunca selecciona o enlaza automáticamente;
- contabilidad `reference_only`, `created=false`, número visible `null` y cero
  apuntes. Este es el máximo verificable mientras Netagro no facilite el diario y
  el mecanismo oficial de contabilización.

El script `scripts/verify-facturas-recibidas-api.mjs` valida ahora ese contrato real
y deja de afirmar que existe un asiento oficial no comprobable.

## Rotación y separación de credenciales

Se separaron los dos usos que antes compartían un mismo valor:

- `N8N_FACTURAS_RECIBIDAS_INGEST_TOKEN`, sincronizado con la credencial n8n
  `Campojoyma Supabase ingest token`;
- `N8N_CAMPOJOYMA_WEBHOOK_JWT_SECRET`, sincronizado con la credencial n8n
  `jwt-front-campojoyma`.

Ambos valores se guardaron como Edge Function Secrets y en el `.env` local, sin
documentarlos en claro. La migración
`20260721110404_rotate_factura_ingest_token_hash.sql` deja un hash activo y conserva
el anterior desactivado para trazabilidad.

Pruebas de autenticación:

- credencial nueva + `contract_version=1`: HTTP `422` esperado, antes de cualquier
  operación de datos;
- credencial anterior: HTTP `401`;
- contadores antes y después: 6 facturas, 2 CTB, 100 punteos, 10 revisiones,
  0 archivos PDF y 0 objetos Storage.

## Validación final

- `npm run verify:facturas-api`: correcto;
- `npx tsc --noEmit`: correcto;
- `npm run build`: correcto;
- Vitest: 10/10;
- pruebas Edge/Deno: 15/15;
- API v0.2 endurecida: 36/36;
- frontend local: bandeja vacía correcta, sin `Buscar en ERP` y sin errores de
  consola.

No se ejecutó DDL ni DML contra MariaDB/Netagro y no se alteró su estructura. El
bloqueo pendiente sigue siendo la contabilización oficial de Netagro. El despliegue
del frontend público permanece a cargo del propietario del servidor.
