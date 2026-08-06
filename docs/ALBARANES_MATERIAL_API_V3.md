# Albaranes de material — API v3 / candidato 0.3.15

La fuente FastAPI candidata incorpora `POST /albaranes/material` para crear una
entrada de material completa en el clon persistente TEST. El candidato está
implementado y probado, pero todavía no está desplegado ni habilitado en el
servidor.

Contrato OpenAPI sincronizado:

- [netagro-test-api-v0.3.15.json](openapi/netagro-test-api-v0.3.15.json)

## Integración prevista desde Campojoyma

1. La aplicación construye el payload tipado con cabecera y una o más líneas.
2. Envía `operation: validate`, un `request_id` nuevo y la identidad vigente
   `target_id + dataset_epoch`, con `X-Netagro-Api-Key` y sin parámetros de
   URL (`dry_run` no está admitido).
3. Muestra los errores, total calculado y posibles duplicados. Una coincidencia
   histórica requiere confirmación manual; la aplicación devuelve en
   `duplicados_revisados_ids` exactamente los IDs mostrados y no permite
   preconfirmar. Si el conjunto cambia, se vuelve a validar.
4. Si la validación es limpia, repite exactamente el payload con
   `operation: commit` y el mismo `request_id`.
5. Solo considera enviado el documento cuando la respuesta contiene
   `readback_confirmed: true`.
6. Abre el registro creado mediante
   `GET /albaranes/material/{AMA_idalb}` con el mismo target y epoch.

No se deben inventar IDs o número de albarán ni enviar campos de auditoría,
factura, vale o unidad. Todos ellos los deriva la API.

La API añade internamente al vale un marcador `NETAGRO-MA:<request_id>` para
que un commit incierto solo pueda reconciliarse con el documento creado por
esa petición, nunca con un duplicado histórico. No forma parte del payload de
la aplicación.

## Diferencia respecto a facturas

No existe contabilización, IVA ni asiento, pero sí movimiento de stock. Por
eso el commit sigue siendo transaccional: crea `albmaterial`, sus líneas, el
`valeenvases` de operación `AC` y sus líneas, y avanza cinco contadores en una
sola transacción.

El primer perfil no admite pedidos relacionados, gastos, devoluciones,
material retornable, impuesto de plástico ni proveedores en divisa distinta de
la base homologada. El total esperado debe coincidir
exactamente con la suma calculada por el servidor y el precio neto tras
descuento debe caber exactamente en los seis decimales del movimiento de
almacén.

## Activación futura

El despliegue requiere provisionar el usuario independiente
`netagro_material_writer`, verificar sus grants mínimos, backup del clon TEST,
idempotencia del epoch, suite/OpenAPI y un canario. El gate
`ALBMATERIAL_CREATE_ENABLED` debe permanecer en `false` hasta completar esas
comprobaciones. No debe ejecutarse este flujo contra producción.
