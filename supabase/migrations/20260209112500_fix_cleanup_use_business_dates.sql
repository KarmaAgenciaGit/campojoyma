-- Ajusta la limpieza automática para usar fechas de negocio
-- en lugar de la fecha técnica de inserción.
create or replace function public.delete_old_orders_and_changes()
returns void
language plpgsql
as $function$
declare
  cutoff_date date := (current_date - interval '1 month')::date;
begin
  -- 1) Borrar cambios antiguos por fecha de negocio
  delete from public.cambios_pedidos cp
  where coalesce(cp.fecha_pedido, cp.fecha_carga, cp.fecha::date, cp.created_at::date) < cutoff_date;

  -- 2) Borrar pedidos/previsiones antiguos por fecha de negocio
  delete from public.pedidos p
  where coalesce(p.fecha_pedido, p.fecha_carga, p.fecha::date, p.created_at::date) < cutoff_date;

  -- Opcional: limpieza de PDFs sin referencias
  -- delete from public.archivos_pdf ap
  -- where not exists (select 1 from public.pedidos p2 where p2.archivo_pdf_id = ap.id)
  --   and not exists (select 1 from public.cambios_pedidos cp2 where cp2.archivo_pdf_id = ap.id);
end;
$function$;

comment on function public.delete_old_orders_and_changes()
is 'Elimina pedidos/previsiones y cambios con antiguedad > 1 mes usando fecha de negocio (fecha_pedido/fecha_carga) con fallback tecnico.';
