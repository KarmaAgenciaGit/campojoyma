alter table public.cuentaventas
  add column if not exists total_cuentaventa numeric(14,2) not null default 0;

alter table public.cuentaventas
  drop constraint if exists cuentaventas_total_cuentaventa_check;

alter table public.cuentaventas
  add constraint cuentaventas_total_cuentaventa_check
  check (total_cuentaventa >= 0);

comment on column public.cuentaventas.total_cuentaventa is
  'Importe total de la cuenta de venta (valor monetario).';
