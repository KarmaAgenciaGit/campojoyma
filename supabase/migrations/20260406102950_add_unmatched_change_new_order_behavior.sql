ALTER TABLE public.cliente_behavior_rules
  ADD COLUMN IF NOT EXISTS allow_create_new_order_from_unmatched_change boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cliente_behavior_rules.allow_create_new_order_from_unmatched_change IS
  'Permite ofrecer en la UI la opcion de crear un nuevo pedido/prevision a partir de un cambio sin match.';

INSERT INTO public.cliente_behavior_rules (
  clienteid,
  allow_create_new_order_from_unmatched_change
)
VALUES (
  1873,
  true
)
ON CONFLICT (clienteid) DO UPDATE
SET allow_create_new_order_from_unmatched_change = EXCLUDED.allow_create_new_order_from_unmatched_change,
    updated_at = now();
