-- La evidencia del ejercicio 25 corresponde al caso Onduspan (acreedor 17),
-- no a todos los acreedores de la empresa 1.

update public.facturas_recibidas_erp_rules general_rule
set proveedor_id = 17,
    updated_at = now()
where general_rule.empresa_id = 1
  and general_rule.proveedor_id is null
  and general_rule.ejercicio_erp = 25
  and general_rule.tipo_factura is null
  and general_rule.regimen_id is null
  and general_rule.fecha_ctb_policy = 'manual'
  and general_rule.approval_note =
    'Ejercicio ERP 25 confirmado por la aceptacion de solo lectura del caso Onduspan el 22/07/2026.'
  and not exists (
    select 1
    from public.facturas_recibidas_erp_rules provider_rule
    where provider_rule.empresa_id = 1
      and provider_rule.proveedor_id = 17
  );

update public.facturas_recibidas_erp_rules general_rule
set ejercicio_erp = null,
    activo = false,
    approval_note =
      'Seed general desactivado: la evidencia del ejercicio 25 solo confirma el acreedor Onduspan (17).',
    updated_at = now()
where general_rule.empresa_id = 1
  and general_rule.proveedor_id is null
  and general_rule.ejercicio_erp = 25
  and general_rule.tipo_factura is null
  and general_rule.regimen_id is null
  and general_rule.fecha_ctb_policy = 'manual'
  and exists (
    select 1
    from public.facturas_recibidas_erp_rules provider_rule
    where provider_rule.empresa_id = 1
      and provider_rule.proveedor_id = 17
  );
