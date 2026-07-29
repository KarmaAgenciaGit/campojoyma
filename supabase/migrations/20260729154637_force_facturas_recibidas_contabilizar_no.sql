-- Versión alineada con la migración aplicada al proyecto Supabase CAMPOJOYMA.
-- La copia TEST de Netagro no tiene instalado el servicio oficial que crea los
-- asientos. Mantener la regla en S bloquea el alta completa en el contrato v2.
-- El writer aplica además N como defensa final, aunque una fila antigua diga S.

update public.facturas_recibidas_erp_rules
set contabilizar_default = 'N',
    approval_note = concat_ws(
      ' ',
      nullif(
        btrim(
          replace(
            coalesce(approval_note, ''),
            'y contabilizar S.',
            'y contabilizar N.'
          )
        ),
        ''
      ),
      'Contabilización automática desactivada en TEST hasta disponer del servicio oficial de Netagro.'
    ),
    updated_at = now()
where empresa_id = 1
  and proveedor_id is null
  and contabilizar_default is distinct from 'N';
