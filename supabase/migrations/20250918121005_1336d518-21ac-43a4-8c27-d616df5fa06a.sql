-- Remove notas column from previsiones table
ALTER TABLE public.previsiones DROP COLUMN IF EXISTS notas;