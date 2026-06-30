-- Enable RLS for cuentas de venta with same visibility model as pedidos
-- Uses public.is_cliente_visible(clienteid) and public.is_admin() defined in previous migrations.

-- Preserve current visibility for existing cuentas de venta
INSERT INTO public.clientes_visibles (clienteid)
SELECT DISTINCT cv.clienteid
FROM public.cuentaventas cv
WHERE cv.clienteid IS NOT NULL
ON CONFLICT (clienteid) DO NOTHING;

-- Enable RLS on cuentas de venta and related tables
ALTER TABLE public.cuentaventas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuentaventa_gastos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuentaventa_detalle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuentaventa_detalle_valor ENABLE ROW LEVEL SECURITY;

-- Cuentaventas policies (similar to pedidos)
DROP POLICY IF EXISTS "Cuentaventas: select visibles" ON public.cuentaventas;
CREATE POLICY "Cuentaventas: select visibles"
ON public.cuentaventas
FOR SELECT
TO authenticated
USING (public.is_cliente_visible(clienteid));

DROP POLICY IF EXISTS "Cuentaventas: insert visibles" ON public.cuentaventas;
CREATE POLICY "Cuentaventas: insert visibles"
ON public.cuentaventas
FOR INSERT
TO authenticated
WITH CHECK (public.is_cliente_visible(clienteid));

DROP POLICY IF EXISTS "Cuentaventas: update visibles" ON public.cuentaventas;
CREATE POLICY "Cuentaventas: update visibles"
ON public.cuentaventas
FOR UPDATE
TO authenticated
USING (public.is_cliente_visible(clienteid))
WITH CHECK (public.is_cliente_visible(clienteid));

DROP POLICY IF EXISTS "Cuentaventas: delete visibles" ON public.cuentaventas;
CREATE POLICY "Cuentaventas: delete visibles"
ON public.cuentaventas
FOR DELETE
TO authenticated
USING (public.is_cliente_visible(clienteid));

-- Cuentaventa_gastos policies
DROP POLICY IF EXISTS "Cuentaventa_gastos: select visibles" ON public.cuentaventa_gastos;
CREATE POLICY "Cuentaventa_gastos: select visibles"
ON public.cuentaventa_gastos
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cuentaventas cv
    WHERE cv.id = cuentaventa_gastos.cuentaventa_id
  )
);

DROP POLICY IF EXISTS "Cuentaventa_gastos: insert visibles" ON public.cuentaventa_gastos;
CREATE POLICY "Cuentaventa_gastos: insert visibles"
ON public.cuentaventa_gastos
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cuentaventas cv
    WHERE cv.id = cuentaventa_gastos.cuentaventa_id
  )
);

DROP POLICY IF EXISTS "Cuentaventa_gastos: update visibles" ON public.cuentaventa_gastos;
CREATE POLICY "Cuentaventa_gastos: update visibles"
ON public.cuentaventa_gastos
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cuentaventas cv
    WHERE cv.id = cuentaventa_gastos.cuentaventa_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cuentaventas cv
    WHERE cv.id = cuentaventa_gastos.cuentaventa_id
  )
);

DROP POLICY IF EXISTS "Cuentaventa_gastos: delete visibles" ON public.cuentaventa_gastos;
CREATE POLICY "Cuentaventa_gastos: delete visibles"
ON public.cuentaventa_gastos
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cuentaventas cv
    WHERE cv.id = cuentaventa_gastos.cuentaventa_id
  )
);

-- Cuentaventa_detalle policies
DROP POLICY IF EXISTS "Cuentaventa_detalle: select visibles" ON public.cuentaventa_detalle;
CREATE POLICY "Cuentaventa_detalle: select visibles"
ON public.cuentaventa_detalle
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cuentaventas cv
    WHERE cv.id = cuentaventa_detalle.cuentaventa_id
  )
);

DROP POLICY IF EXISTS "Cuentaventa_detalle: insert visibles" ON public.cuentaventa_detalle;
CREATE POLICY "Cuentaventa_detalle: insert visibles"
ON public.cuentaventa_detalle
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cuentaventas cv
    WHERE cv.id = cuentaventa_detalle.cuentaventa_id
  )
);

DROP POLICY IF EXISTS "Cuentaventa_detalle: update visibles" ON public.cuentaventa_detalle;
CREATE POLICY "Cuentaventa_detalle: update visibles"
ON public.cuentaventa_detalle
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cuentaventas cv
    WHERE cv.id = cuentaventa_detalle.cuentaventa_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cuentaventas cv
    WHERE cv.id = cuentaventa_detalle.cuentaventa_id
  )
);

DROP POLICY IF EXISTS "Cuentaventa_detalle: delete visibles" ON public.cuentaventa_detalle;
CREATE POLICY "Cuentaventa_detalle: delete visibles"
ON public.cuentaventa_detalle
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cuentaventas cv
    WHERE cv.id = cuentaventa_detalle.cuentaventa_id
  )
);

-- Cuentaventa_detalle_valor policies
DROP POLICY IF EXISTS "Cuentaventa_detalle_valor: select visibles" ON public.cuentaventa_detalle_valor;
CREATE POLICY "Cuentaventa_detalle_valor: select visibles"
ON public.cuentaventa_detalle_valor
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cuentaventa_detalle cd
    JOIN public.cuentaventas cv ON cv.id = cd.cuentaventa_id
    WHERE cd.id = cuentaventa_detalle_valor.cuentaventa_detalle_id
  )
);

DROP POLICY IF EXISTS "Cuentaventa_detalle_valor: insert visibles" ON public.cuentaventa_detalle_valor;
CREATE POLICY "Cuentaventa_detalle_valor: insert visibles"
ON public.cuentaventa_detalle_valor
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cuentaventa_detalle cd
    JOIN public.cuentaventas cv ON cv.id = cd.cuentaventa_id
    WHERE cd.id = cuentaventa_detalle_valor.cuentaventa_detalle_id
  )
);

DROP POLICY IF EXISTS "Cuentaventa_detalle_valor: update visibles" ON public.cuentaventa_detalle_valor;
CREATE POLICY "Cuentaventa_detalle_valor: update visibles"
ON public.cuentaventa_detalle_valor
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cuentaventa_detalle cd
    JOIN public.cuentaventas cv ON cv.id = cd.cuentaventa_id
    WHERE cd.id = cuentaventa_detalle_valor.cuentaventa_detalle_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cuentaventa_detalle cd
    JOIN public.cuentaventas cv ON cv.id = cd.cuentaventa_id
    WHERE cd.id = cuentaventa_detalle_valor.cuentaventa_detalle_id
  )
);

DROP POLICY IF EXISTS "Cuentaventa_detalle_valor: delete visibles" ON public.cuentaventa_detalle_valor;
CREATE POLICY "Cuentaventa_detalle_valor: delete visibles"
ON public.cuentaventa_detalle_valor
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cuentaventa_detalle cd
    JOIN public.cuentaventas cv ON cv.id = cd.cuentaventa_id
    WHERE cd.id = cuentaventa_detalle_valor.cuentaventa_detalle_id
  )
);

-- Allow PDF access when linked to cuentas de venta
DROP POLICY IF EXISTS "Archivos_pdf: select visibles" ON public.archivos_pdf;
CREATE POLICY "Archivos_pdf: select visibles"
ON public.archivos_pdf
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.pedidos p
    WHERE p.archivo_pdf_id = archivos_pdf.id
  )
  OR EXISTS (
    SELECT 1
    FROM public.cambios_pedidos cp
    WHERE cp.archivo_pdf_id = archivos_pdf.id
  )
  OR EXISTS (
    SELECT 1
    FROM public.cuentaventas cv
    WHERE cv.archivo_pdf_id = archivos_pdf.id
  )
);
