-- Fix: user_roles.role es TEXT, pero has_role recibe app_role (enum).
-- Esto rompía is_admin()/RLS con el error: "operator does not exist: text = app_role".

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT exists (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = (_role::text)
  )
$$;

