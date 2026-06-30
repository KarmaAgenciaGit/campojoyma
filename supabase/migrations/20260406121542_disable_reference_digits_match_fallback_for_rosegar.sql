UPDATE public.cliente_behavior_rules
SET match_reference_by_digits_fallback = false,
    updated_at = now()
WHERE clienteid = 1873;
