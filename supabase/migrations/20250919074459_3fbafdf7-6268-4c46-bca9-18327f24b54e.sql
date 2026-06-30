-- Crear funciones de utilidad
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Función para verificar si el usuario tiene un rol específico
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT exists (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Función para verificar si es administrador
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
$$;

-- Función para validar completado de previsiones
CREATE OR REPLACE FUNCTION public.can_complete_prevision(fecha_entrega date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT fecha_entrega <= CURRENT_DATE;
$$;

-- Función para validar previsiones antes de actualizar
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

-- Función para crear nuevo usuario
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

-- Función para asignar rol de usuario por defecto
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$$;

-- Función para generar tokens de API
CREATE OR REPLACE FUNCTION public.generate_api_token()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    characters text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    token_length integer := 16;
    token text := '';
    i integer;
BEGIN
    FOR i IN 1..token_length LOOP
        token := token || substr(characters, floor(random() * length(characters) + 1)::integer, 1);
    END LOOP;
    RETURN token;
END;
$$;

-- Función para obtener usuario desde token
CREATE OR REPLACE FUNCTION public.get_user_from_token(token_value text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  user_uuid UUID;
BEGIN
  SELECT user_id INTO user_uuid 
  FROM public.api_tokens 
  WHERE token = token_value AND is_active = true;
  
  -- Update last_used_at
  IF user_uuid IS NOT NULL THEN
    UPDATE public.api_tokens 
    SET last_used_at = now() 
    WHERE token = token_value;
  END IF;
  
  RETURN user_uuid;
END;
$$;