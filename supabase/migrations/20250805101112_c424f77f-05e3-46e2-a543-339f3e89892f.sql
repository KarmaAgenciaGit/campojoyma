-- Add image_base64 column to invoices table
ALTER TABLE public.invoices 
ADD COLUMN image_base64 TEXT;