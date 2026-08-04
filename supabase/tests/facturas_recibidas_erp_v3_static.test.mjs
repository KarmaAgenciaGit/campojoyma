import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const supabaseRoot = dirname(here);
const migrationPath = join(
  supabaseRoot,
  "migrations",
  "20260730145320_harden_facturas_recibidas_erp_v3.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const createCompatibilityMigration = readFileSync(
  join(
    supabaseRoot,
    "migrations",
    "20260731121047_fix_create_factura_recibida_v3_defaults.sql",
  ),
  "utf8",
);
const saveProtectionMigration = readFileSync(
  join(
    supabaseRoot,
    "migrations",
    "20260731121720_protect_factura_recibida_v3_identity_on_save.sql",
  ),
  "utf8",
);
const clientAclMigration = readFileSync(
  join(
    supabaseRoot,
    "migrations",
    "20260803114713_harden_facturas_recibidas_client_acl.sql",
  ),
  "utf8",
);
const accountingMigration = readFileSync(
  join(
    supabaseRoot,
    "migrations",
    "20260804093000_integrate_factura_accounting_v3.sql",
  ),
  "utf8",
);
const accountingSafetyMigration = readFileSync(
  join(
    supabaseRoot,
    "migrations",
    "20260804100000_make_accounting_uncertainty_sticky_v3.sql",
  ),
  "utf8",
);
const accountingResumeMigration = readFileSync(
  join(
    supabaseRoot,
    "migrations",
    "20260804103000_resume_accounting_safely_v3.sql",
  ),
  "utf8",
);

const functionBody = (name, schema = "public") => {
  const marker = `create or replace function ${schema}.${name}(`;
  const start = migration.toLowerCase().indexOf(marker);
  assert.notEqual(start, -1, `No se encuentra ${schema}.${name}`);
  const next = migration.toLowerCase().indexOf(
    "create or replace function ",
    start + marker.length,
  );
  return migration.slice(start, next === -1 ? migration.length : next);
};

const accountingFunctionBody = (name, schema = "public") => {
  const marker = `create or replace function ${schema}.${name}(`;
  const start = accountingMigration.toLowerCase().indexOf(marker);
  assert.notEqual(start, -1, `No se encuentra ${schema}.${name}`);
  const next = accountingMigration.toLowerCase().indexOf(
    "create or replace function ",
    start + marker.length,
  );
  return accountingMigration.slice(
    start,
    next === -1 ? accountingMigration.length : next,
  );
};

test("create v2 inicializa la identidad ERP v3 sin aceptar campos de cliente", () => {
  assert.match(
    createCompatibilityMigration,
    /create or replace function public\.create_factura_recibida_v2\(/i,
  );
  assert.match(
    createCompatibilityMigration,
    /security invoker[\s\S]*?set search_path = ''/i,
  );

  const sanitizedPayloadMatch = createCompatibilityMigration.match(
    /p_factura\s*-\s*array\[([\s\S]*?)\]\s*\)\s*\|\|\s*jsonb_build_object\(/i,
  );
  assert.ok(sanitizedPayloadMatch, "No se encuentra el saneado de p_factura");
  const sanitizedPayload = sanitizedPayloadMatch[1];
  const serverDefaults = createCompatibilityMigration.slice(
    createCompatibilityMigration.indexOf("|| jsonb_build_object("),
    createCompatibilityMigration.indexOf("if v_source_kind <> 'erp_reference'"),
  );

  for (const field of [
    "erp_target_id",
    "erp_dataset_epoch",
    "erp_payload_hash",
    "erp_business_fingerprint",
    "erp_verified_at",
    "erp_reference_status",
    "erp_validation_status",
    "erp_validation_request_id",
    "erp_validated_at",
    "fecha_ctb_source",
  ]) {
    assert.match(
      sanitizedPayload,
      new RegExp(`'${field}'`),
      `El RPC debe retirar ${field} del payload entrante`,
    );
  }

  for (const field of [
    "erp_target_id",
    "erp_dataset_epoch",
    "erp_payload_hash",
    "erp_business_fingerprint",
    "erp_verified_at",
    "erp_validation_request_id",
    "erp_validated_at",
  ]) {
    assert.match(
      serverDefaults,
      new RegExp(`'${field}',\\s*null`),
      `El RPC debe inicializar ${field} a NULL`,
    );
  }

  assert.match(
    serverDefaults,
    /'erp_reference_status',\s*case[\s\S]*?'legacy_unverified'[\s\S]*?'unverified'/i,
  );
  assert.match(
    serverDefaults,
    /'erp_validation_status',\s*'not_validated'/i,
  );
  assert.match(
    serverDefaults,
    /'fecha_ctb_source',\s*case[\s\S]*?p_factura->>'fecha_ctb_source' = 'manual'[\s\S]*?'invoice_date'/i,
  );
  assert.match(
    createCompatibilityMigration,
    /jsonb_populate_record\(null::public\.facturasrecibidas, v_payload\)/i,
  );
});

test("save v2 conserva la identidad ERP v3 controlada por el servidor", () => {
  assert.match(
    saveProtectionMigration,
    /create or replace function public\.save_factura_recibida_v2\(/i,
  );
  assert.match(
    saveProtectionMigration,
    /security invoker[\s\S]*?set search_path = ''/i,
  );
  assert.match(saveProtectionMigration, /v_payload :=\s*to_jsonb\(v_current\)/i);

  const sanitizedPayloadMatch = saveProtectionMigration.match(
    /p_factura\s*-\s*array\[([\s\S]*?)\]\s*\)\s*\|\|\s*jsonb_build_object\(/i,
  );
  assert.ok(sanitizedPayloadMatch, "No se encuentra el saneado de save");
  for (const field of [
    "erp_target_id",
    "erp_dataset_epoch",
    "erp_payload_hash",
    "erp_business_fingerprint",
    "erp_verified_at",
    "erp_reference_status",
    "erp_validation_status",
    "erp_validation_request_id",
    "erp_validated_at",
    "fecha_ctb_source",
  ]) {
    assert.match(
      sanitizedPayloadMatch[1],
      new RegExp(`'${field}'`),
      `save debe retirar ${field} del payload entrante`,
    );
  }

  assert.match(
    saveProtectionMigration,
    /'fecha_ctb_source',\s*case[\s\S]*?not \(p_factura \? 'fecha_ctb_source'\)[\s\S]*?v_current\.fecha_ctb_source[\s\S]*?'manual'[\s\S]*?'invoice_date'/i,
  );
});

test("validar ERP no abre sending; solo begin v3 puede abrir el envío", () => {
  const validate = functionBody("record_factura_recibida_validation_v3");
  const begin = functionBody("begin_factura_recibida_sync_v3");

  assert.doesNotMatch(validate, /sync_status\s*=\s*'sending'/i);
  assert.doesNotMatch(validate, /estado\s*=\s*'preparada_erp'/i);
  assert.match(begin, /sync_status\s*=\s*'sending'/i);
});

test("errores y watchdog no contaminan el estado documental ni contable", () => {
  const finish = functionBody("finish_factura_recibida_sync_v3");
  const watchdog = functionBody("mark_stale_factura_recibida_syncs_v3");

  for (const body of [finish, watchdog]) {
    assert.doesNotMatch(body, /accounting_status\s*=/i);
    assert.doesNotMatch(body, /estado\s*=\s*'error_erp'/i);
  }
});

test("finish v3 deriva el estado antes del IF anidado", () => {
  const finish = functionBody("finish_factura_recibida_sync_v3");
  const executableFinish = finish.replace(/--[^\r\n]*/g, "");

  assert.match(finish, /v_target_sync_status text/i);
  assert.match(
    finish,
    /v_target_sync_status := case[\s\S]*?end;[\s\S]*?v_current\.sync_status is distinct from v_target_sync_status/i,
  );
  assert.doesNotMatch(
    executableFinish,
    /is distinct from\s+case[\s\S]*?\bend\s+then/i,
  );
});

test("estado derivado preserva descarte manual y duplicado enlazado", () => {
  const stateTrigger = functionBody("enforce_factura_received_state_v3");
  const discardedBranch = stateTrigger.indexOf("new.estado = 'descartada'");
  const duplicateBranch = stateTrigger.indexOf("new.duplicada_de is not null");

  assert.ok(discardedBranch >= 0);
  assert.ok(duplicateBranch > discardedBranch);
  assert.match(
    stateTrigger,
    /old\.estado = 'descartada'[\s\S]*?new\.estado := 'descartada'[\s\S]*?new\.sync_status := 'draft'/i,
  );
  assert.match(
    stateTrigger,
    /new\.duplicada_de is not null[\s\S]*?new\.estado := 'duplicada'[\s\S]*?new\.sync_status := 'draft'/i,
  );

  const update = readFileSync(
    join(supabaseRoot, "functions", "factura-recibida-update", "index.ts"),
    "utf8",
  );
  assert.match(update, /const discardRequested =[\s\S]*?body\.estado === "descartada"/i);
  assert.match(update, /discardRequested[\s\S]*?\? "descartada"/i);
});

test("extraccion, ingesta y guardado revalidan duplicado ERP antes de resolver punteos", () => {
  const functionsRoot = join(supabaseRoot, "functions");
  for (const functionName of [
    "factura-recibida-extraer",
    "factura-recibida-ingest",
    "factura-recibida-update",
  ]) {
    const source = readFileSync(
      join(functionsRoot, functionName, "index.ts"),
      "utf8",
    );
    const duplicateCheck = source.indexOf("verifyFacturaERPExactDuplicate(");
    const existingLinksReadback = source.indexOf("resolveFacturaERPExistingPunteoLinks(");
    const punteoCheck = source.indexOf("verifyFacturaERPExactMAPunteos(");
    const documentedCheck = source.indexOf("getFacturaERPDocumentedReferenceIssues({");
    assert.ok(duplicateCheck >= 0, `${functionName} debe verificar el duplicado remoto`);
    assert.ok(
      existingLinksReadback > duplicateCheck,
      `${functionName} debe releer los vinculos del duplicado confirmado`,
    );
    assert.ok(punteoCheck > duplicateCheck, `${functionName} debe comprobar primero el duplicado`);
    assert.ok(documentedCheck > duplicateCheck, `${functionName} no puede resolver referencias antes del duplicado`);
    assert.match(
      source,
      /existingInvoiceVerified:\s*(?:verifiedExactDuplicate|duplicateVerification\.duplicate)/i,
    );
    assert.match(source, /erp_duplicate_verification:\s*[^,\n]+\.evidence/i);
  }
});

test("guardado de duplicado unico relee vinculos ERP y falla sin sustituirlos por vacio", () => {
  const update = readFileSync(
    join(supabaseRoot, "functions", "factura-recibida-update", "index.ts"),
    "utf8",
  );
  const readback = update.indexOf("resolveFacturaERPExistingPunteoLinks(");
  const persistence = update.indexOf('rpc("save_factura_recibida_v2"');
  assert.ok(readback >= 0, "update debe releer los vinculos del duplicado exacto");
  assert.ok(persistence > readback, "el readback debe ocurrir antes del RPC de guardado");
  assert.match(update, /punteos\s*=\s*existingPunteoLinks\.punteos/i);
  assert.match(update, /p_punteos:\s*punteos/i);
});

test("watchdog se ejecuta cada minuto y caduca intentos a los diez minutos", () => {
  assert.match(migration, /create extension if not exists pg_cron;/i);
  assert.match(
    migration,
    /cron\.schedule\(\s*'facturas-recibidas-erp-watchdog-v3'\s*,\s*'\* \* \* \* \*'/i,
  );
  assert.match(
    migration,
    /mark_stale_factura_recibida_syncs_v3\(\s*interval '10 minutes'\s*,\s*null\s*\)/i,
  );
});

test("activación management exige blocked, confirmación y gates completos", () => {
  const activation = functionBody(
    "set_erp_target_write_mode_v3_impl",
    "private",
  );
  assert.match(activation, /security definer[\s\S]*?set search_path = ''/i);
  assert.match(activation, /v_target\.write_mode\s*<>\s*'blocked'/i);
  assert.match(activation, /ENABLE_VALIDATION:/i);
  assert.match(activation, /ENABLE_MANAGEMENT:/i);
  for (const gate of [
    "runtime_reconciled",
    "idempotency_store_ready",
    "counter_protocol_verified",
    "punteo_mapping_verified",
    "canary_readback_verified",
    "concurrency_tests_passed",
    "failure_injection_tests_passed",
  ]) {
    assert.match(activation, new RegExp(gate));
  }
  assert.match(activation, /sync_status in \('sending', 'unknown', 'reconciling'\)/i);
});

test("RPC privilegiadas usan wrappers invoker y helpers privados cerrados", () => {
  const privilegedFunctions = [
    "finalize_factura_recibida_sync_v3",
    "rotate_erp_target_epoch_v3",
    "set_erp_target_write_mode_v3",
  ];

  for (const name of privilegedFunctions) {
    const wrapper = functionBody(name);
    const helper = functionBody(`${name}_impl`, "private");

    assert.match(wrapper, /security invoker[\s\S]*?set search_path = ''/i);
    assert.doesNotMatch(wrapper, /security definer/i);
    assert.match(wrapper, new RegExp(`return private\\.${name}_impl\\s*\\(`, "i"));
    assert.match(helper, /security definer[\s\S]*?set search_path = ''/i);
  }

  assert.match(
    migration,
    /create schema if not exists private;[\s\S]*?revoke all on schema private from public, anon, authenticated, service_role;[\s\S]*?grant usage on schema private to service_role;/i,
  );
  for (const name of privilegedFunctions) {
    assert.match(
      migration,
      new RegExp(
        `revoke all on function private\\.${name}_impl\\([\\s\\S]*?\\) from public, anon, authenticated, service_role;`,
        "i",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `grant execute on function private\\.${name}_impl\\([\\s\\S]*?\\) to service_role;`,
        "i",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `revoke execute on function public\\.${name}\\([\\s\\S]*?\\) from public, anon, authenticated;[\\s\\S]*?grant execute on function public\\.${name}\\([\\s\\S]*?\\) to service_role;`,
        "i",
      ),
    );
  }

  const config = readFileSync(join(supabaseRoot, "config.toml"), "utf8");
  assert.doesNotMatch(config, /schemas\s*=\s*\[[^\]]*private/i);
});

test("rotar epoch separa referencias reales de validaciones no enviadas", () => {
  const rotation = functionBody("rotate_erp_target_epoch_v3_impl", "private");
  assert.match(rotation, /security definer[\s\S]*?set search_path = ''/i);

  assert.match(
    rotation,
    /sync_status in \('sending', 'unknown', 'reconciling'\)[\s\S]*?EPOCH_ROTATION_BLOCKED/i,
  );
  assert.match(
    rotation,
    /with stale_references as[\s\S]*?remote_frr_id is not null[\s\S]*?or "FRR_id" is not null[\s\S]*?'stale_environment'/i,
  );
  assert.match(
    rotation,
    /with invalidated_validations as[\s\S]*?erp_validation_status = 'not_validated'[\s\S]*?erp_target_id = null[\s\S]*?erp_dataset_epoch = null[\s\S]*?remote_frr_id is null[\s\S]*?"FRR_id" is null/i,
  );
  assert.match(rotation, /'epoch_validation_invalidated'/i);
  assert.match(rotation, /'invalidated_validations',\s*v_invalidated_count/i);
  assert.match(
    migration,
    /erp_validation_status = 'stale'[\s\S]*?remote_frr_id is not null[\s\S]*?or "FRR_id" is not null/i,
  );
});

test("identidad remota es target + epoch + FRR y targets no admiten mutacion directa", () => {
  assert.match(
    migration,
    /idx_facturasrecibidas_target_epoch_remote_frr_id_unique[\s\S]*?erp_target_id[\s\S]*?erp_dataset_epoch[\s\S]*?remote_frr_id/i,
  );
  assert.match(
    migration,
    /drop index if exists public\.idx_facturasrecibidas_remote_frr_id_unique/i,
  );
  const targetAcl = migration.match(
    /revoke all on table public\.erp_targets[\s\S]*?grant select on table public\.erp_targets[\s\S]*?to authenticated, service_role;/i,
  )?.[0] ?? "";
  assert.ok(targetAcl);
  assert.match(targetAcl, /from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(targetAcl, /\b(?:insert|update|delete)\b/i);

  assert.match(
    migration,
    /erp_targets_dataset_identity_check check \([\s\S]*?dataset_epoch is null[\s\S]*?snapshot_at is null[\s\S]*?write_mode = 'disabled'[\s\S]*?dataset_epoch is not null[\s\S]*?snapshot_at is not null/i,
  );
});

test("backfills legacy son estables en una segunda ejecución", () => {
  const legacyStart = migration.indexOf("-- Existing remote references");
  const staleStart = migration.indexOf("-- The TEST clone refresh");
  const legacyBackfill = migration.slice(legacyStart, staleStart);
  const staleBackfill = migration.slice(
    staleStart,
    migration.indexOf("drop index if exists", staleStart),
  );

  assert.match(legacyBackfill, /remote_frr_id\s*<>\s*49681/i);
  assert.match(legacyBackfill, /erp_reference_status is distinct from 'legacy_unverified'/i);
  assert.match(staleBackfill, /sync_status is distinct from 'stale'/i);
  assert.match(
    staleBackfill,
    /erp_error is distinct from\s*'Referencia ERP caducada tras refrescar el clon TEST'/i,
  );
});

test("readback v3 deja una revisión inmutable posterior al finalizador legacy", () => {
  const finalize = functionBody(
    "finalize_factura_recibida_sync_v3_impl",
    "private",
  );
  assert.match(finalize, /row_version\s*=\s*factura\.row_version\s*\+\s*1/i);
  assert.match(finalize, /'edge_readback_v3'/i);
  assert.match(finalize, /'readback_verified_v3'/i);
  assert.match(finalize, /factura_recibida_snapshot_v2\(p_factura_id\)/i);
});

const walkFiles = (root) =>
  readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? walkFiles(path) : [path];
  });

test("n8n queda limitado a extracción; lectura y escritura ERP llaman FastAPI", () => {
  const functionsRoot = join(supabaseRoot, "functions");
  const forbidden = [];
  for (const path of walkFiles(functionsRoot)) {
    if (!path.endsWith(".ts") || path.endsWith(".test.ts")) continue;
    const source = readFileSync(path, "utf8");
    const isExtractionFunction = relative(functionsRoot, path)
      .replaceAll("\\", "/")
      .startsWith("factura-recibida-extraer/");
    if (
      !isExtractionFunction &&
      /N8N_[A-Z0-9_]*(?:READ|WRITE)|apiCampojoyma-facturas-write|webhook.*facturas/i.test(
        source,
      )
    ) {
      forbidden.push(relative(functionsRoot, path));
    }
  }
  assert.deepEqual(forbidden, []);

  const send = readFileSync(
    join(functionsRoot, "factura-recibida-send-erp", "index.ts"),
    "utf8",
  );
  const read = readFileSync(
    join(functionsRoot, "facturas-recibidas-erp-read", "index.ts"),
    "utf8",
  );
  assert.match(send, /callNetagroWriteV3/);
  assert.match(read, /callNetagroRead/);
  assert.match(read, /applyCampojoymaLegacyERPReadScope\(consulta\)/);
  assert.doesNotMatch(send, /missing_configuration/);
  assert.doesNotMatch(read, /jsonResponse\(\{\s*error:\s*message\s*\}/);
});

test("Edge exige contrato v3 y no filtra errores internos en respuestas directas", () => {
  const functionsRoot = join(supabaseRoot, "functions");
  const send = readFileSync(
    join(functionsRoot, "factura-recibida-send-erp", "index.ts"),
    "utf8",
  );
  const read = readFileSync(
    join(functionsRoot, "facturas-recibidas-erp-read", "index.ts"),
    "utf8",
  );
  const extract = readFileSync(
    join(functionsRoot, "factura-recibida-extraer", "index.ts"),
    "utf8",
  );
  const ingest = readFileSync(
    join(functionsRoot, "factura-recibida-ingest", "index.ts"),
    "utf8",
  );
  const runtime = readFileSync(
    join(functionsRoot, "facturas-recibidas-erp-runtime", "index.ts"),
    "utf8",
  );

  assert.doesNotMatch(send, /legacy_commit|legacyMode/i);
  assert.match(send, /code:\s*"contract_upgrade_required"/i);
  assert.match(send, /status:\s*426/i);
  for (const source of [send, read, extract, ingest, runtime]) {
    assert.doesNotMatch(source, /jsonResponse\(\{\s*error:/i);
    assert.doesNotMatch(source, /return (?:auth|tokenResult)\.response/i);
    for (const field of [
      "code",
      "category",
      "user_message",
      "technical_details",
      "retryable",
      "reconciliation_required",
      "request_id",
      "target_id",
      "dataset_epoch",
    ]) {
      assert.match(source, new RegExp(`\\b${field}\\b`));
    }
  }
  assert.match(ingest, /const buildIngestError/);
  assert.match(runtime, /const runtimeError/);
  assert.match(read, /if \(!result\.ok\)[\s\S]*?return readError/);
});

test("reconciliación comprueba identidad completa antes del readback", () => {
  const send = readFileSync(
    join(
      supabaseRoot,
      "functions",
      "factura-recibida-send-erp",
      "index.ts",
    ),
    "utf8",
  );
  const reconciliationStart = send.indexOf("if (reconciliationMode)");
  const reconciliation = send.slice(reconciliationStart);
  const identityCheck = reconciliation.indexOf("const attemptsMatchIdentity");
  const identityGuard = reconciliation.indexOf("if (!attemptsMatchIdentity)");
  const readback = reconciliation.indexOf("readERPReadback(", identityGuard);

  assert.ok(reconciliationStart >= 0);
  assert.ok(identityCheck >= 0);
  assert.ok(identityGuard > identityCheck);
  assert.ok(readback > identityGuard);
  for (const field of [
    "targetId",
    "datasetEpoch",
    "circuit",
    "payloadHash",
    "businessFingerprint",
  ]) {
    assert.match(
      reconciliation.slice(identityCheck, identityGuard),
      new RegExp(`\\b${field}\\b`),
    );
  }
  assert.match(
    send,
    /let activeTargetId:[\s\S]*?let activeDatasetEpoch:[\s\S]*?target_id: activeTargetId[\s\S]*?dataset_epoch: activeDatasetEpoch/i,
  );
});

test("RPC v2 no puede abrir ni finalizar el writer con service_role", () => {
  for (const signature of [
    String.raw`begin_factura_recibida_sync_v2\(\s*uuid,\s*bigint,\s*uuid,\s*jsonb,\s*uuid\s*\)`,
    String.raw`finish_factura_recibida_sync_v2\(\s*uuid,\s*uuid,\s*text,\s*text,\s*jsonb,\s*integer,\s*text,\s*uuid\s*\)`,
    String.raw`finalize_factura_recibida_sync_v2\(\s*uuid,\s*uuid,\s*jsonb,\s*jsonb,\s*uuid\s*\)`,
  ]) {
    assert.match(
      migration,
      new RegExp(
        `revoke execute on function public\\.${signature}[\\s\\S]*?from public, anon, authenticated, service_role`,
        "i",
      ),
    );
  }

  const finalize = functionBody("finalize_factura_recibida_sync_v3");
  const finalizeImpl = functionBody(
    "finalize_factura_recibida_sync_v3_impl",
    "private",
  );
  assert.match(finalize, /security invoker[\s\S]*?set search_path = ''/i);
  assert.match(
    finalize,
    /return private\.finalize_factura_recibida_sync_v3_impl/i,
  );
  assert.match(
    finalizeImpl,
    /security definer[\s\S]*?set search_path = ''/i,
  );
});

test("reconciliacion exacta puede cerrar commit unknown, pero no sin intento activo", () => {
  const finalize = functionBody(
    "finalize_factura_recibida_sync_v3_impl",
    "private",
  );
  const unknownBranch = finalize.indexOf("if v_commit.status = 'unknown'");
  const reconcileAttempt = finalize.indexOf("and phase = 'reconcile'", unknownBranch);
  const activeGuard = finalize.indexOf("v_reconcile.status <> 'in_progress'", reconcileAttempt);
  const exactReadback = finalize.indexOf(
    "public.finalize_factura_recibida_sync_v2",
    activeGuard,
  );
  const promoteCommit = finalize.indexOf(
    "set status = 'succeeded'",
    exactReadback,
  );

  assert.ok(unknownBranch >= 0);
  assert.ok(reconcileAttempt > unknownBranch);
  assert.ok(activeGuard > reconcileAttempt);
  assert.ok(exactReadback > activeGuard);
  assert.ok(promoteCommit > exactReadback);
  for (const field of [
    "erp_target_id",
    "erp_dataset_epoch",
    "circuit",
    "payload_hash",
    "business_fingerprint",
  ]) {
    assert.match(
      finalize.slice(reconcileAttempt, exactReadback),
      new RegExp(`v_reconcile\\.${field}`),
    );
  }
});

test("cada reintento in_progress reinicia started_at antes del watchdog", () => {
  const begin = functionBody("begin_factura_recibida_sync_v3");
  const finish = functionBody("finish_factura_recibida_sync_v3");
  assert.match(
    begin,
    /on conflict \(request_id, phase\) do update[\s\S]*?started_at = now\(\)/i,
  );
  assert.match(
    finish,
    /started_at = case[\s\S]*?excluded\.status = 'in_progress'[\s\S]*?then now\(\)/i,
  );
});

test("target, epoch y snapshot forman una sola identidad runtime", () => {
  const send = readFileSync(
    join(
      supabaseRoot,
      "functions",
      "factura-recibida-send-erp",
      "index.ts",
    ),
    "utf8",
  );
  const runtime = readFileSync(
    join(
      supabaseRoot,
      "functions",
      "facturas-recibidas-erp-runtime",
      "index.ts",
    ),
    "utf8",
  );
  assert.match(send, /timestampsReferToSameInstant\([\s\S]*?snapshot_at[\s\S]*?runtime\.snapshot_at/i);
  assert.match(runtime, /timestampsReferToSameInstant\(local\.snapshot_at, upstream\.snapshot_at\)/i);

  const rotation = functionBody("rotate_erp_target_epoch_v3_impl", "private");
  assert.match(
    rotation,
    /dataset_epoch is not distinct from p_dataset_epoch[\s\S]*?snapshot_at is distinct from p_snapshot_at[\s\S]*?IDEMPOTENCY_CONFLICT/i,
  );
});

test("las revisiones v3 usan tipos admitidos y texto de auditoria libre", () => {
  const allowedTypes = new Set([
    "update",
    "sync_begin",
    "sync_error",
    "sync_unknown",
    "sync_finalize",
  ]);
  const revisionValues = [
    ["update", "migration_erp_v3", "legacy_unverified"],
    ["update", "migration_erp_v3", "stale_environment"],
    ["sync_begin", "edge_send_v3", null],
    ["sync_unknown", "watchdog_v3", "ambiguous_commit"],
    ["sync_finalize", "edge_readback_v3", "readback_verified_v3"],
    ["update", "epoch_rotation_v3", "stale_environment"],
    ["update", "epoch_rotation_v3", "epoch_validation_invalidated"],
  ];
  for (const [changeType, changeSource, reason] of revisionValues) {
    assert.ok(allowedTypes.has(changeType));
    assert.match(migration, new RegExp(`'${changeSource}'`, "i"));
    if (reason) assert.match(migration, new RegExp(`'${reason}'`, "i"));
  }
});

test("hardening ACL conserva lectura RLS y elimina toda mutacion de cliente", () => {
  const tables = [
    "facturasrecibidas",
    "facturasrecibidas_ctb",
    "facturasrecibidas_punteos",
    "facturasrecibidas_sync_attempts",
    "facturasrecibidas_asientos",
    "facturasrecibidas_asiento_apuntes",
    "facturasrecibidas_revisions",
  ];

  for (const table of tables) {
    assert.match(
      clientAclMigration,
      new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    );
    assert.match(
      clientAclMigration,
      new RegExp(`'public\\.${table}'::regclass`, "i"),
    );
  }

  assert.match(
    clientAclMigration,
    /from pg_catalog\.pg_policies[\s\S]*?policy\.cmd <> 'SELECT'[\s\S]*?'drop policy if exists %I on %I\.%I'/i,
  );
  assert.match(
    clientAclMigration,
    /revoke all privileges[\s\S]*?from public, anon, authenticated;/i,
  );
  assert.match(
    clientAclMigration,
    /grant select[\s\S]*?to authenticated;/i,
  );
  assert.doesNotMatch(
    clientAclMigration,
    /grant\s+[^;]*\b(?:insert|update|delete|truncate|references|trigger)\b[^;]*\bto\s+authenticated\s*;/i,
  );

  assert.match(
    clientAclMigration,
    /pg_catalog\.pg_policy[\s\S]*?policy\.polcmd <> 'r'/i,
  );
  assert.match(
    clientAclMigration,
    /pg_catalog\.pg_policy[\s\S]*?policy\.polcmd = 'r'/i,
  );
  for (const privilege of [
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "REFERENCES",
    "TRIGGER",
  ]) {
    assert.match(clientAclMigration, new RegExp(`'${privilege}'`));
  }
  assert.match(
    clientAclMigration,
    /has_table_privilege\(\s*'authenticated'[\s\S]*?'SELECT'/i,
  );
  assert.match(
    clientAclMigration,
    /has_table_privilege\(\s*'anon'[\s\S]*?'SELECT'/i,
  );
});

test("hardening ACL preserva service_role y verifica los RPC v3", () => {
  assert.match(
    clientAclMigration,
    /grant select, insert, update, delete[\s\S]*?to service_role;/i,
  );
  assert.match(
    clientAclMigration,
    /grant select, insert, update[\s\S]*?facturasrecibidas_sync_attempts[\s\S]*?to service_role;/i,
  );
  assert.match(
    clientAclMigration,
    /grant select, insert[\s\S]*?facturasrecibidas_asientos[\s\S]*?facturasrecibidas_asiento_apuntes[\s\S]*?facturasrecibidas_revisions[\s\S]*?to service_role;/i,
  );

  for (const rpc of [
    "record_factura_recibida_validation_v3",
    "begin_factura_recibida_sync_v3",
    "finish_factura_recibida_sync_v3",
    "finalize_factura_recibida_sync_v3",
    "mark_stale_factura_recibida_syncs_v3",
    "rotate_erp_target_epoch_v3",
    "set_erp_target_write_mode_v3",
  ]) {
    assert.match(
      clientAclMigration,
      new RegExp(`'public\\.${rpc}\\(`, "i"),
    );
  }

  assert.match(clientAclMigration, /pg_catalog\.to_regprocedure\(rpc_signature\)/i);
  assert.match(
    clientAclMigration,
    /has_function_privilege\(\s*'service_role'[\s\S]*?'EXECUTE'/i,
  );
  assert.match(
    clientAclMigration,
    /foreach client_role in array array\['authenticated', 'anon'\][\s\S]*?has_function_privilege\(/i,
  );
  assert.doesNotMatch(clientAclMigration, /\b(?:grant|revoke)\s+execute\b/i);
});

test("la intencion contable queda separada del alta de gestion", () => {
  assert.match(
    accountingMigration,
    /accounting_mode in \('unavailable', 'official', 'sql_test'\)/i,
  );
  for (const column of [
    "accounting_requested",
    "accounting_request_id",
    "accounting_payload_hash",
    "accounting_invoice_fingerprint",
    "accounting_error",
    "accounting_response",
    "accounting_verified_at",
  ]) {
    assert.match(
      accountingMigration,
      new RegExp(`add column if not exists ${column}\\b`, "i"),
    );
  }

  const capture = accountingFunctionBody("capture_factura_accounting_intent_v3");
  assert.match(
    capture,
    /new\.accounting_requested\s*:=\s*coalesce\(new\."FRR_Contabilizar", 'N'\) = 'S'/i,
  );
  assert.match(
    capture,
    /new\.sync_status\s*=\s*'sending'[\s\S]*?new\.accounting_requested\s*:=\s*true/i,
  );
  assert.match(
    accountingMigration,
    /before insert or update of "FRR_Contabilizar", sync_status[\s\S]*?execute function public\.capture_factura_accounting_intent_v3\(\)/i,
  );
});

test("prepare contable fija request antes de Netagro y exige alta confirmada en el mismo TEST", () => {
  const prepare = accountingFunctionBody("prepare_factura_recibida_accounting_v3");
  assert.match(prepare, /from public\.erp_targets[\s\S]*?for share/i);
  assert.match(prepare, /not v_target\.active/i);
  assert.match(
    prepare,
    /v_target\.dataset_epoch is distinct from p_dataset_epoch/i,
  );
  assert.match(
    prepare,
    /v_target\.accounting_mode not in \('official', 'sql_test'\)/i,
  );
  assert.match(prepare, /v_current\.sync_status <> 'sent'/i);
  assert.match(prepare, /v_current\.erp_reference_status <> 'valid'/i);
  assert.match(prepare, /v_current\.erp_target_id is distinct from p_target_id/i);
  assert.match(
    prepare,
    /v_current\.erp_dataset_epoch is distinct from p_dataset_epoch/i,
  );
  assert.match(
    prepare,
    /coalesce\(v_current\.remote_frr_id, v_current\."FRR_id", 0\) <= 0/i,
  );
  assert.match(prepare, /if not v_current\.accounting_requested/i);
  assert.match(
    prepare,
    /accounting_request_id is not null[\s\S]*?accounting_status in \('requested', 'pending', 'unknown'\)[\s\S]*?IDEMPOTENCY_CONFLICT/i,
  );

  const persistRequest = prepare.indexOf("accounting_request_id = p_request_id");
  const pendingRevision = prepare.indexOf("'accounting_pending'");
  assert.ok(persistRequest >= 0, "prepare debe persistir el request contable");
  assert.ok(
    pendingRevision > persistRequest,
    "el request debe quedar fijado antes de registrar el intento pendiente",
  );
});

test("record contable solo confirma un readback exacto, visible y cuadrado", () => {
  const record = accountingFunctionBody("record_factura_recibida_accounting_v3");
  for (const status of ["pending", "created", "error", "unknown"]) {
    assert.match(record, new RegExp(`'${status}'`, "i"));
  }
  for (const identity of [
    "accounting_request_id is distinct from p_request_id",
    "erp_target_id is distinct from p_target_id",
    "erp_dataset_epoch is distinct from p_dataset_epoch",
  ]) {
    assert.match(record, new RegExp(identity, "i"));
  }
  for (const field of [
    "contract_version",
    "operation",
    "request_id",
    "target_id",
    "dataset_epoch",
    "factura_id",
    "payload_hash",
    "invoice_fingerprint",
    "eligible",
    "readback_confirmed",
  ]) {
    assert.match(record, new RegExp(`p_response->>?'${field}'`, "i"));
  }
  assert.match(record, /jsonb_array_length\(v_lines\) = 0/i);
  assert.match(record, /v_accounting->'balanced' is distinct from 'true'::jsonb/i);
  assert.match(record, /abs\(v_total_debit - v_total_credit\) > 0\.01/i);
  assert.match(
    record,
    /insert into public\.facturasrecibidas_asientos[\s\S]*?insert into public\.facturasrecibidas_asiento_apuntes[\s\S]*?set accounting_status = 'created'/i,
  );
  assert.match(record, /"FRR_IdAsientoNet" = v_technical_id/i);
  assert.match(record, /"FRR_Contabilizar" = 'S'/i);
  assert.match(record, /accounting_verified_at = now\(\)/i);
});

test("RPC contables quedan reservadas a service_role", () => {
  for (const [name, signature] of [
    [
      "prepare_factura_recibida_accounting_v3",
      "uuid, uuid, text, uuid, uuid",
    ],
    [
      "record_factura_recibida_accounting_v3",
      "uuid, uuid, text, uuid, text, jsonb, text, text, text, uuid",
    ],
  ]) {
    assert.match(
      accountingMigration,
      new RegExp(
        `revoke execute on function public\\.${name}\\([\\s\\S]*?${signature.replaceAll(" ", "\\s*")}\\s*\\)[\\s\\S]*?from public, anon, authenticated`,
        "i",
      ),
    );
    assert.match(
      accountingMigration,
      new RegExp(
        `grant execute on function public\\.${name}\\([\\s\\S]*?${signature.replaceAll(" ", "\\s*")}\\s*\\)[\\s\\S]*?to service_role`,
        "i",
      ),
    );
  }
});

test("Edge de gestion conserva el gate contable pero no orquesta asientos", () => {
  const functionsRoot = join(supabaseRoot, "functions");
  const send = readFileSync(
    join(functionsRoot, "factura-recibida-send-erp", "index.ts"),
    "utf8",
  );
  const runtime = readFileSync(
    join(functionsRoot, "facturas-recibidas-erp-runtime", "index.ts"),
    "utf8",
  );

  const accountingGate = send.indexOf("!runtime.accounting_ready_for_commit");
  const managementBegin = send.indexOf('"begin_factura_recibida_sync_v3"');
  assert.ok(accountingGate >= 0);
  assert.ok(
    managementBegin > accountingGate,
    "el gate contable debe cerrar antes de abrir el writer de gestion",
  );
  assert.match(
    send.slice(Math.max(0, accountingGate - 250), accountingGate + 500),
    /requestedOperation === "commit"[\s\S]*?accountingRequested[\s\S]*?\["official", "sql_test"\][\s\S]*?localTarget[\s\S]*?accounting_mode/i,
  );
  assert.match(
    runtime,
    /\["official", "sql_test"\]\.includes\(localAccountingMode\)[\s\S]*?localAccountingMode === upstream\.accounting_mode[\s\S]*?upstream\.accounting_ready_for_commit[\s\S]*?upstream\.capabilities\.accounting_commit/i,
  );
  assert.doesNotMatch(send, /callNetagroAccountingV3/i);
  assert.doesNotMatch(send, /buildAccountingContractV3/i);
  assert.doesNotMatch(send, /prepare_factura_recibida_accounting_v3/i);
  assert.doesNotMatch(send, /record_factura_recibida_accounting_v3/i);
  assert.match(
    send,
    /finalize_factura_recibida_sync_v3[\s\S]*?activeWriterOpened = false[\s\S]*?return jsonResponse/i,
  );
});

test("una Edge contable separada, si existe, conserva los mismos gates e identidad", () => {
  const functionsRoot = join(supabaseRoot, "functions");
  const candidates = readdirSync(functionsRoot).filter((name) =>
    /^factura-recibida-(?:account|contabil)/i.test(name)
  );
  for (const name of candidates) {
    const source = readFileSync(join(functionsRoot, name, "index.ts"), "utf8");
    assert.match(source, /accounting_ready_for_commit/i);
    assert.match(source, /\["official", "sql_test"\]/i);
    assert.match(source, /prepare_factura_recibida_accounting_v3/i);
    assert.match(source, /record_factura_recibida_accounting_v3/i);
    assert.match(source, /callNetagroAccountingV3/i);
    assert.match(source, /validateNetagroAccountingResponseV3/i);
    assert.doesNotMatch(source, /callNetagroWriteV3/i);
  }
});

test("Edge contable solo reanuda pending antes de un claim atomico de commit", () => {
  const source = readFileSync(
    join(
      supabaseRoot,
      "functions",
      "factura-recibida-account-erp",
      "index.ts",
    ),
    "utf8",
  );
  const stickyBranch = source.indexOf("if (UNCERTAIN_STATUSES.has(accountingStatus))");
  const runtimeCall = source.indexOf("runtime = await fetchNetagroRuntime()", stickyBranch);
  const prepareCall = source.indexOf('"prepare_factura_recibida_accounting_v3"');
  const validateCall = source.indexOf('accountingPayload("validate")');
  const commitCall = source.indexOf('accountingPayload("commit")');
  const resumePlan = source.indexOf("getFacturaAccountingResumePlan({");
  const validateBranch = source.indexOf('if (resumePlan === "validate")');
  const commitClaim = source.indexOf(
    '"begin_factura_recibida_accounting_commit_v3"',
  );

  assert.ok(stickyBranch >= 0);
  assert.ok(runtimeCall > stickyBranch);
  assert.ok(prepareCall > stickyBranch);
  assert.ok(resumePlan > prepareCall);
  assert.ok(validateBranch > resumePlan);
  assert.ok(validateCall > validateBranch);
  assert.ok(validateCall > stickyBranch);
  assert.ok(commitCall > stickyBranch);
  assert.ok(commitClaim > validateCall);
  assert.ok(commitCall > commitClaim);
  assert.match(source, /const UNCERTAIN_STATUSES = new Set\(\["unknown"\]\)/);
  assert.match(source, /const RESUMABLE_STATUSES = new Set\(\["pending"\]\)/);
  assert.match(
    source.slice(resumePlan, validateBranch),
    /resumePlan === "reconcile"[\s\S]*?return accountingError\(\{[\s\S]*?status:\s*202/,
  );
  assert.match(
    source.slice(resumePlan, validateCall),
    /resumePlan === "commit"[\s\S]*?preparedPayloadHash[\s\S]*?preparedInvoiceFingerprint/,
  );
  assert.match(
    source.slice(stickyBranch, runtimeCall),
    /storedRequestId !== requestId[\s\S]*?idempotency_conflict[\s\S]*?status:\s*202[\s\S]*?ambiguous_commit[\s\S]*?reconciliationRequired:\s*true/i,
  );
  assert.match(source, /structuredCommitError\?\.code === "idempotency_in_progress"/);
  assert.match(source, /structured\?\.code === "idempotency_in_progress"/);
  assert.match(
    source,
    /safePayloadHash = isSha256\(payloadHash\)[\s\S]*?safeInvoiceFingerprint = isSha256\(invoiceFingerprint\)/,
  );
  assert.match(
    source.slice(commitClaim, commitCall),
    /commit_authorized !== true[\s\S]*?reconciliation_required === true[\s\S]*?ambiguous_commit/,
  );
  assert.match(
    source.slice(commitClaim, commitCall + 250),
    /commitOpened = true[\s\S]*?callNetagroAccountingV3/,
  );
});

test("migracion correctiva hace sticky la incertidumbre y cierra accounting con el target", () => {
  assert.match(
    accountingSafetyMigration,
    /v_current\.accounting_status in \('pending', 'unknown'\)[\s\S]*?accounting_request_id is distinct from p_request_id[\s\S]*?reconciliation_required', true[\s\S]*?update public\.facturasrecibidas/i,
  );
  assert.match(
    accountingSafetyMigration,
    /create or replace function public\.keep_unknown_factura_accounting_sticky_v3/i,
  );
  assert.match(
    accountingSafetyMigration,
    /new\.accounting_mode := 'unavailable'[\s\S]*?before update of write_mode, dataset_epoch, snapshot_at/i,
  );
  assert.match(
    accountingSafetyMigration,
    /new\.write_mode <> 'management'[\s\S]*?new\.dataset_epoch is distinct from old\.dataset_epoch[\s\S]*?new\.snapshot_at is distinct from old\.snapshot_at/i,
  );
});

test("unknown no puede convertirse en stale y solo cierra con readback exacto persistido", () => {
  const start = accountingResumeMigration.indexOf(
    "create or replace function public.keep_unknown_factura_accounting_sticky_v3(",
  );
  const end = accountingResumeMigration.indexOf(
    "create or replace function public.guard_erp_target_against_unresolved_accounting_v3(",
    start,
  );
  assert.ok(start >= 0);
  assert.ok(end > start);
  const sticky = accountingResumeMigration.slice(start, end);

  assert.match(
    sticky,
    /old\.accounting_status <> 'unknown'[\s\S]*?new\.accounting_status = 'unknown'[\s\S]*?return new/i,
  );
  assert.match(
    sticky,
    /new\.accounting_status <> 'created'[\s\S]*?ACCOUNTING_RECONCILIATION_REQUIRED/i,
  );
  assert.doesNotMatch(sticky, /new\.accounting_status[^;]*?'stale'/i);
  assert.match(
    sticky,
    /accounting_request_id is distinct from old\.accounting_request_id[\s\S]*?accounting_payload_hash is distinct from old\.accounting_payload_hash[\s\S]*?accounting_invoice_fingerprint[\s\S]*?old\.accounting_invoice_fingerprint/i,
  );
  assert.match(
    sticky,
    /attempt\.phase = 'commit'[\s\S]*?attempt\.status = 'succeeded'[\s\S]*?not attempt\.reconciliation_required[\s\S]*?asiento\.technical_id = new\."FRR_IdAsientoNet"[\s\S]*?asiento\.balanced/i,
  );
});

test("la rotacion y activacion quedan bloqueadas por contabilidad no resuelta", () => {
  assert.match(
    accountingResumeMigration,
    /accounting_status in \('requested', 'pending', 'unknown'\)/i,
  );
  assert.match(
    accountingResumeMigration,
    /attempt\.circuit = 'accounting'[\s\S]*?attempt\.status in \('in_progress', 'unknown'\)[\s\S]*?attempt\.reconciliation_required/i,
  );
  assert.match(
    accountingResumeMigration,
    /new\.dataset_epoch is distinct from old\.dataset_epoch[\s\S]*?old\.write_mode = 'disabled' and new\.write_mode = 'blocked'[\s\S]*?old\.write_mode <> 'management' and new\.write_mode = 'management'[\s\S]*?new\.accounting_mode in \('official', 'sql_test'\)/i,
  );
  assert.match(
    accountingResumeMigration,
    /new\.accounting_mode in \('official', 'sql_test'\)[\s\S]*?new\.write_mode <> 'management'[\s\S]*?ACCOUNTING_MODE_REQUIRES_MANAGEMENT/i,
  );

  const rotationStart = accountingResumeMigration.indexOf(
    "create or replace function private.rotate_erp_target_epoch_v3_impl(",
  );
  assert.ok(rotationStart >= 0);
  const rotation = accountingResumeMigration.slice(rotationStart);
  const guard = rotation.indexOf(
    "private.assert_no_unresolved_factura_accounting_v3(p_target_id, null)",
  );
  const staleMutation = rotation.indexOf("with stale_references as");
  const targetMutation = rotation.indexOf("update public.erp_targets");
  assert.ok(guard >= 0);
  assert.ok(staleMutation > guard);
  assert.ok(targetMutation > staleMutation);
  assert.match(
    rotation.slice(targetMutation, targetMutation + 500),
    /write_mode = 'disabled'[\s\S]*?accounting_mode = 'unavailable'/i,
  );
});

test("pending reanuda validate o el mismo commit solo con identidad demostrable", () => {
  const start = accountingResumeMigration.indexOf(
    "create or replace function public.prepare_factura_recibida_accounting_v3(",
  );
  const end = accountingResumeMigration.indexOf(
    "create or replace function public.begin_factura_recibida_accounting_commit_v3(",
    start,
  );
  const prepare = accountingResumeMigration.slice(start, end);

  const unknownBranch = prepare.indexOf(
    "if v_current.accounting_status = 'unknown'",
  );
  const allowlistStart = prepare.indexOf(
    "if v_current.accounting_status not in (",
  );
  const allowlistEnd = prepare.indexOf(") then", allowlistStart);
  const freshRequest = prepare.indexOf("v_request_payload := jsonb_build_object");
  assert.ok(unknownBranch >= 0);
  assert.ok(allowlistStart > unknownBranch);
  assert.ok(allowlistEnd > allowlistStart);
  assert.ok(freshRequest > allowlistEnd);
  const allowlist = prepare.slice(allowlistStart, allowlistEnd);
  for (const status of ["not_requested", "requested", "error", "pending"]) {
    assert.match(allowlist, new RegExp(`'${status}'`));
  }
  for (const status of [
    "stale",
    "reference_unverified",
    "reference_only",
    "unavailable",
  ]) {
    assert.doesNotMatch(allowlist, new RegExp(`'${status}'`));
  }
  assert.match(
    prepare.slice(allowlistStart, freshRequest),
    /ACCOUNTING_NOT_READY: el estado contable no permite iniciar ni reanudar la operacion/i,
  );
  assert.match(
    prepare,
    /is_readonly_reference[\s\S]*?source_kind = 'erp_reference'[\s\S]*?ACCOUNTING_NOT_READY/i,
  );

  assert.match(
    prepare,
    /phase = 'commit'[\s\S]*?v_commit\.status = 'in_progress'[\s\S]*?accounting_payload_hash is not distinct from v_commit\.payload_hash[\s\S]*?accounting_invoice_fingerprint[\s\S]*?business_fingerprint[\s\S]*?resume_phase', 'commit'[\s\S]*?reconciliation_required', false/i,
  );
  assert.match(
    prepare,
    /phase = 'validate'[\s\S]*?accounting_status = 'pending'[\s\S]*?status not in \('in_progress', 'succeeded'\)/i,
  );
  assert.match(
    prepare,
    /v_validate\.status = 'succeeded'[\s\S]*?then 'precommit'[\s\S]*?else 'validate'/i,
  );
  assert.doesNotMatch(prepare, /insert into public\.facturasrecibidas_sync_attempts[\s\S]*?'commit'/i);
});

test("el claim de commit es unico; solo in_progress exacto admite replay", () => {
  const start = accountingResumeMigration.indexOf(
    "create or replace function public.begin_factura_recibida_accounting_commit_v3(",
  );
  const end = accountingResumeMigration.indexOf(
    "create or replace function private.rotate_erp_target_epoch_v3_impl(",
    start,
  );
  const beginCommit = accountingResumeMigration.slice(start, end);

  assert.match(
    beginCommit,
    /v_validate\.status <> 'succeeded'[\s\S]*?v_validate\.reconciliation_required[\s\S]*?payload_hash is distinct from p_payload_hash[\s\S]*?business_fingerprint is distinct from p_invoice_fingerprint/i,
  );
  assert.match(
    beginCommit,
    /v_current\.sync_status <> 'sent'[\s\S]*?erp_reference_status <> 'valid'[\s\S]*?is_readonly_reference[\s\S]*?source_kind = 'erp_reference'[\s\S]*?not v_current\.accounting_requested[\s\S]*?accounting_status <> 'pending'[\s\S]*?accounting_payload_hash is distinct from p_payload_hash[\s\S]*?accounting_invoice_fingerprint[\s\S]*?p_invoice_fingerprint/i,
  );
  assert.match(
    beginCommit,
    /phase = 'commit'[\s\S]*?for update[\s\S]*?if found then[\s\S]*?v_commit\.status = 'in_progress'[\s\S]*?not v_commit\.reconciliation_required[\s\S]*?'commit_authorized', true[\s\S]*?'commit_replay', true[\s\S]*?'reconciliation_required', false/i,
  );
  assert.match(
    beginCommit,
    /'commit_replay', true[\s\S]*?return jsonb_build_object\([\s\S]*?'commit_authorized', false[\s\S]*?'reconciliation_required', true/i,
  );
  assert.match(
    beginCommit,
    /'commit_claimed', true[\s\S]*?'commit_authorized', true/i,
  );
  assert.match(
    accountingResumeMigration,
    /new\.request_payload->'commit_claimed' is distinct from 'true'::jsonb[\s\S]*?return null/i,
  );
  assert.match(
    accountingResumeMigration,
    /revoke execute on function public\.begin_factura_recibida_accounting_commit_v3[\s\S]*?from public, anon, authenticated[\s\S]*?grant execute on function public\.begin_factura_recibida_accounting_commit_v3[\s\S]*?to service_role/i,
  );
});
