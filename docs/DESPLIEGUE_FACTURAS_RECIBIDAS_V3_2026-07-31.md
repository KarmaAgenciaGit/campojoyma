# Despliegue seguro de facturas recibidas v3

Fecha de ejecución: **31 de julio de 2026**.

Este documento registra el estado realmente desplegado. No implica que las
altas en Netagro estén habilitadas: el runtime permanece deliberadamente en
solo lectura hasta completar el clon persistente, la identidad de dataset, el
almacén de idempotencia v2 y los gates de homologación.

## Resultado

```text
Frontend local actualizado
  -> Supabase
  -> Edge Functions
  -> HTTPS autenticado
  -> FastAPI 0.3.1
  -> MariaDB TEST en solo lectura
```

Quedaron comprobadas las lecturas autenticadas de catálogos y facturas. No se
ejecutó ningún `commit`, alta, punteo, actualización de contador ni operación
contable.

## Identidad del artefacto API

- Repositorio: `KarmaAgenciaGit/api-campojoyma`.
- Commit funcional:
  `ba96ba9ee34bd16840e5494585b8ffa107c2897a`.
- Commit de release:
  `95547bde4edd5dffcbffe3eb06e8906b893a1a43`.
- Versión FastAPI: `0.3.1`.
- Contrato de escritura: `3`.
- Artefacto:
  `api-campojoyma-v0.3.1-20260731T100912Z-95547bde4edd.tar.gz`.
- SHA-256 del artefacto:
  `f830d58194de0a13653c3186b03c51c470720a81a091a3f666e99c7e990298d6`.
- OpenAPI sincronizado:
  [`openapi/netagro-test-api-v0.3.1.json`](openapi/netagro-test-api-v0.3.1.json).
- SHA-256 del OpenAPI:
  `e48bf0bfd6c2359a6d19a1fc7de1918b1476540f4532647f582545228ce2f61a`.

El paquete se verificó en un entorno virtual limpio antes de activarlo: 196
pruebas correctas, `pip check`, `compileall` y OpenAPI 0.3.1 con 46 rutas y
47 operaciones. El JSON vivo y el candidato tienen el mismo SHA-256 canónico:
`99e5cf01bb23fdc40d9755fb76626f4e3b4598eec9ab893d82fa98887f57527b`.

## FastAPI en `karma-box`

- Servicio: `netagro-api-v2.service`.
- Ruta estable:
  `/home/karma/releases/api-campojoyma-current/staging/v0.2.0`.
- Release activa:
  `/home/karma/releases/api-campojoyma-v0.3.1-20260731T100912Z-95547bde4edd`.
- Entorno externo:
  `/home/karma/.config/netagro-api-v2/runtime.env`, modo `0600`.
- Lock compartido por cron y despliegues:
  `/home/karma/.config/netagro-api-v2/maintenance.lock`, modo `0600`.
- Backup previo de la disposición del servicio:
  `/home/karma/backups/api-campojoyma/service-layout-pre-v031-20260731T101112Z`.
- Rollback inmediato:
  `/home/karma/releases/api-campojoyma-v0.3.0-20260731T103855-1c9a343c6fb2`.

La unidad dejó de depender del antiguo drop-in `20-v030.conf` y ahora usa el
symlink estable y un único entorno externo. La activación no alteró ni migró el
SQLite heredado. El runtime no llega a validarlo mientras falte la identidad
del target; por eso informa `schema_version=null`, no `1`.

Un primer empaquetado `v0.3.1-20260731T100628Z-ba96ba9ee34b` falló el manifiesto
por finales de línea y nunca se activó. Se conserva como evidencia; el release
promovido se generó después de fijar LF reproducible.

Estado leído de `/meta/runtime`:

| Campo | Valor |
|---|---|
| `write_mode` | `disabled` |
| `accounting_mode` | `unavailable` |
| `target_id` | `null` |
| `dataset_epoch` | `null` |
| `idempotency_store.ready` | `false` |
| `idempotency_store.schema_version` | `null` |
| `ready_for_commit` | `false` |
| validación ERP | deshabilitada |
| alta de gestión | deshabilitada |
| contabilización | deshabilitada |

Las credenciales heredadas de escritura se retiraron del entorno de esta
release. El lector superó el gate real de grants y la empresa 1 se resuelve de
forma explícita al esquema contable autorizado. No se ejecutó DDL en Netagro.

## Writer histórico v0.1 retirado del camino operativo

La auditoría confirmó que el proceso histórico de `127.0.0.1:8000` conservaba
el writer antiguo con `MAX(...)+1`, aunque no podía abrir la conexión porque
había cargado `DB_WRITES_ENABLED=false`. Para que su seguridad no dependa solo
de ese flag:

- se retiraron de su `.env` las credenciales `DB_WRITE_*`, conservando backup;
- sus fuentes en disco se sustituyeron por la variante cuyo POST responde
  siempre `410 writer_disabled` y que no contiene conexión DML;
- se creó `netagro-api-v1-reader.service` en `127.0.0.1:8002`;
- se comprobaron los mismos 40 GET y el `410` del POST;
- el túnel `:18000` del VPS se redirigió a `:8002`, también desde
  `172.19.0.1`, por lo que n8n conserva las lecturas y ya no alcanza el proceso
  antiguo;
- la clave de túnel dejó de autorizar `permitopen` hacia `8000`; solo conserva
  `8001` y `8002`.

El proceso de sistema de `:8000` sigue activo y ligado únicamente a localhost
hasta que un operador con privilegios en `karma-box` pueda reiniciarlo o
retirarlo. No está expuesto por el VPS, sus fuentes y entorno quedan seguros
para el siguiente arranque y no debe volver a conectarse al túnel.

Backups principales:

- `/home/karma/backups/api-campojoyma/legacy-v01-env-pre-hardening-20260731T092414Z`;
- `/home/karma/backups/api-campojoyma/legacy-v01-pre-readeronly-20260731T092612Z`;
- `/root/backups/netagro-api-tunnel/pre-readeronly-20260731T093035Z`.

## Gateway HTTPS

- URL: `https://netagro-api-v2.srv894901.hstgr.cloud`.
- Directorio VPS: `/root/netagro-api-gateway`.
- Contenedor: `netagro-api-gateway`.
- Imagen: `nginx:1.28.3-alpine`.
- Túnel de destino: `netagro-api-v2-tunnel.service`, puerto `18001`.

Se comprobó:

- certificado TLS confiable;
- `/gateway-health` con respuesta `200`;
- ausencia o error de credencial con respuesta `401`;
- credencial correcta alcanzando FastAPI 0.3.1;
- `/meta/runtime` conservando escrituras y contabilidad apagadas.

El valor del secreto no se registra en Git ni en esta documentación.

## Supabase Edge

Proyecto: `CAMPOJOYMA` (`adbprpemmbspntbttziz`).

| Función | Versión | Verificación JWT |
|---|---:|---|
| `facturas-recibidas-erp-runtime` | 1 | sí |
| `facturas-recibidas-erp-read` | 19 | sí |
| `factura-recibida-extraer` | 19 | sí |
| `factura-recibida-ingest` | 23 | no; exige el token propio del agente |
| `factura-recibida-update` | 21 | sí |
| `factura-recibida-send-erp` | 25 | sí |

La función de lectura v19 incorpora una compatibilidad transitoria y cerrada:
si el frontend histórico consulta exactamente `cuentas-contables` sin
`empresa_id`, Edge añade `empresa_id=1`. No reemplaza valores explícitos, no
acepta `account_schema` y FastAPI continúa derivando y validando el esquema.

La copia anterior a este despliegue se conserva fuera de Git en:

`C:\Users\Moises-Karma\Desktop\Karmabox\Karmabox\Automatizaciones\Repositorios\campojoyma\.codex-logs\deployments\2026-07-31\supabase-edge-pre-v3-20260731T104900.zip`

SHA-256 del archivo:
`ec1b6d8344eec08882487d382bc8c16fa6652cc12ab0426e632bf065b88350e7`.

## Frontend

### Local

El frontend actualizado quedó construido y servido en
`http://localhost:8080`:

- contenedor: `campojoyma`;
- imagen:
  `sha256:eafc1442a2de36638b49df541a7f326dacf7180e4a5da4e8a230dc75996b39b0`;
- bundle JavaScript: `index-BN9BAZcy.js`;
- TypeScript correcto;
- 135/135 pruebas Vitest correctas;
- build de producción correcto.

En una sesión autenticada se comprobó:

- estados separados de documento, registro ERP y contabilidad;
- `Validar con ERP` y `Enviar a gestión ERP (sin contabilizar)` deshabilitados
  mientras el runtime no está preparado;
- contabilización deshabilitada y explicada como no disponible;
- IVA como desplegable con 0 %, 4 %, 10 % y 21 %;
- cuentas de gasto y CTB mediante el mismo combobox remoto;
- búsqueda real por cuenta o descripción y paginación;
- detalle completo sin respuestas HTTP fallidas.

La línea CTB creada durante la prueba solo existió en el estado local del
navegador. No se pulsó `Guardar` y no se persistió ningún cambio.

### Producción

`https://campojoyma.multiplicaxfuego.com` continúa sirviendo el frontend
anterior:

- DNS: `217.154.101.108`;
- bundle publicado: `index-BMzeM2s7.js`;
- bundle local nuevo: `index-BN9BAZcy.js`.

La compatibilidad Edge v19 elimina el error de catálogo del frontend antiguo,
pero no convierte ese bundle en la interfaz v3. La factura de prueba sigue
mostrando el mensaje histórico del webhook escritor desactivado porque ese
texto está guardado en el registro; no es un fallo del gateway actual.

No se pudo publicar el build nuevo porque:

- `217.154.101.108` rechaza la clave Hostinger disponible;
- la cuenta Hostinger comprobada solo muestra los VPS `82.25.119.113` y
  `82.25.119.150`;
- el panel alternativo de proyectos requiere una clave de entrada no
  disponible.

Por tanto, el backend está desplegado de forma segura y el frontend actualizado
está listo y probado localmente, pero la liberación pública E2E queda pendiente
de acceso autorizado al host del dominio.

## Gates superados

- API: 196 pruebas, OpenAPI 0.3.1 y smoke real de lectura.
- Edge: 98 pruebas Deno, 19 pruebas estáticas y descarga posterior de v19
  idéntica a las tres fuentes locales desplegadas.
- Frontend: TypeScript, 135 pruebas y build correctos.
- Gateway: TLS, health, rechazo sin credencial y lectura autenticada.
- Producción histórica: el catálogo contable vuelve a cargar sin el 422
  observado antes de Edge v19; FastAPI registró
  `GET /cuentas-contables?limit=100&empresa_id=1` con `200`.

No se ejecutó `verify:facturas-api` con el `.env` local porque no contiene las
dos variables privadas del gateway. La misma ruta se verificó directamente
contra FastAPI, por HTTPS y finalmente desde una sesión autenticada de Edge.

## Deuda técnica no introducida por este rollout

- Vite avisa de que el chunk principal supera 500 kB.
- `npm audit --omit=dev` informa 1 vulnerabilidad moderada, 11 altas y ninguna
  crítica en el árbol de producción. Entre las dependencias directas afectadas
  aparecen `postcss`, `react-router-dom` y `xlsx`; esta última no ofrece arreglo
  automático en el informe actual.

No se ejecutó `npm audit fix` porque mezclar actualizaciones de dependencias con
este despliegue cambiaría el alcance y, en el caso de `xlsx`, no resolvería el
hallazgo. Debe abrirse una revisión de dependencias separada antes de otorgar
una homologación general de seguridad al frontend.

## Pendientes antes de habilitar altas

1. Provisionar un clon persistente independiente.
2. Fijar `target_id`, `dataset_epoch` y fecha de snapshot.
3. Migrar explícitamente el almacén externo de idempotencia a v2.
4. Ejecutar la alta oficial de observación para fijar usuario y punteos.
5. Superar canario, concurrencia, inyección de fallos y readback.
6. Publicar el frontend nuevo en el host autorizado.
7. Mantener la contabilidad apagada hasta disponer del mecanismo oficial.

Ninguno de estos pendientes autoriza a habilitar `DB_WRITES_ENABLED` por sí
solo.

## Rollback seguro

1. Confirmar que `DB_WRITES_ENABLED=false`; no tocar MariaDB.
2. Si se revierte Edge, desplegar las fuentes archivadas en orden inverso y
   comprobar cada versión antes de continuar.
3. Retirar consumidores del gateway y después, en
   `/root/netagro-api-gateway`, ejecutar:

   ```bash
   docker compose --env-file .env down
   ```

4. En `karma-box`, bajo el lock de mantenimiento y con escrituras confirmadas
   como apagadas, cambiar atómicamente
   `/home/karma/releases/api-campojoyma-current` al release de rollback y
   reiniciar `netagro-api-v2.service`.
5. Verificar `/health`, la versión restaurada y escrituras apagadas.

No se revierten migraciones Supabase, no se borran intentos o referencias y no
se ejecuta DDL/DML manual en Netagro como parte del rollback.
