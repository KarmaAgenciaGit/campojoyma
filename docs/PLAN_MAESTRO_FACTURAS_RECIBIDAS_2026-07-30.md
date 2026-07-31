# Plan maestro de facturas recibidas

Estado de referencia: 30 de julio de 2026.

Este documento es la fuente operativa única para terminar el circuito de
facturas recibidas de Campojoyma. Reúne el estado comprobado del frontend,
Supabase, FastAPI y Netagro, y sustituye como plan de ejecución a las
propuestas parciales anteriores. Los documentos históricos y las evidencias
de reunión se conservan como soporte, pero no deben usarse para decidir el
comportamiento actual sin contrastarlos con este documento.

Evidencia visual y transcripción saneada:
[`reunion-erp-2026-07-30`](evidencias/facturas-recibidas/reunion-erp-2026-07-30/README.md).

## Estado de ejecución: 31 de julio de 2026

El circuito de lectura v3 ya está desplegado y probado. El detalle exacto,
artefactos, checksums y rollback se conserva en
[DESPLIEGUE_FACTURAS_RECIBIDAS_V3_2026-07-31.md](DESPLIEGUE_FACTURAS_RECIBIDAS_V3_2026-07-31.md).

- `api-campojoyma` `0.3.2`, commit de release `29effcccaccf` sobre el cambio
  funcional `060484b`, está activo en `karma-box`.
- El gateway HTTPS autenticado está activo en
  `https://netagro-api-v2.srv894901.hstgr.cloud`.
- Los secretos requeridos están provisionados fuera de Git y las seis Edge
  Functions v3 están activas. La lectura está en versión 19.
- El runtime informa `write_mode=disabled`,
  `accounting_mode=unavailable`, `target_id=NULL`,
  `dataset_epoch=NULL` y `ready_for_commit=false`.
- El runtime no considera preparado el almacén de idempotencia y devuelve
  `schema_version=NULL` mientras falten target y epoch. El archivo heredado v1
  se conserva sin migrar en el backup.
- La migración `harden_facturas_recibidas_erp_v3` está aplicada en Supabase.
  El watchdog está activo y los RPC v2 de escritura permanecen cerrados.
- La referencia `49305` continúa como `legacy_unverified`; `49681` sigue
  marcada como `stale`. Ninguna fue religada.
- Verificación superada: 196 pruebas FastAPI y OpenAPI con 46 rutas/47
  operaciones, 98 pruebas Deno, 19 pruebas
  estáticas, 138 pruebas frontend, TypeScript y builds correctos.
- Desde 0.3.2, `q` en `/cuentas-contables` busca únicamente por número y
  descripción; una búsqueda por NIF requiere el parámetro explícito `nif`.
- El frontend actualizado está construido, desplegado localmente y comprobado
  con sesión autenticada en `http://localhost:8080`. IVA, gastos y CTB usan
  catálogos reales y no se observaron respuestas HTTP fallidas.
- El dominio público aún sirve el bundle anterior. La compatibilidad de lectura
  evita su error de cuentas, pero la UI v3 no podrá publicarse hasta recuperar
  acceso autorizado a `217.154.101.108`.

El siguiente orden obligatorio es: publicar el build ya probado cuando exista
acceso al host; provisionar después un clon persistente con identidad de
dataset e idempotencia v2; ejecutar los gates de contadores, punteos, canario,
concurrencia y fallos; y solo entonces considerar la habilitación gradual de
gestión. La contabilidad permanece cerrada hasta disponer del mecanismo oficial.

## 1. Flujo objetivo

```text
PDF
  -> extracción
  -> revisión humana
  -> Validar con ERP
  -> confirmar alta de gestión
  -> readback de cabecera, CTB y punteos
  -> contabilización mediante mecanismo oficial
  -> readback del asiento
```

Validar y crear son operaciones distintas. Contabilizar es una tercera
operación y nunca forma parte implícita del alta de gestión.

## 2. Estado comprobado antes de la implementación

### Aplicación y orquestación

- El frontend principal parte de un working tree limpio.
- El repositorio `api-campojoyma` contiene cambios desplegados en la versión
  `0.2.4` que todavía no estaban consolidados en Git al iniciar este trabajo.
- El workflow n8n de escritura está desactivado. El mensaje «webhook no
  registrado» es consecuencia de ese estado, no un error contable de Netagro.
- n8n permanece en el circuito de extracción. La escritura debe ir desde Edge
  directamente al FastAPI autenticado.
- Verificación operativa del 30 de julio:
  - `FIO92NfGcsWYsHC5`, «CAMPOJOYMA - Entrada segura de facturas recibidas
    v4.2 (webhook v2)», está activo y exige `contract_version=2`; valida y
    devuelve el mismo `request_id`;
  - `4wu0VF2RiwT4eyJC`, «Campojoyma - Facturas recibidas write v2
    (DESACTIVADO)», continúa inactivo.
- `factura-recibida-extraer` normalizaba CTB pero lo descartaba al guardar;
  `factura-recibida-ingest` sí lo conservaba.
- La vista previa local del frontend no era un dry-run ERP. El dry-run real se
  ejecutaba después de que la sincronización ya hubiera pasado a `sending`.

### Entorno e identidad

- La API TEST está activa y expone una MariaDB clonada.
- `DB_WRITES_ENABLED=false`.
- El runtime anterior disponía de un archivo externo de idempotencia de
  esquema 1. El runtime 0.3.2 no lo considera preparado sin una identidad
  completa de target y dataset.
- La copia se refresca y puede reutilizar los mismos IDs para facturas
  distintas. Una referencia ERP sin entorno y generación no es estable.
- La referencia local que conservaba `remote_frr_id=49681` quedó obsoleta tras
  un refresco y no puede considerarse confirmada.

### Alta de facturas

- `FRR_id`, `FRR_numero` y `FRC_id` no son `AUTO_INCREMENT`.
- El writer anterior calculaba los tres con `MAX()+1`; ese algoritmo no es
  válido para concurrencia ni respeta el protocolo del ERP.
- Los contadores efectivos son:

| Uso | `CON_NombreTabla` | `CON_TipoContador` |
| --- | --- | --- |
| `FRR_id` global | `facturasrecibidas` | cadena vacía |
| Número de factura | `facturasrecibidas` | `{empresa}_{ejercicio}` |
| `FRC_id` global | `FacturasRecibidas_Ctb` | cadena vacía |

- La numeración visible de gestión es por empresa y ejercicio, no por tipo de
  factura.
- `contadores`, `facturasrecibidas`, `facturasrecibidas_ctb`, `asientos`,
  `asientolineas` e `ivasoportado` están confirmadas como InnoDB.
- El alta sin contabilidad debe escribir expresamente
  `FRR_Contabilizar='N'`. El valor por defecto de la tabla es `S`.

### Contabilidad

- No hay triggers ni eventos relevantes en el dump completo.
- No se encontró una rutina de base de datos que construya el asiento.
- La relación real es:
  `facturasrecibidas.FRR_IdAsientoNet -> contabilidad.asientos.IdAsiento`.
- El asiento debe tener además `cdorigen='FR'` e
  `idorigen=facturasrecibidas.FRR_id`.
- Los apuntes viven en `contabilidad.asientolineas`.
- `contabilidad.ivasoportado.IdRegistro` enlaza con el apunte de acreedor.
- `FRR_Contabilizar='S'` no prueba que exista contabilización: hay cabeceras
  con ese valor y sin asiento válido.
- `facturasrecibidas_ctb` es distribución analítica auxiliar. No es el diario,
  no es obligatorio y no debe generarse automáticamente.

## 3. Arquitectura que se implementa

### Identidad del target

Cada referencia debe incluir:

- `erp_target_id`;
- `erp_dataset_epoch`;
- `remote_frr_id`;
- hash del payload enviado;
- huella de negocio;
- fecha del último readback válido.

La identidad remota es la tupla
`(erp_target_id, erp_dataset_epoch, remote_frr_id)`. Un cambio de epoch
convierte las referencias anteriores en `stale`; nunca las religa por número.

FastAPI expone `GET /meta/runtime` con:

- `target_id`;
- `dataset_epoch`;
- fecha del snapshot;
- `write_mode`;
- `accounting_mode`;
- versión del almacén de idempotencia.

### Camino de red

FastAPI continúa escuchando únicamente en `karma-box:127.0.0.1:8001`. El
túnel privado lo presenta al VPS en `172.19.0.1:18001`; no se abre MariaDB ni
el puerto de FastAPI a Internet. Supabase Edge accede mediante un gateway
HTTPS mínimo publicado por el Traefik existente:

```text
Supabase Edge
  -> https://netagro-api-v2.srv894901.hstgr.cloud
  -> Traefik
  -> nginx autenticado
  -> 172.19.0.1:18001
  -> túnel SSH
  -> FastAPI
```

El gateway y FastAPI exigen `X-Netagro-Api-Key`. El secreto se provisiona
fuera de Git y Edge lo recibe como `CAMPOJOYMA_API_V2_SHARED_SECRET`. El
gateway no contiene lógica de negocio y no altera que las escrituras sigan
cerradas por `DB_WRITES_ENABLED=false`.

### Contrato de alta

Se conserva `POST /facturasrecibidas` y se añade el contrato 3:

```json
{
  "contract_version": 3,
  "operation": "validate",
  "request_id": "uuid",
  "target_id": "netagro-test-write",
  "dataset_epoch": "uuid",
  "accounting_mode": "none",
  "cabecera": {},
  "ctb": [],
  "punteos": []
}
```

`validate` no modifica MariaDB, no reserva números y no cambia el estado a
`sending`. Puede dejar auditoría en los almacenes externos.

`commit` exige el mismo request, target, epoch y hash. Cualquier edición
invalida la validación anterior.

### Reserva transaccional

En `commit`, dentro de una sola transacción:

1. comprobar target y epoch;
2. repetir validaciones y duplicados;
3. bloquear las filas exactas de `contadores` con `FOR UPDATE`;
4. comprobar que cada contador existe y no está por debajo del máximo real;
5. reservar el siguiente `FRR_id`;
6. reservar `FRR_numero` con `{empresa}_{ejercicio}`;
7. reservar un rango contiguo de `FRC_id` cuando exista CTB;
8. bloquear y comprobar los punteos;
9. insertar cabecera con `FRR_Contabilizar='N'`, CTB y enlaces;
10. confirmar;
11. ejecutar readback exacto.

Un fallo anterior al commit revierte también los contadores. Un timeout o
fallo cuyo commit no pueda descartarse pasa a `needs_reconciliation` y nunca
se reenvía automáticamente.

### Contabilización

La contabilización será un adaptador separado:

```text
POST /facturasrecibidas/{FRR_id}/contabilizar
```

Solo se habilitará cuando Hispatec proporcione un mecanismo oficial o una
traza controlada identifique de forma reproducible ese mismo mecanismo. La
traza no autoriza a sintetizar los SQL del diario.

El estado `created` exige:

- ID técnico positivo;
- asiento con origen `FR` y `idorigen` correcto;
- número visible positivo;
- apuntes no vacíos;
- Debe y Haber cuadrados;
- detalle fiscal coherente, incluidos varios tramos y retención.

## 4. Reglas de interfaz y datos

- Régimen IVA conserva su selector actual.
- IVA % se selecciona desde el catálogo efectivo de `tiposivacli`; se añade
  0 % y se conserva como opción cualquier valor histórico desconocido.
- Elegir IVA no recalcula cuotas silenciosamente.
- Gastos y CTB usan el mismo combobox remoto de cuentas, buscando por número o
  descripción.
- El servidor deriva el esquema contable desde `empresa_id`; el cliente no
  envía nombres de esquema.
- Cuenta e importe forman un par obligatorio. Una fila totalmente vacía no se
  envía.
- CTB se presenta como «Distribución analítica (CTB)» y es opcional.
- Fecha CTB nace de la fecha de factura. Al editarla pasa a origen `manual` y
  no vuelve a sobrescribirse.
- Los punteos siempre se seleccionan manualmente. Las diferencias son avisos
  salvo una regla `warning|block` aprobada en
  `facturas_recibidas_erp_rules`.
- No se generaliza el descuento del 3 % observado en ONDUSPAN.

La pantalla separa:

- estado documental;
- **Registro ERP**;
- **Contabilidad**.

Los CTA son:

- «Validar con ERP»;
- «Enviar a gestión ERP (sin contabilizar)»;
- «Contabilizar», solo cuando la capacidad oficial esté disponible.

## 5. Errores e idempotencia

Todas las capas comparten:

```json
{
  "code": "counter_drift",
  "category": "environment",
  "user_message": "No se puede reservar la numeración de Netagro.",
  "technical_details": {},
  "retryable": false,
  "reconciliation_required": false,
  "request_id": "uuid",
  "target_id": "netagro-test-write",
  "dataset_epoch": "uuid"
}
```

Códigos mínimos:

- `writer_disabled`;
- `stale_environment`;
- `invalid_account`;
- `duplicate_invoice`;
- `counter_missing`;
- `counter_drift`;
- `punteo_conflict`;
- `idempotency_conflict`;
- `ambiguous_commit`;
- `accounting_unavailable`;
- `upstream_unavailable`.

El detalle técnico se conserva en auditoría. La UI muestra únicamente
`user_message` y `request_id`.

## 6. Clon persistente y refresh

El target escribible debe ser una instancia separada del clon que se refresca
diariamente. El refresh del target escribible es manual:

1. comprobar `DB_WRITES_ENABLED=false`;
2. bloquear nuevas validaciones y commits;
3. comprobar que no existen `in_progress`, `sending`,
   `needs_reconciliation` ni `unknown` sin resolver;
4. crear backup recuperable;
5. restaurar el snapshot;
6. verificar motores, esquema, tablas, contadores y permisos;
7. generar un nuevo `dataset_epoch` fuera de MariaDB;
8. marcar como `stale` las referencias del epoch anterior;
9. reiniciar API y verificar `/health` y `/meta/runtime`;
10. mantener las escrituras apagadas hasta completar un canario.

La aplicación nunca crea, altera o elimina estructuras de Netagro durante
import, arranque o petición.

## 7. Gates y verificación

No se habilita la escritura hasta demostrar:

- working tree y runtime API equivalentes;
- esquema 2 del almacén de idempotencia provisionado fuera de runtime;
- target y epoch presentes en todas las fases;
- permisos por tabla y columna sin DDL ni DML contable;
- protocolo de contadores observado en una alta oficial;
- veinte altas concurrentes sin colisiones;
- rollback de cabecera, CTB, punteos y contadores ante fallos inyectados;
- replay y conflictos de idempotencia correctos;
- invalidación tras refresh;
- readback exacto;
- visibilidad del canario desde Netagro.

No se habilita la contabilidad hasta:

- localizar el mecanismo oficial;
- repetirlo dos veces en TEST;
- verificar cabecera, asiento, apuntes, IVA y posibles efectos de cartera;
- probar factura simple, multi-IVA, retención, abono y agricultor.

El rollback operativo consiste en desactivar capacidades. No se borran
facturas, intentos, snapshots ni evidencias.

## 8. Dependencias externas abiertas

- Provisionar la segunda instancia MariaDB requiere acceso operativo al host y
  no se sustituye por DDL ejecutado desde la API.
- Hispatec debe identificar o validar el mecanismo oficial de contabilización.
- La traza del cliente Netagro requiere una sesión controlada en el puesto ERP.

Mientras cualquiera de esos gates siga abierto, el sistema debe mostrar la
capacidad correspondiente como no disponible y nunca aparentar éxito.

### Solicitud técnica para Hispatec

La petición al proveedor debe incluir, como mínimo:

1. ¿Qué API, servicio, ejecutable, procedimiento o componente soportado
   contabiliza una factura recibida ya guardada?
2. ¿Cuál es su contrato de entrada y cuál es el identificador idempotente?
3. ¿La operación es síncrona o asíncrona? Si es asíncrona, ¿cómo se consulta
   su estado definitivo?
4. ¿Qué credencial y permisos mínimos requiere?
5. ¿Actualiza `FRR_Contabilizar`, `FRR_IdAsientoNet`, cartera, vencimientos,
   punteos u otros objetos además del diario?
6. ¿Qué respuesta diferencia rechazo anterior al commit, resultado incierto y
   contabilización confirmada?
7. ¿Existe un endpoint o consulta soportada de readback que incluya número
   visible, apuntes e IVA?
8. ¿Cuál es el procedimiento de reversión oficial si la factura de gestión se
   creó pero la contabilidad falló?

Se debe solicitar un ejemplo reproducible para factura simple, multi-IVA,
retención y abono. Una descripción verbal del botón de escritorio no sustituye
el contrato técnico.
