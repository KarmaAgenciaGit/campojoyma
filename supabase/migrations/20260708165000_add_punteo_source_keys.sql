-- Store the stable source keys required by the intermediate API to link ERP
-- "Albaranes/Gtos para puntear" back on invoice creation.

alter table public.facturasrecibidas_punteos
  add column if not exists source_table text;

alter table public.facturasrecibidas_punteos
  add column if not exists source_id bigint;

alter table public.facturasrecibidas_punteos
  add column if not exists importe_factura numeric(12,2);

create index if not exists idx_facturasrecibidas_punteos_source
  on public.facturasrecibidas_punteos (source_table, source_id)
  where source_table is not null and source_id is not null;

comment on column public.facturasrecibidas_punteos.source_table is
  'ERP source table for the punteo link, for example albsalida_gastos.';
comment on column public.facturasrecibidas_punteos.source_id is
  'ERP source row id used together with source_table to link a punteo.';
comment on column public.facturasrecibidas_punteos.importe_factura is
  'Amount to apply/link from this punteo in the ERP invoice create API.';
