-- Separa y rota el token de ingesta usado por n8n.
-- Solo persiste SHA-256; el token en claro vive en Edge Secrets y en la credencial n8n.

UPDATE private.factura_ingest_token_hashes
SET is_active = false
WHERE token_hash <> '7339d7de9f995fff86b521d6b75686bf8b18404f4dbd8141ea29638ba117dfbb'
  AND is_active;

INSERT INTO private.factura_ingest_token_hashes (
  token_hash,
  hash_algorithm,
  is_active
)
VALUES (
  '7339d7de9f995fff86b521d6b75686bf8b18404f4dbd8141ea29638ba117dfbb',
  'sha256',
  true
)
ON CONFLICT (token_hash) DO UPDATE
SET hash_algorithm = EXCLUDED.hash_algorithm,
    is_active = EXCLUDED.is_active;
