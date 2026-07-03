# Facturas recibidas / facturas de compra - Campojoyma

Ultima actualizacion: 2026-07-03

Este documento resume decisiones y contexto operativo para futuras conversaciones sobre el modulo de facturas de compra de Campojoyma.

## Idea principal

La pantalla de `Facturas de compra` no debe mostrar el historico completo de facturas reales de Netagro.

El flujo esperado es:

1. Campojoyma registra nuevas facturas en la aplicacion.
2. Esas facturas se guardan en Supabase como staging/bandeja de revision.
3. El cliente revisa y valida los datos.
4. Cuando el cliente lo habilite, se usaran endpoints `POST` para enviar esas facturas a la base real de Netagro.

Por tanto, Supabase es la bandeja de trabajo. Netagro/MariaDB es el destino real final y tambien una fuente de consulta para validar datos.

## Supabase

Proyecto asociado:

```text
CAMPOJOYMA
adbprpemmbspntbttziz
```

Tablas principales de staging:

```text
public.facturasrecibidas
public.facturasrecibidas_ctb
public.acreedores_cache
```

Estas tablas tienen nombres y columnas similares al modelo real de Netagro:

```text
acreedores.ACR_Codigo -> facturasrecibidas.FRR_idproveedor
facturasrecibidas.FRR_id -> facturasrecibidas_ctb.FRC_idfacturarecibida
```

Pero en Supabase no son la base real de Netagro. Son una copia/staging para revision, OCR, validacion y envio posterior.

Regla importante:

- En facturas nuevas o ejemplos de staging, `FRR_id` debe quedar `null` hasta que la factura exista realmente en Netagro.
- Si se usa una factura real de Netagro como ejemplo, el ID real puede guardarse en `extraction.remote_id` o `netagro_response.remote_id`, pero no debe confundirse con un registro ya sincronizado.

## API de Netagro via VPS/n8n

La API del VPS intermedio consulta una copia local de MariaDB. Produccion no se toca.

Base URL interna desde n8n:

```text
http://172.19.0.1:18000
```

Webhook externo de lectura:

```text
https://n8nbecarios.srv894901.hstgr.cloud/webhook/apiCampojoyma
```

El parametro correcto para enrutar en n8n es:

```text
query.consulta
```

No usar:

```text
consulta
```

La expresion correcta en n8n para el HTTP Request interno es:

```text
={{ 'http://172.19.0.1:18000/' + $json.query.consulta }}
```

La autenticacion del webhook externo usa JWT Bearer. El secreto no debe exponerse en frontend.

## Endpoints GET disponibles

Ya existen endpoints de solo lectura para:

```text
GET /acreedores
GET /acreedores/{acreedor_id}
GET /facturasrecibidas
GET /facturasrecibidas/{factura_id}
GET /facturasrecibidas/{factura_id}/ctb
GET /facturasrecibidas_ctb?factura_id={id}
```

Ejemplos:

```text
acreedores?limit=50
acreedores?nif=B04243655
acreedores/1941
facturasrecibidas?proveedor_id=1941&numero_factura=FCD26%2F2820
facturasrecibidas/49165
facturasrecibidas/34602/ctb
```

Formato esperado de listados:

```json
{
  "items": [],
  "limit": 50,
  "offset": 0,
  "total": 0
}
```

Uso previsto de estos GET:

- Resolver acreedores/proveedores por NIF, nombre o codigo.
- Consultar una factura concreta como referencia.
- Comprobar duplicados o validar campos contra Netagro.
- Traer algunos ejemplos controlados para pruebas.

Uso no previsto:

- No cargar `GET /facturasrecibidas?limit=500` como listado principal de la pantalla.
- No convertir la pantalla en explorador del historico real de Netagro.

## Frontend

Ruta principal:

```text
/facturas-recibidas
```

Copy visible acordado:

```text
Facturas de compra
```

No usar "facturas recibidas" como etiqueta principal de negocio si el usuario pidio "facturas de compra".

La UI debe listar las facturas de Supabase staging. Las facturas reales de Netagro solo deben entrar por acciones concretas: validacion, busqueda, duplicados, detalle puntual o ejemplos seleccionados.

## Edge Function / proxy de lectura

Si el frontend necesita llamar al webhook de lectura, debe hacerlo a traves de una Edge Function o proxy server-side, porque el JWT del webhook no puede vivir en el navegador.

Funcion local preparada:

```text
supabase/functions/facturas-recibidas-netagro-read
```

Estado observado el 2026-07-03:

- En Supabase remoto no habia Edge Functions desplegadas.
- El CLI `supabase` no estaba disponible en PATH local.
- La variable local `SUPABASE_SERVICE_ROLE_KEY` estaba presente pero vacia.

No desplegar una Edge Function de lectura sin confirmar que estos secretos existen en Supabase:

```text
N8N_CAMPOJOYMA_READ_WEBHOOK_URL
N8N_CAMPOJOYMA_WEBHOOK_JWT_SECRET
N8N_CAMPOJOYMA_WEBHOOK_JWT_EXP_SECONDS
```

Si se despliega sin secretos, puede dejar de funcionar el fallback local y pasar de un 404 controlado a un 500.

## Datos de ejemplo cargados

Se cargaron 5 facturas de ejemplo en Supabase staging desde la API de lectura, para tener listado visible y poder probar el flujo.

Todas quedan como:

```text
estado = pendiente_revision
FRR_id = null
source_pdf_name = ejemplo-api-campojoyma-<remote_id>.pdf
extraction.source = apiCampojoyma-read-sample
extraction.remote_id = <id real Netagro>
```

Ejemplos insertados:

```text
FCD26/2820  - MONTAJES ELECTRICOS AVILA SL      - 13.884,51
F2026/0195  - LA JABEGA PLAYA, S.L.             - 1.155,61
FV26-13     - CRISTOBAL HUGO RODOLFO            - 14.951,01
01/2026     - TRACTORES RIVAS GONZALEZ SL       - 79.151,52
1 000265    - AGROELIAN, S.L.                   - 13.596,24
```

Tambien se cargaron sus acreedores en `acreedores_cache`.

Para repetir la carga, borrar solo:

```sql
delete from public.facturasrecibidas
where source_pdf_name like 'ejemplo-api-campojoyma-%';
```

El borrado en cascada elimina sus lineas `facturasrecibidas_ctb`.

## Futuro POST a Netagro

El envio real a Netagro todavia depende de endpoints `POST` que el cliente habilitara despues.

Cuando existan, el flujo deberia ser:

1. Validar factura y lineas en Supabase.
2. Resolver acreedor contra `acreedores` real o cache.
3. Enviar cabecera a endpoint `POST` de facturas recibidas.
4. Enviar lineas contables a endpoint `POST` de `facturasrecibidas_ctb`.
5. Guardar respuesta real de Netagro:
   - `FRR_id`
   - `FRR_numero`
   - `FRC_id`
   - `FRC_idfacturarecibida`
   - `netagro_sent_at`
   - `netagro_response`

Hasta entonces, no marcar una factura como realmente enviada solo por existir en staging.

## Errores a evitar

- No tratar `public.facturasrecibidas` de Supabase como si fuera la tabla real de Netagro.
- No listar el historico completo de `GET /facturasrecibidas` en la pantalla principal.
- No exponer el JWT del webhook en variables `VITE_*`.
- No usar `$json.consulta` en n8n; usar `$json.query.consulta`.
- No rellenar `FRR_id` en ejemplos/staging si la factura no fue creada por el POST real.
- No confundir "facturas de compra" con "facturas emitidas".
