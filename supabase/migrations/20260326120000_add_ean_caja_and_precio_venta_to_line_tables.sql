ALTER TABLE public.pedido_linea
ADD COLUMN IF NOT EXISTS ean_caja text,
ADD COLUMN IF NOT EXISTS precio_venta numeric(14,4);

ALTER TABLE public.cambios_pedido_linea
ADD COLUMN IF NOT EXISTS ean text,
ADD COLUMN IF NOT EXISTS nlote_cliente text,
ADD COLUMN IF NOT EXISTS ean_caja text,
ADD COLUMN IF NOT EXISTS precio_venta numeric(14,4);
