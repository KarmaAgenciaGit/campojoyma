-- Configuración de comportamiento por cliente para eliminar hardcodes (ej. clienteid 1873)

CREATE TABLE IF NOT EXISTS public.cliente_behavior_rules (
  clienteid bigint PRIMARY KEY,
  allow_duplicate_reference boolean NOT NULL DEFAULT false,
  block_duplicate_reference_same_pdf boolean NOT NULL DEFAULT false,
  use_lot_labels boolean NOT NULL DEFAULT false,
  clear_reference_in_orizon_payload boolean NOT NULL DEFAULT false,
  map_reference_to_nlote_in_orizon boolean NOT NULL DEFAULT false,
  clear_references_in_picking boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.cliente_behavior_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cliente behavior rules readable by authenticated" ON public.cliente_behavior_rules;
CREATE POLICY "Cliente behavior rules readable by authenticated"
ON public.cliente_behavior_rules
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Admins can manage cliente behavior rules" ON public.cliente_behavior_rules;
CREATE POLICY "Admins can manage cliente behavior rules"
ON public.cliente_behavior_rules
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP TRIGGER IF EXISTS update_cliente_behavior_rules_updated_at ON public.cliente_behavior_rules;
CREATE TRIGGER update_cliente_behavior_rules_updated_at
  BEFORE UPDATE ON public.cliente_behavior_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.is_cliente_reference_duplicate_allowed(_clienteid bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (
      SELECT r.allow_duplicate_reference
      FROM public.cliente_behavior_rules r
      WHERE r.clienteid = _clienteid
    ),
    false
  );
$$;

-- Reemplaza la restricción fija basada en clienteid 1873 por validación dinámica.
DROP INDEX IF EXISTS public.pedidos_referencia_unique_p220;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_p220_reference()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  duplicate_id bigint;
  duplicates_allowed boolean;
BEGIN
  IF NEW.tipo_pedido IS DISTINCT FROM 'P220' THEN
    RETURN NEW;
  END IF;

  IF NEW.referencia_cliente IS NULL OR btrim(NEW.referencia_cliente) = '' THEN
    RETURN NEW;
  END IF;

  duplicates_allowed := public.is_cliente_reference_duplicate_allowed(NEW.clienteid);

  IF duplicates_allowed THEN
    RETURN NEW;
  END IF;

  -- Evita carreras entre inserciones concurrentes con misma referencia.
  PERFORM pg_advisory_xact_lock(hashtextextended('P220:' || NEW.referencia_cliente, 0));

  SELECT p.id
  INTO duplicate_id
  FROM public.pedidos p
  WHERE p.tipo_pedido = 'P220'
    AND p.referencia_cliente = NEW.referencia_cliente
    AND p.referencia_cliente IS NOT NULL
    AND btrim(p.referencia_cliente) <> ''
    AND p.id IS DISTINCT FROM NEW.id
    AND NOT public.is_cliente_reference_duplicate_allowed(p.clienteid)
  LIMIT 1;

  IF duplicate_id IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate key value violates unique constraint "pedidos_referencia_unique_p220"'
      USING ERRCODE = '23505',
            DETAIL = format('(referencia_cliente)=(%s) already exists.', NEW.referencia_cliente);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_p220_reference ON public.pedidos;
CREATE TRIGGER trg_prevent_duplicate_p220_reference
  BEFORE INSERT OR UPDATE OF tipo_pedido, referencia_cliente, clienteid ON public.pedidos
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_p220_reference();

-- Seed inicial para mantener comportamiento histórico de Rosegar (clienteid 1873).
INSERT INTO public.cliente_behavior_rules (
  clienteid,
  allow_duplicate_reference,
  block_duplicate_reference_same_pdf,
  use_lot_labels,
  clear_reference_in_orizon_payload,
  map_reference_to_nlote_in_orizon,
  clear_references_in_picking
)
VALUES (
  1873,
  true,
  true,
  true,
  true,
  true,
  true
)
ON CONFLICT (clienteid) DO UPDATE
SET allow_duplicate_reference = EXCLUDED.allow_duplicate_reference,
    block_duplicate_reference_same_pdf = EXCLUDED.block_duplicate_reference_same_pdf,
    use_lot_labels = EXCLUDED.use_lot_labels,
    clear_reference_in_orizon_payload = EXCLUDED.clear_reference_in_orizon_payload,
    map_reference_to_nlote_in_orizon = EXCLUDED.map_reference_to_nlote_in_orizon,
    clear_references_in_picking = EXCLUDED.clear_references_in_picking,
    updated_at = now();
