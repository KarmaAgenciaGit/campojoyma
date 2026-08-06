#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly RELEASE_LINK=/home/karma/releases/api-campojoyma-current
readonly EXPECTED_RELEASE=/home/karma/releases/api-campojoyma-v0.3.15-20260806T101234Z-material-writer-1d29536
readonly RUNTIME_ENV=/home/karma/.config/netagro-api-v2/runtime.env
readonly LOCK=/home/karma/.config/netagro-api-v2/maintenance.lock
readonly API_SERVICE=netagro-api-v2.service
readonly PYTHON="$RELEASE_LINK/staging/v0.2.0/.venv/bin/python"

[[ "$(id -un)" == karma ]]
[[ "$(readlink -f "$RELEASE_LINK")" == "$EXPECTED_RELEASE" ]]
[[ "$(stat -c '%a:%U:%G' "$RUNTIME_ENV")" == '600:karma:karma' ]]

exec 9>>"$LOCK"
flock -n 9 || {
  echo 'ERROR: another Netagro maintenance operation is active' >&2
  exit 1
}
cd "$RELEASE_LINK"

patch_result="$($PYTHON - <<'PY'
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
    'DB_MATERIAL_WRITE_USER': 'netagro_material_writer',
}
for key, value in expected.items():
    if before.get(key, '').rstrip('/').casefold() != value.rstrip('/').casefold():
        raise SystemExit(f'rollback runtime mismatch: {key}')
gate = before.get('ALBMATERIAL_CREATE_ENABLED', '').casefold()
if gate == 'false':
    print('already_false')
    raise SystemExit(0)
if gate != 'true':
    raise SystemExit('rollback refused an unexpected material gate value')
_atomic_patch_env(path, {'ALBMATERIAL_CREATE_ENABLED': 'false'})
_, after = _load_env_document(path)
before_without_gate = {
    key: value for key, value in before.items() if key != 'ALBMATERIAL_CREATE_ENABLED'
}
after_without_gate = {
    key: value for key, value in after.items() if key != 'ALBMATERIAL_CREATE_ENABLED'
}
if before_without_gate != after_without_gate:
    raise SystemExit('rollback changed runtime keys other than the material gate')
if after.get('ALBMATERIAL_CREATE_ENABLED', '').casefold() != 'false':
    raise SystemExit('rollback did not close the material gate')
print('patched_false')
PY
)"

if [[ "$patch_result" == already_false ]]; then
  echo 'ROLLBACK_GATE_ALREADY_FALSE=true'
  exit 0
fi
[[ "$patch_result" == patched_false ]]

systemctl --user restart "$API_SERVICE"
for _ in {1..30}; do
  if systemctl --user is-active --quiet "$API_SERVICE" \
    && curl -fsS http://127.0.0.1:8001/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
systemctl --user is-active --quiet "$API_SERVICE"

"$PYTHON" - <<'PY'
import json
import urllib.request

with urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=5) as response:
    health = json.load(response)
if health.get('status') != 'ok':
    raise SystemExit('rollback health is not ok')
if health.get('albmaterial_create_enabled') is not False:
    raise SystemExit('rollback health still exposes material create')
if health.get('writes_enabled') is not True:
    raise SystemExit('rollback changed management writes')
if health.get('accounting_writes_enabled') is not True:
    raise SystemExit('rollback changed accounting writes')
print('ROLLBACK_VERIFIED=true')
PY
