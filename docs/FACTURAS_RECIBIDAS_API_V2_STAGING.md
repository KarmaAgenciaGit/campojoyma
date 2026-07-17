# Facturas recibidas API v2 — homologación en pruebas

Fecha de la intervención: 2026-07-16.

## Estado seguro del despliegue

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

Hashes SHA-256: OpenAPI
`0bc9096f61033f19ad52ee907c34cf6f9c8cfa8b5091bf3a1a6062f7771e2216`;
parche
`72ac9ee3fa75f098a72fabd4f4a7f7f03a7703cdfc3028221db7a3fd4cdef656`;
workflow
`90d065e4970d917e8723139ce763f7fb713d2b566e801acfec8244b2b3ae58ae`.

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
- La ruta predeterminada del diario se calcula desde el directorio de la aplicación:
  `<despliegue>/data/facturas-idempotency.sqlite3`. El proceso alternativo confirma
  explícitamente
  `/home/karma/fastapi-netagro-v2-20260716/data/idempotency.sqlite3`; no escribe en
  el árbol de la API activa.
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
  permite buscar albaranes MA pendientes.
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

- `/asiento` devuelve `reference_only` cuando existe `FRR_IdAsientoNet`, siempre con
  `created=false`, o `unavailable` cuando no existe.
- Nunca se deriva el número visible desde `FRR_IdAsientoNet`.
- Un POST v2 con `FRR_Contabilizar="S"` recibe una validación bloqueante durante el
  dry-run y no crea ni la factura ni un supuesto asiento.
- No se han creado asientos mediante `INSERT`.

Para cerrar la homologación falta que el proveedor facilite o habilite:

1. El servicio/API/procedimiento oficial que Netagro utiliza para contabilizar.
2. Un diario de pruebas consultable que permita leer apuntes y mapear
   `FRR_IdAsientoNet` con el número visible.
3. Una respuesta oficial que confirme factura, asiento, Debe, Haber y cuadre.

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

Su fallback `http://172.19.0.1:18001` es únicamente un artefacto de pruebas y no
funciona mientras la clave del túnel no permita el destino `8001`. No debe activarse.

El workflow legado activo `Campojoyma - API CLAVE` conserva `pinData` con una
cabecera Bearer histórica. No se modificó durante esta intervención para no alterar
el proxy activo; debe limpiarse ese `pinData` y rotarse el secreto JWT en una
intervención separada, sin copiar el token a documentación.

## Pruebas realizadas sin escritura

Sobre la factura ONDUSPAN `FRR_id=49305`:

- 17 punteos `albmaterial`.
- 21 líneas.
- Suma de albaranes: `42.341,52`.
- `/asiento`: `reference_only`, `created=false`, ID técnico `390305`, número visible
  `null`, cero apuntes.

También se validó:

- OpenAPI incluye `albmaterial` en `PunteoSeleccionado`.
- Un dry-run v2 con `FRR_Contabilizar="S"` devuelve `ok=false` y error en
  `cabecera.FRR_Contabilizar`.
- Un dry-run v2 sin solicitud de contabilización devuelve `ok=true` y
  `would_create=true`.
- El diario de idempotencia devuelve la misma respuesta para el mismo
  `request_id`/payload y rechaza con `409` reutilizarlo con otro payload.
- Un MA con su importe completo supera la validación económica; el mismo MA con un
  importe parcial se rechaza en `punteos[0].importe_factura`. Ambos siguen bloqueados
  para escritura mientras falten los grants mínimos.
- La inyección de IDs de factura/asiento y campos técnicos de log produce errores de
  validación, y la propuesta devuelta contiene únicamente IDs generados.
- No se ejecutó ningún POST real.

## Requisitos antes de activar

1. Incorporar el mecanismo contable oficial y sus pruebas de lectura posterior.
2. Conceder únicamente `SELECT, UPDATE` sobre `netagrocomer.albmaterial` al usuario
   de escritura y activar `ALBMATERIAL_WRITES_ENABLED=true`.
3. Crear un servicio administrado para la v2 y ampliar de forma explícita
   `PermitOpen`/el túnel al puerto elegido.
4. Configurar `CAMPOJOYMA_API_V2_BASE_URL` en n8n.
5. Repetir dry-run, alta controlada, reconciliación e idempotencia antes de activar
   el workflow.
6. Mantener producción fuera de alcance hasta completar esta aceptación en la copia.
