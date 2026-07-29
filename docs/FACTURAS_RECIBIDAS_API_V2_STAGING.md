# Facturas recibidas API v2 — homologación en pruebas

Fecha de la intervención inicial: 2026-07-16.

Última verificación controlada: 2026-07-20.

> La fotografía del 16 de julio se conserva debajo como trazabilidad histórica. El
> estado operativo actual está en
> [INFORME_FINAL_HOMOLOGACION_FACTURAS_RECIBIDAS_2026-07-20.md](INFORME_FINAL_HOMOLOGACION_FACTURAS_RECIBIDAS_2026-07-20.md).

## Cierre técnico del 20 de julio

- Fuente canónica: `KarmaAgenciaGit/api-campojoyma@a4bdc53`, limpia y sincronizada
  con `origin/main`.
- La v0.2 permanece aislada en
  `/home/karma/fastapi-netagro-v02-20260720`, puerto `8001`, publicada únicamente
  por el túnel controlado `127.0.0.1:18001`; la v0.1 conserva `8000`/`18000`.
- El SQLite de idempotencia fue provisionado fuera de Netagro con directorio `0700`
  y fichero `0600`. El runtime no crea ficheros, tablas ni migraciones.
- Se ejecutó una única alta ficticia sin contabilización: `FRR_id=49399`,
  `FRR_numero=5146`, referencia `E2E-20260720-50CA89`.
- El readback, la reconciliación, el replay idéntico y el conflicto de payload fueron
  verificados; la búsqueda final devuelve una sola fila.
- La API volvió a `DB_WRITES_ENABLED=false` y el workflow n8n de escritura volvió a
  `active=false` con el guardado de ejecuciones deshabilitado.
- Pasan 36/36 pruebas de la API. La contabilización continúa bloqueada por ausencia
  de endpoint/readback oficial de Netagro.
- No se ejecutó ninguna operación DDL contra MariaDB y no se modificó su estructura.

El parche sincronizado tiene SHA-256
`95f4694247b9706f56b5c8148b16f5d2e8af260dc85adb2c16e31ffdddb792a2`.
La fuente reproducible completa, incluidos los scripts de provisión y reconciliación,
es el commit `a4bdc53`; el parche de este repositorio conserva únicamente el delta de
la aplicación FastAPI.

## Fotografía histórica del despliegue del 16 de julio

- La API activa no se ha reemplazado. Sigue atendiendo en `karma-box:8000` y en el
  túnel del VPS `127.0.0.1:18000`.
- La v2 está aislada en `/home/karma/fastapi-netagro-v2-20260716` y escucha solo en
  `127.0.0.1:8001` dentro de `karma-box`.
- El proceso alternativo guarda PID en `run-v2.pid` y log en `run-v2.log`.
- La v2 validada es `0.2.0`, expone 41 paths y su `main.py` tiene SHA-256
  `879b877b0039f2d2e42b4130e46b5d7c1bd52e1e99b6b67377ec4544a1358d9d`.
- La clave SSH del túnel solo autoriza el destino `127.0.0.1:8000`. El intento
  temporal hacia `8001` fue rechazado con `administratively prohibited` y se detuvo.
  Por tanto, la v2 no está publicada en el VPS ni en Internet.
- La restricción está en `/home/karma/.ssh/authorized_keys`, propiedad
  `karma:karma`, modo `600`, con `from="82.25.119.150"` y
  `permitopen="127.0.0.1:8000"`. El archivo es modificable por `karma`, pero no se
  añadió `8001` porque cambiar persistentemente este control SSH requiere una
  autorización explícita adicional.

Artefactos reproducibles:

- [OpenAPI v0.2.0](openapi/netagro-test-api-v0.2.0.json)
- [Parche FastAPI v0.2.0](patches/fastapi-netagro-v0.2.0.patch)
- [Workflow n8n write v2 desactivado](n8n/campojoyma-facturas-recibidas-write-v2.disabled.json)

### Corrección posterior del 17 de julio

Al separar la API en `KarmaAgenciaGit/api-campojoyma` se comprobó que el snapshot
v0.2 original contenía `mkdir`, una apertura SQLite creadora y
`CREATE TABLE IF NOT EXISTS factura_requests` dentro de la primera petición real
v2. No afectaba a MariaDB y no llegó a ejecutarse porque no existía el fichero ni
hubo un POST real, pero incumplía el criterio de infraestructura explícita.

El árbol local del repositorio API quedó endurecido antes de subir esa corrección:

- `FACTURAS_IDEMPOTENCY_DB` obligatorio y absoluto;
- apertura exclusiva de un SQLite ya existente mediante `mode=rw`;
- validación de versión, esquema, restricciones y huella sin DDL runtime;
- fallo de arranque con writes habilitados y `503` en reserva insegura;
- provisión separada mediante `scripts/provision_idempotency_store.py`;
- bloqueo de writes reales con contrato v1;
- cuenta lectora solo `USAGE`/`SELECT` y escritora explícita solo con
  `USAGE`/`SELECT`/`INSERT`/`UPDATE`, comprobadas mediante `SHOW GRANTS`;
- scopes de lectura limitados a los esquemas de negocio y contabilidad configurados,
  y scope de escritura independiente, sin grants globales o ajenos;
- replay antes de validaciones dependientes de MariaDB, claim atómico y lock de
  numeración mantenido hasta el commit;
- confirmación readback de cabecera, CTB y todos los punteos antes de marcar
  `completed`; cualquier diferencia queda `needs_reconciliation`;
- tests negativos que demuestran que una ruta inexistente o un SQLite vacío no
  reciben ficheros, directorios ni tablas automáticamente.

El working tree local de `api-campojoyma` pasó a ser la fuente prevista durante la
revisión. Ese trabajo ya está publicado en `729bf1e`, `306cb5a` y `a4bdc53`. Los
hashes que siguen describen la captura histórica del 16/17 de julio, no el cierre
del día 20.

Hashes SHA-256 de la captura histórica: OpenAPI
`0bc9096f61033f19ad52ee907c34cf6f9c8cfa8b5091bf3a1a6062f7771e2216`;
parche
`72ac9ee3fa75f098a72fabd4f4a7f7f03a7703cdfc3028221db7a3fd4cdef656`;
workflow
`90d065e4970d917e8723139ce763f7fb713d2b566e801acfec8244b2b3ae58ae`.

La copia endurecida final del parche, sincronizada desde `api-campojoyma@a4bdc53`,
tiene SHA-256
`95f4694247b9706f56b5c8148b16f5d2e8af260dc85adb2c16e31ffdddb792a2`.

## Backups verificados

En `karma-box`:

```text
/home/karma/backups/facturas-recibidas-v2/20260716-175905+0200
```

Contiene la API anterior, su OpenAPI y un dump transaccional comprimido de las tablas
base de los 14 esquemas funcionales. Los hashes se verificaron con:

```text
SHA256SUMS.before
SHA256SUMS.mariadb
SHA256SUMS.v0.2.0
```

El dump incluye 365 tablas de `netagrocomer`, 360 de `netagrocomer_au`, 365 de
`netagrocomer_2` y la tabla `cuentas` de cada esquema `contabilidad*`. Las cuentas
limitadas de la API no tienen `SHOW VIEW`, `TRIGGER`, `EVENT` ni acceso a rutinas;
por ello este backup nuevo no incorpora vistas ni objetos administrativos. La copia
completa anterior permanece en `/home/karma/db_clone`.

En el VPS:

```text
/root/backups/facturas-recibidas-v2/20260716-155928+0000
```

Incluye 127 workflows n8n exportados. El archivo `n8n-workflows.tar.gz` se verificó
con SHA-256
`d5abd864a11ccc1db3c97790ead4ba433b5929291b6a52927882849ea7b9983d`.

## Contrato implementado

`POST /facturasrecibidas` acepta de forma aditiva:

```json
{
  "contract_version": 2,
  "request_id": "uuid",
  "dry_run": true,
  "cabecera": {},
  "ctb": [],
  "punteos": []
}
```

- En v2 `request_id` es obligatorio.
- `dry_run` del cuerpo tiene prioridad sobre el parámetro query antiguo.
- La respuesta normaliza `factura`, `ctb`, `punteos`, `validations`, `accounting` y
  `readback_confirmed`, conservando temporalmente `FRR_id`, `FRR_numero`,
  `FRR_IdAsientoNet`, `validation_errors`, `erp_errors` e
  `ids_punteos_enlazados`.
- Los envíos reales v2 usan un diario SQLite persistente por `request_id`. Una
  ejecución ambigua queda en `needs_reconciliation` y no se reintenta a ciegas.
- El snapshot original calculaba una ruta predeterminada y podía crear el diario en
  la primera petición. Esa conducta está retirada del árbol endurecido: ahora la
  ruta absoluta es obligatoria, el fichero se provisiona fuera de FastAPI y el
  runtime solo lo abre en modo existente.
- Antes de escribir se validan duplicados y existencia/disponibilidad de cada
  punteo. La escritura de cabecera, CTB y enlaces sigue siendo una transacción.
- En v2 el cliente no puede fijar `FRR_id`, `FRR_numero`, `FRR_IdAsientoNet`,
  enlaces técnicos ni campos de log FRR/FRC. Se validan y se eliminan del payload
  antes de generar la propuesta; los identificadores solo pueden ser generados o
  devueltos por el ERP.

Nuevas lecturas:

- `GET /facturasrecibidas/{id}/punteos?include_lines=true`
  incluye `albmaterial`, `line_count` y sus líneas de solo lectura.
- `GET /albaranes-gastos/punteables?source_table=albmaterial`
  permite buscar albaranes MA pendientes; el filtro opcional
  `referencia` exige igualdad exacta sobre `Ref`.
- `GET /facturasrecibidas/{id}/asiento`
  separa ID técnico y número visible y devuelve `entries`.

En el esquema físico inspeccionado `albmaterial` no tiene una columna `AMA_id`; su
clave primaria estable es `AMA_idalb`. Por ello el contrato usa
`source_table="albmaterial"`, `source_id=AMA_idalb` y `Origen="MA"`. Este ajuste evita
inventar un identificador que no existe y mantiene el enlace reversible con la fila
ERP real.

`importe_factura` para MA puede omitirse o coincidir con el `AMA_importe` completo
con tolerancia de 0,01. Un valor parcial o diferente se rechaza; la API nunca escribe
un reparto artificial en `albmaterial`.

La cuenta de escritura actual carece de `SELECT, UPDATE` sobre
`netagrocomer.albmaterial`. La API deja `ALBMATERIAL_WRITES_ENABLED=false`: puede
leer MA, pero bloquea expresamente su enlace durante un alta.

## Dependencia contable bloqueante

La copia no contiene el asiento real:

- Todos los esquemas `contabilidad*` solo contienen la tabla `cuentas`.
- No hay tablas de diario/apuntes, procedimientos, funciones ni triggers para
  contabilizar una factura recibida.
- No existe en `karma-box` un servicio o ejecutable oficial de Netagro; solo están
  MariaDB y esta FastAPI.
- `facturasrecibidas.FRR_IdAsientoNet` conserva un identificador técnico, pero no
  permite obtener el número visible ni verificar Debe/Haber.

Evidencia revisada en modo lectura:

- OpenAPI y código desplegado de `/home/karma/fastapi-netagro`.
- Servicios activos de `karma-box`: MariaDB, SSH y `netagro-api.service`; no aparece
  otro servicio Netagro.
- Directorios de aplicación en `/home/karma`, `/opt`, `/srv` y `/usr/local`; no hay
  binario o API contable oficial.
- `INFORMATION_SCHEMA.TABLES` y `COLUMNS` de todos los esquemas de la copia.
- `INFORMATION_SCHEMA.ROUTINES`, `TRIGGERS` y `EVENTS` buscando factura, asiento y
  contabilización; no se encontró ningún mecanismo.
- Workflows n8n Campojoyma y código FastAPI existente: el escritor actual solo
  inserta cabecera/CTB y enlaza punteos.

No se accedió al aplicativo Netagro de producción ni a un servicio oficial del
proveedor porque ese componente no está instalado ni publicado en la máquina de la
copia. El dato exacto que debe solicitarse al proveedor es el endpoint, servicio o
procedimiento soportado que recibe una factura recibida, crea su asiento y permite
leer el número visible y los apuntes Debe/Haber resultantes.

Consecuencias:

- `/asiento` usa `FRR_IdAsientoNet` solo como clave técnica para consultar el
  diario. Devuelve `created=true` únicamente si encuentra un asiento con origen
  `FR`, la misma factura y Debe/Haber cuadrado.
- El número visible se lee de `contabilidad.asientos`; nunca se deriva
  aritméticamente desde `FRR_IdAsientoNet`.
- Un POST v2 con `FRR_Contabilizar="S"` recibe una validación bloqueante durante el
  dry-run y no crea ni la factura ni un supuesto asiento.
- No se han creado asientos mediante `INSERT`.

Para cerrar la homologación falta que el proveedor facilite o habilite:

1. El servicio/API/procedimiento oficial que Netagro utiliza para contabilizar.
2. Una respuesta oficial del mecanismo de creación que identifique factura y
   asiento para realizar después el readback ya disponible.

## n8n

Se importó el workflow:

```text
4wu0VF2RiwT4eyJC | Campojoyma - Facturas recibidas write v2 (DESACTIVADO)
```

Estado verificado:

- `active=false`.
- Tres nodos: webhook JWT, preflight/write/readback y confirmación de CTB, punteos
  y asiento.
- Sin `pinData`.
- `saveDataSuccessExecution=none`.
- `saveDataErrorExecution=none`.
- `saveManualExecutions=false`.
- No contiene tokens ni valores de credenciales; solo referencia la credencial JWT
  ya administrada por n8n.

Su fallback `http://172.19.0.1:18001` es únicamente un artefacto de pruebas. Funcionó
durante la ventana controlada del 20 de julio y el workflow volvió a desactivarse al
terminar; no debe mantenerse activo como writer permanente.

El workflow legado activo `Campojoyma - API CLAVE` conserva `pinData` con una
cabecera Bearer histórica. No se modificó durante esta intervención para no alterar
el proxy activo; debe limpiarse ese `pinData` y rotarse el secreto JWT en una
intervención separada, sin copiar el token a documentación.

## Pruebas realizadas sin escritura

Sobre la factura ONDUSPAN `FRR_id=49305`:

- 17 punteos `albmaterial`.
- 21 líneas.
- Suma de albaranes: `42.341,52`.
- `/asiento`: `created=true`, ID técnico `390305`, número visible `48732`, tres
  apuntes y Debe/Haber cuadrado en `51.233,24 €`.

También se validó:

- OpenAPI incluye `albmaterial` en `PunteoSeleccionado`.
- Un dry-run v2 con `FRR_Contabilizar="S"` devuelve `ok=false` y error en
  `cabecera.FRR_Contabilizar`.
- Un dry-run v2 sin solicitud de contabilización devuelve `ok=true` y
  `would_create=true`.
- La lógica aislada de idempotencia devolvía la misma respuesta para el mismo
  `request_id`/payload y rechazaba con `409` reutilizarlo con otro payload. El 20 de
  julio se confirmó además sobre una única alta real controlada: reconciliación,
  replay idéntico sin writes, conflicto de payload y búsqueda sin duplicados. Las
  36 pruebas de la API pasan.
- Un MA con su importe completo supera la validación económica; el mismo MA con un
  importe parcial se rechaza en `punteos[0].importe_factura`. Ambos siguen bloqueados
  para escritura mientras falten los grants mínimos.
- La inyección de IDs de factura/asiento y campos técnicos de log produce errores de
  validación, y la propuesta devuelta contiene únicamente IDs generados.
- El 16 de julio no se ejecutó ningún POST real. El 20 de julio se realizó la única
  alta ficticia detallada en el informe final, siempre sobre la copia TEST y sin
  contabilización.

## Requisitos antes de una activación permanente

1. Usar como fuente el árbol revisado de `KarmaAgenciaGit/api-campojoyma`, no la
   captura original sin endurecer.
2. Mantener `DB_WRITES_ENABLED=false` mientras falte el mecanismo contable oficial
   y sus pruebas de lectura posterior.
3. Verificar con `SHOW GRANTS` que el usuario lector carece de DML/DDL y que el
   usuario escritor separado carece de cualquier DDL, roles y `GRANT OPTION`.
4. Precrear como usuario del servicio un directorio `0700`, provisionar fuera de
   FastAPI el SQLite `0600`, configurar su ruta absoluta, usar `UMask=0077` y
   comprobar que el servicio rehúsa arrancar si se retira.
5. Si se autoriza posteriormente el enlace MA, conceder solo los DML exactos sobre
   las tablas necesarias; nunca DDL ni privilegios de esquema.
6. Crear un servicio administrado para la v2 y ampliar de forma explícita
   `PermitOpen`/el túnel al puerto elegido.
7. Configurar `CAMPOJOYMA_API_V2_BASE_URL` en n8n.
8. Repetir dry-run, alta controlada, reconciliación e idempotencia antes de activar
   el workflow.
9. Garantizar un solo writer lógico: todos los workers comparten el mismo SQLite
   persistente, la v0.1 no escribe en paralelo y no hay réplicas con stores locales.
10. Usar exclusivamente `scripts/reconcile_factura_request.py` para una
    reconciliación verificada; no editar el SQLite manualmente ni desbloquear
    automáticamente estados ambiguos.
11. Mantener producción fuera de alcance hasta completar esta aceptación en la copia.
