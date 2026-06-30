-- Arreglar las funciones con search_path mutable
CREATE OR REPLACE FUNCTION public.can_complete_prevision(fecha_entrega date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT fecha_entrega <= CURRENT_DATE;
$$;

CREATE OR REPLACE FUNCTION public.validate_prevision_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
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

-- Crear triggers para actualizar timestamps
CREATE OR REPLACE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER update_user_roles_updated_at
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER update_modules_updated_at
  BEFORE UPDATE ON public.modules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER update_agricultores_updated_at
  BEFORE UPDATE ON public.agricultores
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER update_product_configs_updated_at
  BEFORE UPDATE ON public.product_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER update_previsiones_updated_at
  BEFORE UPDATE ON public.previsiones
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER validate_prevision_completion_trigger
  BEFORE INSERT OR UPDATE ON public.previsiones
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_prevision_completion();

CREATE OR REPLACE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER update_webhook_configs_updated_at
  BEFORE UPDATE ON public.webhook_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER update_delivery_notes_updated_at
  BEFORE UPDATE ON public.delivery_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER update_semillas_updated_at
  BEFORE UPDATE ON public.semillas
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER update_work_reports_updated_at
  BEFORE UPDATE ON public.work_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER update_daily_summaries_updated_at
  BEFORE UPDATE ON public.daily_summaries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();