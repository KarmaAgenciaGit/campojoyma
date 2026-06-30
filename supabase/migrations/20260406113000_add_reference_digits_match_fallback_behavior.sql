ALTER TABLE public.cliente_behavior_rules
  ADD COLUMN IF NOT EXISTS match_reference_by_digits_fallback boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cliente_behavior_rules.match_reference_by_digits_fallback IS
  'Permite buscar el match de un pedido usando el bloque numerico final de la referencia como fallback, ignorando prefijos de texto.';

INSERT INTO public.cliente_behavior_rules (
  clienteid,
  match_reference_by_digits_fallback
)
VALUES (
  1873,
  true
)
ON CONFLICT (clienteid) DO UPDATE
SET match_reference_by_digits_fallback = EXCLUDED.match_reference_by_digits_fallback,
    updated_at = now();
