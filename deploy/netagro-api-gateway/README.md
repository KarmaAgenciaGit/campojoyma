# Gateway HTTPS de Netagro API

Este contenedor publica el FastAPI de pruebas a través del Traefik ya existente
del VPS. Es únicamente un proxy autenticado:

`Supabase Edge -> HTTPS/Traefik -> nginx -> túnel 172.19.0.1:18001 -> FastAPI`

No contiene lógica de facturas, no conecta con MariaDB y no habilita escrituras.
El modo de escritura sigue gobernado por `DB_WRITES_ENABLED` en FastAPI.

## Estado desplegado: 2026-07-31

- Directorio operativo: `/root/netagro-api-gateway`.
- Contenedor: `netagro-api-gateway`.
- Imagen: `nginx:1.28.3-alpine`.
- URL: `https://netagro-api-v2.srv894901.hstgr.cloud`.
- Destino: túnel `172.19.0.1:18001`.
- FastAPI: `0.3.1`, contrato de escritura `3`.
- Escrituras: `write_mode=disabled`.
- Contabilidad: `accounting_mode=unavailable`.

La credencial se mantiene únicamente en los entornos operativos de gateway,
FastAPI y Supabase Edge. No debe imprimirse al verificar el servicio.

## Precondiciones

- El túnel `netagro-api-v2-tunnel.service` debe escuchar en
  `172.19.0.1:18001`.
- Debe existir la red Docker externa `traefik_net`.
- El DNS `netagro-api-v2.srv894901.hstgr.cloud` debe apuntar al VPS.
- FastAPI, este gateway y Supabase deben compartir un secreto hexadecimal
  generado fuera del repositorio.

## Instalación

Crear un directorio operativo exclusivo en el VPS y copiar `compose.yml` y
`default.conf.template`. Crear allí un `.env` con modo `0600`:

```text
NETAGRO_API_SHARED_SECRET=<secreto>
```

Validar antes de arrancar:

```bash
docker compose --env-file .env config --quiet
docker compose --env-file .env up -d
docker compose ps
```

Configurar después estos secretos de Supabase:

```text
CAMPOJOYMA_API_V2_BASE_URL=https://netagro-api-v2.srv894901.hstgr.cloud
CAMPOJOYMA_API_V2_SHARED_SECRET=<mismo secreto>
```

Una petición sin `X-Netagro-Api-Key` obtiene `401`. La URL
`/gateway-health` solo comprueba el contenedor; no consulta FastAPI ni Netagro.
`/meta/runtime` sí consulta FastAPI y requiere autenticación.

## Verificación y rollback

Verificar primero que el acceso sin secreto falla y luego que `/health` y
`/meta/runtime` responden con el secreto. Deben informar
`write_mode=disabled` y `accounting_mode=unavailable`.

El rollback consiste en ejecutar `docker compose down` en este directorio y
restaurar los secretos Edge anteriores. No modifica datos, facturas, contadores
ni referencias ERP.
