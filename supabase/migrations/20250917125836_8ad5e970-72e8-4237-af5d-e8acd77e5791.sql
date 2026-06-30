-- Add localizacion field to agricultores table
ALTER TABLE public.agricultores 
ADD COLUMN localizacion text;

-- Update existing records with random Spanish provinces
UPDATE public.agricultores 
SET localizacion = CASE 
  WHEN random() < 0.05 THEN 'A Coruña'
  WHEN random() < 0.10 THEN 'Álava'
  WHEN random() < 0.15 THEN 'Albacete'
  WHEN random() < 0.20 THEN 'Alicante'
  WHEN random() < 0.25 THEN 'Almería'
  WHEN random() < 0.30 THEN 'Asturias'
  WHEN random() < 0.35 THEN 'Ávila'
  WHEN random() < 0.40 THEN 'Badajoz'
  WHEN random() < 0.45 THEN 'Barcelona'
  WHEN random() < 0.50 THEN 'Burgos'
  WHEN random() < 0.55 THEN 'Cáceres'
  WHEN random() < 0.60 THEN 'Cádiz'
  WHEN random() < 0.65 THEN 'Cantabria'
  WHEN random() < 0.70 THEN 'Castellón'
  WHEN random() < 0.75 THEN 'Ciudad Real'
  WHEN random() < 0.80 THEN 'Córdoba'
  WHEN random() < 0.85 THEN 'Cuenca'
  WHEN random() < 0.90 THEN 'Girona'
  WHEN random() < 0.95 THEN 'Granada'
  ELSE 'Guadalajara'
END
WHERE localizacion IS NULL;