#!/usr/bin/env bash
set -euo pipefail
umask 077
readonly LOG=/home/karma/material-window-backup-1d29536-retry3.log
[[ ! -e "$LOG" ]]
nohup /home/karma/backup_material_window.sh >"$LOG" 2>&1 </dev/null &
printf 'BACKUP_PID=%s\n' "$!"
printf 'BACKUP_LOG=%s\n' "$LOG"
