#!/usr/bin/env bash
set -euo pipefail

readonly RELEASE_LINK=/home/karma/releases/api-campojoyma-current
readonly EXPECTED_RELEASE=/home/karma/releases/api-campojoyma-v0.3.15-20260806T101234Z-material-writer-1d29536

actual_release="$(readlink -f "$RELEASE_LINK")"
test "$actual_release" = "$EXPECTED_RELEASE"
printf 'release=%s\n' "$actual_release"
printf 'api_service=%s\n' "$(systemctl --user is-active netagro-api-v2.service)"
printf 'test_mariadb_service=%s\n' "$(systemctl --user is-active netagro-test-write-mariadb.service)"

cd "$RELEASE_LINK"
staging/v0.2.0/.venv/bin/python \
  ops/netagro/provision_material_writer_incremental.py
