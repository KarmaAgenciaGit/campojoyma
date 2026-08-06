#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly RELEASE_LINK=/home/karma/releases/api-campojoyma-current
readonly EXPECTED_RELEASE=/home/karma/releases/api-campojoyma-v0.3.15-20260806T101234Z-material-writer-1d29536
readonly INSTANCE_ROOT=/home/karma/.local/share/netagro-test-write
readonly EXPECTED_DATADIR=/home/karma/.local/share/netagro-test-write/data
readonly RUNTIME_ENV=/home/karma/.config/netagro-api-v2/runtime.env
readonly IDEMPOTENCY_DB=/home/karma/.local/state/netagro-api/idempotency/a67774b7-d9bf-4a8a-8a93-95b3e08a5f7c.sqlite3
readonly SERVICE_UNIT=/home/karma/.config/systemd/user/netagro-test-write-mariadb.service
readonly LOCK=/home/karma/.config/netagro-api-v2/maintenance.lock
readonly API_SERVICE=netagro-api-v2.service
readonly DB_SERVICE=netagro-test-write-mariadb.service
readonly CREATED_AT="$(date -u +%Y%m%dT%H%M%SZ)"
readonly BACKUP_DIR="/home/karma/backups/netagro-test-write/${CREATED_AT}-pre-material-window-1d29536"
readonly ARCHIVE="$BACKUP_DIR/netagro-test-write-data-config.tar.zst"
readonly PYTHON="$RELEASE_LINK/staging/v0.2.0/.venv/bin/python"

if [[ "$(id -un)" != karma ]]; then
  echo 'ERROR: run as karma' >&2
  exit 1
fi
if [[ "$(readlink -f "$RELEASE_LINK")" != "$EXPECTED_RELEASE" ]]; then
  echo 'ERROR: active release is not the approved immutable release' >&2
  exit 1
fi
for private_file in \
  "$RUNTIME_ENV" \
  "$INSTANCE_ROOT/config/root-client.cnf" \
  "$INSTANCE_ROOT/config/target-secrets.env" \
  "$INSTANCE_ROOT/config/material-writer-client.cnf"
do
  [[ "$(stat -c '%a:%U:%G' "$private_file")" == '600:karma:karma' ]]
done
[[ -f "$IDEMPOTENCY_DB" ]]
[[ -f "$SERVICE_UNIT" ]]
[[ ! -e "$BACKUP_DIR" ]]
systemctl --user is-active --quiet "$API_SERVICE"
systemctl --user is-active --quiet "$DB_SERVICE"

exec 9>>"$LOCK"
flock -n 9 || {
  echo 'ERROR: another Netagro maintenance operation is active' >&2
  exit 1
}

cd "$RELEASE_LINK"

"$PYTHON" - <<'PY'
import hashlib
import json
from pathlib import Path

from ops.netagro.provision_material_writer_incremental import _load_env_document

runtime_path = Path('/home/karma/.config/netagro-api-v2/runtime.env')
_, env = _load_env_document(runtime_path)
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
mismatches = {
    key: {'expected': value, 'actual': env.get(key)}
    for key, value in expected.items()
    if env.get(key, '').rstrip('/').casefold() != value.rstrip('/').casefold()
}
if mismatches:
    raise SystemExit('runtime identity/gate mismatch: ' + json.dumps(mismatches, sort_keys=True))
if not env.get('DB_MATERIAL_WRITE_PASSWORD'):
    raise SystemExit('material writer password is absent')
if not env.get('NETAGRO_API_SHARED_SECRET'):
    raise SystemExit('API shared secret is absent')
safe = {
    'environment': env['NETAGRO_ENVIRONMENT'],
    'target_id': env['NETAGRO_TARGET_ID'],
    'dataset_epoch': env['NETAGRO_DATASET_EPOCH'],
    'host': env['DB_WRITE_HOST'],
    'port': int(env['DB_WRITE_PORT']),
    'schema': env['DB_WRITE_DEFAULT_SCHEMA'],
    'datadir': env['DB_WRITE_EXPECTED_DATADIR'].rstrip('/') + '/',
    'db_writes_enabled': True,
    'accounting_writes_enabled': True,
    'albmaterial_create_enabled': False,
    'material_user': env['DB_MATERIAL_WRITE_USER'],
    'runtime_sha256': hashlib.sha256(runtime_path.read_bytes()).hexdigest(),
}
print('RUNTIME_PREFLIGHT=' + json.dumps(safe, sort_keys=True))
PY

"$PYTHON" - <<'PY'
import shutil
from pathlib import Path

from ops.netagro.provision_material_writer_incremental import (
    _account_hosts,
    _assert_exact_grants,
    _grant_sql,
    _show_grants_for,
    _target_metadata,
)

binary = shutil.which('mariadb') or shutil.which('mysql')
if not binary:
    raise SystemExit('MariaDB client is unavailable')
instance = Path('/home/karma/.local/share/netagro-test-write')
root_client = instance / 'config/root-client.cnf'
_target_metadata(binary, root_client, instance / 'data')
hosts = _account_hosts(binary, root_client)
if hosts != ('127.0.0.1',):
    raise SystemExit(f'unexpected material writer hosts: {hosts!r}')
grants = _show_grants_for(binary, root_client)
_assert_exact_grants(grants)
_grant_sql(binary, root_client)
print('DATABASE_PREFLIGHT=host-local,port-3307,datadir-exact,schema-present,material-grants-exact')
PY

"$PYTHON" - <<'PY'
import os
import sys
from pathlib import Path

from ops.netagro.provision_material_writer_incremental import _load_env_document

release = Path('/home/karma/releases/api-campojoyma-current')
environment = os.environ.copy()
for path in (
    Path('/home/karma/.config/netagro-api-v2/runtime.env'),
    Path('/home/karma/.local/share/netagro-test-write/config/target-secrets.env'),
):
    environment.update(_load_env_document(path)[1])
checker = release / 'staging/v0.2.0/scripts/check_mariadb_grants.py'
os.execve(sys.executable, [sys.executable, str(checker)], environment)
PY

mkdir -m 700 "$BACKUP_DIR"
source_bytes="$(du -sb "$INSTANCE_ROOT/data" "$INSTANCE_ROOT/config" | awk '{total += $1} END {print total}')"
available_bytes="$(df -B1 --output=avail "$BACKUP_DIR" | tail -n 1 | tr -d ' ')"
if (( available_bytes < source_bytes + 1073741824 )); then
  echo 'ERROR: insufficient free space for a worst-case physical archive' >&2
  exit 1
fi
printf 'BACKUP_DIR=%s\n' "$BACKUP_DIR"
printf 'SOURCE_BYTES=%s\n' "$source_bytes"
printf 'AVAILABLE_BYTES=%s\n' "$available_bytes"

api_stopped=0
db_stopped=0
recover_services() {
  local rc=$?
  trap - EXIT INT TERM HUP
  if (( db_stopped )); then
    systemctl --user start "$DB_SERVICE" || rc=1
  fi
  if (( api_stopped )); then
    systemctl --user start "$API_SERVICE" || rc=1
  fi
  exit "$rc"
}
trap recover_services EXIT INT TERM HUP

api_stopped=1
systemctl --user stop "$API_SERVICE"
if systemctl --user is-active --quiet "$API_SERVICE"; then
  echo 'ERROR: API remained active' >&2
  exit 1
fi
printf 'API_STOPPED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

"$PYTHON" - "$IDEMPOTENCY_DB" <<'PY'
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
    'staging/v0.2.0/scripts/check_idempotency_store_quiescent.py'
)
os.execve(sys.executable, [sys.executable, str(checker), sys.argv[1]], environment)
PY

"$PYTHON" - "$IDEMPOTENCY_DB" <<'PY'
import sqlite3
import sys
from pathlib import Path

path = Path(sys.argv[1]).resolve()
connection = sqlite3.connect(f'{path.as_uri()}?mode=ro', uri=True)
try:
    result = connection.execute('PRAGMA quick_check').fetchone()[0]
finally:
    connection.close()
if result != 'ok':
    raise SystemExit(f'idempotency quick_check failed: {result}')
print('IDEMPOTENCY_SOURCE_QUICK_CHECK=ok')
PY

db_stopped=1
systemctl --user stop "$DB_SERVICE"
if systemctl --user is-active --quiet "$DB_SERVICE"; then
  echo 'ERROR: isolated TEST MariaDB remained active' >&2
  exit 1
fi
if ss -ltn | grep -Eq '127\.0\.0\.1:3307([[:space:]]|$)'; then
  echo 'ERROR: isolated TEST port 3307 remained open' >&2
  exit 1
fi
printf 'TEST_MARIADB_STOPPED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

tar -C "$INSTANCE_ROOT" -cf - data config \
  | zstd -T0 -10 --no-progress >"$ARCHIVE"
"$PYTHON" - "$IDEMPOTENCY_DB" "$BACKUP_DIR/idempotency.sqlite3" <<'PY'
import os
import sqlite3
import sys
from pathlib import Path

source_path = Path(sys.argv[1]).resolve()
backup_path = Path(sys.argv[2]).resolve()
if backup_path.exists():
    raise SystemExit('idempotency backup destination already exists')
source = sqlite3.connect(f'{source_path.as_uri()}?mode=ro', uri=True)
destination = sqlite3.connect(backup_path)
try:
    source.backup(destination)
finally:
    destination.close()
    source.close()
os.chmod(backup_path, 0o600)
print('IDEMPOTENCY_SQLITE_BACKUP=complete')
PY
install -m 600 "$RUNTIME_ENV" "$BACKUP_DIR/runtime.env"
install -m 600 "$SERVICE_UNIT" "$BACKUP_DIR/netagro-test-write-mariadb.service"

runtime_sha256="$(sha256sum "$RUNTIME_ENV" | awk '{print $1}')"
{
  printf 'created_at_utc=%s\n' "$CREATED_AT"
  printf 'release=%s\n' "$EXPECTED_RELEASE"
  printf 'commit=%s\n' '1d29536e88e5ba68971bc37f45a6a68e62317c59'
  printf 'environment=%s\n' 'test'
  printf 'target_id=%s\n' 'netagro-test-write'
  printf 'dataset_epoch=%s\n' 'a67774b7-d9bf-4a8a-8a93-95b3e08a5f7c'
  printf 'db_host=%s\n' '127.0.0.1'
  printf 'db_port=%s\n' '3307'
  printf 'db_schema=%s\n' 'netagrocomer_test_write'
  printf 'db_datadir=%s\n' '/home/karma/.local/share/netagro-test-write/data/'
  printf 'runtime_sha256=%s\n' "$runtime_sha256"
  printf 'runtime_material_gate=%s\n' 'false'
  printf 'capture_method=%s\n' 'API stopped; idempotency quiescent; isolated TEST MariaDB stopped; physical data+config tar'
} >"$BACKUP_DIR/BACKUP_METADATA.txt"
chmod 600 "$BACKUP_DIR/BACKUP_METADATA.txt"
sync "$BACKUP_DIR"

systemctl --user start "$DB_SERVICE"
for _ in {1..30}; do
  if systemctl --user is-active --quiet "$DB_SERVICE"; then
    db_stopped=0
    break
  fi
  sleep 1
done
if (( db_stopped )); then
  echo 'ERROR: isolated TEST MariaDB did not recover' >&2
  exit 1
fi

systemctl --user start "$API_SERVICE"
for _ in {1..30}; do
  if systemctl --user is-active --quiet "$API_SERVICE"; then
    api_stopped=0
    break
  fi
  sleep 1
done
if (( api_stopped )); then
  echo 'ERROR: API did not recover' >&2
  exit 1
fi
printf 'SERVICES_RECOVERED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

zstd -t "$ARCHIVE"
tar --use-compress-program=unzstd -tf "$ARCHIVE" \
  >"$BACKUP_DIR/ARCHIVE_CONTENTS.txt"
chmod 600 "$BACKUP_DIR/ARCHIVE_CONTENTS.txt"
grep -Fxq 'data/ibdata1' "$BACKUP_DIR/ARCHIVE_CONTENTS.txt"
grep -Eq '^data/netagrocomer_test_write/' "$BACKUP_DIR/ARCHIVE_CONTENTS.txt"
grep -Fxq 'config/root-client.cnf' "$BACKUP_DIR/ARCHIVE_CONTENTS.txt"
grep -Fxq 'config/target-secrets.env' "$BACKUP_DIR/ARCHIVE_CONTENTS.txt"
grep -Fxq 'config/material-writer-client.cnf' "$BACKUP_DIR/ARCHIVE_CONTENTS.txt"

"$PYTHON" - "$BACKUP_DIR/idempotency.sqlite3" <<'PY'
import sqlite3
import sys
from pathlib import Path

path = Path(sys.argv[1]).resolve()
connection = sqlite3.connect(f'{path.as_uri()}?mode=ro&immutable=1', uri=True)
try:
    result = connection.execute('PRAGMA quick_check').fetchone()[0]
finally:
    connection.close()
if result != 'ok':
    raise SystemExit(f'backup idempotency quick_check failed: {result}')
print('IDEMPOTENCY_BACKUP_QUICK_CHECK=ok')
PY

(
  cd "$BACKUP_DIR"
  sha256sum \
    netagro-test-write-data-config.tar.zst \
    idempotency.sqlite3 \
    runtime.env \
    netagro-test-write-mariadb.service \
    BACKUP_METADATA.txt \
    ARCHIVE_CONTENTS.txt \
    >SHA256SUMS
  chmod 600 SHA256SUMS
  sha256sum -c SHA256SUMS
)

printf 'ARCHIVE_BYTES=%s\n' "$(stat -c %s "$ARCHIVE")"
printf 'ARCHIVE_SHA256=%s\n' "$(sha256sum "$ARCHIVE" | awk '{print $1}')"
printf 'MANIFEST_SHA256=%s\n' "$(sha256sum "$BACKUP_DIR/SHA256SUMS" | awk '{print $1}')"
printf 'BACKUP_VALIDATED=true\n'

trap - EXIT INT TERM HUP
