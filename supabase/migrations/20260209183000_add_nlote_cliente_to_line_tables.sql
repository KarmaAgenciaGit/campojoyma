alter table if exists public.pedido_linea
  add column if not exists nlote_cliente text;

alter table if exists public.cambios_pedido_linea
  add column if not exists nlote_cliente text;

comment on column public.pedido_linea.nlote_cliente is
  'Numero de lote informado por cliente para la linea de pedido.';

comment on column public.cambios_pedido_linea.nlote_cliente is
  'Numero de lote informado por cliente para la linea del cambio.';
