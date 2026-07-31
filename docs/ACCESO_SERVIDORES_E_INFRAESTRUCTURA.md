# Acceso a servidores e infraestructura de Campojoyma

Última comprobación: **2026-07-31**.

Este documento es la referencia operativa para localizar cada servicio, acceder a
los servidores y evitar confundir el VPS de integración con el equipo que aloja la
API y la MariaDB de pruebas.

No contiene contraseñas ni material privado de claves. Las claves se referencian
por su ruta. No deben copiarse al repositorio.

## Resumen directo

```text
Equipo local Windows
  |
  | SSH con %USERPROFILE%\.ssh\id_ed25519_hostinger
  v
VPS de integración: root@82.25.119.150
  nombre: srv894901
  servicios: n8n, PostgreSQL de n8n, documentación y túneles SSH
  |
  | SSH con /root/.ssh/netagro_api_tunnel_ed25519
  v
Servidor de pruebas: karma@88.30.71.235:2222
  nombre: karma-box
  servicios: FastAPI v1/v2 y MariaDB de pruebas
```

La ruta canónica de acceso es:

```text
equipo local -> 82.25.119.150 -> 88.30.71.235:2222
```

El acceso directo desde el equipo local a `88.30.71.235:2222` puede agotar el
tiempo de espera aunque la API esté funcionando. En ese caso no se debe concluir
que `karma-box` está caído: hay que entrar primero al VPS y realizar el segundo
salto desde allí.

## Inventario

| Capa | Host o identificador | Acceso | Función |
|---|---|---|---|
| Frontend público | `217.154.101.108` | No confirmado con la clave Hostinger disponible | Publicación web; no confundir con el VPS de integración. |
| Gateway HTTPS Netagro | `netagro-api-v2.srv894901.hstgr.cloud` | HTTPS con secreto fuera de Git | Entrada autenticada de Edge hacia FastAPI; no contiene lógica de negocio. |
| Supabase | `CAMPOJOYMA` (`adbprpemmbspntbttziz`) | Conector Supabase o Dashboard | Backend de trabajo, Auth, Storage y Edge Functions. |
| VPS de integración | `82.25.119.150` / `srv894901` | `root`, SSH 22 | n8n, PostgreSQL, documentación y túneles hacia `karma-box`. |
| Servidor de pruebas | `88.30.71.235:2222` / `karma-box` | `karma`, preferiblemente desde el VPS | FastAPI y copia MariaDB de pruebas. |
| MariaDB original | `192.168.1.91:3306` | Solo procedimientos controlados de lectura/dump | Origen Netagro. No usar para pruebas ni escrituras. |

## Acceso al VPS de integración

Desde PowerShell en el equipo local:

```powershell
$sshKey = "$env:USERPROFILE\.ssh\id_ed25519_hostinger"
ssh -i $sshKey -o BatchMode=yes root@82.25.119.150
```

Comprobación rápida sin abrir una sesión interactiva:

```powershell
$sshKey = "$env:USERPROFILE\.ssh\id_ed25519_hostinger"
ssh -i $sshKey -o BatchMode=yes root@82.25.119.150 `
  'hostname; systemctl is-active netagro-api-tunnel.service; curl -fsS http://127.0.0.1:18000/health'
```

Resultado esperado:

```text
srv894901
active
{"status":"ok","database":{"ok":1,"db_host":"karma-box",...}}
```

### n8n

Contenedor activo comprobado:

```text
n8nbecarios-n8n-1
docker.n8n.io/n8nio/n8n:1.123.20
```

Comandos de solo lectura:

```bash
docker ps --format '{{.Names}} | {{.Image}} | {{.Status}}'
docker logs --tail 100 n8nbecarios-n8n-1
docker exec n8nbecarios-n8n-1 n8n --version
```

URL pública de n8n:

```text
https://n8nbecarios.srv894901.hstgr.cloud
```

Webhook de lectura Campojoyma:

```text
https://n8nbecarios.srv894901.hstgr.cloud/webhook/apiCampojoyma?consulta=...
```

El webhook requiere el JWT configurado por el proyecto. Las variables locales
están en `.env`; no se deben imprimir ni copiar a documentación.

## Acceso a `karma-box`

Una vez dentro de `root@82.25.119.150`:

```bash
ssh -i /root/.ssh/netagro_api_tunnel_ed25519 \
  -p 2222 \
  -o BatchMode=yes \
  karma@88.30.71.235
```

Comprobación de un solo paso desde el VPS:

```bash
ssh -i /root/.ssh/netagro_api_tunnel_ed25519 \
  -p 2222 \
  -o BatchMode=yes \
  karma@88.30.71.235 hostname
```

Resultado esperado:

```text
karma-box
```

La clave `/root/.ssh/netagro_api_tunnel_ed25519` está en el VPS. No está en este
repositorio y no debe descargarse salvo una decisión operativa explícita.

## FastAPI y túneles

```text
n8n dentro de Docker
  -> http://172.19.0.1:18000
  -> túnel netagro-api-tunnel.service en el VPS
  -> karma-box 127.0.0.1:8002
  -> FastAPI v1 de solo lectura; writer retirado con HTTP 410
  -> MariaDB de pruebas

n8n/VPS
  -> http://172.19.0.1:18001 o http://127.0.0.1:18001
  -> túnel netagro-api-v2-tunnel.service en el VPS
  -> karma-box 127.0.0.1:8001
  -> FastAPI 0.3.2, contrato de escritura v3
  -> MariaDB de pruebas + almacén externo de idempotencia

Supabase Edge
  -> https://netagro-api-v2.srv894901.hstgr.cloud
  -> Traefik + contenedor netagro-api-gateway en el VPS
  -> http://172.19.0.1:18001
  -> FastAPI 0.3.2 en karma-box
```

| API | VPS | `karma-box` | Estado comprobado el 2026-07-31 |
|---|---|---|---|
| v1 lectura | `127.0.0.1:18000` y `172.19.0.1:18000` | `127.0.0.1:8002` | `netagro-api-v1-reader.service` sano; 40 GET conservados y POST retirado con `410 writer_disabled`. |
| v2/v3 | `127.0.0.1:18001` y `172.19.0.1:18001` | `127.0.0.1:8001` | FastAPI 0.3.2 sana; escrituras desactivadas, contabilidad no disponible e idempotencia no preparada (`schema_version=NULL`). |

Comprobaciones desde el VPS:

```bash
systemctl is-active netagro-api-tunnel.service
systemctl is-active netagro-api-v2-tunnel.service
curl -fsS http://127.0.0.1:18000/health
curl -fsS http://127.0.0.1:18001/health
```

Comprobaciones desde `karma-box`:

```bash
systemctl --user is-active netagro-api-v2.service
systemctl --user status netagro-api-v2.service --no-pager
systemctl --user is-active netagro-api-v1-reader.service
ss -lntp | grep -E ':8000|:8001|:8002'
ps -eo pid,lstart,cmd | grep -E '[u]vicorn|[f]astapi-netagro'
```

Rutas desplegadas comprobadas:

```text
/home/karma/fastapi-netagro
/home/karma/releases/api-campojoyma-v01-readeronly-20260731T092612Z
/home/karma/fastapi-netagro-v02-20260720
/home/karma/releases/api-campojoyma-current
/home/karma/releases/api-campojoyma-v0.3.2-20260731T105738Z-29effcccaccf
/home/karma/releases/api-campojoyma-v0.3.1-20260731T100912Z-95547bde4edd
```

El servicio de sistema histórico continúa en `127.0.0.1:8000`, sin exposición
desde el VPS. Sus credenciales `DB_WRITE_*` se retiraron, conserva
`DB_WRITES_ENABLED=false` y las fuentes en disco ya contienen el writer
neutralizado. Su proceso actual no debe volver a exponerse; el reinicio o
retirada definitiva requiere un operador con privilegios en `karma-box`. La
clave del túnel solo admite ahora `permitopen` hacia `8001` y `8002`.

La release `0.3.2` se activa mediante el symlink estable:

```text
/home/karma/releases/api-campojoyma-current
  -> /home/karma/releases/api-campojoyma-v0.3.2-20260731T105738Z-29effcccaccf
```

Corresponde al commit de release `29effcccaccf` y al cambio funcional
`060484b`. El artefacto
`api-campojoyma-v0.3.2-20260731T105738Z-29effcccaccf.tar.gz` tiene SHA-256
`d8d1c52cbb2bb0e0f4be282e5fb5300ac7848e59695f82ada7db5d7f44da687b`.

La unidad consume el entorno externo
`/home/karma/.config/netagro-api-v2/runtime.env`; el antiguo drop-in
`20-v030.conf` ya no forma parte de la configuración activa.

Backup reversible previo y releases de rollback:

```text
/home/karma/backups/api-campojoyma/service-layout-pre-v031-20260731T101112Z
/home/karma/releases/api-campojoyma-v0.3.1-20260731T100912Z-95547bde4edd  # rollback inmediato de 0.3.2
/home/karma/releases/api-campojoyma-v0.3.0-20260731T103855-1c9a343c6fb2
```

La fuente de trabajo prevista de FastAPI es el repositorio local
`KarmaAgenciaGit/api-campojoyma`. Si contiene cambios sin commit o push, su
working tree es la autoridad concreta; este repositorio conserva contrato,
OpenAPI, workflows y una copia sincronizada del parche.

## Gateway HTTPS de la API

El gateway desplegado está en:

```text
/root/netagro-api-gateway
```

Comprobaciones desde el VPS:

```bash
cd /root/netagro-api-gateway
docker compose --env-file .env ps
curl -fsS https://netagro-api-v2.srv894901.hstgr.cloud/gateway-health
```

El contenedor esperado es `netagro-api-gateway` con imagen
`nginx:1.28.3-alpine`. `/gateway-health` solo acredita el proxy; la comprobación
completa requiere consultar `/meta/runtime` con la cabecera autenticada sin
imprimir su valor.

## Bloqueo del frontend público

El DNS de `campojoyma.multiplicaxfuego.com` apunta a `217.154.101.108`. Ese host
no es el VPS de integración y tampoco es `karma-box`.

Comprobación del 31/07:

- la clave Hostinger disponible es rechazada por `217.154.101.108`;
- la cuenta Hostinger visible solo contiene `82.25.119.113` y
  `82.25.119.150`;
- `gestionvps.multiplicaxfuego.com` exige una clave de entrada propia;
- producción sirve `index-BMzeM2s7.js`, mientras el build local probado sirve
  `index-BzUrwCU_.js`.

Esto bloquea únicamente la publicación del frontend. No indica una caída de
FastAPI, del gateway o de MariaDB. El build nuevo está disponible y probado en
`http://localhost:8080`.

## MariaDB de pruebas

MariaDB está en `karma-box`, puerto local `3306`. Es la copia de pruebas y no debe
confundirse con la MariaDB original `192.168.1.91`.

Medición actual obtenida directamente en `karma-box` el **2026-07-28**:

| Métrica | Valor |
|---|---:|
| Tamaño físico de `/var/lib/mysql` | `10.669.099.820` bytes |
| Tamaño físico legible | `10G` (`9,94 GiB`) |
| Datos lógicos | `5,907 GiB` |
| Índices lógicos | `1,951 GiB` |
| Total lógico | `7,858 GiB` |
| Esquema `netagrocomer` | `2,883 GiB` |
| Esquemas de aplicación | 47 |
| Objetos visibles con administración local | 3.566 |

El tamaño físico incluye ficheros internos, espacio asignado y sobrecoste de
MariaDB. Por eso no coincide exactamente con la suma lógica de datos e índices.

### Cómo volver a medir

En `karma-box`, solo lectura:

```bash
sudo du -sb /var/lib/mysql
sudo du -sh /var/lib/mysql
```

Tamaño lógico completo, usando administración local y sin mutar datos:

```bash
sudo mariadb --batch --raw <<'SQL'
SELECT
  COUNT(DISTINCT TABLE_SCHEMA) AS app_schema_count,
  COUNT(*) AS objects_count,
  ROUND(SUM(COALESCE(DATA_LENGTH, 0)) / 1024 / 1024 / 1024, 3) AS data_gib,
  ROUND(SUM(COALESCE(INDEX_LENGTH, 0)) / 1024 / 1024 / 1024, 3) AS indexes_gib,
  ROUND(
    SUM(COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0))
    / 1024 / 1024 / 1024,
    3
  ) AS logical_total_gib
FROM information_schema.TABLES
WHERE TABLE_SCHEMA NOT IN (
  'information_schema',
  'mysql',
  'performance_schema',
  'sys'
);
SQL
```

Importante: el usuario runtime `netagro_api` solo ve sus esquemas permitidos. Una
consulta de `information_schema` con ese usuario puede devolver 14 esquemas y un
total parcial de unos `3,7 GiB`. Ese valor **no** representa el tamaño completo de
la copia.

## Documentación en el VPS

El VPS conserva copias de consulta en:

```text
/root/netagro_docs/
```

La documentación versionada en Git es la referencia preferida. Las copias del VPS
pueden ser fotografías históricas y no sustituyen el estado del repositorio.

## Diagnóstico recomendado

Ante una consulta sobre facturas, disponibilidad o tamaño:

1. Entrar al VPS `82.25.119.150`.
2. Comprobar los túneles y `curl /health` en `18000` y `18001`.
3. Si hace falta el host real, saltar desde el VPS a `karma-box`.
4. Para facturas, usar primero la API; no consultar MariaDB directamente salvo
   diagnóstico de solo lectura.
5. Para tamaño completo, usar `sudo du` y la consulta administrativa de
   `information_schema`.
6. No interpretar un timeout directo a `88.30.71.235:2222` como caída sin probar
   antes el salto por el VPS.

## Límites de seguridad

- La MariaDB original es de solo lectura para estos trabajos.
- No ejecutar `CREATE`, `ALTER`, `DROP`, `TRUNCATE` ni ninguna operación DDL
  contra la MariaDB de pruebas o la original.
- No ejecutar escrituras manuales para simular la API.
- No mostrar contraseñas, JWT, contenidos de `.env` ni claves privadas.
- Comprobar permisos MariaDB con `SHOW GRANTS`, nunca intentando una operación
  mutante.
- La API v2 debe permanecer con `writes_enabled=false` salvo autorización y
  procedimiento de homologación explícitos.
