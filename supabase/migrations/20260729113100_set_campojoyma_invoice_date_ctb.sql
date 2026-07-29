-- Campojoyma confirma que la fecha contable de las facturas recibidas debe ser
-- siempre la fecha de factura. La regla general se aplica a toda la empresa y
-- también se propaga a reglas activas por proveedor para que la precedencia de
-- estas no conserve accidentalmente el valor por defecto `manual`.

do $$
declare
  v_approval_note constant text :=
    'Fecha CTB = fecha factura confirmada expresamente para Campojoyma el 29/07/2026.';
begin
  insert into public.facturas_recibidas_erp_rules (
    empresa_id,
    proveedor_id,
    ejercicio_erp,
    tipo_factura,
    regimen_id,
    fecha_ctb_policy,
    activo,
    approval_note
  )
  values (
    1,
    null,
    null,
    null,
    null,
    'invoice_date',
    true,
    v_approval_note
  )
  on conflict (empresa_id) where proveedor_id is null
  do update
  set fecha_ctb_policy = 'invoice_date',
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

  update public.facturas_recibidas_erp_rules
  set fecha_ctb_policy = 'invoice_date',
      approval_note = case
        when position(v_approval_note in coalesce(approval_note, '')) > 0
          then approval_note
        else concat_ws(' ', nullif(btrim(approval_note), ''), v_approval_note)
      end,
      updated_at = now()
  where empresa_id = 1
    and proveedor_id is not null
    and activo = true
    and fecha_ctb_policy = 'manual';
end
$$;
