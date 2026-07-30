# Documentación consolidada: facturas Campojoyma

Última actualización: 2026-07-30

La topología real, los dos saltos SSH, los túneles, las rutas de claves y los
comandos de diagnóstico se mantienen en
[ACCESO_SERVIDORES_E_INFRAESTRUCTURA.md](ACCESO_SERVIDORES_E_INFRAESTRUCTURA.md).
Ese documento es la referencia operativa antes de concluir que un servidor no es
accesible o antes de medir la copia MariaDB.

La referencia canónica del contrato de escritura es
[FACTURAS_RECIBIDAS_API_CONTRACT.md](FACTURAS_RECIBIDAS_API_CONTRACT.md). El
estado de homologación y los límites de la API se documentan en
[FACTURAS_RECIBIDAS_API_V2_STAGING.md](FACTURAS_RECIBIDAS_API_V2_STAGING.md);
el OpenAPI verificable está en
[openapi/netagro-test-api-v0.2.0.json](openapi/netagro-test-api-v0.2.0.json).
El nombre del fichero se mantiene por compatibilidad; su contenido corresponde
a la API v0.2.4 desplegada. La ampliación de líneas de albarán de entrada se
verificó contra el caso real `25 / A26 / 8436` y la de material contra
`AMA_idalb=23210` el 28/07/2026.

La creación por API no está habilitada de forma continua: a cierre de las dos
tareas del 29/07/2026, <code>DB_WRITES_ENABLED=false</code>,
<code>ACCOUNTING_MECHANISM=unavailable</code> y
<code>ALBMATERIAL_WRITES_ENABLED=false</code>; el workflow escritor n8n está
inactivo y archivado. La copia de Netagro no expone el mecanismo oficial que
crea un asiento nuevo. Sí existe lectura del diario para verificar asientos
históricos: el caso Onduspan `FRR_id=49305` confirma el asiento visible `48732`,
tres apuntes y Debe/Haber de `51.233,24 €`. Un dry-run o una referencia técnica
sin ese readback exacto no prueban una creación.

`DB_WRITES_ENABLED=false` bloquea literalmente el DML de la API. Es un
interruptor operativo, no una afirmación de que la base sea producción. Durante
una ventana controlada se habilitó temporalmente para validar un alta parcial
con `FRR_Contabilizar=N`; la factura se creó y se leyó de vuelta exactamente una
vez. Al terminar se volvió a cerrar. Activar solo ese interruptor no garantiza
ni el asiento oficial ni los enlaces MA y, por tanto, no equivale al alta
completa inicialmente solicitada.

Estado de aplicación trazado a 30/07/2026: Supabase incorpora la finalización contra el
dry-run original, el default <code>S=false</code> de punteos, la unicidad por
circuito y el cierre de privilegios mutantes de tabla para clientes sobre
cabecera, CTB y punteos. Tras la confirmación expresa,
<code>acreedores_cache</code> se retiró físicamente y sus cinco filas quedaron
exportadas como evidencia recuperable. Las Edge Functions saneadas están
desplegadas. El extractor n8n v4.2 está activo con el ID
<code>FIO92NfGcsWYsHC5</code>: 32 nodos, cinco tools GET, cinco conexiones
<code>ai_tool</code>, webhook <code>campojoyma-factura-extraer</code>
registrado y <code>PROMPT_VERSION: 4.2</code>. El parser mantiene
<code>autoFix=false</code>; el agente repite como máximo una vez la extracción
completa si la salida no cumple el esquema y después falla cerrado. La copia
canónica local conserva <code>active=false</code> para evitar activaciones
accidentales al importar. El frontend está validado en local y su despliegue
externo sigue pendiente. El escritor n8n v2 continúa desactivado.

Artefactos del despliegue, todos con modo <code>600</code>:

- backup previo:
  <code>/root/campojoyma-pre-agent-v4.2-20260729T154205Z.json</code>,
  SHA-256
  <code>1441938ba666da9f9ca27e6c5aea60dac10f3e57eed3d2e550fb9261c940b501</code>;
- candidato importado:
  <code>/root/campojoyma-agent-v4.2-20260729T154205Z.json</code>,
  SHA-256
  <code>7a32d91a9cd99171f27a41c8269795fda3167b3a1298e09fd71cee4970b883ce</code>;
- exportación posterior:
  <code>/root/campojoyma-post-agent-v4.2-20260729T154205Z.json</code>,
  SHA-256
  <code>f949cd6a1461734953a7de697d7e08ea1ad22000763d388dc960f9931a205b95</code>.

La revisión v4.2 mantiene `schema_version: 4` y el contrato externo v2, pero
añade orquestación con cinco tools GET. El agente busca acreedor por
NIF/nombre, confirma su detalle, consulta la sugerencia histórica de régimen y
busca referencias MA. El Code posterior repite y revalida todas esas consultas;
ninguna respuesta del modelo es autoridad ERP. Cuando hay NIF y nombre visibles,
el detalle debe confirmar ambos; solo se consideran equivalentes las variantes
jurídicas con núcleo idéntico de las familias `SL`/`SLU` y `SA`/`SAU`.

## Convergencia de las conversaciones Extracción / Inserción (30/07/2026)

Este bloque es el punto de reanudación conjunto de estas dos tareas Codex:

- `Campojoyma - Extraccion Facturas`,
  `019fae46-1789-75a0-a9e3-d3895d361610`;
- `Campojoyma - Inserción Facturas`,
  `019fae4b-5c41-7d11-93a7-c2c7187b433c`.

Los historiales explican las decisiones, pero no sustituyen al código, las
migraciones, los artefactos ni una comprobación actual de los servicios
externos. No se reproducen aquí credenciales ni secretos que aparecieron en
salidas históricas.

### Resultado conjunto

Las dos conversaciones no describen dos flujos independientes. Son las dos
mitades del mismo circuito:

~~~text
PDF
  -> extracción y contraste ERP
  -> borrador en Supabase
  -> revisión humana de ambigüedades y punteos
  -> preflight + dry-run con request_id
  -> commit en una ventana de escritura
  -> readback exacto o reconciliación sin repetir el POST
~~~

La extracción ya dejó de ser un OCR pasivo. El extractor n8n v4.2 publicado el
29/07/2026 tiene 32 nodos y cinco tools GET de solo lectura. Identifica al
acreedor por NIF/nombre, confirma su detalle y cuenta, consulta el histórico de
régimen, busca referencias MA exactas y devuelve un borrador contable. Un nodo
determinista repite esas consultas y puede degradar o bloquear la propuesta de
la IA; el modelo nunca es la autoridad del ERP.

La inserción de cabecera quedó validada técnicamente en Netagro TEST durante una
ventana controlada, pero no se dejó operativa permanentemente. La prueba
`TEST-A-00748886-01`, basada en Onduspan, terminó con:

| Evidencia | Resultado |
|---|---|
| ID de staging | `726561ee-4de9-4951-b1e2-fa497251f043` |
| `FRR_id` Netagro | `49681` |
| Número de entrada `FRR_numero` | `5425` |
| Total | `51.233,24 €` |
| Vencimiento confirmado manualmente | `29/08/2026` |
| Estado Supabase | `enviada_erp` / `sent` |
| Coincidencias exactas en Netagro | una |
| Contabilización | no solicitada; `FRR_IdAsientoNet=0` |
| CTB y punteos | no solicitados en esa prueba |

Netagro normalizó varios opcionales omitidos de `null` a `0`. La segunda
comparación interpretó inicialmente esa normalización como una discrepancia y
dejó el estado en reconciliación. Se corrigió la equivalencia, se leyó la
factura existente y se cerró como enviada sin repetir la escritura. Este caso
es la evidencia práctica del criterio fail-closed y de que un commit incierto
se reconcilia; nunca se reenvía a ciegas.

Una prueba posterior distinta, `TEST-PUNTEOS-2907`, no llegó a crear una
factura. El webhook escritor estaba inactivo y los tres candidatos eran
`albmaterial`; el usuario de escritura no tenía todavía el permiso mínimo
acotado para actualizar `AMA_idfactura`. No debe confundirse esa prueba fallida
de punteos con la inserción de cabecera ya confirmada.

### Decisiones vigentes que resuelven las aparentes contradicciones

- La regla actual de Campojoyma es ejercicio ERP `25`. Está en
  `facturas_recibidas_erp_rules`; no se infiere de la fecha.
- La política técnica activa hace que la fecha CTB copie la fecha de factura
  mediante `invoice_date`. La reunión operativa del 30/07/2026 aclaró que
  conceptualmente es la fecha de contabilización y que puede diferir cuando la
  factura llega tarde; la excepción queda pendiente de decisión explícita y no
  se cambia automáticamente.
- El flujo actual propone circuito de acreedores `OT`. Se conserva la
  arquitectura `GE` para agricultores y nunca se deduce el circuito desde el
  origen MA/GE de un punteo.
- La propuesta técnica de cuenta de gasto es `60200000001`; concepto y
  observación AEAT parten de `FRA. {proveedor}`. Son reglas configurables, no
  texto inventado por la IA. La propuesta de cuenta no se considera universal:
  si un mismo acreedor admite varias naturalezas contables debe quedar para
  selección manual.
- El régimen se resuelve desde una regla aprobada o desde histórico estricto
  del mismo proveedor, empresa, circuito y firma IVA. Si la evidencia no
  alcanza el umbral, queda manual.
- Las filas IVA se preparan automáticamente desde datos visibles y se validan
  aritméticamente. Un tramo parcialmente desconocido o una retención parcial
  no se completa inventando ceros.
- Los albaranes encontrados son candidatos. El enriquecedor puede solicitar su
  selección automática únicamente si todas las referencias MA documentadas
  son exactas, únicas, completas y uno-a-uno; la Edge repite la verificación
  contra ERP de forma atómica. Cualquier ambigüedad deja todos sin seleccionar.
  El enlace real sigue requiriendo permisos mínimos, commit y readback.
- La decisión más reciente sobre contabilización prevalece sobre el primer
  borrador de la conversación: todo envío TEST fuerza
  `FRR_Contabilizar='N'` en interfaz, regla, normalización y writer hasta que
  exista el mecanismo oficial de creación del asiento.
- Los vencimientos del PDF son evidencia. La prueba anterior incorporó uno
  después de confirmarlo; eso no lo convierte en un default automático.

### Estado verificable en repositorios

| Componente | Estado al consolidar |
|---|---|
| `campojoyma` | `main@0d666a7`, limpio y alineado con `origin/main`. |
| Extractor local | v4.2, 32 nodos, cinco tools GET, 18 escenarios del validador; `active=false` en la exportación por seguridad. |
| Escritor local | v2 deliberadamente desactivado. |
| Contrato/OpenAPI | API v0.2.4, 44 rutas y 45 operaciones. |
| `api-campojoyma` | `main@b5c0d3b`, alineado con remoto pero con 11 archivos modificados y dos tests nuevos sin commit; 104 pruebas locales pasan. |
| Estado externo declarado el 29/07 | extractor v4.2 activo; Edge saneadas desplegadas; API de lectura viva; escritor y DML cerrados tras la prueba. No se ha revalidado en vivo durante esta consolidación. |

El working tree local de `api-campojoyma` es la autoridad mientras siga sin
commit. Añade el readback del diario histórico, el filtro exacto
`referencia` para albaranes y el análisis seguro de grants por columna. La copia
`docs/patches/fastapi-netagro-v0.2.0.patch` de este repositorio está retrasada
respecto a ese working tree y no debe usarse para sobrescribirlo.

### Alcance realmente completado y siguiente paso

Queda validado:

- extracción enriquecida y contrastada;
- preflight, idempotencia y reconciliación fail-closed;
- creación de una cabecera no contabilizada y sin punteos, con readback exacto;
- cierre posterior de la ventana de escritura.

No queda validado todavía:

- operación continua para usuarios sin abrir manualmente el escritor;
- enlace transaccional de punteos MA o GE en el caso real pendiente;
- creación oficial del asiento y verificación de su número visible y apuntes;
- despliegue externo del frontend con los últimos cambios;
- commit/push del working tree autoritativo de `api-campojoyma` y sincronización
  posterior de su parche en este repositorio.

Antes de continuar debe elegirse el siguiente corte de aceptación:

1. Si se busca operar ya con facturas no contabilizadas y sin punteos, dejar
   permanente y monitorizada la ruta que ya creó la cabecera de prueba.
2. Si se busca el flujo completo solicitado, completar primero el permiso
   mínimo y el enlace MA/GE dentro de la transacción, y después homologar el
   mecanismo oficial de asiento. No basta con cambiar
   `DB_WRITES_ENABLED=true`.

## Estado vigente

La arquitectura activa se rige por estas decisiones:

- Supabase es la bandeja de revisión. ERP es la autoridad para maestros,
  duplicados y, cuando la escritura real sea homologada, el destino final.
- Los terceros se consultan exclusivamente mediante la API ERP. El circuito
  `GE` usa `agricultores`; `OT` y los demás tipos observados usan
  `acreedores`. No existe una fuente ni un fallback local.
- Antes de enviar se repite un preflight contra ERP: existencia del proveedor
  en su maestro canónico, coincidencia de su cuenta y duplicado exacto.
- El ejercicio del circuito actual de Campojoyma es la regla explícita 25. No se
  calcula desde la fecha ni se acepta como deducción del modelo.
- La fecha CTB hereda actualmente la fecha de factura mediante la política
  `invoice_date`, confirmada el 29/07/2026. La explicación operativa posterior
  del 30/07/2026 indica que puede diferir para facturas recibidas tarde; la
  política sigue activa en TEST, pero queda pendiente de revalidación antes de
  tratarla como verdad general de negocio.
- El régimen IVA se resuelve desde una regla explícita o, si falta, desde el
  histórico ERP del mismo proveedor, empresa, circuito y firma IVA. La
  resolución histórica exige al menos tres casos, ganador único y confianza
  mínima del 98 %; si no cumple, permanece manual.
- El tipo de factura procede de una regla aprobada o del circuito canónico del
  proveedor ya confirmado; nunca del origen `MA`/`GE` de un albarán.
- Gastos, CTB, punteos y asiento son conceptos distintos y se almacenan,
  validan y presentan por separado.
- Los punteos son candidatos y parten sin seleccionar. Para acreedores MA, una
  solicitud automática solo sobrevive si n8n y Edge verifican de forma
  independiente todas las referencias exactas, únicas, completas y uno-a-uno,
  con un máximo de 25. Cualquier ambigüedad rechaza el conjunto completo. Solo
  los candidatos finalmente marcados intervienen en el total.
- Un commit de estado desconocido se concilia con el <code>request_id</code> y
  el dry-run originales: solo búsqueda/readback exactos, sin repetir el POST
  escritor y sin resolver ambigüedades automáticamente.
- Los vencimientos extraídos del PDF son evidencia. No se copian
  automáticamente a <code>FechaVto</code> o <code>ImporteVto</code> sin una
  regla aprobada o confirmación manual.
- <code>acreedores_cache</code> ya no existe en Supabase. El runtime usa
  exclusivamente la API ERP y se conserva una exportación local de las cinco
  filas históricas para una recuperación controlada.

Los valores contrastados para un caso de aceptación, como ONDUSPAN
(ejercicio 25, tipo OT y régimen 2110), no son defaults universales. Solo se
aplican cuando una regla con ese alcance está aprobada.

## Confirmaciones funcionales recibidas el 28/07/2026

Campojoyma confirmó por correo que la casilla `Agricultor descontar` no se
utiliza. Por tanto, no debe mostrarse ni solicitarse en el frontend. El campo
físico <code>FRR_IdAgricultorDto</code> se conserva en el modelo y en el
contrato por compatibilidad con Netagro, con su valor neutro, pero no participa
en la edición ni se deriva de otro dato.

La respuesta incluye formularios vacíos y completos de las dos opciones
visibles bajo `Tipo factura`:

- `Compras de Género`, con la parte principal rotulada como `Proveedor`;
- `Acreedores`, con la parte principal rotulada como `Acreedor`.

Las capturas también muestran variantes distintas de
`Albaranes/Gtos para puntear`. Esto es evidencia de presentación y contenido,
no una autorización para deducir el tipo de factura desde la columna `Origen`
de un punteo. En particular, el ejemplo de acreedores contiene filas de origen
`MA`.

![Formulario vacío de Compras de Género](evidencias/facturas-recibidas/actualizacion-proyecto-2026-07-28/01-erp-compras-genero-formulario-vacio.png)

![Formulario vacío de Acreedores](evidencias/facturas-recibidas/actualizacion-proyecto-2026-07-28/02-erp-acreedores-formulario-vacio.png)

La segunda respuesta del mismo hilo documenta expresamente los
`Albaranes de entrada para compras de género`. Incluye el formulario vacío y
un ejemplo `25 / A26 / 8436`. La cabecera corresponde a `albentrada` y la
rejilla muestra sus partidas, género, cultivo/calidad, envase, bultos, kilos,
precio e importe. En el ejemplo existen pesos pero precio e importe son cero:
la recepción logística puede preceder a su valoración contable.

El cruce del ejemplo con la base identifica la cabecera como
<code>albentrada.AEN_idalbaran=82548</code> y su única línea como
<code>albentrada_lineas.AEL_idlinea=87097</code>, con partida
<code>AEL_muestreo=10843601</code>. Esta identidad técnica se usa para consultar
el detalle; la identidad visible sigue siendo campaña, serie y número.

![Albarán de entrada vacío](evidencias/facturas-recibidas/actualizacion-proyecto-2026-07-28/06-erp-albaran-entrada-formulario-vacio.png)

![Albarán de entrada cumplimentado](evidencias/facturas-recibidas/actualizacion-proyecto-2026-07-28/07-erp-albaran-entrada-ejemplo-relleno.png)

El cruce con la API y la base aclara dos dimensiones que no deben mezclarse:

- `FRR_tipofactura` representa el circuito de factura. `GE` es Compras de
  Género y resuelve el tercero en `agricultores`; `OT` y los demás tipos
  muestreados corresponden al circuito de acreedores.
- `Origen` representa la familia del albarán o gasto punteado. Una factura
  `OT` puede contener albaranes `MA`, por lo que nunca se deriva
  `FRR_tipofactura` desde `Origen`.

Las siete capturas funcionales, los hashes y la cronología saneada están en
[la carpeta de evidencias del 28/07/2026](evidencias/facturas-recibidas/actualizacion-proyecto-2026-07-28/).

## Evidencia operativa ERP de la reunión del 30/07/2026

Se recorrió completa la grabación de Teams y se conservaron nueve vistas ERP
distintas, más el documento usado para explicar el descuento de Onduspan. Las
capturas mantienen juntas la pantalla compartida y la transcripción asociada.
El índice, el flujo reconstruido, las conclusiones, los niveles de certeza y
los SHA-256 están en el
[dossier de la reunión del 30/07/2026](evidencias/facturas-recibidas/reunion-erp-2026-07-30/).

Una segunda pasada, con el vídeo pausado a pantalla completa y revisión de
fotogramas adyacentes, añade diez originales `1920×1080` y diez recortes
limpios `1674×881`. La serie mejora la lectura del ERP sin sustituir la
evidencia contextual con transcripción; ambas quedan enlazadas una a una en el
dossier y documentadas en su
[manifiesto de integridad](evidencias/facturas-recibidas/reunion-erp-2026-07-30/MANIFIESTO_PANTALLA_COMPLETA.md).

La reunión confirma el flujo del operador, pero no modifica por sí sola el
estado de homologación de la integración:

- Los albaranes de materiales se registran diariamente en una pantalla
  separada, vinculados al acreedor. Al introducir la factura se seleccionan los
  que la componen.
- En el caso `MA` mostrado, la suma de albaranes seleccionados se contrasta con
  la primera base de IVA. Una diferencia obliga a revisar tarifas, descuentos
  o la propia factura. Este control queda limitado al circuito observado hasta
  confirmar su alcance en facturas con varias bases u otros orígenes.
- `Entrada` es el registro de gestión y `Asiento` es el asiento real del diario
  contable.
- Guardar manualmente con `Contabilizar` marcado realiza, según la explicación
  funcional, el traspaso de gestión a contabilidad y crea el asiento. Ese es el
  objetivo operativo del ERP, no una capacidad ya homologada de nuestra API.
- `dry_run=true` no aparece en Netagro y no es un nuevo flujo para el operador:
  es el preflight propio de la integración y no escribe nada. Un commit TEST
  con `FRR_Contabilizar=N` puede crear solo la cabecera de gestión; la creación
  con `S` sigue bloqueada hasta conocer el mecanismo oficial y verificar el
  diario mediante readback.

También quedan registradas tres decisiones pendientes que no deben resolverse
con hardcodes:

- `Fecha CTB` significa fecha de contabilización y puede diferir de la fecha de
  factura cuando esta llega tarde. La política activa `invoice_date` se
  mantiene en TEST hasta recibir un criterio explícito para esa excepción.
- Algunas cuentas de gasto son estables por acreedor; cuando el mismo
  acreedor admite inmovilizado y gasto directo, la cuenta se deja en blanco y
  se elige manualmente. La propuesta `60200000001` no es una certeza universal.
- El descuento del `3 %` observado para Onduspan debe formalizarse como regla
  específica del proveedor, con identidad ERP y redondeo confirmados. La
  expansión exacta del origen `GC` tampoco se fija porque la transcripción
  alterna explicaciones distintas.

## Flujo y autoridad de datos

~~~text
Frontend React
  -> archivos_pdf
  -> factura-recibida-extraer
      -> n8n campojoyma-factura-extraer
          -> IA: solo datos visibles y evidencia del PDF
          -> API ERP: acreedor/agricultor canónico y reglas confirmadas
      -> facturasrecibidas (cabecera de staging)
      -> facturasrecibidas_ctb (solo CTB explícito)
      -> facturasrecibidas_punteos (propuestas no seleccionadas)

Frontend React
  -> facturas-recibidas-erp-read
      -> n8n apiCampojoyma
          -> FastAPI
              -> copia MariaDB de solo lectura

Frontend React
  -> factura-recibida-send-erp
      -> preflight de tipo de proveedor, cuenta y duplicado contra API ERP
      -> escritor v2, normalmente inactivo
      -> ventana controlada: alta con FRR_Contabilizar=N
      -> readback exacto o reconciliación, sin repetir el POST
      -> nunca declarar asiento creado sin diario
~~~

Secuencia operativa:

1. El usuario incorpora un PDF.
2. El PDF se guarda en <code>archivos_pdf</code>.
3. <code>factura-recibida-extraer</code> envía su contenido al extractor n8n.
4. La IA extrae los datos visibles y orquesta cinco tools GET acotadas. Por
   ahora solo resuelve acreedores; `erp_lookup` es evidencia provisional.
5. Un nodo determinista de n8n repite la resolución del acreedor, comprueba
   duplicado, resuelve el régimen por histórico y busca hasta 25 referencias MA.
   Si encuentra una factura ERP exacta y única, recupera en su lugar los punteos
   ya ligados mediante `/facturasrecibidas/{id}/punteos` y los muestra
   obligatoriamente con `S=false`.
   Los cinco slots IVA distinguen un placeholder explícito `0/10/0`, que se
   limpia como `0/0/0`, de un tramo parcialmente desconocido como
   `null/10/null` o `0/10/null`, que conserva los `null` y bloquea el borrador.
6. El enriquecedor n8n construye actualmente un borrador con ejercicio 25,
   fecha CTB igual a fecha de factura, tipo OT, gasto 60200000001, concepto/AEAT
   `FRA. <acreedor>` y ningún vencimiento ERP. El artefacto v4.2 todavía expresa
   `FRR_Contabilizar=S` como intención inicial, pero la Edge elimina los campos
   contables no confiables, aplica la regla viva `N` y el writer vuelve a forzar
   `N`. Por tanto, el valor efectivo persistido y enviado en TEST es siempre
   `N`; esa `S` intermedia no habilita ni acredita contabilización. La fecha CTB
   y la cuenta de gasto describen la política técnica activa, no cierran las
   excepciones funcionales detectadas en la reunión del 30/07/2026.
7. Los errores bloqueantes y avisos quedan visibles para revisión.
8. Antes del envío se consulta de nuevo ERP y se rechaza cualquier proveedor
   inexistente, cuenta incoherente o duplicado exacto.
9. Con el escritor cerrado, el flujo solo puede validar y reconciliar. En una
   ventana controlada puede crear una cabecera no contabilizada; el estado
   `enviada_erp` solo se confirma tras readback exacto. Ninguno de esos
   resultados acredita la creación de un asiento.

El parser interno usa <code>schema_version: 4</code>. Ante una salida inválida
repite una sola vez la extracción completa con las imágenes originales; nunca
repara a ciegas el JSON fallido. Las consultas ERP del agente son orientativas y
se repiten en el enriquecedor determinista con
parámetros derivados de los literales normalizados. El contrato externo del
workflow continúa siendo v2; son versiones de capas distintas.

El modelo tiene exactamente cinco HTTP tools GET conectadas por
<code>ai_tool</code>. <code>erp_lookup</code> puede conservar una coincidencia
provisional internamente coherente; el Code la vuelve a validar y degrada
cualquier ambigüedad. El parser usa
<code>autoFix=false</code>. JWT, ingest, renderizador PDF y OpenAI se resuelven
mediante credenciales administradas por n8n; sus valores no aparecen en el JSON
versionado.

## API ERP de lectura

La FastAPI del VPS intermedio consulta una copia local de MariaDB con
credenciales de solo lectura. No se ejecutan operaciones DDL contra Netagro.

Base interna desde n8n:

~~~text
http://172.19.0.1:18001
~~~

Webhook externo:

~~~text
https://n8nbecarios.srv894901.hstgr.cloud/webhook/apiCampojoyma?consulta=...
~~~

En n8n el parámetro correcto es <code>query.consulta</code>. La petición
interna se forma con:

~~~text
={{ 'http://172.19.0.1:18001/' + $json.query.consulta }}
~~~

Endpoints relevantes:

| Endpoint | Uso |
|---|---|
| <code>GET /health</code> | Estado de API y conexión de lectura. |
| <code>GET /empresas</code> | Catálogo real para <code>FRR_Idempresa</code>. |
| <code>GET /empresas/{empresa_id}</code> | Detalle de empresa. |
| <code>GET /acreedores</code> | Búsqueda acotada por nombre, NIF o código. |
| <code>GET /acreedores/{acreedor_id}</code> | Detalle autoritativo del proveedor y su cuenta. |
| <code>GET /acreedores/{acreedor_id}/gastos</code> | Reglas/cuentas de gasto observadas para el acreedor. |
| <code>GET /agricultores</code> | Búsqueda de productores por nombre, NIF o código. |
| <code>GET /agricultores/{agricultor_id}</code> | Detalle autoritativo del agricultor y su cuenta. |
| <code>GET /agricultores/{agricultor_id}/gastos</code> | Reglas/cuentas observadas para el agricultor. |
| <code>GET /facturasrecibidas/tipos</code> | Códigos observados; no constituye una regla de selección. |
| <code>GET /facturasrecibidas</code> | Consulta y comprobación de duplicados exactos. |
| <code>GET /facturasrecibidas/buscar</code> | Búsqueda exacta v0.2.4 por empresa, proveedor, número y circuito; admite ejercicio o, si aún no se conoce, exige fecha de factura. |
| <code>GET /facturasrecibidas/{factura_id}</code> | Cabecera real por <code>FRR_id</code> con proveedor canónico. |
| <code>GET /facturasrecibidas/{factura_id}/ctb</code> | CTB real asociado a una factura. |
| <code>GET /facturasrecibidas_ctb?factura_id={id}</code> | Alias de consulta CTB. |
| <code>GET /facturasrecibidas/{factura_id}/punteos</code> | Punteos ya ligados; en GE incluye histórico de entrada de solo lectura. |
| <code>GET /albaranes/entrada</code> | Cabeceras vigentes de albaranes de género. |
| <code>GET /albaranes/entrada/{albaran_id}/lineas</code> | Detalle logístico v0.2.3: línea, partida, género, categoría/calibre, envase, cultivo, tipo de cultivo, calidad, pesos, unidades, precio e importe. |
| <code>GET /albaranes/material/{material_id}/lineas</code> | v0.2.4: líneas de un albarán de material por su identificador estable <code>AMA_idalb</code>. |

Los listados responden con:

~~~json
{
  "items": [],
  "limit": 25,
  "offset": 0,
  "total": 0
}
~~~

La respuesta de
<code>GET /albaranes/entrada/{albaran_id}/lineas</code> conserva
<code>id</code>, <code>albaran_id</code>, <code>genero_id</code>,
<code>categoria_id</code>, <code>kilos_brutos</code>,
<code>kilos_netos</code>, <code>palets</code>, <code>bultos</code>,
<code>piezas</code>, <code>precio</code> e <code>importe</code>. La v0.2.3
añade:

- <code>linea</code> y <code>partida</code>;
- <code>genero_nombre</code>;
- <code>categoria_nombre</code>, <code>categoria_calibre</code> y
  <code>categoria_calibre_nombre</code>;
- <code>envase_id</code> y <code>envase_nombre</code>;
- <code>cultivo_id</code>, conservado como identificador crudo;
- <code>tipo_cultivo_id</code>, <code>tipo_cultivo_abreviatura</code> y
  <code>tipo_cultivo_nombre</code>;
- <code>calidad_codigo</code>.

Las columnas `TCUL` y `PCAL` de la pantalla no pertenecen a dos maestros
distintos. Ambas proceden de <code>tipocultivo</code>: `TCUL` es la abreviatura
<code>BIO</code> y `PCAL` es el nombre <code>ECOLOGICO</code> del mismo registro.
Para el albarán visible `8436`, la respuesta se obtiene con
<code>/albaranes/entrada/82548/lineas</code> y devuelve la línea
<code>87097</code>, partida <code>10843601</code>.

Las líneas MA también se consultan bajo demanda. Supabase conserva únicamente
la referencia estable del punteo (`source_table=albmaterial` y
`source_id=AMA_idalb`), nunca una copia de las líneas. El runtime v0.2.4 las
sirve directamente por <code>material_id</code>. El frontend conserva el
readback de punteos con líneas únicamente como compatibilidad ante una
indisponibilidad transitoria de la ruta específica.

La búsqueda interactiva de terceros debe ser acotada y con debounce. Tras
seleccionar uno se consulta su detalle en el maestro correspondiente; no se
rellena desde una copia persistida en Supabase ni se acepta una coincidencia
basada solo en un ID que también pueda existir en el otro maestro.

La búsqueda exacta de factura exige siempre empresa, proveedor y número.
<code>ejercicio</code> es opcional: si se omite,
<code>fecha_factura</code> pasa a ser obligatoria. El circuito se acota mediante
<code>tipo_factura</code>. Una petición sin ejercicio ni fecha devuelve
<code>422</code>, y una respuesta vacía, múltiple o incoherente no resuelve el
ejercicio. Aunque el filtro de tipo es opcional por compatibilidad de API, el
flujo Campojoyma lo envía siempre que ya conoce el circuito.

Desde la API v0.2.2, listado y detalle de facturas recibidas devuelven
<code>proveedor_tipo</code>, <code>proveedor_id</code>,
<code>proveedor_nombre</code> y <code>proveedor_nif</code>, además de las
identidades específicas de acreedor y agricultor. Para
<code>FRR_tipofactura="GE"</code> el proveedor canónico es agricultor; para los
demás tipos observados es acreedor.

## Modelo y duplicados

Tablas ERP principales:

| Tabla | Papel |
|---|---|
| <code>empresas</code> | Maestro de empresas. |
| <code>acreedores</code> | Maestro de terceros del circuito de acreedores. |
| <code>agricultores</code> | Maestro de proveedores agrícolas del circuito GE. |
| <code>facturasrecibidas</code> | Cabecera real. |
| <code>facturasrecibidas_ctb</code> | Apuntes CTB reales. |
| <code>tipoagricultor</code> | Reglas contables cuando están confirmadas. |
| <code>albentrada</code> | Cabecera vigente del albarán de entrada de género. |
| <code>albentrada_his</code>/<code>albentrada_hislineas</code> | Histórico y líneas utilizados para leer albaranes GE ya ligados. |

Relaciones prácticas:

~~~text
empresas.EMP_idempresa
  -> facturasrecibidas.FRR_Idempresa

facturasrecibidas.FRR_tipofactura = GE
  -> agricultores.AGR_Idagricultor = facturasrecibidas.FRR_idproveedor

facturasrecibidas.FRR_tipofactura <> GE (tipos observados)
  -> acreedores.ACR_Codigo = facturasrecibidas.FRR_idproveedor

facturasrecibidas.FRR_id
  -> facturasrecibidas_ctb.FRC_idfacturarecibida
  -> albentrada_his.AEH_idfacturafirme

albentrada_his.AEH_idalbaran
  -> albentrada.AEN_idalbaran

albentrada_his.AEH_id
  -> albentrada_hislineas.AHL_idalbhis
~~~

La clave de duplicado funcional es:

~~~text
FRR_Idempresa + FRR_ejercicio + circuito + FRR_idproveedor + FRR_numerofactura
~~~

La comprobación debe usar los cinco valores exactos, ignorar registros
descartados/duplicados de staging cuando corresponda y mostrar el candidato que
causa el conflicto. Una caída de API no equivale a «proveedor no encontrado»:
se trata como indisponibilidad técnica y el envío falla de forma cerrada.

## Supabase staging

Proyecto:

~~~text
CAMPOJOYMA
adbprpemmbspntbttziz
~~~

Tablas operativas:

| Tabla | Uso |
|---|---|
| <code>archivos_pdf</code> | PDF base64, hash y metadatos. |
| <code>facturasrecibidas</code> | Cabecera, estado, extracción, validación y respuesta ERP. |
| <code>facturasrecibidas_ctb</code> | CTB explícito y separado. |
| <code>facturasrecibidas_punteos</code> | Candidatos de punteo, selección manual y selección MA exacta revalidada. |
| <code>public.facturas_recibidas_erp_rules</code> | Reglas aprobadas con alcance de empresa/proveedor. |

<code>acreedores_cache</code> se retiró físicamente el 22/07/2026 después de
eliminar sus dependencias de runtime y recibir aprobación expresa. La migración
<code>20260722190000_retire_acreedores_cache.sql</code> deja el cambio
reproducible. La exportación previa está en
<code>docs/evidencias/facturas-recibidas/acreedores-cache-backup-2026-07-22.json</code>
y su SHA-256 es
<code>79F49160CA74A3B2CAE88C026627B258FB10D69F27B38B7EB28E389152E4B5BC</code>.

La unicidad física de staging usa empresa, ejercicio, proveedor, circuito y el
número de factura tras <code>btrim</code>, es decir, sin espacios exteriores.
Edge usa además una normalización alfanumérica para verificar la identidad
visible. Esa normalización adicional no forma parte de la expresión del índice
de Supabase.

Estados principales:

| Estado | Significado |
|---|---|
| <code>pendiente_revision</code> | Faltan datos o existe una revisión manual pendiente. |
| <code>validada</code> | Supera las validaciones de preparación, no implica asiento. |
| <code>duplicada</code> | Conflicto confirmado por PDF o clave funcional. |
| <code>enviada_erp</code> | Solo válido tras una creación real confirmada por ERP. |
| <code>error_erp</code> | El envío/preflight no pudo completarse. |
| <code>descartada</code> | Registro excluido manualmente de staging. |

Los identificadores <code>FRR_id</code>, <code>FRR_numero</code>,
<code>FRC_id</code> y <code>FRC_idfacturarecibida</code> deben permanecer
nulos hasta que el ERP confirme una escritura real.

## Responsabilidades de las Edge Functions

### factura-recibida-extraer

- Lee el PDF almacenado y llama al extractor.
- Guarda la cabecera normalizada.
- Guarda CTB únicamente si el origen devuelve apuntes explícitos y trazables.
- Parte de candidatos sin seleccionar. Solo conserva una solicitud de selección
  MA si la verificación exacta e independiente de Edge valida atómicamente el
  conjunto completo; una duda deja todos a `S=false`.
- No inventa cuenta ni vencimiento. Ejercicio, fecha CTB, tipo, régimen, cuenta
  de gasto y concepto se completan únicamente mediante las reglas contables
  verificables descritas en este documento.
- Devuelve estado y validaciones estructuradas.

### factura-recibida-ingest

- Recibe fuentes de email/agente o payload externo.
- Aplica las mismas reglas de normalización y validación.
- No crea una línea CTB por defecto para el flujo actual.
- Mantiene separada la evidencia de extracción de los campos ERP confirmados.

### facturas-recibidas-erp-read

Es el proxy server-side que protege el JWT. Su lista permitida incluye las
consultas concretas necesarias para empresas, acreedores, agricultores,
detalle, gastos, facturas, tipos, CTB, punteos y albaranes de entrada. No
acepta rutas arbitrarias ni navegación por segmentos.

Secrets:

~~~text
N8N_CAMPOJOYMA_READ_WEBHOOK_URL
N8N_CAMPOJOYMA_WEBHOOK_URL
N8N_CAMPOJOYMA_WEBHOOK_JWT_SECRET
N8N_CAMPOJOYMA_WEBHOOK_JWT_EXP_SECONDS
~~~

### factura-recibida-send-erp

Antes de invocar al escritor:

1. Comprueba que el proveedor existe en el maestro canónico indicado por el
   circuito: agricultor para GE y acreedor para los demás tipos observados.
2. Contrasta la cuenta de la factura con la cuenta de ese maestro.
3. Busca el duplicado exacto por empresa, ejercicio, proveedor, número y
   circuito.
4. Bloquea si la API no está disponible, si el proveedor no existe, si la
   cuenta difiere o si aparece un candidato duplicado.
5. Fuerza `FRR_Contabilizar=N` en TEST.
6. Usa el mismo `request_id` y payload funcional en dry-run y commit.
7. Ante un resultado incierto, busca y reconcilia la factura exacta; no repite
   el POST escritor.
8. Conserva cualquier resultado <code>reference_only</code> como referencia,
   sin cambiarlo semánticamente a «asiento creado».

El escritor v2 debe repetir estas garantías antes de cualquier escritura.

## Reglas de negocio y edición manual

Las variaciones específicas no se hardcodean en frontend ni se deducen por
heurística. Se modelan en <code>public.facturas_recibidas_erp_rules</code> y deben ser
visibles/editables desde administración cuando corresponda.

Reglas vigentes:

- Empresa: se selecciona del catálogo ERP.
- Ejercicio: la regla general aprobada de Campojoyma fija `25`. Una regla de
  proveedor puede especializarla; no se infiere desde la fecha.
- Tipo de factura: regla aprobada, circuito canónico del proveedor confirmado
  o selección manual.
- Régimen IVA: regla aprobada; en su ausencia, histórico ERP estricto del mismo
  proveedor, empresa, circuito y firma IVA (mínimo 3, ganador único y ≥98 %);
  si no hay evidencia suficiente, selección manual.
- Fecha CTB: la política activa en TEST es `invoice_date`, confirmada el
  29/07/2026. Desde la reunión del 30/07/2026 queda pendiente revalidar las
  facturas recibidas tarde, donde la fecha de contabilización puede diferir.
- Cuenta del proveedor: detalle del agricultor para GE o del acreedor para los
  demás tipos observados.
- Gastos: la regla técnica general propone la cuenta `60200000001`; una regla
  de proveedor, evidencia ERP o edición explícita puede especializarla. Si el
  acreedor puede corresponder a más de una naturaleza contable, la reunión
  confirma que debe conservarse la selección manual. La IA no inventa cuentas.
- Concepto y observación AEAT: plantilla aprobada `FRA. {proveedor}`.
- Contabilizar: el flujo manual explicado usa la casilla marcada para pasar de
  gestión a contabilidad y crear el asiento. La integración mantiene `N` en
  TEST, forzado de extremo a extremo, hasta que exista y se homologue el
  mecanismo oficial de asiento.
- Vencimientos: evidencia separada hasta existir regla aprobada o confirmación.
- Agricultor a descontar: Campojoyma confirma que no se utiliza; no se muestra
  ni se solicita en la interfaz.

Los avisos informan de datos que requieren revisión. Los errores bloquean el
envío. Para un mismo campo se muestra una sola incidencia semántica.

## Separación contable obligatoria

### Gastos

Los pares <code>FRR_igasto*</code>/<code>FRR_ctagasto*</code> son desglose de
gastos de la cabecera. Proceden de reglas ERP confirmadas o de una decisión
manual explícita.

### CTB

<code>facturasrecibidas_ctb</code> contiene apuntes <code>FRC_*</code>. No son
líneas de producto, gastos ni punteos. Si no hay CTB confirmado se conserva una
lista vacía; no se construye desde la base o desde la cuenta del proveedor.

### Punteos

Las propuestas de punteo de staging son candidatos de conciliación y su estado
inicial no confiable se sanea a no seleccionado. El usuario puede seleccionarlos
manualmente. Para acreedores MA existe además una vía automática estricta:
n8n solicita la selección solo cuando todas las referencias visibles tienen
una coincidencia exacta, única, completa y uno-a-uno, y Edge repite esas
consultas antes de conservar `S=true`. Si falla una sola referencia, se rechaza
el conjunto completo. El total suma únicamente los candidatos finalmente
marcados; la lectura de una factura ERP también puede devolver vínculos que ya
existen, siempre mostrados sin volver a seleccionarlos.

La lectura v0.2.2 añade los albaranes GE que Netagro ya vinculó a una factura:
lee <code>albentrada_his</code> por <code>AEH_idfacturafirme</code> y, cuando
se solicitan, sus líneas desde <code>albentrada_hislineas</code>. Esas filas
son evidencia de solo lectura: no aparecen en candidatos y no pueden enviarse
en una mutación.

Cada fila GE distingue <code>importe_origen</code>, conservado del histórico,
de <code>importe_factura</code>. Si ambas bases totales no coinciden, la API
prorratea la base de factura y lo declara mediante
<code>importe_metodo=prorrateo_base_factura</code>; no sobrescribe el importe
histórico. El mayor <code>AEH_id</code> absorbe de forma determinista el residuo
de redondeo para que la suma final cuadre al céntimo.

En ASG y FGC, <code>importe_origen</code> conserva el gasto bruto e
<code>importe_factura</code> usa el importe realmente asignado a la factura
(<code>Importe P</code>).

### Asiento

El asiento pertenece al ERP y solo existe cuando el mecanismo oficial devuelve
un identificador verificable y sus apuntes. Staging, CTB propuesto, punteos,
dry-run y <code>reference_only</code> no son un asiento.

## Campos principales

| Dato | Campo | Fuente permitida |
|---|---|---|
| Empresa | <code>FRR_Idempresa</code> | Catálogo ERP/manual. |
| Ejercicio | <code>FRR_ejercicio</code> | Regla general Campojoyma `25`, especializable por proveedor; nunca inferido de la fecha. |
| Tipo | <code>FRR_tipofactura</code> | Regla aprobada, circuito canónico del proveedor confirmado o manual. |
| Régimen | <code>FRR_idregimen</code> | Regla aprobada o histórico ERP estricto; manual si la evidencia no alcanza el umbral. |
| Proveedor | <code>FRR_idproveedor</code> | Búsqueda y detalle en el maestro indicado por <code>FRR_tipofactura</code>; conservar <code>proveedor_tipo</code>. |
| Cuenta proveedor | <code>FRR_idcuenta</code> | Detalle canónico de agricultor/acreedor y preflight. |
| Número factura | <code>FRR_numerofactura</code> | PDF/IA, confirmado por usuario. |
| Fecha factura | <code>FRR_fechafactura</code> | PDF/IA. |
| Fecha contable | <code>FRR_fechactb</code> | Regla aprobada o manual. |
| Base/IVA/retención/total | <code>FRR_base*</code>, <code>FRR_iva*</code>, <code>FRR_cuota*</code>, <code>FRR_*ret</code>, <code>FRR_totalfac</code> | PDF/IA y validación aritmética. |
| Gastos | <code>FRR_igasto*</code>/<code>FRR_ctagasto*</code> | Regla Campojoyma `60200000001`, regla específica, evidencia ERP o manual. |
| Vencimiento | <code>FechaVto</code>/<code>ImporteVto</code> | Regla aprobada o manual. |
| CTB | <code>facturasrecibidas_ctb</code> | Solo apuntes explícitos. |
| Punteos | <code>facturasrecibidas_punteos</code> | Candidatos; selección manual o verificación automática MA exacta en dos capas. |

## Caso histórico útil: FV26-13

El caso real <code>FV26-13</code> demostró por qué no deben mezclarse gastos y
CTB ni inferirse cuentas:

| Campo | Valor |
|---|---:|
| <code>FRR_id</code> | 49174 |
| <code>FRR_idproveedor</code> | 1924 |
| <code>FRR_igasto1</code> | 15973.30 |
| <code>FRR_ctagasto1</code> | 40090001924 |
| <code>FRR_igasto2</code> | -1597.33 |
| <code>FRR_ctagasto2</code> | 60000000010 |
| <code>FRR_totalfac</code> | 14951.01 |

Los apuntes CTB observados tenían importes equivalentes, pero su coincidencia en
ese ejemplo no autoriza a copiar automáticamente un bloque al otro. La cuenta
de comisión procede de una regla de <code>tipoagricultor</code>; no se elige
mediante IA.

## Validación mínima antes del envío

- Empresa, ejercicio, proveedor, cuenta, número, fecha, tipo y régimen presentes.
- Proveedor existente en el maestro canónico ERP; no basta un ID coincidente
  en el otro maestro.
- Cuenta coincidente con ese maestro.
- Duplicado exacto inexistente en ERP.
- Importes coherentes dentro de la tolerancia definida.
- Fecha CTB igual a la fecha de factura mientras rija `invoice_date`; los casos
  de recepción tardía quedan en revisión hasta aprobar la excepción indicada
  en la reunión del 30/07/2026.
- Circuito incluido en la comprobación exacta del duplicado.
- Gastos, CTB y punteos validados en sus bloques independientes.
- API disponible durante el preflight.

Si no se resuelve un dato obligatorio, la factura permanece en revisión y el
envío se bloquea. No se sustituye un error de maestro por una advertencia ni se
usa una copia local.

## Decisiones y pendientes

Decisiones vigentes:

- La pantalla principal lista staging, no todo el histórico ERP.
- Los catálogos, acreedores y agricultores se consultan bajo demanda.
- <code>FRR_tipofactura = "1"</code> no es un valor confirmado ni un default.
- n8n extrae y contrasta; la Edge Function persiste en Supabase.
- La escritura real debe devolver identificadores ERP verificables.

Pendientes externos:

1. Homologar el mecanismo oficial de creación del asiento. El readback de
   asientos históricos ya existe, pero no crea uno nuevo.
2. Confirmar las descripciones funcionales pendientes de algunos tipos.
3. Completar la mutación MA con el grant mínimo, activar su puerta solo durante
   la prueba y verificar `TEST-PUNTEOS-2907`; confirmar también el contrato de
   mutación GE antes de sacarlo del modo de solo lectura.
4. Completar aceptación funcional de los defaults v4.2 y del régimen histórico
   cuando no alcanza el umbral de confianza.
5. Desplegar externamente el frontend; n8n v4.2 ya está importado, activo y
   respaldado.
6. Convertir la ventana controlada de alta no contabilizada en una operación
   continua monitorizada, si ese es el corte funcional elegido.
7. Commit/push del working tree de `api-campojoyma` y sincronización posterior
   del parche conservado en este repositorio.
8. Confirmar la regla de Fecha CTB para facturas recibidas tarde y decidir si
   `invoice_date` conserva excepciones manuales o debe sustituirse por otra
   política explícita.
9. Revisar el alcance de la propuesta `60200000001` para que un acreedor con
   varias naturalezas contables quede en selección manual.
10. Formalizar el descuento del 3 % de Onduspan con identidad ERP, base y
    redondeo, y confirmar el diccionario oficial del origen `GC`.

## Línea base funcional del lote tratado, previa a v4.1 (29/07/2026)

Se reprocesaron las diez facturas de
`Downloads/facturas campojoyma/tratadas` contra n8n v4, Edge y la API ya
endurecidos. Resultado: **10/10 sin errores bloqueantes**. Todas quedaron con
fecha CTB igual a la fecha de factura, ejercicio 25, régimen 2110 y tipo OT.

Esta tabla conserva la línea base de v4. No representa una regresión real de la
revisión de prompt v4.1.

Los vínculos se mantuvieron como referencias ERP sin selección automática:

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

### Regresión no persistente del prompt v4.1

Tras publicar la revisión v4.1 se enviaron de nuevo los diez PDF tratados
directamente al webhook autenticado. Resultado: **10/10 HTTP 200 y
`ok=true`**. Esta ruta termina en `Respond to Webhook`; no llama a la Edge de
ingesta y no creó ni modificó facturas en Supabase.

Las ejecuciones correctas no se conservan por la política de privacidad del
workflow. Para evitar confundirlas con el lote v4 histórico se verificó
directamente el estado publicado de n8n: `activeVersionId` y `versionId`
coincidían en `e9e831a8-0be3-4277-bccf-036c71a8d602`. Esa versión activa tiene
27 nodos, cero tools HTTP y un mensaje de sistema que comienza por
`PROMPT_VERSION: 4.1`.

El visor PDF corregido se verificó en la UI. Descarga y valida los bytes
<code>%PDF-</code>, reconstruye el <code>Blob</code> con
<code>application/pdf</code> y evita la carrera de carga/desmontaje de pdf.js.
Abrir y descargar quedan disponibles en cuanto se valida el original, incluso
si la previsualización falla. También se verificó la apertura dinámica de las
tres líneas vinculadas a Smurfit.

## Errores a evitar

- Usar <code>acreedores_cache</code> como fuente o fallback.
- Resolver <code>FRR_idproveedor</code> contra acreedores sin comprobar el
  circuito; los IDs de acreedor y agricultor pueden colisionar.
- Inferir <code>FRR_tipofactura</code> desde <code>Origen</code>.
- Tratar Supabase como ERP real.
- Exponer el JWT en variables de frontend.
- Cargar todo el histórico ERP en la pantalla principal.
- Inferir ejercicio desde una fecha.
- Aplicar la política de fecha CTB de Campojoyma a otros clientes sin su
  confirmación.
- Asignar tipo, régimen o vencimiento fuera de las reglas y evidencias
  aprobadas.
- Confundir gastos, CTB, punteos o asiento.
- Seleccionar punteos automáticamente.
- Rellenar identificadores ERP antes de una escritura real.
- Declarar un asiento creado a partir de <code>reference_only</code>.
- Ejecutar DDL contra MariaDB Netagro.
