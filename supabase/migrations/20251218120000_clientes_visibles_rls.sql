-- Control de visibilidad por cliente (solo admin ve todo; usuarios ven solo clientes permitidos)
-- Objetivo: poder ocultar pedidos/cambios de clientes nuevos a usuarios no admin.

-- =========================
-- 1) Tabla allowlist
-- =========================

CREATE TABLE IF NOT EXISTS public.clientes_visibles (
  clienteid bigint PRIMARY KEY,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.clientes_visibles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage clientes_visibles" ON public.clientes_visibles;
CREATE POLICY "Admins can manage clientes_visibles"
ON public.clientes_visibles
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP TRIGGER IF EXISTS update_clientes_visibles_updated_at ON public.clientes_visibles;
CREATE TRIGGER update_clientes_visibles_updated_at
  BEFORE UPDATE ON public.clientes_visibles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- 2) Helper para RLS
-- =========================

CREATE OR REPLACE FUNCTION public.is_cliente_visible(_clienteid bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_admin()
     OR EXISTS (
       SELECT 1
       FROM public.clientes_visibles cv
       WHERE cv.clienteid = _clienteid
     );
$$;

-- Seed inicial: mantener el comportamiento actual (clientes existentes visibles).
INSERT INTO public.clientes_visibles (clienteid)
SELECT DISTINCT p.clienteid
FROM public.pedidos p
WHERE p.clienteid IS NOT NULL
ON CONFLICT (clienteid) DO NOTHING;

INSERT INTO public.clientes_visibles (clienteid)
SELECT DISTINCT c.clienteid
FROM public.cambios_pedidos c
WHERE c.clienteid IS NOT NULL
ON CONFLICT (clienteid) DO NOTHING;

-- =========================
-- 3) RLS en tablas principales
-- =========================

-- PEDIDOS
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read pedidos" ON public.pedidos;
DROP POLICY IF EXISTS "Public insert pedidos" ON public.pedidos;

DROP POLICY IF EXISTS "Pedidos: select visibles" ON public.pedidos;
CREATE POLICY "Pedidos: select visibles"
ON public.pedidos
FOR SELECT
TO authenticated
USING (public.is_cliente_visible(clienteid));

DROP POLICY IF EXISTS "Pedidos: insert visibles" ON public.pedidos;
CREATE POLICY "Pedidos: insert visibles"
ON public.pedidos
FOR INSERT
TO authenticated
WITH CHECK (public.is_cliente_visible(clienteid));

DROP POLICY IF EXISTS "Pedidos: update visibles" ON public.pedidos;
CREATE POLICY "Pedidos: update visibles"
ON public.pedidos
FOR UPDATE
TO authenticated
USING (public.is_cliente_visible(clienteid))
WITH CHECK (public.is_cliente_visible(clienteid));

DROP POLICY IF EXISTS "Pedidos: delete visibles" ON public.pedidos;
CREATE POLICY "Pedidos: delete visibles"
ON public.pedidos
FOR DELETE
TO authenticated
USING (public.is_cliente_visible(clienteid));

-- PEDIDO_LINEA
ALTER TABLE public.pedido_linea ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Pedido_linea: select visibles" ON public.pedido_linea;
CREATE POLICY "Pedido_linea: select visibles"
ON public.pedido_linea
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pedidos p
    WHERE p.id = pedido_linea.pedidoid
  )
);

DROP POLICY IF EXISTS "Pedido_linea: insert visibles" ON public.pedido_linea;
CREATE POLICY "Pedido_linea: insert visibles"
ON public.pedido_linea
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.pedidos p
    WHERE p.id = pedido_linea.pedidoid
  )
);

DROP POLICY IF EXISTS "Pedido_linea: update visibles" ON public.pedido_linea;
CREATE POLICY "Pedido_linea: update visibles"
ON public.pedido_linea
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pedidos p
    WHERE p.id = pedido_linea.pedidoid
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.pedidos p
    WHERE p.id = pedido_linea.pedidoid
  )
);

DROP POLICY IF EXISTS "Pedido_linea: delete visibles" ON public.pedido_linea;
CREATE POLICY "Pedido_linea: delete visibles"
ON public.pedido_linea
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pedidos p
    WHERE p.id = pedido_linea.pedidoid
  )
);

-- PEDIDO_LINEA_CENTRO
ALTER TABLE public.pedido_linea_centro ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Pedido_linea_centro: select visibles" ON public.pedido_linea_centro;
CREATE POLICY "Pedido_linea_centro: select visibles"
ON public.pedido_linea_centro
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pedido_linea pl
    JOIN public.pedidos p ON p.id = pl.pedidoid
    WHERE pl.pedidodetid = pedido_linea_centro.pedidodetid
  )
);

DROP POLICY IF EXISTS "Pedido_linea_centro: insert visibles" ON public.pedido_linea_centro;
CREATE POLICY "Pedido_linea_centro: insert visibles"
ON public.pedido_linea_centro
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.pedido_linea pl
    JOIN public.pedidos p ON p.id = pl.pedidoid
    WHERE pl.pedidodetid = pedido_linea_centro.pedidodetid
  )
);

DROP POLICY IF EXISTS "Pedido_linea_centro: update visibles" ON public.pedido_linea_centro;
CREATE POLICY "Pedido_linea_centro: update visibles"
ON public.pedido_linea_centro
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pedido_linea pl
    JOIN public.pedidos p ON p.id = pl.pedidoid
    WHERE pl.pedidodetid = pedido_linea_centro.pedidodetid
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.pedido_linea pl
    JOIN public.pedidos p ON p.id = pl.pedidoid
    WHERE pl.pedidodetid = pedido_linea_centro.pedidodetid
  )
);

DROP POLICY IF EXISTS "Pedido_linea_centro: delete visibles" ON public.pedido_linea_centro;
CREATE POLICY "Pedido_linea_centro: delete visibles"
ON public.pedido_linea_centro
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pedido_linea pl
    JOIN public.pedidos p ON p.id = pl.pedidoid
    WHERE pl.pedidodetid = pedido_linea_centro.pedidodetid
  )
);

-- CAMBIOS_PEDIDOS (cabecera de cambios)
ALTER TABLE public.cambios_pedidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cambios_pedidos: select visibles" ON public.cambios_pedidos;
CREATE POLICY "Cambios_pedidos: select visibles"
ON public.cambios_pedidos
FOR SELECT
TO authenticated
USING (public.is_cliente_visible(clienteid));

DROP POLICY IF EXISTS "Cambios_pedidos: insert visibles" ON public.cambios_pedidos;
CREATE POLICY "Cambios_pedidos: insert visibles"
ON public.cambios_pedidos
FOR INSERT
TO authenticated
WITH CHECK (public.is_cliente_visible(clienteid));

DROP POLICY IF EXISTS "Cambios_pedidos: update visibles" ON public.cambios_pedidos;
CREATE POLICY "Cambios_pedidos: update visibles"
ON public.cambios_pedidos
FOR UPDATE
TO authenticated
USING (public.is_cliente_visible(clienteid))
WITH CHECK (public.is_cliente_visible(clienteid));

DROP POLICY IF EXISTS "Cambios_pedidos: delete visibles" ON public.cambios_pedidos;
CREATE POLICY "Cambios_pedidos: delete visibles"
ON public.cambios_pedidos
FOR DELETE
TO authenticated
USING (public.is_cliente_visible(clienteid));

-- CAMBIOS_PEDIDO_LINEA
ALTER TABLE public.cambios_pedido_linea ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cambios_pedido_linea: select visibles" ON public.cambios_pedido_linea;
CREATE POLICY "Cambios_pedido_linea: select visibles"
ON public.cambios_pedido_linea
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cambios_pedidos cp
    WHERE cp.id = cambios_pedido_linea.pedidoid
  )
);

DROP POLICY IF EXISTS "Cambios_pedido_linea: insert visibles" ON public.cambios_pedido_linea;
CREATE POLICY "Cambios_pedido_linea: insert visibles"
ON public.cambios_pedido_linea
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cambios_pedidos cp
    WHERE cp.id = cambios_pedido_linea.pedidoid
  )
);

DROP POLICY IF EXISTS "Cambios_pedido_linea: update visibles" ON public.cambios_pedido_linea;
CREATE POLICY "Cambios_pedido_linea: update visibles"
ON public.cambios_pedido_linea
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cambios_pedidos cp
    WHERE cp.id = cambios_pedido_linea.pedidoid
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cambios_pedidos cp
    WHERE cp.id = cambios_pedido_linea.pedidoid
  )
);

DROP POLICY IF EXISTS "Cambios_pedido_linea: delete visibles" ON public.cambios_pedido_linea;
CREATE POLICY "Cambios_pedido_linea: delete visibles"
ON public.cambios_pedido_linea
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cambios_pedidos cp
    WHERE cp.id = cambios_pedido_linea.pedidoid
  )
);

-- CAMBIOS_PEDIDO_LINEA_CENTRO
ALTER TABLE public.cambios_pedido_linea_centro ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cambios_pedido_linea_centro: select visibles" ON public.cambios_pedido_linea_centro;
CREATE POLICY "Cambios_pedido_linea_centro: select visibles"
ON public.cambios_pedido_linea_centro
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cambios_pedido_linea cpl
    JOIN public.cambios_pedidos cp ON cp.id = cpl.pedidoid
    WHERE cpl.pedidodetid = cambios_pedido_linea_centro.pedidodetid
  )
);

DROP POLICY IF EXISTS "Cambios_pedido_linea_centro: insert visibles" ON public.cambios_pedido_linea_centro;
CREATE POLICY "Cambios_pedido_linea_centro: insert visibles"
ON public.cambios_pedido_linea_centro
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cambios_pedido_linea cpl
    JOIN public.cambios_pedidos cp ON cp.id = cpl.pedidoid
    WHERE cpl.pedidodetid = cambios_pedido_linea_centro.pedidodetid
  )
);

DROP POLICY IF EXISTS "Cambios_pedido_linea_centro: update visibles" ON public.cambios_pedido_linea_centro;
CREATE POLICY "Cambios_pedido_linea_centro: update visibles"
ON public.cambios_pedido_linea_centro
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cambios_pedido_linea cpl
    JOIN public.cambios_pedidos cp ON cp.id = cpl.pedidoid
    WHERE cpl.pedidodetid = cambios_pedido_linea_centro.pedidodetid
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cambios_pedido_linea cpl
    JOIN public.cambios_pedidos cp ON cp.id = cpl.pedidoid
    WHERE cpl.pedidodetid = cambios_pedido_linea_centro.pedidodetid
  )
);

DROP POLICY IF EXISTS "Cambios_pedido_linea_centro: delete visibles" ON public.cambios_pedido_linea_centro;
CREATE POLICY "Cambios_pedido_linea_centro: delete visibles"
ON public.cambios_pedido_linea_centro
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cambios_pedido_linea cpl
    JOIN public.cambios_pedidos cp ON cp.id = cpl.pedidoid
    WHERE cpl.pedidodetid = cambios_pedido_linea_centro.pedidodetid
  )
);

-- ARCHIVOS_PDF
ALTER TABLE public.archivos_pdf ENABLE ROW LEVEL SECURITY;

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
);

-- Insert de PDFs: permitido para usuarios autenticados (se controla el acceso real por referencia en pedidos/cambios)
DROP POLICY IF EXISTS "Archivos_pdf: insert" ON public.archivos_pdf;
CREATE POLICY "Archivos_pdf: insert"
ON public.archivos_pdf
FOR INSERT
TO authenticated
WITH CHECK (auth.role() = 'authenticated'::text);

-- Updates/deletes de PDFs: restringidos a admin para evitar borrados accidentales con deduplicación.
DROP POLICY IF EXISTS "Archivos_pdf: update admin" ON public.archivos_pdf;
CREATE POLICY "Archivos_pdf: update admin"
ON public.archivos_pdf
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Archivos_pdf: delete admin" ON public.archivos_pdf;
CREATE POLICY "Archivos_pdf: delete admin"
ON public.archivos_pdf
FOR DELETE
TO authenticated
USING (public.is_admin());

