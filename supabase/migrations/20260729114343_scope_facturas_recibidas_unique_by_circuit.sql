-- La clave de proveedor no es global entre los maestros de acreedores y
-- agricultores. Dos facturas con la misma empresa, ejercicio, id numérico de
-- proveedor y número pueden coexistir únicamente cuando pertenecen a circuitos
-- canónicos distintos.
--
-- Se crea primero el índice nuevo para no dejar ninguna ventana sin protección
-- de unicidad. El índice histórico, más restrictivo y sin circuito, se elimina
-- solo después de que el nuevo exista.

create unique index if not exists idx_facturasrecibidas_supplier_invoice_circuit_unique
  on public.facturasrecibidas (
    "FRR_Idempresa",
    "FRR_ejercicio",
    "FRR_idproveedor",
    nullif(btrim("FRR_numerofactura"), ''),
    (
      case
        when upper(nullif(btrim("FRR_tipofactura"), '')) = 'GE'
          then 'agricultor'
        when nullif(btrim("FRR_tipofactura"), '') is not null
          then 'acreedor'
        else 'desconocido'
      end
    )
  )
  where "FRR_Idempresa" is not null
    and "FRR_ejercicio" is not null
    and "FRR_idproveedor" is not null
    and nullif(btrim("FRR_numerofactura"), '') is not null
    and estado not in ('duplicada', 'descartada');

drop index if exists public.idx_facturasrecibidas_supplier_invoice_unique;

comment on index public.idx_facturasrecibidas_supplier_invoice_circuit_unique is
  'Evita duplicados activos por empresa, ejercicio, proveedor, numero normalizado y circuito canonico: GE=agricultor, no-GE=acreedor, vacio=desconocido.';
