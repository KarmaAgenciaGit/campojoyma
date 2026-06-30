-- Actualizar todas las previsiones futuras que estén marcadas como completadas a pendientes
UPDATE previsiones 
SET estado = 'pendiente'
WHERE fechaentrega > CURRENT_DATE AND estado = 'completada';

-- Crear función para validar si una previsión puede ser completada
CREATE OR REPLACE FUNCTION public.can_complete_prevision(fecha_entrega date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT fecha_entrega <= CURRENT_DATE;
$$;

-- Crear trigger para asegurar que no se puedan completar previsiones futuras
CREATE OR REPLACE FUNCTION public.validate_prevision_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Si se está intentando marcar como completada una previsión futura
  IF NEW.estado = 'completada' AND NEW.fechaentrega > CURRENT_DATE THEN
    RAISE EXCEPTION 'No se puede completar una previsión futura. Fecha de entrega: %, Fecha actual: %', NEW.fechaentrega, CURRENT_DATE;
  END IF;
  
  -- Si la fecha de entrega es futura, forzar estado pendiente
  IF NEW.fechaentrega > CURRENT_DATE THEN
    NEW.estado = 'pendiente';
  END IF;
  
  RETURN NEW;
END;
$$;

-- Crear el trigger
DROP TRIGGER IF EXISTS validate_prevision_completion_trigger ON previsiones;
CREATE TRIGGER validate_prevision_completion_trigger
  BEFORE INSERT OR UPDATE ON previsiones
  FOR EACH ROW
  EXECUTE FUNCTION validate_prevision_completion();