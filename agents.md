# AGENTS.md

Estas instrucciones aplican a todo el repositorio.

## Contexto del proyecto

- Stack principal: `Vite + React + TypeScript + Supabase`.
- El proyecto usa `cliente_behavior_rules` para reglas por cliente; evita hardcodes si una variación puede modelarse ahí.
- Proyecto Supabase actual asociado a este repo: `CAMPOJOYMA` (`adbprpemmbspntbttziz`).

## Reglas de trabajo

- Antes de implementar algo nuevo, revisa si ya existe un flujo reutilizable en lugar de crear uno paralelo.
- Si una necesidad es específica de un cliente, prioriza una regla configurable antes que lógica fija en frontend o funciones.
- No cambies la semántica de los datos automáticamente si eso puede generar falsos positivos.
  Ejemplo: no reinterpretar `edit` como `add` sin una decisión explícita de producto o del usuario.
- Si una solución puede resolverse con una opción manual clara y segura en la UI, suele ser preferible a una automatización agresiva.

## Diagnóstico en origen

- Si aparece un problema de match, referencia, domicilio o cabecera, valora primero si la causa puede venir de la extracción o normalización aguas arriba.
- Antes de proponer cambios en BBDD, `cliente_behavior_rules`, frontend o workarounds locales, aconseja revisar también el flujo que genera el dato:
  IA, prompts, parseo o `n8n`.
- Cuando el dato nace mal en origen, prioriza corregirlo ahí antes que compensarlo después con lógica adicional.

## Supabase y migraciones

- Si cambias esquema o comportamiento persistente, crea siempre una migración nueva en `supabase/migrations`.
- Las migraciones deben ser idempotentes cuando sea razonable:
  usa `IF NOT EXISTS`, `ON CONFLICT`, etc.
- Si el cambio requiere activarse para un cliente concreto, deja el seed explícito en la migración.
- Si está disponible el MCP de Supabase, aplica también la migración allí y verifica el resultado.
- Si añades columnas en `cliente_behavior_rules`, actualiza de extremo a extremo:
  migración, tipos de Supabase, servicio `clienteBehaviorRules`, panel admin y consumo en el flujo correspondiente.

## API y Netagro

- La fuente de trabajo prevista para FastAPI es `KarmaAgenciaGit/api-campojoyma`;
  mientras haya cambios sin commit/push, la autoridad concreta es su working tree
  local. Este repositorio solo conserva contrato, OpenAPI, workflows y una copia
  sincronizada del parche.
- La MariaDB de pruebas de Netagro es estructuralmente inmutable. No ejecutar nunca
  `CREATE`, `ALTER`, `DROP`, `TRUNCATE` ni otras operaciones DDL contra ella,
  tampoco para comprobar permisos.
- Los usuarios MariaDB runtime deben carecer de DDL y comprobarse de forma no
  mutante mediante `SHOW GRANTS`.
- El estado de idempotencia vive fuera de Netagro y se provisiona explícitamente
  durante el despliegue. FastAPI no puede crear ni migrar su almacén al importar,
  arrancar o atender una petición.
- Si el almacén de idempotencia falta o no coincide con el esquema esperado, la API
  debe fallar de forma cerrada y no abrir la conexión de escritura a Netagro.

## Frontend y UX

- Mantén un estilo profesional, sobrio y operativo.
- Evita “tarjetas dentro de tarjetas” salvo que exista una razón fuerte y el patrón ya esté asentado.
- Evita badges, pills o etiquetas decorativas que no aporten significado real.
- Si hay una acción principal y una secundaria, usa una jerarquía simple:
  un CTA principal claro, una alternativa secundaria, poco texto y sin exceso de contenedores.
- Reduce la sensación de “UI generada”: mejor menos elementos y mejor jerarquía que más adornos.
- Conserva el lenguaje visual existente del proyecto; no rediseñes de forma gratuita.

## Copy y microcopy

- El copy de interfaz debe estar en español.
- Prefiere textos cortos, claros y operativos.
- Evita formulaciones raras o poco naturales.
  Ejemplo: si una etiqueta suena forzada, simplifícala.
- En estados ambiguos, explica qué está pasando y qué puede hacer el usuario a continuación.

## Validación

- Tras cambios relevantes de código, ejecutar como mínimo:
  - `npx tsc --noEmit`
  - `npm run build`
- `npm run lint` puede mostrar errores preexistentes del repo.
  No lo uses como único criterio de bloqueo sin separar claramente lo nuevo de lo heredado.

## Preferencias concretas de este repo

- Para reglas por cliente en pedidos/cambios, usa `cliente_behavior_rules`.
- Para cambios sin match, prioriza exponer una resolución clara al usuario antes que deducir automáticamente intenciones dudosas.
- Si una nueva capacidad se configura por cliente, debe poder verse y editarse desde `AdminSettings` salvo que haya una razón fuerte para no hacerlo.
