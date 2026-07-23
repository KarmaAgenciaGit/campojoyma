-- La unicidad solo se aplica cuando la clave ERP exacta esta completa.
-- Los borradores sin empresa o ejercicio deben poder coexistir hasta que una
-- regla aprobada o una seleccion manual complete esos valores.

drop index if exists public.idx_facturasrecibidas_supplier_invoice_unique;

create unique index if not exists idx_facturasrecibidas_supplier_invoice_unique
  on public.facturasrecibidas (
    "FRR_Idempresa",
    "FRR_ejercicio",
    "FRR_idproveedor",
    nullif(btrim("FRR_numerofactura"), '')
  )
  where "FRR_Idempresa" is not null
    and "FRR_ejercicio" is not null
    and "FRR_idproveedor" is not null
    and nullif(btrim("FRR_numerofactura"), '') is not null
    and estado not in ('duplicada', 'descartada');

comment on index public.idx_facturasrecibidas_supplier_invoice_unique is
  'Evita duplicados activos solo con clave ERP completa: empresa, ejercicio, proveedor y numero.';
