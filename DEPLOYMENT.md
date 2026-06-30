# Guía de Despliegue en Producción - AgroIris

## Requisitos previos (1 vez)

1. **DNS configurado:**
   - Crear un A record: `agroiris.karmaia.app → 217.154.101.108`

2. **Red Docker de Traefik:**
   ```bash
   docker network ls | grep proxy || docker network create proxy
   ```

3. **Traefik debe estar corriendo** con:
   - Cert resolver `le` configurado
   - Red `proxy` disponible

---

## Archivos de Configuración

### 1. docker-compose.yml ✅
- Servicio: `agroiris`
- Contenedor: `agroiris`
- Host: `agroiris.karmaia.app`
- Logging configurado (10MB, 3 archivos)

### 2. nginx.conf ✅
- Proxy `/agroiris-api/` → `http://46.24.40.100:7000/api/`
- Proxy `/agroiris-api-cuentaventa/` → `http://46.24.40.100:8000/api/` (temporal)
- Proxy `/agroiris-config/` → `http://46.24.40.100:7001/api/`
- Proxy `/agroiris-login/` → `http://46.24.40.100:7001/api/login/`
- Proxy `/agroiris-login-cuentaventa/` → `http://46.24.40.100:8001/api/login/` (temporal)
- Proxy `/agroiris-divisa/` → `http://46.24.40.100:7001/api/divisa/`
- Proxy `/agroiris-serie/` → `http://46.24.40.100:7001/api/serie/`
- Cache de estáticos configurado (excepto index.html)
- SPA fallback para rutas de React Router

### 3. Dockerfile ✅
- Build stage con Node 20 Alpine
- Runtime stage con Nginx Alpine
- Healthcheck incluido

### 4. .env
- Variables ya configuradas con rutas relativas
- `VITE_AGROIRIS_API_URL="/agroiris-api"`
- `VITE_AGROIRIS_LOGIN_URL="/agroiris-login/Login"`
- `VITE_AGROIRIS_CUENTAVENTA_API_URL="/agroiris-api-cuentaventa"` (temporal)
- `VITE_AGROIRIS_CUENTAVENTA_LOGIN_URL="/agroiris-login-cuentaventa/login/Login"` (temporal)
- `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` configurados

---

## Despliegue

### Comando completo (desde el servidor):
```bash
cd ~/agroiris/AgroIris && \
git pull && \
docker compose build && \
docker compose up -d && \
docker logs -n 100 agroiris
```

### Paso a paso:

1. **Construir e iniciar:**
   ```bash
   cd ~/agroiris/AgroIris
   docker compose up -d --build
   ```

2. **Ver logs:**
   ```bash
   # Logs del contenedor agroiris
   docker logs -f agroiris
   
   # Logs de Traefik (certificado SSL)
   docker logs -f traefik
   ```

3. **Verificar estado:**
   ```bash
   docker ps | grep agroiris
   docker inspect agroiris
   ```

---

## Verificación

### Checklist de verificación:

- [ ] DNS `agroiris.karmaia.app` apunta a `217.154.101.108`
- [ ] Red docker `proxy` existe
- [ ] Contenedor `agroiris` corriendo: `docker ps`
- [ ] Sin errores en logs: `docker logs agroiris`
- [ ] Certificado TLS emitido (candado en navegador)
- [ ] App accesible en `https://agroiris.karmaia.app`
- [ ] Llamadas a `/agroiris-api/*` funcionan sin CORS
- [ ] Login funciona correctamente

### URLs de prueba:

- **Frontend:** https://agroiris.karmaia.app
- **API (proxy):** https://agroiris.karmaia.app/agroiris-api/...
- **Config API (proxy):** https://agroiris.karmaia.app/agroiris-config/...
- **Login (proxy):** https://agroiris.karmaia.app/agroiris-login/Login

### Verificar en consola del navegador:

1. Abrir DevTools (F12)
2. Ir a la pestaña Network
3. Filtrar por XHR
4. Verificar que las llamadas a `/agroiris-api/` devuelven 200
5. No deben aparecer errores CORS

---

## Comandos útiles

### Reiniciar el contenedor:
```bash
docker restart agroiris
```

### Ver logs en tiempo real:
```bash
docker logs -f agroiris
```

### Reconstruir sin caché:
```bash
docker compose build --no-cache
docker compose up -d
```

### Detener y eliminar:
```bash
docker compose down
```

### Limpiar imágenes huérfanas:
```bash
docker image prune -f
```

---

## Solución de problemas

### Error: "network proxy not found"
```bash
docker network create proxy
```

### Certificado SSL no se emite
- Verificar DNS apunta correctamente
- Ver logs de Traefik: `docker logs traefik | grep agroiris`
- Esperar 2-3 minutos para propagación DNS

### Error 502 Bad Gateway
- Verificar que el contenedor está corriendo: `docker ps`
- Ver logs: `docker logs agroiris`
- Verificar nginx: `docker exec agroiris nginx -t`

### API retorna CORS errors
- Verificar que las rutas en `nginx.conf` son correctas
- Verificar que las IPs y puertos de la API son accesibles desde el servidor
- Probar manualmente: `curl http://46.24.40.100:7000/api/calibre`

### App no carga estilos o JS
- Limpiar caché del navegador
- Verificar que el build generó los archivos: `docker exec agroiris ls /usr/share/nginx/html`
- Reconstruir sin caché

---

## Arquitectura de producción

```
Internet
    ↓
217.154.101.108 (VPS)
    ↓
Traefik (puerto 443)
    ↓
agroiris.karmaia.app
    ↓
Contenedor agroiris (puerto 80)
    ↓
Nginx
    ├─ / → SPA (React + Vite)
    ├─ /agroiris-api/ → http://46.24.40.100:7000/api/
    ├─ /agroiris-api-cuentaventa/ → http://46.24.40.100:8000/api/ (temporal)
    ├─ /agroiris-config/ → http://46.24.40.100:7001/api/
    ├─ /agroiris-login/ → http://46.24.40.100:7001/api/login/
    ├─ /agroiris-login-cuentaventa/ → http://46.24.40.100:8001/api/login/ (temporal)
    ├─ /agroiris-divisa/ → http://46.24.40.100:7001/api/divisa/
    └─ /agroiris-serie/ → http://46.24.40.100:7001/api/serie/
```

---

## Notas importantes

1. **No exponer puertos externos** en `docker-compose.yml` - Traefik maneja todo
2. **Las APIs externas** (46.24.40.100) deben ser accesibles desde el VPS
3. **El certificado SSL** se renueva automáticamente vía Let's Encrypt
4. **Los logs rotan** automáticamente (max 10MB x 3 archivos)
5. **El healthcheck** verifica que Nginx responde cada 30 segundos

---

## Contacto y soporte

- Repositorio: KarmaAgenciaGit/AgroIris
- Branch: agroiris
- Supabase Project: adbprpemmbspntbttziz
