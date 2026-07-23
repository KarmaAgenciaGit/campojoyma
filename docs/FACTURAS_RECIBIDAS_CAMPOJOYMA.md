# Facturas recibidas - Campojoyma

Última actualización: 2026-07-22

La referencia del contrato de escritura es
[FACTURAS_RECIBIDAS_API_CONTRACT.md](FACTURAS_RECIBIDAS_API_CONTRACT.md). El
estado de homologación se mantiene en
[FACTURAS_RECIBIDAS_API_V2_STAGING.md](FACTURAS_RECIBIDAS_API_V2_STAGING.md).

## Estado operativo

Supabase es la bandeja de revisión y ERP es la autoridad para maestros,
duplicados y escrituras reales. La pantalla no muestra el histórico completo de
Netagro.

El escritor continúa en <code>reference_only</code>. Un dry-run correcto, una
respuesta de referencia o una factura validada en staging no prueban que se
haya creado un asiento. No se debe usar el estado «enviada a ERP» ni mostrar un
número de asiento hasta recibir y verificar una creación real.

El 22/07/2026 quedaron aplicadas en Supabase las migraciones de finalización
estricta, punteos no seleccionados por defecto y revocación de los privilegios
de mutación directa para <code>authenticated</code>/<code>anon</code> sobre
cabecera, CTB y punteos, incluidos <code>TRUNCATE</code>,
<code>REFERENCES</code> y <code>TRIGGER</code>. Los clientes conservan lectura;
las mutaciones operativas pasan por Edge/RPC con <code>service_role</code>.
También se desplegaron las cinco Edge Functions
saneadas: lectura v8, actualización v9, ingestión v11, extracción v7 y envío
ERP v11. El frontend y el workflow n8n permanecen pendientes de despliegue, y
la prueba autenticada requiere una sesión o credenciales operativas.

## Flujo

1. El usuario incorpora una factura a la bandeja de Supabase.
2. El extractor obtiene solo datos visibles del documento.
3. El proveedor se busca y se hidrata mediante la API ERP.
4. La UI presenta por separado cabecera, gastos, CTB y punteos.
5. El usuario completa los datos que no cubra una regla aprobada.
6. Antes del envío, la Edge Function repite el preflight autoritativo.
7. Solo una respuesta real y verificable del ERP permite declarar creada la
   factura o su asiento.

Si un commit queda en estado desconocido, la conciliación reutiliza el
<code>request_id</code> original y el dry-run inmutable. Solo consulta ERP y
finaliza tras un readback exacto; nunca repite el POST escritor ni elige entre
candidatos ambiguos.

## Fuentes de datos

### ERP

Los acreedores se consultan exclusivamente en:

~~~text
GET /acreedores
GET /acreedores/{acreedor_id}
GET /acreedores/{acreedor_id}/gastos
~~~

- <code>/acreedores</code> sirve para búsqueda acotada por nombre, NIF o código.
- El detalle proporciona los campos maestros, incluida la cuenta del proveedor.
- El endpoint de gastos aporta las reglas/cuentas observadas para ese acreedor.
- Una caída de la API se comunica como indisponibilidad técnica; no se traduce
  a «proveedor no encontrado».
- No existe caché local ni fallback para acreedores.

Otros endpoints de lectura:

~~~text
GET /empresas
GET /facturasrecibidas/tipos
GET /facturasrecibidas
GET /facturasrecibidas/{factura_id}
GET /facturasrecibidas/{factura_id}/ctb
GET /facturasrecibidas_ctb?factura_id={id}
~~~

El acceso desde navegador pasa por
<code>facturas-recibidas-erp-read</code>, que mantiene el JWT fuera del
frontend y limita las rutas admitidas.

### Supabase

Proyecto:

~~~text
CAMPOJOYMA
adbprpemmbspntbttziz
~~~

Tablas operativas:

~~~text
public.archivos_pdf
public.facturasrecibidas
public.facturasrecibidas_ctb
public.facturasrecibidas_punteos
public.facturas_recibidas_erp_rules
~~~

<code>acreedores_cache</code> era un resto histórico sin uso en runtime: no
participaba en búsquedas, validaciones ni fallbacks. Tras comprobar que no
quedaban dependencias y recibir confirmación expresa, se retiró físicamente el
22/07/2026 mediante una migración nueva. Las cinco filas previas se conservaron
en <code>docs/evidencias/facturas-recibidas/acreedores-cache-backup-2026-07-22.json</code>
con SHA-256
<code>79F49160CA74A3B2CAE88C026627B258FB10D69F27B38B7EB28E389152E4B5BC</code>.

En las facturas nuevas, <code>FRR_id</code> queda nulo hasta que ERP devuelva un
id creado. Un id real usado como evidencia se guarda en metadatos de extracción
o respuesta, nunca como si staging ya estuviese sincronizado.

## Reglas configurables

Las variaciones se modelan en <code>public.facturas_recibidas_erp_rules</code> con alcance
de empresa/proveedor cuando sea necesario.

- Onduspan (acreedor ERP 17) dispone de un seed explícito para el ejercicio 25;
  no se usa como regla general de Campojoyma.
- El ejercicio no se deduce de la fecha de factura.
- Tipo de factura, régimen IVA y fecha CTB se rellenan únicamente desde una
  regla aprobada o por selección manual.
- La fecha de factura no se copia automáticamente a la fecha CTB.
- Los valores de un caso contrastado no se convierten en defaults globales.

Para el caso de aceptación ONDUSPAN se contrastaron ejercicio 25, tipo OT y
régimen 2110. Estos valores solo son válidos dentro de la regla confirmada que
les dé alcance.

## Preflight antes del envío

<code>factura-recibida-send-erp</code> comprueba contra ERP:

1. Que <code>FRR_idproveedor</code> exista.
2. Que <code>FRR_idcuenta</code> coincida con la cuenta del detalle maestro.
3. Que no exista una factura con la clave exacta:

~~~text
FRR_Idempresa + FRR_ejercicio + FRR_idproveedor + FRR_numerofactura
~~~

El duplicado muestra su candidato para facilitar la revisión. Proveedor
inexistente, cuenta incoherente, duplicado exacto e indisponibilidad de API son
errores bloqueantes distintos. El escritor debe repetir las garantías antes de
cualquier operación real.

## Separación de bloques

### Gastos

Los campos <code>FRR_igasto*</code> y <code>FRR_ctagasto*</code> son gastos de
cabecera. Proceden de reglas ERP confirmadas o edición explícita.

### CTB

<code>facturasrecibidas_ctb</code> guarda apuntes <code>FRC_*</code> explícitos.
No se genera un apunte a partir de la cuenta del proveedor o de la base, y no se
copian automáticamente los gastos a CTB.

### Punteos

Los candidatos de punteo se almacenan por separado y nacen sin seleccionar. La
selección es siempre manual y el total de la UI suma únicamente los registros
marcados por el usuario.

### Asiento

El asiento es una entidad creada por el mecanismo oficial del ERP. Gastos, CTB,
punteos, una validación correcta o <code>reference_only</code> no equivalen a
un asiento.

## Vencimientos

Las fechas e importes de vencimiento detectados en el PDF se conservan como
evidencia de extracción. No se promueven automáticamente a
<code>FechaVto</code>/<code>ImporteVto</code>. Esos campos requieren una regla
aprobada o confirmación manual.

## Frontend

Ruta:

~~~text
/facturas-recibidas
~~~

La UI:

- lista la bandeja de staging;
- busca acreedores en ERP con debounce y límite pequeño;
- consulta el detalle tras seleccionar un proveedor;
- diferencia avisos de errores bloqueantes;
- evita incidencias duplicadas para el mismo campo;
- presenta gastos, CTB y punteos en bloques independientes;
- conserva la selección de punteos como acción manual;
- no muestra <code>reference_only</code> como asiento creado.

## Errores que bloquean el envío

- Falta empresa, ejercicio, proveedor, cuenta, número o fecha de factura.
- Falta tipo, régimen o fecha CTB sin regla aprobada/selección manual.
- El proveedor no existe en ERP.
- La cuenta no coincide con el maestro.
- Existe el duplicado exacto.
- La API ERP no está disponible durante el preflight.
- Los importes obligatorios no son coherentes.

Los avisos explican revisiones pendientes sin alterar la semántica del dato. Un
error de proveedor o cuenta nunca se degrada a aviso por disponer de una copia
local.

## Nota histórica

En una etapa inicial se cargaron cinco ejemplos y sus acreedores en Supabase
para poder desarrollar la pantalla sin un proxy de lectura disponible. Esa
carga explica la existencia de <code>acreedores_cache</code>, pero no describe
la arquitectura vigente. El proxy ERP y el preflight autoritativo sustituyen
por completo ese mecanismo.

Los ejemplos históricos pueden seguir siendo evidencia de pruebas, siempre con
<code>FRR_id = null</code> en staging y el id remoto dentro de metadatos.

## Pendientes externos

- Homologar el endpoint que crea la factura/asiento y devuelve evidencias
  verificables.
- Confirmar nuevas reglas de tipo, régimen, fecha CTB o vencimiento antes de
  automatizarlas.
- Desplegar el frontend y reemplazar de forma controlada el workflow n8n,
  conservando antes una exportación recuperable de la versión remota.
- Ejecutar la prueba de aceptación autenticada de lectura, edición, extracción
  y preflight de envío.

## Errores a evitar

- Usar <code>acreedores_cache</code> como fuente o fallback.
- Tratar Supabase como la base real de ERP.
- Exponer el JWT en variables <code>VITE_*</code>.
- Cargar el histórico completo en la pantalla.
- Inferir ejercicio, tipo, régimen, fecha CTB o vencimiento.
- Mezclar gastos, CTB, punteos y asiento.
- Seleccionar punteos automáticamente.
- Rellenar ids ERP antes de una escritura confirmada.
- Declarar creado un asiento mientras la API siga en
  <code>reference_only</code>.
- Ejecutar DDL contra MariaDB Netagro.
