begin;

alter table public.facturasrecibidas_punteos
  drop constraint if exists facturasrecibidas_punteos_source_table_check;

alter table public.facturasrecibidas_punteos
  add constraint facturasrecibidas_punteos_source_table_check
  check (
    source_table is null
    or source_table = any (
      array[
        'albsalida_gastos'::text,
        'albentrada_hisgastos'::text,
        'albaranescompra_gastos'::text,
        'facturas_gastos'::text,
        'albarancoste'::text,
        'albmaterial'::text,
        'albentrada'::text,
        'albentrada_his'::text
      ]
    )
  );

alter table public.facturasrecibidas_punteos
  drop constraint if exists facturasrecibidas_punteos_albentrada_unselected_check;

alter table public.facturasrecibidas_punteos
  add constraint facturasrecibidas_punteos_albentrada_unselected_check
  check (
    source_table is distinct from 'albentrada'
    or "S" is false
  );

comment on constraint facturasrecibidas_punteos_albentrada_unselected_check
  on public.facturasrecibidas_punteos is
  'Los albaranes de entrada son referencias de lectura para revisar lineas; no son punteos seleccionables ni escribibles en Netagro.';

commit;
