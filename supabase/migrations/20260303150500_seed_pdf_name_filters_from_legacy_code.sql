-- Migra filtros legacy del nodo n8n seleccionPDF (cfgFromOrigen) a BBDD.
--
-- Reglas legacy:
-- - EuroGroup / Rosegar: skip_name_includes = ['anexo','cartel']
-- - Delifresh / Freshpasion: require_name_prefixes = ['PED_']
--
-- clienteid mapeados en AgroIris:
-- - EuroGroup: 1403
-- - Rosegar: 1873
-- - Delifresh: 2373
-- - Freshpasion: 2530

INSERT INTO public.cliente_behavior_rules (
  clienteid,
  skip_name_includes,
  require_name_prefixes
)
VALUES
  (1403, ARRAY['anexo', 'cartel']::text[], ARRAY[]::text[]),
  (1873, ARRAY['anexo', 'cartel']::text[], ARRAY[]::text[]),
  (2373, ARRAY[]::text[], ARRAY['PED_']::text[]),
  (2530, ARRAY[]::text[], ARRAY['PED_']::text[])
ON CONFLICT (clienteid) DO UPDATE
SET skip_name_includes = EXCLUDED.skip_name_includes,
    require_name_prefixes = EXCLUDED.require_name_prefixes,
    updated_at = now();
