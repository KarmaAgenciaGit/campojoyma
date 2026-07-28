# Acceso a servidores e infraestructura de Campojoyma

Última comprobación: **2026-07-28**.

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
  -> karma-box 127.0.0.1:8000
  -> FastAPI v1
  -> MariaDB de pruebas

n8n/VPS
  -> http://172.19.0.1:18001 o http://127.0.0.1:18001
  -> túnel netagro-api-v2-tunnel.service en el VPS
  -> karma-box 127.0.0.1:8001
  -> FastAPI v2
  -> MariaDB de pruebas + almacén externo de idempotencia
```

| API | VPS | `karma-box` | Estado comprobado el 2026-07-28 |
|---|---|---|---|
| v1 | `127.0.0.1:18000` y `172.19.0.1:18000` | `127.0.0.1:8000` | Sana; `netagro-api.service` activo. |
| v2 | `127.0.0.1:18001` y `172.19.0.1:18001` | `127.0.0.1:8001` | Sana; writes desactivados e idempotencia preparada. |

Comprobaciones desde el VPS:

```bash
systemctl is-active netagro-api-tunnel.service
systemctl is-active netagro-api-v2-tunnel.service
curl -fsS http://127.0.0.1:18000/health
curl -fsS http://127.0.0.1:18001/health
```

Comprobaciones desde `karma-box`:

```bash
systemctl is-active netagro-api.service
ss -lntp | grep -E ':8000|:8001'
ps -eo pid,lstart,cmd | grep -E '[u]vicorn|[f]astapi-netagro'
```

Rutas desplegadas comprobadas:

```text
/home/karma/fastapi-netagro
/home/karma/fastapi-netagro-v02-20260720
```

La fuente de trabajo prevista de FastAPI es el repositorio local
`KarmaAgenciaGit/api-campojoyma`. Si contiene cambios sin commit o push, su
working tree es la autoridad concreta; este repositorio conserva contrato,
OpenAPI, workflows y una copia sincronizada del parche.

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
