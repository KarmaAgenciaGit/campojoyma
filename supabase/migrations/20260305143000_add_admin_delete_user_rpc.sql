-- Fallback server-side delete for admin panel user removal.
-- Avoids browser CORS/preflight dependency on Edge Functions.

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, auth
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_target_email text;
  v_is_admin boolean := false;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_caller_id
      AND ur.role = 'admin'
  )
  INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Solo administradores';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id es requerido';
  END IF;

  IF v_caller_id = p_user_id THEN
    RAISE EXCEPTION 'No puedes eliminar tu propio usuario desde este panel';
  END IF;

  SELECT u.email
  INTO v_target_email
  FROM auth.users u
  WHERE u.id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado en Auth';
  END IF;

  DELETE FROM auth.users
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se pudo eliminar el usuario';
  END IF;

  RETURN jsonb_build_object(
    'deleted', true,
    'user_id', p_user_id,
    'email', v_target_email
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;
