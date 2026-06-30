alter table public.pedidos
  add column if not exists enviado_por uuid,
  add column if not exists enviado_en timestamptz;
