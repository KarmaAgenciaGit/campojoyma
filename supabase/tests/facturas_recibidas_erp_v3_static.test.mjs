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

const functionBody = (name) => {
  const marker = `create or replace function public.${name}(`;
  const start = migration.toLowerCase().indexOf(marker);
  assert.notEqual(start, -1, `No se encuentra ${name}`);
  const next = migration.toLowerCase().indexOf(
    "create or replace function public.",
    start + marker.length,
  );
  return migration.slice(start, next === -1 ? migration.length : next);
};

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
  const activation = functionBody("set_erp_target_write_mode_v3");
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

test("rotar epoch separa referencias reales de validaciones no enviadas", () => {
  const rotation = functionBody("rotate_erp_target_epoch_v3");
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
  const finalize = functionBody("finalize_factura_recibida_sync_v3");
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
  assert.match(finalize, /security definer[\s\S]*?set search_path = ''/i);
});

test("reconciliacion exacta puede cerrar commit unknown, pero no sin intento activo", () => {
  const finalize = functionBody("finalize_factura_recibida_sync_v3");
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

  const rotation = functionBody("rotate_erp_target_epoch_v3");
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
