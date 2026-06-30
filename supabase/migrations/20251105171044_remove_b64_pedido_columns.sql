-- Drop b64_pedido column from pedidos table
-- This column is now deprecated as we use archivo_pdf_id with the archivos_pdf deduplication system

ALTER TABLE pedidos DROP COLUMN IF EXISTS b64_pedido;

-- Drop b64_pedido column from previsiones table (if it exists)
ALTER TABLE previsiones DROP COLUMN IF EXISTS b64_pedido;

-- Drop pdf_base64 column from previsiones table
-- Previsiones don't store PDFs (only pedidos use archivo_pdf_id)
ALTER TABLE previsiones DROP COLUMN IF EXISTS pdf_base64;

-- Add comment to archivo_pdf_id column to document the new system
COMMENT ON COLUMN pedidos.archivo_pdf_id IS 'Foreign key to archivos_pdf table. PDFs are deduplicated using SHA-256 hash.';
