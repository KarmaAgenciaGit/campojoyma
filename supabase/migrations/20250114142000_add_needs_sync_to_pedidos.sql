alter table public.pedidos
  add column if not exists needs_sync boolean not null default false;
