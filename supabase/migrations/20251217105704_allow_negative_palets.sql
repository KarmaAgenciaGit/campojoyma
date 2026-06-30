-- Allow negative pallet values by removing non-negative CHECK constraints

ALTER TABLE public.pedido_linea
  DROP CONSTRAINT IF EXISTS pedido_linea_numero_palet_check;

ALTER TABLE public.pedido_linea_centro
  DROP CONSTRAINT IF EXISTS pedido_linea_centro_numero_palets_check;

ALTER TABLE public.cambios_pedido_linea_centro
  DROP CONSTRAINT IF EXISTS cambios_pedido_linea_centro_numero_palets_check;
