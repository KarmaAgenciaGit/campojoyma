-- DESTRUCTIVE CHECKPOINT: do not apply remotely without explicit user approval.
-- This migration deliberately sorts after every non-destructive invoice fix so
-- a normal migration runner can stop here without withholding those fixes.
-- A recoverable five-row export is stored in:
-- docs/evidencias/facturas-recibidas/acreedores-cache-backup-2026-07-22.json
-- CASCADE is intentionally omitted so any unexpected external dependency fails closed.

drop table if exists public.acreedores_cache;
