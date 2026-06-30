-- Paginacion server-side para Actividad Operativa Reciente (Administracion > Empleados).

create index if not exists idx_cambios_revisado_en_por
  on public.cambios_pedidos (revisado_en desc, revisado_por)
  where revisado_en is not null
    and revisado_por is not null;

create index if not exists idx_pedidos_enviado_en_por
  on public.pedidos (enviado_en desc, enviado_por)
  where enviado_en is not null
    and enviado_por is not null;

create index if not exists idx_cuentaventas_enviado_en_por
  on public.cuentaventas (enviado_en desc, enviado_por)
  where enviado_en is not null
    and enviado_por is not null;

drop function if exists public.get_operational_activity_page(
  timestamptz,
  timestamptz,
  integer,
  integer
);

create or replace function public.get_operational_activity_page(
  p_start timestamptz,
  p_end timestamptz default null,
  p_page integer default 1,
  p_page_size integer default 10
)
returns table (
  row_type text,
  total_items integer,
  row_sort_date timestamptz,
  row_json jsonb
)
language plpgsql
stable
as $$
declare
  v_start timestamptz := coalesce(p_start, '-infinity'::timestamptz);
  v_end timestamptz := coalesce(p_end, now());
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := greatest(least(coalesce(p_page_size, 10), 100), 1);
  v_offset integer := (v_page - 1) * v_page_size;
begin
  return query
  with events as (
    select
      c.revisado_en as row_sort_date,
      jsonb_build_object(
        'event_key', 'cambio-' || c.id::text || '-' || extract(epoch from c.revisado_en)::bigint::text,
        'timestamp', c.revisado_en,
        'module', 'Cambios',
        'action', 'Cambio revisado',
        'record',
          case
            when nullif(btrim(coalesce(c.referencia_cliente, '')), '') is not null
              then '#' || c.id::text || ' · ' || btrim(c.referencia_cliente)
            else '#' || c.id::text
          end,
        'clienteid', c.clienteid,
        'user_id', c.revisado_por::text
      ) as row_json
    from public.cambios_pedidos c
    where c.revisado_en is not null
      and c.revisado_por is not null
      and c.revisado_en >= v_start
      and c.revisado_en <= v_end

    union all

    select
      p.enviado_en as row_sort_date,
      jsonb_build_object(
        'event_key', 'pedido-' || p.id::text || '-' || extract(epoch from p.enviado_en)::bigint::text,
        'timestamp', p.enviado_en,
        'module', 'Pedidos',
        'action', case when p.tipo_pedido = 'P22E' then 'Previsión enviada' else 'Pedido enviado' end,
        'record',
          case
            when nullif(btrim(coalesce(p.referencia_cliente, '')), '') is not null
              then '#' || p.id::text || ' · ' || btrim(p.referencia_cliente)
            else '#' || p.id::text
          end,
        'clienteid', p.clienteid,
        'user_id', p.enviado_por::text
      ) as row_json
    from public.pedidos p
    where p.enviado_en is not null
      and p.enviado_por is not null
      and p.enviado_en >= v_start
      and p.enviado_en <= v_end

    union all

    select
      cv.enviado_en as row_sort_date,
      jsonb_build_object(
        'event_key', 'cuenta-' || cv.id::text || '-' || extract(epoch from cv.enviado_en)::bigint::text,
        'timestamp', cv.enviado_en,
        'module', 'Cuentas',
        'action', 'Cuenta enviada a Ceox',
        'record',
          coalesce(
            nullif(btrim(coalesce(cv.numero_cuentaventa, '')), ''),
            '#' || cv.id::text
          )
          || case
            when cv.idcuentaventa_orizon is not null then ' · Ceox ' || cv.idcuentaventa_orizon::text
            else ''
          end,
        'clienteid', cv.clienteid,
        'user_id', cv.enviado_por::text
      ) as row_json
    from public.cuentaventas cv
    where cv.enviado_en is not null
      and cv.enviado_por is not null
      and cv.enviado_en >= v_start
      and cv.enviado_en <= v_end
  ),
  totals as (
    select count(*)::integer as total_items
    from events
  ),
  ordered as (
    select
      e.row_sort_date,
      e.row_json,
      row_number() over (
        order by
          e.row_sort_date desc nulls last,
          e.row_json ->> 'event_key' asc
      )::integer as rn
    from events e
  ),
  page_rows as (
    select
      t.total_items,
      o.row_sort_date,
      o.row_json
    from ordered o
    cross join totals t
    where o.rn > v_offset
      and o.rn <= (v_offset + v_page_size)
  )
  select *
  from (
    select
      'meta'::text as row_type,
      t.total_items,
      null::timestamptz as row_sort_date,
      null::jsonb as row_json
    from totals t

    union all

    select
      'item'::text as row_type,
      p.total_items,
      p.row_sort_date,
      p.row_json
    from page_rows p
  ) result_rows
  order by
    case when result_rows.row_type = 'meta' then 0 else 1 end,
    result_rows.row_sort_date desc nulls last;
end;
$$;

comment on function public.get_operational_activity_page(
  timestamptz,
  timestamptz,
  integer,
  integer
)
is 'Devuelve una pagina de actividad operativa (cambios, pedidos y cuentas) con fila meta de total_items y filas item ordenadas por fecha desc.';
