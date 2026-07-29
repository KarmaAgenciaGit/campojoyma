-- Permite que una regla especifica de acreedor no defina politica CTB y
-- herede la regla general de empresa. No se reescriben filas existentes:
-- `manual` sigue siendo una eleccion explicita y NULL representa herencia.

alter table if exists public.facturas_recibidas_erp_rules
  alter column fecha_ctb_policy drop not null,
  alter column fecha_ctb_policy set default null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname =
      'facturas_recibidas_erp_rules_fecha_ctb_policy_nullable_check'
      and conrelid = 'public.facturas_recibidas_erp_rules'::regclass
  ) then
    alter table public.facturas_recibidas_erp_rules
      add constraint
        facturas_recibidas_erp_rules_fecha_ctb_policy_nullable_check
      check (
        fecha_ctb_policy is null
        or fecha_ctb_policy in ('manual', 'invoice_date')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname =
      'facturas_recibidas_erp_rules_ctb_inheritance_approval_check'
      and conrelid = 'public.facturas_recibidas_erp_rules'::regclass
  ) then
    alter table public.facturas_recibidas_erp_rules
      add constraint
        facturas_recibidas_erp_rules_ctb_inheritance_approval_check
      check (
        fecha_ctb_policy is distinct from 'invoice_date'
        or nullif(btrim(approval_note), '') is not null
      );
  end if;
end
$$;

comment on column public.facturas_recibidas_erp_rules.fecha_ctb_policy is
  'NULL hereda la regla general; manual exige revision e invoice_date copia la fecha de factura.';
