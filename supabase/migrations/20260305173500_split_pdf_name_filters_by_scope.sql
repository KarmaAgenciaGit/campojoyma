-- Separate PDF-name filters by scope (pedidos vs cuentas de venta)
-- inside cliente_behavior_rules.
--
-- Legacy columns kept for compatibility:
--   - skip_name_includes
--   - require_name_prefixes
--
-- New columns:
--   - skip_name_includes_pedidos
--   - require_name_prefixes_pedidos
--   - skip_name_includes_cuentaventa
--   - require_name_prefixes_cuentaventa

ALTER TABLE public.cliente_behavior_rules
ADD COLUMN IF NOT EXISTS skip_name_includes_pedidos text[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS require_name_prefixes_pedidos text[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS skip_name_includes_cuentaventa text[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS require_name_prefixes_cuentaventa text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.cliente_behavior_rules.skip_name_includes_pedidos IS
  'Tokens que descartan adjuntos PDF por nombre en flujo de pedidos.';
COMMENT ON COLUMN public.cliente_behavior_rules.require_name_prefixes_pedidos IS
  'Prefijos requeridos de nombre de adjunto en flujo de pedidos.';
COMMENT ON COLUMN public.cliente_behavior_rules.skip_name_includes_cuentaventa IS
  'Tokens que descartan adjuntos PDF por nombre en flujo de cuentas de venta.';
COMMENT ON COLUMN public.cliente_behavior_rules.require_name_prefixes_cuentaventa IS
  'Prefijos requeridos de nombre de adjunto en flujo de cuentas de venta.';

-- Seed inicial:
-- 1) Pedidos toma los valores legacy.
UPDATE public.cliente_behavior_rules
SET
  skip_name_includes_pedidos = COALESCE(skip_name_includes, '{}'),
  require_name_prefixes_pedidos = COALESCE(require_name_prefixes, '{}')
WHERE
  COALESCE(array_length(skip_name_includes_pedidos, 1), 0) = 0
  AND COALESCE(array_length(require_name_prefixes_pedidos, 1), 0) = 0
  AND (
    COALESCE(array_length(skip_name_includes, 1), 0) > 0
    OR COALESCE(array_length(require_name_prefixes, 1), 0) > 0
  );

-- 2) Cuentas de venta parte igual que legacy para no romper comportamiento inicial.
UPDATE public.cliente_behavior_rules
SET
  skip_name_includes_cuentaventa = COALESCE(skip_name_includes, '{}'),
  require_name_prefixes_cuentaventa = COALESCE(require_name_prefixes, '{}')
WHERE
  COALESCE(array_length(skip_name_includes_cuentaventa, 1), 0) = 0
  AND COALESCE(array_length(require_name_prefixes_cuentaventa, 1), 0) = 0
  AND (
    COALESCE(array_length(skip_name_includes, 1), 0) > 0
    OR COALESCE(array_length(require_name_prefixes, 1), 0) > 0
  );
