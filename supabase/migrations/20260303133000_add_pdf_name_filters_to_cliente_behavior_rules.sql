-- Filtros de nombre de PDF por cliente para evitar hardcodes en automatizaciones.
-- Estos campos permiten parametrizar reglas de entrada desde BBDD:
--  - skip_name_includes: tokens que, si aparecen en el nombre del adjunto, lo descartan.
--  - require_name_prefixes: prefijos válidos; si no coincide ninguno, se descarta.

ALTER TABLE public.cliente_behavior_rules
ADD COLUMN IF NOT EXISTS skip_name_includes text[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS require_name_prefixes text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.cliente_behavior_rules.skip_name_includes IS
  'Tokens (case-insensitive) que excluyen un adjunto PDF por nombre.';

COMMENT ON COLUMN public.cliente_behavior_rules.require_name_prefixes IS
  'Prefijos permitidos (case-insensitive) para el nombre de adjuntos PDF.';
