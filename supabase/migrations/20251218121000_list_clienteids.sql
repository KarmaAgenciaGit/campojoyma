-- Helper: listar clienteid distintos presentes en pedidos.
-- Nota: función SECURITY INVOKER (por defecto) para que aplique RLS.

CREATE OR REPLACE FUNCTION public.list_clienteids()
RETURNS TABLE (clienteid bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT DISTINCT p.clienteid
  FROM public.pedidos p
  WHERE p.clienteid IS NOT NULL
  ORDER BY p.clienteid;
$$;
