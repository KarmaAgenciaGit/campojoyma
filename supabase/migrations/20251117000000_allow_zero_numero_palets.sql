-- Allow numero_palets to be zero in pedido_linea_centro
ALTER TABLE public.pedido_linea_centro
  DROP CONSTRAINT IF EXISTS pedido_linea_centro_numero_palets_check;

ALTER TABLE public.pedido_linea_centro
  ADD CONSTRAINT pedido_linea_centro_numero_palets_check
  CHECK (numero_palets >= 0);
