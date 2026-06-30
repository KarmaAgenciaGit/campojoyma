-- Update all existing 'revisada' records to 'completada'
-- This makes sense because if a prevision is marked as 'revisada', 
-- it means the product has arrived and should be considered completed
UPDATE public.previsiones 
SET estado = 'completada' 
WHERE estado = 'revisada';