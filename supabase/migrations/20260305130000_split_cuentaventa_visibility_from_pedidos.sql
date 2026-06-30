-- Separate visibility allowlist for cuentas de venta from pedidos.
-- Keeps current behavior as initial seed, but allows independent management afterwards.

-- =========================
-- 1) Dedicated allowlist for cuentas de venta
-- =========================

CREATE TABLE IF NOT EXISTS public.clientes_visibles_cuentaventa (
  clienteid bigint PRIMARY KEY,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.clientes_visibles_cuentaventa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage clientes_visibles_cuentaventa" ON public.clientes_visibles_cuentaventa;
CREATE POLICY "Admins can manage clientes_visibles_cuentaventa"
ON public.clientes_visibles_cuentaventa
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP TRIGGER IF EXISTS update_clientes_visibles_cuentaventa_updated_at ON public.clientes_visibles_cuentaventa;
CREATE TRIGGER update_clientes_visibles_cuentaventa_updated_at
  BEFORE UPDATE ON public.clientes_visibles_cuentaventa
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed inicial para no romper comportamiento actual:
-- 1) Copia lo que hoy está visible en pedidos.
INSERT INTO public.clientes_visibles_cuentaventa (clienteid)
SELECT DISTINCT cv.clienteid
FROM public.clientes_visibles cv
WHERE cv.clienteid IS NOT NULL
ON CONFLICT (clienteid) DO NOTHING;

-- 2) Asegura que clientes históricos de cuentas de venta queden visibles.
INSERT INTO public.clientes_visibles_cuentaventa (clienteid)
SELECT DISTINCT c.clienteid
FROM public.cuentaventas c
WHERE c.clienteid IS NOT NULL
ON CONFLICT (clienteid) DO NOTHING;

-- =========================
-- 2) Helpers / RPC for cuentas de venta
-- =========================

CREATE OR REPLACE FUNCTION public.is_cliente_visible_cuentaventa(_clienteid bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_admin()
     OR EXISTS (
       SELECT 1
       FROM public.clientes_visibles_cuentaventa cv
       WHERE cv.clienteid = _clienteid
     );
$$;

CREATE OR REPLACE FUNCTION public.list_clienteids_cuentaventa()
RETURNS TABLE (clienteid bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT DISTINCT c.clienteid
  FROM public.cuentaventas c
  WHERE c.clienteid IS NOT NULL
  ORDER BY c.clienteid;
$$;

GRANT EXECUTE ON FUNCTION public.list_clienteids_cuentaventa() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_clientes_visibles_cuentaventa()
RETURNS TABLE (clienteid bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT cv.clienteid
  FROM public.clientes_visibles_cuentaventa cv
  ORDER BY cv.clienteid;
$$;

GRANT EXECUTE ON FUNCTION public.list_clientes_visibles_cuentaventa() TO authenticated;

-- =========================
-- 3) RLS switch for cuentas de venta
-- =========================

DROP POLICY IF EXISTS "Cuentaventas: select visibles" ON public.cuentaventas;
CREATE POLICY "Cuentaventas: select visibles"
ON public.cuentaventas
FOR SELECT
TO authenticated
USING (public.is_cliente_visible_cuentaventa(clienteid));

DROP POLICY IF EXISTS "Cuentaventas: insert visibles" ON public.cuentaventas;
CREATE POLICY "Cuentaventas: insert visibles"
ON public.cuentaventas
FOR INSERT
TO authenticated
WITH CHECK (public.is_cliente_visible_cuentaventa(clienteid));

DROP POLICY IF EXISTS "Cuentaventas: update visibles" ON public.cuentaventas;
CREATE POLICY "Cuentaventas: update visibles"
ON public.cuentaventas
FOR UPDATE
TO authenticated
USING (public.is_cliente_visible_cuentaventa(clienteid))
WITH CHECK (public.is_cliente_visible_cuentaventa(clienteid));

DROP POLICY IF EXISTS "Cuentaventas: delete visibles" ON public.cuentaventas;
CREATE POLICY "Cuentaventas: delete visibles"
ON public.cuentaventas
FOR DELETE
TO authenticated
USING (public.is_cliente_visible_cuentaventa(clienteid));

DROP POLICY IF EXISTS "Cuentaventa_errores: select visibles" ON public.cuentaventa_errores;
CREATE POLICY "Cuentaventa_errores: select visibles"
ON public.cuentaventa_errores
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.cuentaventas c
    WHERE c.archivo_pdf_id = cuentaventa_errores.archivo_pdf_id
      AND public.is_cliente_visible_cuentaventa(c.clienteid)
  )
);
