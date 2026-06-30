-- Update all existing 'revisada' records to 'completada'
-- This makes sense because if a prevision is marked as 'revisada', 
-- it means the product has arrived and should be considered completed
UPDATE public.previsiones 
SET estado = 'completada' 
WHERE estado = 'revisada';

-- Add a check constraint to ensure only valid states are allowed
ALTER TABLE public.previsiones 
ADD CONSTRAINT previsiones_estado_check 
CHECK (estado IN ('pendiente', 'completada'));