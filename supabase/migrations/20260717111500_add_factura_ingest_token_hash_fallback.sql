-- Fallback de autenticacion para factura-recibida-ingest cuando el Edge secret
-- aun no esta disponible. Solo se persisten hashes SHA-256, nunca tokens en claro.

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
REVOKE ALL ON SCHEMA private FROM authenticated;

CREATE TABLE IF NOT EXISTS private.factura_ingest_token_hashes (
  token_hash text PRIMARY KEY,
  hash_algorithm text NOT NULL DEFAULT 'sha256',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT factura_ingest_token_hash_sha256_only
    CHECK (hash_algorithm = 'sha256'),
  CONSTRAINT factura_ingest_token_hash_valid
    CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

ALTER TABLE private.factura_ingest_token_hashes ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.factura_ingest_token_hashes FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.factura_ingest_token_hashes FROM PUBLIC;
REVOKE ALL ON TABLE private.factura_ingest_token_hashes FROM anon;
REVOKE ALL ON TABLE private.factura_ingest_token_hashes FROM authenticated;

INSERT INTO private.factura_ingest_token_hashes (
  token_hash,
  hash_algorithm,
  is_active
)
VALUES (
  'df6eda62e8e47a9b46765acb282cd2863bf91adb9d6c17f8023a486d48e54520',
  'sha256',
  true
)
ON CONFLICT (token_hash) DO UPDATE
SET hash_algorithm = EXCLUDED.hash_algorithm,
    is_active = EXCLUDED.is_active;

CREATE OR REPLACE FUNCTION public.verify_factura_ingest_token_hash(
  p_token_hash text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM private.factura_ingest_token_hashes AS token
    WHERE token.hash_algorithm = 'sha256'
      AND token.is_active
      AND token.token_hash = lower(trim(p_token_hash))
  );
$function$;

REVOKE ALL ON FUNCTION public.verify_factura_ingest_token_hash(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_factura_ingest_token_hash(text) FROM anon;
REVOKE ALL ON FUNCTION public.verify_factura_ingest_token_hash(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.verify_factura_ingest_token_hash(text) TO service_role;
