-- Received invoices: exact duplicate key and manual-only punteo selection.

alter table if exists public.facturasrecibidas_punteos
  alter column "S" set default false;

drop index if exists public.idx_facturasrecibidas_supplier_invoice_unique;

create unique index if not exists idx_facturasrecibidas_supplier_invoice_unique
  on public.facturasrecibidas (
    coalesce("FRR_Idempresa", 0),
    coalesce("FRR_ejercicio", 0),
    "FRR_idproveedor",
    nullif(btrim("FRR_numerofactura"), '')
  )
  where "FRR_idproveedor" is not null
    and nullif(btrim("FRR_numerofactura"), '') is not null
    and estado not in ('duplicada', 'descartada');

comment on index public.idx_facturasrecibidas_supplier_invoice_unique is
  'Evita duplicados activos por empresa, ejercicio, proveedor y numero; permite conservar descartadas y marcas de duplicado.';
