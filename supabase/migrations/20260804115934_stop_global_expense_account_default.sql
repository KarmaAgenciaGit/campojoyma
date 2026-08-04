-- La cuenta 60200000001 se habia sembrado como default general de empresa.
-- El historico real demuestra que la cuenta depende del proveedor/circuito, por
-- lo que Edge debe resolverla por proveedor o dejarla para revision manual.
-- Las reglas explicitas por proveedor no se modifican.

do $$
declare
  v_note constant text :=
    'Cuenta de gasto general retirada el 04/08/2026: se resuelve desde el historico ERP confirmado por proveedor y circuito.';
begin
  update public.facturas_recibidas_erp_rules
  set cuenta_gasto_default = null,
      approval_note = case
        when position(v_note in coalesce(approval_note, '')) > 0
          then approval_note
        else concat_ws(
          ' ',
          nullif(btrim(approval_note), ''),
          v_note
        )
      end,
      updated_at = now()
  where empresa_id = 1
    and proveedor_id is null
    and cuenta_gasto_default = '60200000001';
end
$$;
