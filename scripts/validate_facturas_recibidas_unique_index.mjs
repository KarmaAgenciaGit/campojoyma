import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const migrationSuffix = '_scope_facturas_recibidas_unique_by_circuit.sql';
const migrationFiles = fs
  .readdirSync(migrationsDir)
  .filter((fileName) => fileName.endsWith(migrationSuffix));

assert.equal(
  migrationFiles.length,
  1,
  `Se esperaba una sola migración ${migrationSuffix}; encontradas: ${migrationFiles.join(', ') || 'ninguna'}`,
);

const migrationPath = path.join(migrationsDir, migrationFiles[0]);
const sql = fs.readFileSync(migrationPath, 'utf8');
const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase();

const createNewIndex = normalizedSql.indexOf(
  'create unique index if not exists idx_facturasrecibidas_supplier_invoice_circuit_unique',
);
const dropOldIndex = normalizedSql.indexOf(
  'drop index if exists public.idx_facturasrecibidas_supplier_invoice_unique',
);

assert.ok(createNewIndex >= 0, 'Falta crear el índice único nuevo por circuito.');
assert.ok(dropOldIndex >= 0, 'Falta retirar el índice histórico sin circuito.');
assert.ok(
  createNewIndex < dropOldIndex,
  'El índice nuevo debe crearse antes de eliminar el índice histórico.',
);

const newIndexSql = normalizedSql.slice(createNewIndex, dropOldIndex);
for (const key of [
  '"frr_idempresa"',
  '"frr_ejercicio"',
  '"frr_idproveedor"',
  'nullif(btrim("frr_numerofactura"), \'\')',
]) {
  assert.ok(newIndexSql.includes(key), `La clave única no incluye ${key}.`);
}

assert.match(
  sql,
  /when\s+upper\(nullif\(btrim\("FRR_tipofactura"\),\s*''\)\)\s*=\s*'GE'\s+then\s+'agricultor'/s,
  'GE debe normalizarse al circuito agricultor.',
);
assert.match(
  sql,
  /when\s+nullif\(btrim\("FRR_tipofactura"\),\s*''\)\s+is\s+not\s+null\s+then\s+'acreedor'/s,
  'Todo tipo no vacío distinto de GE debe normalizarse al circuito acreedor.',
);
assert.match(
  sql,
  /else\s+'desconocido'/s,
  'El tipo vacío o nulo debe conservar un circuito desconocido separado.',
);

for (const predicate of [
  '"frr_idempresa" is not null',
  '"frr_ejercicio" is not null',
  '"frr_idproveedor" is not null',
  'nullif(btrim("frr_numerofactura"), \'\') is not null',
  "estado not in ('duplicada', 'descartada')",
]) {
  assert.ok(newIndexSql.includes(predicate), `Falta el predicado parcial: ${predicate}.`);
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    migration: path.relative(repoRoot, migrationPath).replaceAll('\\', '/'),
    circuitos: {
      GE: 'agricultor',
      no_GE_no_vacio: 'acreedor',
      nulo_o_vacio: 'desconocido',
    },
    orden_seguro: 'crear_nuevo_antes_de_eliminar_antiguo',
  }, null, 2)}\n`,
);
