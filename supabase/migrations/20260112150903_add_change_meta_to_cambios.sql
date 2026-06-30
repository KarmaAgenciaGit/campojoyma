ALTER TABLE public.cambios_pedidos
  ADD COLUMN IF NOT EXISTS change_meta jsonb;

ALTER TABLE public.cambios_pedido_linea
  ADD COLUMN IF NOT EXISTS change_meta jsonb;

CREATE INDEX IF NOT EXISTS idx_cambios_pedido_linea_accion
  ON public.cambios_pedido_linea (accion);
