#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly RELEASE_LINK=/home/karma/releases/api-campojoyma-current
readonly EXPECTED_RELEASE=/home/karma/releases/api-campojoyma-v0.3.15-20260806T101234Z-material-writer-1d29536
readonly RUNTIME_ENV=/home/karma/.config/netagro-api-v2/runtime.env
readonly EXPECTED_RUNTIME_SHA256=ac2bcda3d513ee4e50e408d39c57ea81d8e32553b98fc880d95b2cde45bf01cb
readonly BACKUP_DIR=/home/karma/backups/netagro-test-write/20260806T103108Z-pre-material-window-1d29536
readonly EXPECTED_MANIFEST_SHA256=e2d986b3c8974010234afba6c9958b10d4058b45cfa497ba3bd540b2f909c31b
readonly ROLLBACK=/home/karma/.local/state/netagro-api/material-window-rollback-20260806T103108Z.sh
readonly LOCK=/home/karma/.config/netagro-api-v2/maintenance.lock
readonly API_SERVICE=netagro-api-v2.service
readonly DB_SERVICE=netagro-test-write-mariadb.service
readonly PYTHON="$RELEASE_LINK/staging/v0.2.0/.venv/bin/python"

[[ "$(id -un)" == karma ]]
[[ "$(readlink -f "$RELEASE_LINK")" == "$EXPECTED_RELEASE" ]]
[[ "$(stat -c '%a:%U:%G' "$RUNTIME_ENV")" == '600:karma:karma' ]]
[[ "$(sha256sum "$RUNTIME_ENV" | awk '{print $1}')" == "$EXPECTED_RUNTIME_SHA256" ]]
[[ "$(sha256sum "$BACKUP_DIR/SHA256SUMS" | awk '{print $1}')" == "$EXPECTED_MANIFEST_SHA256" ]]
[[ "$(stat -c '%a:%U:%G' "$ROLLBACK")" == '700:karma:karma' ]]
systemctl --user is-active --quiet "$API_SERVICE"
systemctl --user is-active --quiet "$DB_SERVICE"

exec 9>>"$LOCK"
flock -n 9 || {
  echo 'ERROR: another Netagro maintenance operation is active' >&2
  exit 1
}
cd "$RELEASE_LINK"

test_db_pid="$(systemctl --user show -p MainPID --value "$DB_SERVICE")"
api_pid_before="$(systemctl --user show -p MainPID --value "$API_SERVICE")"
gate_may_be_changed=0

rollback_on_error() {
  local rc=$?
  trap - EXIT INT TERM HUP
  if (( gate_may_be_changed )); then
    "$PYTHON" - <<'PY' || true
from pathlib import Path
from ops.netagro.provision_material_writer_incremental import _atomic_patch_env
_atomic_patch_env(
    Path('/home/karma/.config/netagro-api-v2/runtime.env'),
    {'ALBMATERIAL_CREATE_ENABLED': 'false'},
)
PY
    systemctl --user restart "$API_SERVICE" || true
  fi
  exit "$rc"
}
trap rollback_on_error EXIT INT TERM HUP

gate_may_be_changed=1
"$PYTHON" - <<'PY'
import hashlib
import json
from pathlib import Path

from ops.netagro.provision_material_writer_incremental import (
    _atomic_patch_env,
    _load_env_document,
)

path = Path('/home/karma/.config/netagro-api-v2/runtime.env')
_, before = _load_env_document(path)
expected = {
    'NETAGRO_ENVIRONMENT': 'test',
    'NETAGRO_TARGET_ID': 'netagro-test-write',
    'NETAGRO_DATASET_EPOCH': 'a67774b7-d9bf-4a8a-8a93-95b3e08a5f7c',
    'DB_WRITE_HOST': '127.0.0.1',
    'DB_WRITE_PORT': '3307',
    'DB_WRITE_DEFAULT_SCHEMA': 'netagrocomer_test_write',
    'DB_WRITE_ALLOWED_SCHEMAS': 'netagrocomer_test_write',
    'DB_WRITE_EXPECTED_DATADIR': '/home/karma/.local/share/netagro-test-write/data',
    'DB_WRITES_ENABLED': 'true',
    'ACCOUNTING_WRITES_ENABLED': 'true',
    'ALBMATERIAL_CREATE_ENABLED': 'false',
    'DB_MATERIAL_WRITE_USER': 'netagro_material_writer',
}
for key, value in expected.items():
    if before.get(key, '').rstrip('/').casefold() != value.rstrip('/').casefold():
        raise SystemExit(f'activation runtime mismatch: {key}')
_atomic_patch_env(path, {'ALBMATERIAL_CREATE_ENABLED': 'true'})
_, after = _load_env_document(path)
before_without_gate = {
    key: value for key, value in before.items() if key != 'ALBMATERIAL_CREATE_ENABLED'
}
after_without_gate = {
    key: value for key, value in after.items() if key != 'ALBMATERIAL_CREATE_ENABLED'
}
if before_without_gate != after_without_gate:
    raise SystemExit('activation changed runtime keys other than the material gate')
if after.get('ALBMATERIAL_CREATE_ENABLED', '').casefold() != 'true':
    raise SystemExit('activation did not open the material gate')
print('RUNTIME_PATCH=' + json.dumps({
    'only_changed': 'ALBMATERIAL_CREATE_ENABLED',
    'before': False,
    'after': True,
    'db_writes_enabled': after['DB_WRITES_ENABLED'],
    'accounting_writes_enabled': after['ACCOUNTING_WRITES_ENABLED'],
    'environment': after['NETAGRO_ENVIRONMENT'],
    'target_id': after['NETAGRO_TARGET_ID'],
    'host': after['DB_WRITE_HOST'],
    'port': int(after['DB_WRITE_PORT']),
    'schema': after['DB_WRITE_DEFAULT_SCHEMA'],
    'datadir': after['DB_WRITE_EXPECTED_DATADIR'].rstrip('/') + '/',
    'runtime_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
}, sort_keys=True))
PY

systemctl --user restart "$API_SERVICE"
for _ in {1..30}; do
  if systemctl --user is-active --quiet "$API_SERVICE" \
    && curl -fsS http://127.0.0.1:8001/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
systemctl --user is-active --quiet "$API_SERVICE"
systemctl --user is-active --quiet "$DB_SERVICE"
[[ "$(systemctl --user show -p MainPID --value "$DB_SERVICE")" == "$test_db_pid" ]]
api_pid_after="$(systemctl --user show -p MainPID --value "$API_SERVICE")"
[[ "$api_pid_after" != 0 ]]
[[ "$api_pid_after" != "$api_pid_before" ]]

"$PYTHON" - <<'PY'
import os
import sys
from pathlib import Path

from ops.netagro.provision_material_writer_incremental import _load_env_document

environment = os.environ.copy()
environment.update(
    _load_env_document(Path('/home/karma/.config/netagro-api-v2/runtime.env'))[1]
)
checker = Path(
    '/home/karma/releases/api-campojoyma-current/'
    'staging/v0.2.0/scripts/check_mariadb_grants.py'
)
os.execve(sys.executable, [sys.executable, str(checker)], environment)
PY

"$PYTHON" - <<'PY'
import hashlib
import json
import urllib.request
from pathlib import Path

from ops.netagro.provision_material_writer_incremental import _load_env_document

_, env = _load_env_document(Path('/home/karma/.config/netagro-api-v2/runtime.env'))
base = 'http://127.0.0.1:8001'

def get_json(path, *, authenticated=False):
    headers = {'Accept': 'application/json'}
    if authenticated:
        headers['X-Netagro-Api-Key'] = env['NETAGRO_API_SHARED_SECRET']
    request = urllib.request.Request(base + path, headers=headers, method='GET')
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)

root = get_json('/')
health = get_json('/health')
meta = get_json('/meta/runtime', authenticated=True)
request = urllib.request.Request(base + '/openapi.json', method='GET')
with urllib.request.urlopen(request, timeout=10) as response:
    openapi_raw = response.read()
openapi = json.loads(openapi_raw)
openapi_sha256 = hashlib.sha256(openapi_raw).hexdigest()

if root.get('service') != 'netagro-test-api' or root.get('version') != '0.3.15':
    raise SystemExit('unexpected API identity/version')
for field in ('accounting_writes_enabled', 'albmaterial_writes_enabled', 'albmaterial_create_enabled'):
    if root.get(field) is not True:
        raise SystemExit(f'root does not expose {field}=true')
if health.get('status') != 'ok' or health.get('database', {}).get('db_host') != 'karma-box':
    raise SystemExit('health/database identity is not healthy')
for field in ('writes_enabled', 'accounting_writes_enabled', 'albmaterial_create_enabled'):
    if health.get(field) is not True:
        raise SystemExit(f'health does not expose {field}=true')
if health.get('idempotency_store', {}).get('ready') is not True:
    raise SystemExit('idempotency store is not ready')
if health.get('idempotency_store', {}).get('schema_version') != 2:
    raise SystemExit('unexpected idempotency schema version')
expected_meta = {
    'service': 'netagro-test-api',
    'version': '0.3.15',
    'target_id': 'netagro-test-write',
    'dataset_epoch': 'a67774b7-d9bf-4a8a-8a93-95b3e08a5f7c',
    'write_schema': 'netagrocomer_test_write',
    'accounting_mode': 'sql_test',
    'material_write_mode': 'material',
}
for key, value in expected_meta.items():
    if meta.get(key) != value:
        raise SystemExit(f'meta/runtime mismatch: {key}')
if meta.get('material_ready_for_commit') is not True:
    raise SystemExit('meta/runtime material_ready_for_commit is not true')
if meta.get('capabilities', {}).get('material_commit') is not True:
    raise SystemExit('meta/runtime capabilities.material_commit is not true')
if meta.get('material_missing_configuration') != []:
    raise SystemExit('meta/runtime material configuration is incomplete')
if openapi.get('info', {}).get('version') != '0.3.15':
    raise SystemExit('OpenAPI version is not 0.3.15')
if openapi_sha256 != 'df03436f76c08d36696fa865c658b406226d9247c211eda00f401fbb4949bd01':
    raise SystemExit('OpenAPI fingerprint changed')

safe = {
    'release': '/home/karma/releases/api-campojoyma-v0.3.15-20260806T101234Z-material-writer-1d29536',
    'commit': '1d29536e88e5ba68971bc37f45a6a68e62317c59',
    'version': root['version'],
    'health': health['status'],
    'database_host': health['database']['db_host'],
    'writes_enabled': health['writes_enabled'],
    'accounting_writes_enabled': health['accounting_writes_enabled'],
    'albmaterial_create_enabled': health['albmaterial_create_enabled'],
    'target_id': meta['target_id'],
    'dataset_epoch': meta['dataset_epoch'],
    'write_schema': meta['write_schema'],
    'material_write_mode': meta['material_write_mode'],
    'material_ready': meta['material_ready_for_commit'],
    'material_commit': meta['capabilities']['material_commit'],
    'idempotency_ready': meta['idempotency_store']['ready'],
    'idempotency_schema_version': meta['idempotency_store']['schema_version'],
    'openapi_version': openapi['info']['version'],
    'openapi_sha256': openapi_sha256,
}
print('ACTIVATION_VERIFIED=' + json.dumps(safe, sort_keys=True))
PY

printf 'API_PID_BEFORE=%s\n' "$api_pid_before"
printf 'API_PID_AFTER=%s\n' "$api_pid_after"
printf 'TEST_MARIADB_PID_UNCHANGED=%s\n' "$test_db_pid"
printf 'ROLLBACK=%s\n' "$ROLLBACK"
printf 'MATERIAL_WINDOW_OPEN=true\n'

gate_may_be_changed=0
trap - EXIT INT TERM HUP
