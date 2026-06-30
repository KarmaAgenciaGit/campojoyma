-- Add columns to better handle PDF files and file metadata
ALTER TABLE public.invoices 
ADD COLUMN file_data TEXT,
ADD COLUMN file_type TEXT DEFAULT 'pdf',
ADD COLUMN file_size INTEGER;

-- Migrate existing image_base64 data to file_data
UPDATE public.invoices 
SET file_data = image_base64,
    file_type = CASE 
      WHEN image_base64 LIKE 'JVBERi0x%' THEN 'pdf'
      WHEN image_base64 LIKE '/9j/%' THEN 'image/jpeg'
      WHEN image_base64 LIKE 'iVBORw0KGgo%' THEN 'image/png'
      ELSE 'pdf'
    END
WHERE image_base64 IS NOT NULL;

-- Keep image_base64 for backward compatibility but mark as deprecated
COMMENT ON COLUMN public.invoices.image_base64 IS 'Deprecated: Use file_data instead';
COMMENT ON COLUMN public.invoices.file_data IS 'Base64 encoded file content (PDF or image)';
COMMENT ON COLUMN public.invoices.file_type IS 'MIME type of the file (pdf, image/jpeg, image/png)';
COMMENT ON COLUMN public.invoices.file_size IS 'File size in bytes';