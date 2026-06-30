alter table public.cambios_pedidos
  add column if not exists revisado_por uuid,
  add column if not exists revisado_en timestamptz;
