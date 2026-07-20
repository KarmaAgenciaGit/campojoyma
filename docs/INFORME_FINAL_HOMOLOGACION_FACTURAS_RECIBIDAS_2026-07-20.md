# Informe final de homologación técnica — Facturas recibidas

**Fecha de cierre técnico:** 20 de julio de 2026

**Proyecto Supabase:** `CAMPOJOYMA` (`adbprpemmbspntbttziz`)

**Repositorios:** `campojoyma` y `KarmaAgenciaGit/api-campojoyma`

**Entorno ERP utilizado:** copia MariaDB de pruebas de Netagro

**Despliegue público del frontend:** fuera de alcance; lo realiza Moisés

## 1. Resultado ejecutivo

La homologación técnica de facturas recibidas v2 queda completada en local y en el
entorno controlado de pruebas:

- el frontend compila y sus pruebas pasan;
- Supabase conserva la migración v2 y la función de envío está activa en versión 8;
- la API FastAPI v0.2 está aislada de la v0.1, usa idempotencia externa
  preprovisionada y queda con escrituras deshabilitadas;
- se realizó una única alta ficticia, sin contabilización, en la copia de pruebas;
- la lectura posterior confirmó la misma factura y la idempotencia impidió tanto el
  duplicado como la reutilización del UUID con otro payload;
- n8n volvió a quedar desactivado y con su configuración conservadora;
- no se ejecutó ninguna operación DDL ni se modificó la estructura de Netagro.

La factura ficticia se conserva deliberadamente para auditoría. No se ha eliminado
porque la autorización recibida permitía el alta controlada, pero exigía consultar
antes de cualquier limpieza.

Quedan fuera de este cierre:

1. el despliegue público del frontend, responsabilidad de Moisés;
2. el lockdown final de Supabase, que no debe aplicarse hasta comprobar el frontend
   público nuevo;
3. la contabilización real, bloqueada hasta que Netagro proporcione un endpoint y
   readback oficiales o se apruebe expresamente otra operativa.

## 2. Punto exacto donde se detuvo Claude

La conversación local de Claude revisada es:

- título: `Verificación técnica facturas recibidas`;
- archivo fuente:
  `C:\Users\Moises-Karma\.claude\projects\C--Users-Moises-Karma-Desktop-Karmabox-Karmabox-Automatizaciones-Repositorios-campojoyma\f06b0898-f249-4d59-a78f-db947544a9bc.jsonl`;
- `localSessionId`: `local_1eac47e1-eac8-47a5-a3b5-a841df543aa0`.

Claude se detuvo por límite de uso inmediatamente después de desplegar
`factura-recibida-send-erp` v8. En ese momento había dejado preparado el entorno,
pero todavía no había ejecutado ni confirmado una factura real de extremo a extremo.

El estado heredado era:

- API endurecida y publicada en `729bf1e`;
- v0.2 aislada en `/home/karma/fastapi-netagro-v02-20260720`, puerto local `8001`
  y túnel por el VPS en `18001`;
- v0.1 conservada en `8000`/`18000`;
- SQLite de idempotencia provisionado fuera de Netagro;
- usuario restringido y factura ficticia ya creados en Supabase;
- workflow de escritura n8n preparado para una ventana controlada;
- Edge Function v8 activa;
- ningún `POST` real confirmado contra MariaDB.

## 3. Arquitectura verificada

```text
Frontend React local
        │
        ▼
Supabase (estado, RPC y Edge Function v8)
        │  JWT firmado
        ▼
n8n write v2, activado solo durante la prueba
        │
        ▼
FastAPI v0.2 aislada (túnel 18001 → 8001)
        ├── SQLite externo de idempotencia
        └── MariaDB Netagro TEST, estructura inmutable
```

La v0.1 se mantuvo separada. La v0.2 fue el único writer lógico durante la ventana
de prueba y volvió a `DB_WRITES_ENABLED=false` al terminar.

## 4. Cambios realizados después del relevo

### 4.1 Frontend

Se corrigió un bloqueo de reintentos en `src/services/facturas.ts`. El mapeo de la
factura mezclaba `erp_error`, que es el error histórico del intento anterior, con
`validation_errors`, que son los bloqueos vigentes. Como consecuencia, una factura
que había recibido un HTTP 422 no podía reintentarse aunque sus datos ya fueran
válidos.

Ahora:

- `validation_errors` contiene únicamente validaciones activas;
- `erp_error` sigue visible como historial;
- una factura corregida puede reintentarse;
- existe una prueba de regresión específica en `src/services/facturas.test.ts`.

### 4.2 Contrato Supabase → n8n → FastAPI

La Edge Function y el código compartido pasaron a emitir el contrato v2 estricto:

- `contract_version=2`;
- `request_id` UUID;
- `dry_run` booleano;
- `cabecera`, `ctb` y `punteos`;
- sin los campos temporales v1 `operation` y `factura`;
- sin IDs ni campos de log que genera el propio ERP.

La función `factura-recibida-send-erp` está desplegada en versión 8, estado
`ACTIVE`, con `verify_jwt=true`.

### 4.3 API FastAPI v0.2

El repositorio `api-campojoyma` quedó limpio y sincronizado con `origin/main`:

| Commit | Contenido |
|---|---|
| `729bf1e` | Idempotencia fail-closed, gate de grants y readback estricto |
| `306cb5a` | Omisión de valores `None` para respetar defaults existentes de MariaDB |
| `a4bdc53` | Reconciliación verificada de escrituras ambiguas |

La API no crea ni migra estructuras al importar, arrancar o atender una petición.
El SQLite se abre en modo existente y fue preparado explícitamente fuera de
Netagro. Si falta o no tiene el esquema esperado, el servicio falla cerrado antes
de abrir una conexión de escritura a MariaDB.

La reconciliación incorporada en `a4bdc53` solo puede completar una petición si:

- las escrituras están deshabilitadas;
- se proporciona el payload original exacto;
- el hash coincide con la reserva ambigua;
- existe exactamente una factura con la identidad esperada;
- el readback completo coincide;
- únicamente se actualiza el SQLite externo, nunca MariaDB.

### 4.4 n8n

El workflow de escritura utilizado fue `4wu0VF2RiwT4eyJC` en la instancia
`n8nbecarios.srv894901.hstgr.cloud`. Se activó solo durante la prueba y después se
restauró a:

- `active=false`;
- `saveDataErrorExecution=none`;
- `saveDataSuccessExecution=none`;
- `saveManualExecutions=false`;
- `saveExecutionProgress=false`.

Los hashes de nodos y conexiones permanecieron iguales a los del artefacto local
desactivado. El conector n8n disponible en la sesión final apunta a otra instancia,
`n8n.srv792815.hstgr.cloud`; por eso consultar allí el ID anterior devuelve 404 y
no constituye evidencia de que el workflow de becarios haya desaparecido.

## 5. Prueba E2E controlada

### 5.1 Datos de prueba

| Campo | Valor |
|---|---|
| Supabase `facturasrecibidas.id` | `5eceef7a-ab8f-4da4-9200-c7334e02e89b` |
| Referencia | `E2E-20260720-50CA89` |
| Proveedor Netagro TEST | `2095` |
| Total | `1,21 €` |
| Contabilizar | `N` |
| CTB | 0 líneas |
| Punteos | 0 líneas |

Antes de abrir la escritura se comprobó que la referencia era exclusiva de la
fixture, no había asiento solicitado y no existía otro ID remoto asociado.

### 5.2 Primer intento real

- `request_id`: `25512af3-37b9-4851-b6c0-9e5a48abf950`;
- dry-run: correcto;
- commit: HTTP 500;
- causa: MariaDB rechazó `ImporteVto=NULL` porque la columna existente no admite
  nulos;
- efecto: no se creó ninguna factura.

Se corrigió la API para omitir campos `None` y permitir que MariaDB aplique sus
defaults ya existentes, sin modificar el esquema.

### 5.3 Segundo intento y escritura ambigua

- `request_id`: `96bd0c9d-c1af-4777-a38e-45bb003991cb`;
- dry-run: correcto;
- la transacción creó una única factura;
- la respuesta terminó en HTTP 503 `readback_unconfirmed` porque los defaults
  devueltos por MariaDB (`0`, cadena vacía o fecha cero) no coincidían literalmente
  con los `None` omitidos por el cliente;
- el diario quedó en `needs_reconciliation` y el consumidor no reintentó a ciegas.

La búsqueda posterior confirmó exactamente una fila:

| Campo | Valor confirmado |
|---|---|
| `FRR_id` | `49399` |
| `FRR_numero` | `5146` |
| `FRR_numerofactura` | `E2E-20260720-50CA89` |
| `FRR_totalfac` | `1,21` |
| Contabilidad | no solicitada |
| CTB | 0 |
| Punteos | 0 |

### 5.4 Reconciliación e idempotencia

Se ajustó el readback para no exigir igualdad literal en columnas que el payload
omitió expresamente y cuyos defaults genera MariaDB. Después se ejecutó la
herramienta de reconciliación con las escrituras apagadas y el payload original.

Resultados:

- reconciliación verificada: correcta;
- replay idéntico con `DB_WRITES_ENABLED=false`: HTTP 200 y devuelve los mismos
  `FRR_id=49399` y `FRR_numero=5146` sin abrir una nueva escritura;
- mismo UUID con un payload alterado: HTTP 409;
- búsqueda final por referencia: una sola fila.

### 5.5 Estado final en Supabase

Comprobado de nuevo el 20 de julio:

| Campo | Valor final |
|---|---|
| `estado` | `enviada_erp` |
| `sync_status` | `sent` |
| `accounting_status` | `not_requested` |
| `row_version` | `11` |
| `last_request_id` | `96bd0c9d-c1af-4777-a38e-45bb003991cb` |
| `FRR_id` | `49399` |
| `FRR_numero` | `5146` |
| `FRR_numerofactura` | `E2E-20260720-50CA89` |
| `FRR_totalfac` | `1.21` |
| `FRR_Contabilizar` | `N` |
| `erp_error` | `null` |

## 6. Garantías de seguridad respetadas

- No se ejecutó `CREATE`, `ALTER`, `DROP`, `TRUNCATE` ni ninguna otra operación DDL
  contra Netagro.
- No se intentaron probar permisos mediante una operación mutante.
- Los grants se comprueban mediante `SHOW GRANTS` y el runtime falla ante DDL,
  `ALL PRIVILEGES`, scopes no permitidos, roles o `GRANT OPTION`.
- El almacenamiento de idempotencia está fuera de Netagro y se provisiona de forma
  explícita.
- La API falla cerrado si ese almacenamiento falta o es incompatible.
- La prueba no solicitó contabilización, no creó asiento, no creó CTB ni enlazó
  punteos.
- La escritura se habilitó solo en la v0.2 aislada y se apagó en bloques de salida
  garantizada incluso cuando fallaron comprobaciones previas.
- No se eliminó la fila de pruebas ni ningún dato material.

Al terminar se borraron del VPS cuatro copias temporales exactas de despliegue y
reconciliación bajo `/tmp`:

- `api-campojoyma-main-306cb5a.py`;
- `api-main-a4bdc53.py`;
- `api-reconcile-a4bdc53.py`;
- `reconcile-96bd0c9d.json`.

Eran copias efímeras y no son recuperables desde `/tmp`; el código canónico está en
Git, los scripts desplegados permanecen en la instalación v0.2 y la respuesta de
auditoría permanece en los stores correspondientes. No se eliminaron backups ni la
factura de prueba.

## 7. Validaciones ejecutadas

| Componente | Validación | Resultado |
|---|---|---|
| Frontend | `npx tsc --noEmit` | correcto |
| Frontend | Vitest dirigido | 8/8 |
| Frontend | `npm run build` | correcto; aviso heredado de tamaño de chunk |
| Edge compartida | Deno tests | 13/13 |
| API v0.2 | pytest | 36/36 |
| API v0.2 | OpenAPI | `0.2.0`, 41 paths, 42 operaciones |
| API v0.2 | parche reproducible | aplica limpio; manifest de 34 ficheros válido |
| Supabase | fila final y Edge Functions | comprobado |
| Idempotencia | replay y conflicto | HTTP 200 / HTTP 409 correctos |

La auditoría remota final de solo lectura confirmó además:

- v0.1 sana en `18000`, OpenAPI `0.1.0`, 40 rutas y 41 operaciones;
- v0.2 sana en `18001`, OpenAPI `0.2.0`, 41 rutas y 42 operaciones;
- MariaDB `11.8.6` en `karma-box`;
- v0.2 con `writes_enabled=false`;
- idempotencia `ready=true`, esquema 1 y sin error;
- directorio del store `0700` y SQLite `0600`, ambos `karma:karma`;
- gate `scripts/check_mariadb_grants.py`: grants dentro de la allowlist;
- una única factura E2E, con `FRR_IdAsientoNet=0`, sin CTB, sin punteos y sin
  entradas contables.

La comprobación de grants utilizó exclusivamente `SHOW GRANTS`. Esta auditoría no
ejecutó DDL, DML ni cambios de servicios, archivos o datos.

La evidencia visual local tomada antes del envío se conserva en
`docs/evidencias/facturas-recibidas-e2e-20260720/01-frontend-borrador-antes-envio.png`.
No se publica automáticamente porque la captura también contiene datos operativos
de otras facturas. El estado posterior al envío se verificó por Supabase, por el
readback de la API y por el replay idempotente. No hay captura final del navegador
porque el navegador integrado bloqueó después el acceso a `localhost` por su política
de URL.

## 8. Estado de cada una de las tres partes

| Parte | Estado | Acción restante |
|---|---|---|
| Frontend | Código local terminado, probado y compilado | Moisés despliega el bundle público y hace el smoke visual |
| Supabase | Migración v2 aplicada, fixture finalizada y Edge v8 activa | Corregir el secreto del webhook si sigue duplicando la URL de lectura; aplicar lockdown solo tras el despliegue público |
| API/Netagro TEST | v0.2 endurecida, probada, reconciliada y con writes apagados | Mantener TEST estructuralmente inmutable; promover solo con un único writer y store persistente compartido |

## 9. Pendientes reales y orden de cierre operativo

1. Desplegar el frontend público desde la rama/commit acordados. Esta acción la hace
   Moisés y no requiere acceso SSH del agente que realizó esta homologación.
2. Ejecutar un smoke visual autenticado contra el frontend público nuevo, sin crear
   una segunda factura.
3. Confirmar en Supabase que `N8N_CAMPOJOYMA_WRITE_WEBHOOK_URL` apunta al webhook v2
   de escritura. La Edge v8 contiene un fallback seguro para la configuración
   actualmente duplicada, pero el secreto debe corregirse en origen.
4. Aplicar y verificar el lockdown de Supabase únicamente después de confirmar que
   el frontend nuevo ya no depende de las políticas antiguas.
5. Mantener el workflow n8n de escritura desactivado y la API con
   `DB_WRITES_ENABLED=false` fuera de una ventana controlada.
6. Decidir si se conserva o se elimina la fixture `FRR_id=49399`. Cualquier limpieza
   requiere autorización explícita y deberá usar DML acotado, nunca cambios de
   estructura.
7. No activar `FRR_Contabilizar=S` hasta disponer del endpoint oficial de Netagro y
   de una lectura posterior que confirme el asiento.

## 10. Criterio de relevo

El siguiente técnico no debe repetir la factura ficticia. La prueba ya existe y su
idempotencia está confirmada. Para continuar debe partir de estos hechos:

- API fuente: `api-campojoyma@a4bdc53`;
- Edge de envío: versión 8;
- factura TEST: `FRR_id=49399`, `FRR_numero=5146`;
- request canónico: `96bd0c9d-c1af-4777-a38e-45bb003991cb`;
- n8n write: desactivado;
- API v0.2 writes: desactivadas;
- frontend público y lockdown: pendientes deliberadamente;
- contabilización: bloqueo externo, no defecto pendiente de código local.

Este informe sustituye el estado operativo descrito en los informes del 17 de julio;
aquellos documentos siguen siendo útiles para la trazabilidad histórica de las
conversaciones, pero no deben utilizarse como fotografía actual del despliegue.
