-- Impide nuevas previsiones (P22E) duplicadas por cliente + domicilio + fecha_carga.
-- No toca filas históricas existentes; actúa sobre nuevas inserciones/actualizaciones de clave.

CREATE OR REPLACE FUNCTION public.prevent_duplicate_p22e_schedule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  duplicate_id bigint;
  lock_key text;
BEGIN
  IF NEW.tipo_pedido IS DISTINCT FROM 'P22E' THEN
    RETURN NEW;
  END IF;

  IF NEW.fecha_carga IS NULL OR NEW.clienteid IS NULL OR NEW.sujetodomicilioid_destino IS NULL THEN
    RETURN NEW;
  END IF;

  -- Evita condiciones de carrera entre inserciones concurrentes de la misma previsión.
  lock_key := format(
    'P22E:%s:%s:%s',
    NEW.clienteid,
    NEW.sujetodomicilioid_destino,
    NEW.fecha_carga
  );
  PERFORM pg_advisory_xact_lock(hashtextextended(lock_key, 0));

  SELECT p.id
  INTO duplicate_id
  FROM public.pedidos p
  WHERE p.tipo_pedido = 'P22E'
    AND p.fecha_carga = NEW.fecha_carga
    AND p.clienteid = NEW.clienteid
    AND p.sujetodomicilioid_destino = NEW.sujetodomicilioid_destino
    AND p.id IS DISTINCT FROM NEW.id
  LIMIT 1;

  IF duplicate_id IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate key value violates unique constraint "pedidos_prevision_unique_cliente_domicilio_fecha_carga"'
      USING ERRCODE = '23505',
            DETAIL = format(
              '(clienteid,sujetodomicilioid_destino,fecha_carga)=(%s,%s,%s) already exists.',
              NEW.clienteid,
              NEW.sujetodomicilioid_destino,
              NEW.fecha_carga
            );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_p22e_schedule ON public.pedidos;
CREATE TRIGGER trg_prevent_duplicate_p22e_schedule
  BEFORE INSERT OR UPDATE OF tipo_pedido, fecha_carga, clienteid, sujetodomicilioid_destino ON public.pedidos
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_p22e_schedule();
