-- Add Orizon integration fields to pedidos
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS enviado_orizon boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS idpedido_orizon bigint;
