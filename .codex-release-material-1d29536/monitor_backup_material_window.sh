#!/usr/bin/env bash
set -euo pipefail
tail -n 40 /home/karma/material-window-backup-1d29536-retry3.log
if pgrep -af '^bash /home/karma/backup_material_window\.sh$'; then
  echo 'BACKUP_PROCESS_RUNNING=true'
else
  echo 'BACKUP_PROCESS_RUNNING=false'
fi
find /home/karma/backups/netagro-test-write \
  -maxdepth 1 -type d -name '*-pre-material-window-1d29536' \
  -printf 'BACKUP_PATH=%p\n'
find /home/karma/backups/netagro-test-write \
  -maxdepth 2 -type f -path '*-pre-material-window-1d29536/netagro-test-write-data-config.tar.zst' \
  -printf 'ARCHIVE_BYTES_NOW=%s\n'
printf 'api_service=%s\n' "$(systemctl --user is-active netagro-api-v2.service || true)"
printf 'test_mariadb_service=%s\n' "$(systemctl --user is-active netagro-test-write-mariadb.service || true)"
