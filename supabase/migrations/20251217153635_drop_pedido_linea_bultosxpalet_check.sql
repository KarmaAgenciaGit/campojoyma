-- Allow bultosxpalet to be 0/negative by removing CHECK constraint

ALTER TABLE public.pedido_linea
  DROP CONSTRAINT IF EXISTS pedido_linea_bultosxpalet_check;
