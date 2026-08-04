# Facturas recibidas - Campojoyma

Última actualización: 2026-08-04

La referencia del contrato de escritura es
[FACTURAS_RECIBIDAS_API_CONTRACT.md](FACTURAS_RECIBIDAS_API_CONTRACT.md). El
estado de homologación se mantiene en
[FACTURAS_RECIBIDAS_API_V2_STAGING.md](FACTURAS_RECIBIDAS_API_V2_STAGING.md).

## Estado operativo

Supabase es la bandeja de revisión y ERP es la autoridad para maestros,
duplicados y escrituras reales. La pantalla no muestra el histórico completo de
Netagro.

La API desplegada es la v0.3.9. El 4 de agosto se homologó en el clon persistente
aislado un perfil SQL contable mínimo (`OT`, régimen `2110`, un único tramo al
21 %, un gasto, sin retención, CTB, punteos ni cartera). El canario ficticio
`FRR_id=49723` produjo el asiento técnico `394936`, número visible `53344`, tres
apuntes cuadrados y el registro de IVA soportado. Esta evidencia autoriza solo
ese perfil y solo en el clon TEST identificado; no autoriza producción ni una
ampliación por analogía.

Estado operativo comprobado el 4 de agosto:
<code>DB_WRITES_ENABLED=false</code>,
<code>ACCOUNTING_WRITES_ENABLED=false</code>,
<code>ACCOUNTING_MECHANISM=unavailable</code> y
<code>ALBMATERIAL_WRITES_ENABLED=false</code>. El destino Supabase
<code>netagro-test-write</code> permanece en
<code>write_mode=blocked</code>/<code>accounting_mode=unavailable</code>. Por
tanto, tener el código desplegado no abre ninguna escritura.

La regla viva de empresa 1 propone ejercicio 25, CTB igual a fecha de factura,
cuenta `60200000001`, concepto `FRA. {proveedor}` y
`contabilizar_default=N`. La intención de contabilizar se conserva separada en
Supabase. El alta de gestión siempre escribe primero
<code>FRR_Contabilizar='N'</code>; solo después de su readback exacto puede
abrirse la operación contable independiente. El estado <code>created</code> se
acepta únicamente tras verificar asiento, apuntes, origen, fiscalidad y cuadre.

Supabase incorpora la finalización estricta, punteos no seleccionados por
defecto, unicidad por circuito y revocación de privilegios de mutación directa
para <code>authenticated</code>/<code>anon</code> sobre cabecera, CTB y
punteos. Los clientes conservan lectura; las mutaciones operativas pasan por
Edge/RPC con <code>service_role</code>.

Las Edge Functions v3 saneadas están desplegadas con JWT obligatorio. El
extractor n8n v4 está activo
en remoto; su exportación canónica local conserva <code>active=false</code> para
evitar activaciones accidentales al importar. El escritor n8n v2 sigue
desactivado. El frontend está validado en local y su despliegue externo continúa
pendiente.

La sustitución remota final se realizó mediante
<code>n8n import:workflow</code> y se verificó con 32 nodos, cinco
<code>httpRequestTool</code> GET, cinco conexiones <code>ai_tool</code> y el
webhook <code>campojoyma-factura-extraer</code> registrado. El backup previo es
<code>/root/campojoyma-pre-agent-v4.2-20260729T154205Z.json</code>, modo
<code>600</code>, SHA-256
<code>1441938ba666da9f9ca27e6c5aea60dac10f3e57eed3d2e550fb9261c940b501</code>.
El candidato activo tiene SHA-256
<code>7a32d91a9cd99171f27a41c8269795fda3167b3a1298e09fd71cee4970b883ce</code>.

## Flujo

1. El usuario incorpora una factura a la bandeja de Supabase.
2. El extractor obtiene solo datos visibles del documento.
3. El proveedor se busca y se hidrata mediante la API ERP.
4. La UI presenta por separado cabecera, gastos, CTB y punteos.
5. El usuario completa los datos que no cubra una regla aprobada.
6. Antes del envío, la Edge Function repite el preflight autoritativo.
7. El alta de gestión se confirma mediante readback exacto y deja la cabecera
   sin contabilizar.
8. Si el usuario lo pidió y el perfil TEST está habilitado, una operación
   separada crea y verifica el asiento.
9. Solo el readback exacto permite declarar creada la factura o contabilizada.

Si un commit queda en estado desconocido, la operación queda bloqueada con el
<code>request_id</code> original. No se permite iniciar otra contabilización ni
degradar el estado a un error reintentable. Solo una reconciliación de solo
lectura y un readback exacto podrán cerrarlo como creado; nunca se repite el
commit a ciegas.

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

El índice de unicidad de Supabase compara el número de factura después de
<code>btrim</code>, es decir, sin espacios exteriores. Edge aplica además una
normalización alfanumérica para verificar la identidad visible. Son dos capas
complementarias; no debe describirse el índice físico como si aplicara la
normalización alfanumérica.

## Reglas configurables

Las variaciones se modelan en <code>public.facturas_recibidas_erp_rules</code> con alcance
de empresa/proveedor cuando sea necesario.

- El ejercicio no se acepta desde la extracción ni se deduce de la fecha. Se
  completa desde una regla explícita o desde una factura ERP exacta y única
  por empresa, proveedor, número comparado de forma alfanumérica en Edge, fecha
  y circuito.
- Onduspan (acreedor ERP 17) dispone además de un seed explícito para el
  ejercicio 25; no se usa como regla general de Campojoyma.
- El tipo de factura procede de una regla aprobada, del circuito canónico del
  proveedor confirmado o de una selección manual; nunca del origen del
  albarán.
- El régimen IVA procede de una regla aprobada o del histórico ERP estricto
  del mismo proveedor, empresa, circuito y firma IVA (mínimo 3 casos, ganador
  único y confianza ≥98 %); si no alcanza el umbral, queda manual.
- La fecha CTB copia la fecha de factura mediante la política de Campojoyma
  confirmada el 29/07/2026.
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
FRR_Idempresa + FRR_ejercicio + circuito + FRR_idproveedor + FRR_numerofactura
~~~

El duplicado muestra su candidato para facilitar la revisión. Proveedor
inexistente, cuenta incoherente, duplicado exacto e indisponibilidad de API son
errores bloqueantes distintos. El escritor debe repetir las garantías antes de
cualquier operación real.

La extracción manual, la ingesta autenticada y el guardado vuelven a consultar
esta clave directamente desde Edge antes de validar punteos. Si Netagro confirma
un duplicado, se persiste `duplicate_invoice`, los vínculos históricos se
conservan con `S=false` y se muestran únicamente en modo consulta. En ese caso no
se exige volver a resolver las referencias MA porque no existe una nueva alta que
puntear. La evidencia de n8n por sí sola nunca activa esta excepción. Una caída
temporal al revalidar una clave ya confirmada conserva el bloqueo anterior.

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
- mantiene abrir/descargar el PDF original aunque falle la previsualización;
- valida que la descarga HTTP sea realmente un PDF antes de entregarla al
  renderizador y reconstruye el <code>Blob</code> con
  <code>application/pdf</code>;
- presenta gastos, CTB y punteos en bloques independientes;
- conserva la selección de punteos como acción manual;
- no muestra <code>reference_only</code> como asiento creado.

### Diagnóstico del visor PDF en blanco

La incidencia observada el 29/07/2026 combinaba un servidor Vite local detenido
con una carrera durante la inicialización de <code>pdf.js</code>. Una pestaña
ya abierta podía conservar la aplicación anterior en memoria aunque
<code>127.0.0.1:8080</code> hubiera dejado de responder.

Ante un visor vacío:

1. comprobar primero que el servidor local responde;
2. verificar que la descarga comienza por <code>%PDF-</code>, no solo que la
   respuesta HTTP sea 200;
3. usar abrir o descargar para distinguir un fallo del renderizador de un
   documento inaccesible.

El visor actual publica el PDF original en cuanto valida sus bytes. Por eso
abrir y descargar siguen disponibles aunque la carga diferida de
<code>pdf.js</code> falle o tarde más que la descarga.

## Errores que bloquean el envío

- Falta empresa, ejercicio, proveedor, cuenta, número o fecha de factura.
- Falta tipo o régimen sin regla/evidencia suficiente, o no se ha podido
  aplicar la política de fecha CTB.
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
- Confirmar nuevas reglas de tipo, régimen o vencimiento antes de
  automatizarlas.
- Desplegar externamente el frontend. El extractor n8n v4 ya está sustituido y
  activo con configuración de producción; se conservó una exportación
  recuperable de la versión anterior.
- Ejecutar la prueba de aceptación autenticada del envío real al ERP.

## Validación final del lote tratado del 29/07/2026

Las diez facturas se reprocesaron contra el extractor v4, Edge y la API ya
endurecidos. Resultado: **10/10 sin errores bloqueantes**. En todos los casos:

- fecha CTB igual a la fecha de factura;
- ejercicio 25;
- régimen 2110;
- tipo OT.

Los punteos se conservaron como referencias ERP sin selección automática:

| Factura/proveedor | Albaranes | Líneas |
|---|---:|---:|
| Ejido Cartón | 7 | 22 |
| Europack | 3 | 9 |
| Global Pack | 1 | 1 |
| González Cañabate | 0 | 0 |
| Megasa | 0 | 0 |
| MMAX | 3 | 16 |
| Onduspan | 21 | 37 |
| Petit | 15 | 19 |
| Repsol | 0 | 0 |
| Smurfit | 1 | 3 |

El visor PDF y sus acciones se verificaron en la UI. También se comprobó la
apertura dinámica de las tres líneas de Smurfit. El visor valida los bytes,
renderiza el documento y mantiene disponibles abrir y descargar incluso si
pdf.js no termina la previsualización.

## Errores a evitar

- Usar <code>acreedores_cache</code> como fuente o fallback.
- Tratar Supabase como la base real de ERP.
- Exponer el JWT en variables <code>VITE_*</code>.
- Versionar secretos del extractor: JWT, ingest, renderizador PDF y OpenAI se
  referencian únicamente mediante credenciales administradas por n8n.
- Cargar el histórico completo en la pantalla.
- Inferir ejercicio, tipo, régimen o vencimiento fuera de las reglas aprobadas,
  o reutilizar la política de fecha CTB de Campojoyma en otro cliente.
- Mezclar gastos, CTB, punteos y asiento.
- Seleccionar punteos automáticamente.
- Rellenar ids ERP antes de una escritura confirmada.
- Declarar creado un asiento mientras la API siga en
  <code>reference_only</code>.
- Ejecutar DDL contra MariaDB Netagro.
