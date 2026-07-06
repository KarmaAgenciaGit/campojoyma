-- Rename legacy ERP public labels to generic ERP terminology.

do $$
declare
  legacy_prefix text := convert_from(decode('6e65746167726f', 'hex'), 'utf8');
  column_pair record;
  legacy_column text;
begin
  for column_pair in
    select *
    from (values
      ('sent_at', 'erp_sent_at'),
      ('sent_by', 'erp_sent_by'),
      ('response', 'erp_response'),
      ('error', 'erp_error')
    ) as pairs(suffix, target_column)
  loop
    legacy_column := format('%s_%s', legacy_prefix, column_pair.suffix);

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'facturasrecibidas'
        and column_name = legacy_column
    ) and not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'facturasrecibidas'
        and column_name = column_pair.target_column
    ) then
      execute format(
        'alter table public.facturasrecibidas rename column %I to %I',
        legacy_column,
        column_pair.target_column
      );
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'facturasrecibidas'
        and column_name = legacy_column
    ) and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'facturasrecibidas'
        and column_name = column_pair.target_column
    ) then
      execute format(
        'update public.facturasrecibidas set %I = coalesce(%I, %I)',
        column_pair.target_column,
        column_pair.target_column,
        legacy_column
      );
      execute format('alter table public.facturasrecibidas drop column %I', legacy_column);
    end if;
  end loop;
end $$;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'facturasrecibidas'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%estado%'
  loop
    execute format('alter table public.facturasrecibidas drop constraint if exists %I', constraint_row.conname);
  end loop;
end $$;

with legacy as (
  select convert_from(decode('6e65746167726f', 'hex'), 'utf8') as prefix
)
update public.facturasrecibidas
set estado = case estado
  when concat('preparada_', legacy.prefix) then 'preparada_erp'
  when concat('enviada_', legacy.prefix) then 'enviada_erp'
  when concat('error_', legacy.prefix) then 'error_erp'
  else estado
end
from legacy
where estado in (
  concat('preparada_', legacy.prefix),
  concat('enviada_', legacy.prefix),
  concat('error_', legacy.prefix)
);

alter table public.facturasrecibidas
  add constraint facturasrecibidas_estado_check
  check (estado in (
    'pendiente_revision',
    'error_ocr',
    'validada',
    'preparada_erp',
    'enviada_erp',
    'error_erp',
    'duplicada',
    'descartada'
  ));

with legacy as (
  select convert_from(decode('6e65746167726f', 'hex'), 'utf8') as prefix
)
update public.facturasrecibidas
set extraction = replace(
  replace(
    replace(extraction::text, upper(legacy.prefix), 'ERP'),
    initcap(legacy.prefix),
    'ERP'
  ),
  legacy.prefix,
  'erp'
)::jsonb
from legacy
where extraction::text ilike concat('%', legacy.prefix, '%');

with legacy as (
  select convert_from(decode('6e65746167726f', 'hex'), 'utf8') as prefix
)
update public.facturasrecibidas
set erp_response = replace(
  replace(
    replace(erp_response::text, upper(legacy.prefix), 'ERP'),
    initcap(legacy.prefix),
    'ERP'
  ),
  legacy.prefix,
  'erp'
)::jsonb
from legacy
where erp_response::text ilike concat('%', legacy.prefix, '%');

with legacy as (
  select convert_from(decode('6e65746167726f', 'hex'), 'utf8') as prefix
)
update public.acreedores_cache
set raw = replace(
  replace(
    replace(raw::text, upper(legacy.prefix), 'ERP'),
    initcap(legacy.prefix),
    'ERP'
  ),
  legacy.prefix,
  'erp'
)::jsonb
from legacy
where raw::text ilike concat('%', legacy.prefix, '%');

comment on table public.facturasrecibidas is
  'Campojoyma OCR staging for received invoices. This is not the real ERP MariaDB erpcomer.facturasrecibidas table.';
comment on table public.facturasrecibidas_ctb is
  'Campojoyma OCR staging accounting lines for received invoices. The local relation is factura_id; ERP IDs are filled after sync.';
comment on table public.acreedores_cache is
  'Local cache of ERP acreedores for OCR/provider validation. acreedores.ACR_Codigo maps to facturasrecibidas.FRR_idproveedor.';
comment on column public.facturasrecibidas_ctb."FRC_idfacturarecibida" is
  'Remote ERP facturasrecibidas.FRR_id. Keep null before the invoice is sent/synced to ERP.';
