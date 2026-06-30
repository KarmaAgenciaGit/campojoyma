-- Mover EAN a líneas de pedido
alter table public.pedido_linea
  add column if not exists ean text;

-- Limpiar EAN en cabecera si existe de migraciones previas
alter table public.pedidos
  drop column if exists ean;

comment on column public.pedido_linea.ean is 'EAN específico de la línea de pedido';
