-- Defaults contables aprobados para facturas recibidas. Se mantienen en la
-- tabla de reglas para poder administrarlos por empresa o acreedor y evitar
-- decisiones fijas en el frontend.

alter table if exists public.facturas_recibidas_erp_rules
  add column if not exists cuenta_gasto_default text,
  add column if not exists concepto_template text,
  add column if not exists contabilizar_default varchar(1);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturas_recibidas_erp_rules_cuenta_gasto_default_check'
      and conrelid = 'public.facturas_recibidas_erp_rules'::regclass
  ) then
    alter table public.facturas_recibidas_erp_rules
      add constraint facturas_recibidas_erp_rules_cuenta_gasto_default_check
      check (
        cuenta_gasto_default is null
        or cuenta_gasto_default ~ '^[0-9]{11}$'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturas_recibidas_erp_rules_concepto_template_check'
      and conrelid = 'public.facturas_recibidas_erp_rules'::regclass
  ) then
    alter table public.facturas_recibidas_erp_rules
      add constraint facturas_recibidas_erp_rules_concepto_template_check
      check (
        concepto_template is null
        or (
          char_length(btrim(concepto_template)) between 1 and 50
          and position('{proveedor}' in concepto_template) > 0
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturas_recibidas_erp_rules_contabilizar_default_check'
      and conrelid = 'public.facturas_recibidas_erp_rules'::regclass
  ) then
    alter table public.facturas_recibidas_erp_rules
      add constraint facturas_recibidas_erp_rules_contabilizar_default_check
      check (
        contabilizar_default is null
        or contabilizar_default in ('S', 'N')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname =
      'facturas_recibidas_erp_rules_default_approval_note_check'
      and conrelid = 'public.facturas_recibidas_erp_rules'::regclass
  ) then
    alter table public.facturas_recibidas_erp_rules
      add constraint facturas_recibidas_erp_rules_default_approval_note_check
      check (
        (
          cuenta_gasto_default is null
          and concepto_template is null
          and contabilizar_default is null
        )
        or nullif(btrim(approval_note), '') is not null
      );
  end if;
end
$$;

comment on column public.facturas_recibidas_erp_rules.cuenta_gasto_default is
  'Cuenta de gasto ERP de 11 digitos que se propone por defecto.';
comment on column public.facturas_recibidas_erp_rules.concepto_template is
  'Plantilla de concepto de asiento. Debe incluir el marcador {proveedor}.';
comment on column public.facturas_recibidas_erp_rules.contabilizar_default is
  'Valor S/N que se propone por defecto para FRR_Contabilizar.';

do $$
declare
  v_approval_note constant text :=
    'Defaults Campojoyma confirmados expresamente el 29/07/2026: ejercicio 25, fecha CTB = fecha factura, cuenta gasto 60200000001, concepto FRA. {proveedor} y contabilizar S.';
begin
  insert into public.facturas_recibidas_erp_rules (
    empresa_id,
    proveedor_id,
    ejercicio_erp,
    tipo_factura,
    regimen_id,
    fecha_ctb_policy,
    cuenta_gasto_default,
    concepto_template,
    contabilizar_default,
    activo,
    approval_note
  )
  values (
    1,
    null,
    25,
    null,
    null,
    'invoice_date',
    '60200000001',
    'FRA. {proveedor}',
    'S',
    true,
    v_approval_note
  )
  on conflict (empresa_id) where proveedor_id is null
  do update
  set ejercicio_erp = 25,
      fecha_ctb_policy = 'invoice_date',
      cuenta_gasto_default = '60200000001',
      concepto_template = 'FRA. {proveedor}',
      contabilizar_default = 'S',
      activo = true,
      approval_note = case
        when position(v_approval_note in coalesce(
          public.facturas_recibidas_erp_rules.approval_note,
          ''
        )) > 0
          then public.facturas_recibidas_erp_rules.approval_note
        else concat_ws(
          ' ',
          nullif(btrim(public.facturas_recibidas_erp_rules.approval_note), ''),
          v_approval_note
        )
      end,
      updated_at = now();
end
$$;
