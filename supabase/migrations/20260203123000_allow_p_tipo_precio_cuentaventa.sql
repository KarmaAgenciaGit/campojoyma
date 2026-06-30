alter table public.cuentaventa_detalle_valor
  drop constraint if exists cuentaventa_detalle_valor_tipo_precio_check;

alter table public.cuentaventa_detalle_valor
  add constraint cuentaventa_detalle_valor_tipo_precio_check
  check (tipo_precio in ('K', 'B', 'P', 'U'));
