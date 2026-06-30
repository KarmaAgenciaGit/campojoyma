alter table public.cambios_pedidos
  add column if not exists revisado boolean not null default false;
