# Plan de migración a la base de datos de producción — facturas recibidas

Fecha de redacción: **6 de agosto de 2026**.
Estado: **plan. No se ha ejecutado ningún paso.**

Objetivo: que una factura recibida se dé de alta **y se contabilice** en la
MariaDB de producción de Netagro, de forma que el cliente lo vea desde su propio
programa, con copia de seguridad previa y una vuelta atrás definida.

Restricción declarada por el cliente: **su programa no puede reapuntarse a la
copia de pruebas**. Por eso la demostración tiene que ocurrir contra producción.
Esa restricción elimina la opción de ensayar «en su pantalla» sin escribir en su
base real, y es la razón por la que este plan es más estricto que los anteriores.

---

## 1. Estado verificado el 06/08/2026

Comprobado en vivo, no leído de documentación.

### API (`karma-box`, servicio `netagro-api-v2.service`)

| Elemento | Valor actual |
|---|---|
| Release activa | `api-campojoyma-v0.3.13-20260805T105339Z-vat-account-history-fa32a9e` |
| `/health` | `writes_enabled=true`, `accounting_writes_enabled=true`, idempotencia `schema_version=2` |
| Lecturas | `DB_HOST=127.0.0.1:3306`, esquema `netagrocomer` → **copia local de karma-box** |
| Escrituras | `DB_WRITE_HOST=127.0.0.1:3307`, esquema `netagrocomer_test_write` |
| Identidad | `NETAGRO_ENVIRONMENT=test`, `NETAGRO_TARGET_ID=netagro-test-write` |
| Prueba física | `DB_WRITE_EXPECTED_DATADIR=/home/karma/.local/share/netagro-test-write/data/` |
| Contabilidad | `ACCOUNTING_MECHANISM=sql_test`, `DB_ACCOUNT_SCHEMA_BY_COMPANY=1:contabilidad` |
| Usuarios MariaDB | `netagro_api` (lectura), `netagro_target_reader`, `netagro_management_writer`, `netagro_accounting_writer` |
| Contador ERP | `NETAGRO_COUNTER_USER_ID=61` |
| Idempotencia | `/home/karma/.local/state/netagro-api/idempotency/a67774b7-….sqlite3` (un fichero por epoch) |

### Supabase (`adbprpemmbspntbttziz`)

`erp_targets` contiene **una sola fila**:

```text
id              netagro-test-write
environment     test
write_mode      management       (transición 05/08/2026 09:16 desde blocked)
accounting_mode sql_test         (transición 05/08/2026 09:16 desde unavailable)
dataset_epoch   a67774b7-d9bf-4a8a-8a93-95b3e08a5f7c
snapshot_at     2026-08-03 12:11:31+00
```

### Consecuencias

1. La inserción de ayer, incluido el asiento, ocurrió en el **clon TEST
   persistente** (`:3307`, datadir propio). No se ha escrito en producción.
2. Las **lecturas tampoco son de producción**: acreedores, cuentas contables e
   histórico que ve el frontend salen de un snapshot local.
3. El camino **frontend → Edge → API → MariaDB nunca se ha ejercitado con
   identidad v3**: en `facturasrecibidas_sync_attempts` no hay ningún intento con
   `erp_target_id` y el último registro es del 29/07. El canario `49723` se
   ejecutó desde el servidor.

El punto 3 importa: la demostración al cliente pasa por la aplicación, y ese
recorrido concreto todavía no se ha probado ni siquiera contra TEST.

---

## 2. Bloqueos de código (no son variables de entorno)

El sistema se construyó para que producción sea imposible sin tocar código. Hay
cuatro barreras y las cuatro son deliberadas.

| # | Dónde | Regla actual | Efecto en producción |
|---|---|---|---|
| 1 | API `app/main.py` | `write_mode` cae a `blocked` si el esquema de escritura es igual al de lectura | En producción ambos son `netagrocomer` → **gestión bloqueada** |
| 2 | API `app/db.py` (`accounting_test_target_configuration_gaps`) | Exige `environment=test`, target `netagro-test-write`, puerto `3307`, host solo loopback, esquema `netagrocomer_test_write`, mapeo `1:contabilidad` y `@@datadir` exacto | **Contabilidad bloqueada**: fallan cinco de seis invariantes |
| 3 | Edge `_shared/netagro-api-v3.ts` | `accounting_write_mode ∈ {disabled, blocked, sql_test}` | Un modo de producción se degrada a `blocked` y la capacidad se apaga |
| 4 | Supabase `set_erp_target_accounting_mode_v3` | `sql_test` solo si `environment='test'`; `official` exige el gate `official_mechanism_homologated` | No hay transición contable válida para producción |

Sobre el punto 4: **no vamos a usar `official`**. Ese valor significa «existe un
mecanismo oficial de Netagro para crear el asiento», y no existe: el asiento se
crea por DML homologado. Marcar ese gate sería registrar algo falso en la traza
de activación. Se propone un valor nuevo y explícito: `sql_production`.

Además, el frontend es agnóstico al target (verificado): **no requiere cambios**.

### Deuda que hay que cerrar antes de tocar migraciones

`20260805130133_grant_service_role_erp_target_row_lock.sql` concede
`update (updated_at)` a `service_role`. `has_table_privilege(...,'UPDATE')`
devuelve verdadero también con un grant por columna, así que la aserción ACL de
`20260804093000` fallaría en un replay desde cero. La base viva está correcta
(las migraciones se aplicaron en orden); el arreglo es cambiar la aserción a
`has_column_privilege` sobre las columnas de negocio.

---

## 3. Copia de seguridad y vuelta atrás

Esta es la parte que condiciona todo lo demás.

### 3.1 La verdad incómoda sobre «restaurar»

**Restaurar la base completa no es una vuelta atrás viable en un ERP vivo.**
Mientras nosotros probamos, el personal de Campojoyma sigue trabajando: albaranes,
ventas, cobros. Restaurar el volcado destruiría todo lo que hayan hecho desde que
se tomó. Es un recurso de catástrofe, no un botón de deshacer, y solo se ejecuta
con el ERP parado y decisión firmada del cliente.

Por eso la protección real es **que no se pueda romper nada**, en tres niveles.

### 3.2 Nivel A — la escritura no puede destruir datos

Es la salvaguarda principal y ya forma parte del diseño: los usuarios MariaDB de
escritura se crean con **INSERT y UPDATE sobre una lista blanca de tablas, sin
DELETE, sin DDL, sin privilegios globales**. La API verifica los grants con
`SHOW GRANTS` en cada conexión y se niega a arrancar si detecta scopes amplios,
`ALL PRIVILEGES` o `GRANT OPTION`.

Consecuencia: el peor caso posible es **una fila de más**, nunca una fila perdida
ni una tabla alterada. Ese es el motivo por el que se puede hacer esto sobre
producción con una demo controlada.

Además, para la primera factura de producción:

- **`punteos: []`** en el payload. No se enlaza ningún albarán real. El flag
  `ALBMATERIAL_WRITES_ENABLED` debe seguir en `true` (la API lo exige para
  `write_mode=management`), pero el control efectivo es no enviar punteos.
- Una sola factura, empresa 1, perfil homologado `ot-2110-single-21-v1`
  (acreedor OT, régimen 2110, un solo tipo de IVA al 21 %).
- Sin retención, sin descuentos, sin multi-IVA, sin abono.

### 3.3 Nivel B — copia de seguridad previa

Tres copias, de menor a mayor coste.

**B1. Volcado lógico completo (red de catástrofe).**

Esquemas `netagrocomer` y `contabilidad` de producción. Comprobar antes espacio
libre en destino: el clon ocupa ~10 GB físicos y solo `netagrocomer` son
2,88 GiB lógicos.

```bash
mysqldump --host=<prod> --port=3306 --user=<usuario_backup> \
  --single-transaction --quick --routines --triggers --events \
  --hex-blob --default-character-set=utf8mb4 \
  --databases netagrocomer contabilidad \
  | gzip -c > /ruta/backup-netagro-prod-20260806T<hh mm>Z.sql.gz
sha256sum /ruta/backup-netagro-prod-*.sql.gz > /ruta/backup-....sha256
```

Comprobaciones obligatorias antes de dar el volcado por válido:

- [ ] Verificar el **motor de las tablas implicadas**. `--single-transaction` solo
      garantiza consistencia en InnoDB. Si `facturasrecibidas`, `contadores`,
      `asientos`, `asientolineas` o `ivasoportado` son MyISAM, el volcado en
      caliente no es consistente y hay que acordar ventana o método alternativo
      con el administrador del ERP.
- [ ] **Restaurar el volcado en una instancia aparte** (por ejemplo el MariaDB
      local de karma-box, en un esquema nuevo) y comprobar que abre y cuenta
      filas. Un backup no verificado no es un backup.
- [ ] Confirmar que el cliente **tiene además su propia copia** de esa noche y
      que sabe restaurarla. La nuestra es complementaria, no sustitutiva.

**B2. Volcado dirigido de las tablas implicadas (material de undo).**

Rápido y es lo que de verdad se usará para construir la reversión:

```text
netagrocomer.facturasrecibidas
netagrocomer.facturasrecibidas_ctb
netagrocomer.contadores
contabilidad.asientos
contabilidad.asientolineas
contabilidad.ivasoportado
```

**B3. Evidencia fila a fila (el undo real).**

Justo antes de escribir, en lectura pura, y guardado con marca de tiempo:

- [ ] `MAX(FRR_id)` y `MAX(FRR_numero)` de `facturasrecibidas` para empresa y
      ejercicio.
- [ ] Valor exacto de la fila de `contadores` que la API va a bloquear.
- [ ] `MAX(IdAsiento)` de `contabilidad.asientos` y `MAX(IdApunte)` de
      `asientolineas`.
- [ ] `MAX(IdRegistro)` de `contabilidad.ivasoportado`.
- [ ] `@@datadir` de producción (además sirve como prueba física de identidad).

Con esas cotas, cualquier fila creada por nosotros queda identificada sin
ambigüedad, aunque otros usuarios trabajen a la vez.

### 3.4 Nivel C — procedimiento de reversión

Por orden de preferencia:

1. **Desde el programa del cliente.** Netagro permite eliminar una factura
   recibida y su asiento desde su propia interfaz. Es la vía preferente: usa el
   mecanismo oficial, deja traza en su ERP y no requiere que nosotros tengamos
   permisos de borrado. **Confirmar con el cliente, antes de escribir, que sabe
   hacerlo y que está dispuesto.**
2. **Anulación contable.** Si el asiento no puede borrarse por estar en un
   período ya cerrado o punteado, se contabiliza el asiento inverso. Es la
   práctica contable estándar y no destruye traza.
3. **DML compensatorio supervisado.** Último recurso. Requiere una identidad
   MariaDB distinta y temporal con `DELETE` sobre las filas exactas registradas
   en B3, ejecutada bajo supervisión y revocada inmediatamente después. **El
   usuario escritor de la API nunca debe tener DELETE.**
4. **Restauración completa desde B1.** Solo catástrofe, ERP parado, decisión del
   cliente.

Lo que **no** se revierte, y hay que advertirlo antes:

- El **número de factura consumido del contador**. Si se anula la factura, queda
  un hueco en la numeración. Es el comportamiento normal de cualquier ERP y no
  es un error, pero el cliente debe saberlo de antemano.
- El **número de asiento visible**, por el mismo motivo.

### 3.5 Criterios de aborto

Se detiene la ventana, sin insistir, si ocurre cualquiera de estos:

- El volcado B1 no se puede verificar restaurándolo.
- `SHOW GRANTS` de cualquier usuario nuevo devuelve más privilegios de los
  pedidos.
- `@@datadir` leído no coincide con el declarado en `DB_WRITE_EXPECTED_DATADIR`.
- El ejercicio contable de destino está cerrado.
- Cualquier respuesta `503 readback_unconfirmed`, `409` de reconciliación o
  estado `unknown`. Estos estados son *sticky* por diseño: **no se reintenta**,
  se reconcilia en lectura.
- El cliente no confirma que sabe eliminar la factura desde su programa.

---

## 4. Trabajo de código necesario

### 4.1 API — repositorio `KarmaAgenciaGit/api-campojoyma`

**a) Invariante de esquema (`app/main.py`).** Hoy `write_schema == DB_DEFAULT_SCHEMA`
bloquea la gestión. Hay que convertirlo en una regla con dos perfiles en vez de
eliminarlo: la coincidencia solo se admite cuando `NETAGRO_ENVIRONMENT=production`,
el target es el de producción declarado y la prueba de `@@datadir` pasa. Nunca
«cualquier valor vale».

**b) Perfil de destino contable (`app/db.py`).** Convertir
`accounting_test_target_configuration_gaps()` en una función con dos perfiles
cerrados:

```text
TEST        environment=test        target=netagro-test-write
            puerto=3307             esquema=netagrocomer_test_write
            host solo loopback      datadir del clon

PRODUCCIÓN  environment=production  target=netagro-prod
            puerto=<túnel prod>     esquema=netagrocomer
            host solo loopback      datadir de producción
            mapeo 1:contabilidad
```

El perfil TEST no se toca: debe seguir funcionando para regresión.

**c) Vocabulario contable.** Añadir `ACCOUNTING_MECHANISM=sql_production`. No
reutilizar `official`.

**d) Pruebas.** Las 302 actuales deben seguir pasando, más pruebas nuevas del
perfil de producción y de que el perfil TEST no se ha degradado.

### 4.2 Conectividad: túnel en lugar de conexión directa

Recomendación firme: **no apuntar `DB_WRITE_HOST` a `192.168.1.91`**. Publicar
producción en loopback de karma-box mediante túnel (`127.0.0.1:<puerto prod>`).

Ventajas: se conserva la invariante «el escritor solo habla con loopback», el
puerto distingue destino sin ambigüedad, y `DB_WRITE_EXPECTED_DATADIR` sigue
funcionando como prueba física — ahora de que estás en producción y no en el
clon. Es exactamente la misma defensa que hoy impide escribir fuera del clon,
reutilizada al revés.

Verificar primero que karma-box alcanza `192.168.1.91:3306` (de ahí salió el
clon, pero hay que confirmarlo hoy).

### 4.3 Edge Functions

- `_shared/netagro-api-v3.ts`: añadir `sql_production` a las uniones de
  `accounting_mode` y `accounting_write_mode`.
- `facturas-recibidas-erp-runtime/index.ts`: la capacidad `accounting_commit`
  con `sql_production` exige `localEnvironment === 'production'` y
  `upstream.accounting_write_mode === 'sql_production'`, en simetría exacta con
  la regla que hoy existe para `sql_test`.

### 4.4 Migración Supabase

Una sola migración nueva:

- Ampliar el check de `accounting_mode` con `sql_production`.
- En `set_erp_target_accounting_mode_v3`, rama `sql_production`: exige
  `environment='production'`, `write_mode='management'`, confirmación
  `ENABLE_SQL_ACCOUNTING_PRODUCTION:<target>:<epoch>` y gates propios:

  ```text
  physical_backup_verified          (B1 restaurado y comprobado)
  backup_restore_tested             (restauración probada en instancia aparte)
  least_privilege_grants_verified   (SHOW GRANTS revisado)
  accounting_canary_readback_verified
  rollback_procedure_signed_off     (el cliente confirma la vía de reversión)
  api_runtime_reconciled
  ```

- Insertar la fila `netagro-prod` (`environment='production'`, `write_mode='disabled'`,
  `dataset_epoch=null`). Tiene que ir en migración: `service_role` no puede
  mutar `erp_targets` directamente, y esa restricción se comprueba con una
  aserción ACL.
- Corregir la aserción ACL descrita en §2.

El índice `erp_targets_one_active_per_environment_uidx` es por entorno, así que
el target de test y el de producción pueden convivir activos. La API declara uno
solo cada vez: el cambio es de configuración de runtime, no de esquema.

---

## 5. Secuencia de ejecución

### Fase 0 — preparación local (sin riesgo)

- [ ] Cerrar los 28 ficheros en staging: `tsc`, vitest, pruebas Deno y estáticas.
- [ ] Corregir la aserción ACL de `erp_targets`.
- [ ] Commit y push.

### Fase 1 — acuerdos con el cliente (bloqueante)

- [ ] Qué factura real se usará. Debe ser una factura que el cliente **iba a
      registrar de todos modos**, o una que acepte anular después. No inventar
      una factura ficticia en su contabilidad: afecta a IVA soportado y por tanto
      a su modelo 303.
- [ ] Confirmar que el **ejercicio contable está abierto**.
- [ ] Usuario ERP real para `FRR_IdUsuarioLog` y el contador (hoy `61`).
- [ ] Quién administra la MariaDB de producción y crea los usuarios.
- [ ] Ventana horaria. Preferible con poca actividad: el bloqueo de `contadores`
      es breve pero real y afecta a quien esté facturando en ese momento.
- [ ] Confirmación explícita de la vía de reversión (§3.4, opción 1).

### Fase 2 — credenciales y conectividad

- [ ] Comprobar alcance de red karma-box → `192.168.1.91:3306`.
- [ ] Crear en producción tres usuarios de mínimo privilegio: lector de target,
      escritor de gestión (INSERT/UPDATE en lista blanca), escritor contable
      (INSERT/UPDATE en `asientos`, `asientolineas`, `ivasoportado`). Ninguno con
      DELETE, DDL, roles ni `GRANT OPTION`.
- [ ] `SHOW GRANTS` de cada uno y registro de la salida como evidencia.
- [ ] Levantar el túnel a loopback y fijar su puerto.
- [ ] Leer `@@datadir` de producción y anotarlo.

### Fase 3 — copia de seguridad

- [ ] B1, B2 y B3 según §3.3, con SHA-256 y restauración de B1 verificada.

### Fase 4 — despliegue del código

- [ ] Release nueva de la API con los perfiles de destino, empaquetada,
      verificada en entorno limpio y activada por symlink (rollback inmediato a
      `v0.3.13` disponible).
- [ ] Provisionar el almacén de idempotencia del nuevo epoch con el script
      explícito, modo `0600`, propietario del servicio. Nunca `mode=rwc`.
- [ ] Desplegar Edge y aplicar la migración Supabase.
- [ ] Comprobar que no queda ninguna operación TEST en vuelo antes del cambio de
      identidad.

### Fase 5 — activación progresiva

Cada paso se detiene si el anterior no verifica.

- [ ] Cambiar `runtime.env` a identidad de producción y reiniciar. `write_mode`
      debe quedar en `disabled`.
- [ ] `rotate_erp_target_epoch_v3('netagro-prod', <epoch>, <snapshot = hora del backup>)`.
      Semánticamente el epoch identifica «producción a partir de esta copia».
- [ ] Comprobar `/meta/runtime` y la Edge de runtime: `identity_consistent=true`.
      **Lecturas de producción funcionando.** Ya es un hito verificable y
      enseñable.
- [ ] `disabled → blocked` con `ENABLE_VALIDATION:netagro-prod:<epoch>`.
      Validar la factura en dry-run desde la aplicación.
- [ ] `blocked → management` con `ENABLE_MANAGEMENT:netagro-prod:<epoch>` y los
      siete gates.
- [ ] **Alta de gestión de la factura, desde el frontend**, con `punteos: []`.
      Readback completo de cabecera y CTB.
- [ ] Verificar con el cliente que la factura **aparece en su programa**. Este es
      el momento de parar si algo no le cuadra: todavía no hay asiento.
- [ ] `accounting_mode → sql_production` con la confirmación y los gates nuevos.
- [ ] **Contabilizar.** Readback de asiento, apuntes e `ivasoportado`. Comprobar
      origen `FR`, `idorigen` coincidente, Debe = Haber y tramos de IVA.
- [ ] Verificar con el cliente el asiento en su visualizador.

### Fase 6 — cierre

- [ ] Registrar el acta con IDs reales creados, valores antes/después de B3,
      SHA-256 de los volcados y salida de `/meta/runtime`.
- [ ] Decidir con el cliente si la factura se conserva o se anula.
- [ ] Devolver `accounting_mode` y `write_mode` a un estado explícito de reposo
      hasta la siguiente ventana. No dejar producción en `management` de forma
      indefinida sin acuerdo.

---

## 6. Riesgos reales

| Riesgo | Mitigación |
|---|---|
| Escribir en el sitio equivocado | Prueba física de `@@datadir` + puerto + esquema + target declarado. Falla cerrado. |
| Pérdida de datos | Imposible por construcción: los escritores no tienen DELETE ni DDL. |
| Factura duplicada por reintento | Idempotencia externa por `request_id` y hash de payload; un UUID repetido con otro payload devuelve `409`. |
| Escritura confirmada pero readback incompleto | `503 readback_unconfirmed`, estado `needs_reconciliation`, `retry_safe=false`. Se reconcilia en lectura, no se repite el POST. |
| Bloqueo del contador afectando a usuarios reales | Transacción corta; ventana de baja actividad. |
| Asiento incorrecto en su contabilidad | Perfil único homologado; sin retención ni multi-IVA en la primera; anulación por asiento inverso. |
| Cuenta de IVA mal resuelta | Las cuentas dependen de empresa + régimen + porcentaje + circuito, no solo del porcentaje. El servidor resuelve y valida; el frontend no inventa. |
| Frontend público desactualizado | `campojoyma.multiplicaxfuego.com` sirve todavía el bundle antiguo y el acceso al host estaba bloqueado el 31/07. **Verificar antes de la demo**: si la demo se hace desde la aplicación, esto es bloqueante. |
| Extractor n8n leyendo del clon | Apunta a la API v1 (`:18000`), que lee el snapshot. Sus resoluciones seguirían siendo antiguas aunque la v3 esté en producción. Fuera del alcance de esta ventana, pero hay que decirlo. |

---

## 7. Sobre hacerlo hoy

El plan es ejecutable, pero conviene ser honesto con los tiempos. La ruta crítica
no es nuestro código: son los **usuarios de escritura en la MariaDB de producción**,
que tiene que crear quien la administre, y la **verificación del volcado**, que
depende del tamaño y del motor de las tablas.

Si esos dos puntos se resuelven pronto, un objetivo razonable para hoy es llegar
hasta el hito de **lecturas de producción + alta de gestión visible en su
programa** (fin de Fase 5, paso 7). La contabilización puede ser el paso
siguiente en la misma ventana si todo lo anterior verifica limpio, o al día
siguiente con el acta ya cerrada.

Lo que no conviene es comprimir la copia de seguridad para llegar a una hora.
