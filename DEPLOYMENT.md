# Guía de despliegue del frontend - Campojoyma

Este documento describe el despliegue del frontend de **este** repositorio.

- Dominio público: `https://campojoyma.multiplicaxfuego.com`
- Contenedor: `campojoyma`
- Proyecto Supabase: `CAMPOJOYMA` (`adbprpemmbspntbttziz`)

Nota sobre nombres: la clave del servicio en los ficheros compose sigue siendo
`agroiris`, resto del repositorio del que nació este proyecto. El contenedor y el
router de Traefik sí se llaman `campojoyma`. Los comandos de `docker compose` que
reciben un servicio usan `agroiris`; no se renombra porque arrastraría a
`nginx.conf`, `vite.config.ts` y los servicios `src/services/agroiris*.ts`.

Esta guía cubre solo el frontend. Las Edge Functions de Supabase, los workflows de
n8n y la API de Netagro se despliegan aparte; su estado está en `docs/`.
La topología real, los dos saltos SSH, los túneles y los comandos de diagnóstico
están en
[docs/ACCESO_SERVIDORES_E_INFRAESTRUCTURA.md](docs/ACCESO_SERVIDORES_E_INFRAESTRUCTURA.md).

---

## Requisitos previos (1 vez)

1. **DNS configurado:**
   - `campojoyma.multiplicaxfuego.com` apuntando al servidor de producción.

2. **Red Docker de Traefik:**
   ```bash
   docker network ls | grep proxy || docker network create proxy
   ```

3. **Traefik corriendo** con:
   - cert resolver `le` configurado;
   - red `proxy` disponible.

4. **`.env` en la raíz del repositorio**, a partir de `.env.example`.

---

## Archivos de configuración

### 1. `docker-compose.yml`
- Servicio: `agroiris` · contenedor: `campojoyma`
- Red externa `proxy`, sin puertos publicados: Traefik enruta el tráfico.
- `restart: unless-stopped` y rotación de logs (10 MB × 3 archivos).

### 2. `docker-compose.traefik.yml`
- Overlay con las etiquetas de Traefik.
- Router `campojoyma`: `Host(campojoyma.multiplicaxfuego.com)`, entrypoint
  `websecure`, TLS con resolver `le`, servicio hacia el puerto `80` del contenedor.

### 3. `docker-compose.windows.yml`
- Overlay alternativo **para pruebas locales**. No lleva Traefik ni red externa:
  publica `8080:80`.

### 4. `Dockerfile`
- Build stage con Node 20 Alpine (`npm ci --legacy-peer-deps` + `npm run build`).
- Runtime stage con Nginx Alpine: copia `dist/` y `nginx.conf`.
- **No define `HEALTHCHECK`.** El estado se comprueba con `docker ps` y con los
  logs o una petición al frontend.

### 5. `nginx.conf`
- SPA fallback para las rutas de React Router.
- `index.html` sin caché; estáticos con caché de un año (`immutable`).
- Proxies a la API externa `46.24.40.100`:

  | Ruta pública | Reescritura | Destino |
  |---|---|---|
  | `/agroiris-api/` | `/api/$1` | `:7000` |
  | `/agroiris-api-cuentaventa/` | `/api/$1` | `:7000` |
  | `/agroiris-config/` | `/api/$1` | `:7001` |
  | `/agroiris-login/` | `/api/$1` | `:7001` |
  | `/agroiris-login-cuentaventa/` | `/api/$1` | `:7001` |
  | `/agroiris-divisa/` y `/agroiris-divisa` | `/api/divisa/` | `:7001` |
  | `/agroiris-serie/` y `/agroiris-serie` | `/api/serie/` | `:7001` |

  Las variantes sin barra final existen porque parte del código hace `fetch` sin
  ella. Estas rutas deben coincidir con las de `vite.config.ts`, que es lo que usa
  el servidor de desarrollo.

### 6. `.env`
Solo las variables `VITE_*` se inyectan como `ARG` en el build y, por definición,
acaban en el bundle público:

```text
VITE_SUPABASE_PROJECT_ID
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_URL
VITE_AGROIRIS_API_URL
VITE_AGROIRIS_LOGIN_URL
VITE_AGROIRIS_CUENTAVENTA_API_URL
VITE_AGROIRIS_CUENTAVENTA_LOGIN_URL
VITE_AGROIRIS_LOGIN
VITE_AGROIRIS_PASSWORD
```

El resto de `.env` (`SUPABASE_SERVICE_ROLE_KEY`, `N8N_*`) es server-side y **no
entra en el contexto de Docker**. No añadir esos valores como `ARG`.

---

## Despliegue

### Producción (servidor Linux)

```bash
./deploy-front.sh
```

El script hace `git pull --ff-only`, valida la configuración y ejecuta:

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build
```

Después muestra el estado del servicio y las últimas 100 líneas de log. Falla de
forma explícita si faltan `git`, `docker`, `docker compose` o alguno de los dos
ficheros compose.

### Local (Windows)

```powershell
./deploy-front.ps1
```

Arranca Docker Desktop si hace falta, construye con `docker-compose.windows.yml` y
espera hasta 20 intentos a que `http://localhost:8080` responda `200`.

### Manual

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build
```

---

## Verificación

- [ ] DNS de `campojoyma.multiplicaxfuego.com` resuelve al servidor
- [ ] Red docker `proxy` existe
- [ ] Contenedor corriendo: `docker ps | grep campojoyma`
- [ ] Sin errores en logs: `docker logs campojoyma`
- [ ] Certificado TLS emitido (candado en el navegador)
- [ ] App accesible en `https://campojoyma.multiplicaxfuego.com`
- [ ] Las llamadas a `/agroiris-*` responden sin errores CORS
- [ ] Login y bandeja de facturas recibidas cargan

### En la consola del navegador

1. DevTools (F12) → pestaña Network → filtrar por XHR.
2. Comprobar que las llamadas a `/agroiris-api/` y `/agroiris-config/` devuelven `200`.
3. No deben aparecer errores CORS.

---

## Comandos útiles

Con `docker compose`, el servicio se llama `agroiris`; con `docker` a secas, el
contenedor se llama `campojoyma`.

```bash
docker restart campojoyma
```

```bash
docker logs -f campojoyma
```

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml logs --tail=100 agroiris
```

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml build --no-cache
```

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml down
```

```bash
docker image prune -f
```

---

## Solución de problemas

### Error: "network proxy not found"
```bash
docker network create proxy
```

### El certificado SSL no se emite
- Verificar que el DNS apunta correctamente.
- Ver logs de Traefik: `docker logs traefik | grep campojoyma`.
- Esperar a la propagación DNS.

### Error 502 Bad Gateway
- Comprobar que el contenedor está corriendo: `docker ps`.
- Ver logs: `docker logs campojoyma`.
- Validar nginx: `docker exec campojoyma nginx -t`.

### La API devuelve errores CORS
- Revisar que las rutas de `nginx.conf` siguen coincidiendo con las de `vite.config.ts`.
- Comprobar que `46.24.40.100` es accesible desde el servidor:
  `curl http://46.24.40.100:7000/api/calibre`.

### La app no carga estilos o JS
- Limpiar la caché del navegador.
- Verificar el build: `docker exec campojoyma ls /usr/share/nginx/html`.
- Reconstruir sin caché.

### El frontend público no refleja el último build
Comparar el nombre del bundle servido con el que genera `npm run build`. Si
difieren, el contenedor no se reconstruyó: repetir con `--build`.

---

## Arquitectura de producción

```text
Internet
    ↓
Traefik (443, red proxy)
    ↓
campojoyma.multiplicaxfuego.com
    ↓
Contenedor campojoyma (puerto 80)
    ↓
Nginx
    ├─ /                             → SPA (React + Vite)
    ├─ /agroiris-api/                → http://46.24.40.100:7000/api/
    ├─ /agroiris-api-cuentaventa/    → http://46.24.40.100:7000/api/
    ├─ /agroiris-config/             → http://46.24.40.100:7001/api/
    ├─ /agroiris-login/              → http://46.24.40.100:7001/api/
    ├─ /agroiris-login-cuentaventa/  → http://46.24.40.100:7001/api/
    ├─ /agroiris-divisa/             → http://46.24.40.100:7001/api/divisa/
    └─ /agroiris-serie/              → http://46.24.40.100:7001/api/serie/
```

Supabase y la API de Netagro no pasan por este Nginx: el frontend habla con
Supabase directamente y con Netagro a través de las Edge Functions.

---

## Notas importantes

1. **No publicar puertos** en `docker-compose.yml`: de eso se encarga Traefik. El
   único overlay que publica puerto es `docker-compose.windows.yml`, y es local.
2. **Las APIs externas** (`46.24.40.100`) deben ser accesibles desde el servidor.
3. **El certificado SSL** lo renueva Traefik vía Let's Encrypt.
4. **Los logs rotan** automáticamente (10 MB × 3 archivos).
5. **No meter secretos server-side en el build.** Todo lo que se pase como `ARG`
   acaba siendo público en el bundle.

---

## Referencias

- Repositorio: este mismo
- Proyecto Supabase: `CAMPOJOYMA` (`adbprpemmbspntbttziz`)
- Estado funcional de facturas recibidas: `docs/`
