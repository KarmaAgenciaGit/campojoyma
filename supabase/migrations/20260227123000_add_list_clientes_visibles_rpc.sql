-- Helper: lista clienteid permitidos en allowlist de visibilidad.
-- SECURITY DEFINER para que usuarios autenticados puedan leer la allowlist
-- sin abrir SELECT directo sobre la tabla.

CREATE OR REPLACE FUNCTION public.list_clientes_visibles()
RETURNS TABLE (clienteid bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT cv.clienteid
  FROM public.clientes_visibles cv
  ORDER BY cv.clienteid;
$$;

GRANT EXECUTE ON FUNCTION public.list_clientes_visibles() TO authenticated;
