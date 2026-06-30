-- Change numeric fields to text in semillas table to handle string data from n8n
ALTER TABLE public.semillas 
  ALTER COLUMN cantidad_semillas TYPE text,
  ALTER COLUMN germinacion_minima TYPE text,
  ALTER COLUMN pureza TYPE text;