-- Agrega filtro "en Ceox desactualizado" a la paginacion agrupada de pedidos.

drop function if exists public.get_pedidos_group_page(
  text,
  integer,
  integer,
  text,
  text,
  bigint,
  bigint,
  date,
  date,
  date,
  date,
  boolean,
  boolean,
  boolean,
  boolean
);

drop function if exists public.get_pedidos_group_page(
  text,
  integer,
  integer,
  text,
  text,
  bigint,
  bigint,
  date,
  date,
  date,
  date,
  boolean,
  boolean,
  boolean,
  boolean,
  text
);

drop function if exists public.get_pedidos_group_page(
  text,
  integer,
  integer,
  text,
  text,
  bigint,
  bigint,
  date,
  date,
  date,
  date,
  boolean,
  boolean,
  boolean,
  boolean,
  text,
  text
);

create or replace function public.get_pedidos_group_page(
  p_tipo_pedido text,
  p_page integer default 1,
  p_page_size integer default 10,
  p_order text default 'desc',
  p_referencia text default null,
  p_cliente_id bigint default null,
  p_domicilio_destino_id bigint default null,
  p_fecha_pedido_from date default null,
  p_fecha_pedido_to date default null,
  p_fecha_carga_from date default null,
  p_fecha_carga_to date default null,
  p_en_orizon boolean default false,
  p_tiene_matricula boolean default false,
  p_tiene_cambio boolean default false,
  p_tiene_prevision boolean default false,
  p_sort_by text default 'business_date',
  p_ceox_status text default 'all'
)
returns table (
  row_type text,
  total_groups integer,
  total_items integer,
  group_key text,
  group_rank integer,
  group_sort_date timestamptz,
  row_sort_date timestamptz,
  row_json jsonb
)
language plpgsql
stable
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := greatest(least(coalesce(p_page_size, 10), 200), 1);
  v_offset integer := (greatest(coalesce(p_page, 1), 1) - 1) * greatest(least(coalesce(p_page_size, 10), 200), 1);
  v_order text := case when lower(coalesce(p_order, 'desc')) = 'asc' then 'asc' else 'desc' end;
  v_referencia text := nullif(btrim(p_referencia), '');
  v_sort_by text := case
    when lower(coalesce(p_sort_by, 'business_date')) in ('email_arrival', 'created_at', 'llegada_correo') then 'email_arrival'
    else 'business_date'
  end;
  v_ceox_status text := case
    when lower(coalesce(p_ceox_status, '')) = 'in_ceox' then 'in_ceox'
    when lower(coalesce(p_ceox_status, '')) = 'not_in_ceox' then 'not_in_ceox'
    when lower(coalesce(p_ceox_status, '')) = 'in_ceox_outdated' then 'in_ceox_outdated'
    when lower(coalesce(p_ceox_status, '')) = 'all' and coalesce(p_en_orizon, false) then 'in_ceox'
    when lower(coalesce(p_ceox_status, '')) = 'all' then 'all'
    when coalesce(p_en_orizon, false) then 'in_ceox'
    else 'all'
  end;
begin
  return query
  with filtered as (
    select
      p.*,
      case when p.archivo_pdf_id is null then '__null__' else p.archivo_pdf_id::text end as group_key,
      case
        when v_sort_by = 'email_arrival' then p.created_at
        else coalesce(
          p.fecha_pedido::timestamptz,
          p.fecha_carga::timestamptz,
          p.fecha::timestamptz,
          p.created_at
        )
      end as row_sort_date
    from public.pedidos p
    where p.tipo_pedido = p_tipo_pedido
      and (
        v_referencia is null
        or coalesce(p.referencia_cliente, '') ilike '%' || v_referencia || '%'
        or coalesce(p.referencia2_cliente, '') ilike '%' || v_referencia || '%'
      )
      and (p_cliente_id is null or p.clienteid = p_cliente_id)
      and (p_domicilio_destino_id is null or p.sujetodomicilioid_destino = p_domicilio_destino_id)
      and (p_fecha_pedido_from is null or p.fecha_pedido is null or p.fecha_pedido::date >= p_fecha_pedido_from)
      and (p_fecha_pedido_to is null or p.fecha_pedido is null or p.fecha_pedido::date <= p_fecha_pedido_to)
      and (p_fecha_carga_from is null or p.fecha_carga is null or p.fecha_carga::date >= p_fecha_carga_from)
      and (p_fecha_carga_to is null or p.fecha_carga is null or p.fecha_carga::date <= p_fecha_carga_to)
      and (
        v_ceox_status = 'all'
        or (
          v_ceox_status = 'in_ceox'
          and (
            p.idpedido_orizon is not null
            or nullif(btrim(coalesce(p.pedidoclienteid::text, '')), '') is not null
          )
        )
        or (
          v_ceox_status = 'not_in_ceox'
          and not (
            p.idpedido_orizon is not null
            or nullif(btrim(coalesce(p.pedidoclienteid::text, '')), '') is not null
          )
        )
        or (
          v_ceox_status = 'in_ceox_outdated'
          and (
            p.idpedido_orizon is not null
            or nullif(btrim(coalesce(p.pedidoclienteid::text, '')), '') is not null
          )
          and coalesce(p.needs_sync, false)
        )
      )
      and (
        not coalesce(p_tiene_matricula, false)
        or nullif(btrim(coalesce(p.matricula_tractora, '')), '') is not null
        or nullif(btrim(coalesce(p.matricula_remolque, '')), '') is not null
      )
      and (
        not coalesce(p_tiene_prevision, false)
        or p.tipo_pedido <> 'P220'
        or exists (
          select 1
          from public.pedidos p2
          where p2.tipo_pedido = 'P22E'
            and p2.clienteid is not distinct from p.clienteid
            and p2.sujetodomicilioid_destino is not distinct from p.sujetodomicilioid_destino
            and p2.fecha_carga is not distinct from p.fecha_carga
        )
      )
      and (
        not coalesce(p_tiene_cambio, false)
        or exists (
          select 1
          from public.cambios_pedidos c
          where c.tipo_pedido = p.tipo_pedido
            and (
              (
                p.idpedido_orizon is not null
                and c.idpedido_orizon = p.idpedido_orizon
              )
              or (
                p.tipo_pedido = 'P220'
                and nullif(btrim(coalesce(p.referencia_cliente, '')), '') is not null
                and c.referencia_cliente = p.referencia_cliente
              )
              or (
                p.tipo_pedido = 'P22E'
                and c.clienteid is not distinct from p.clienteid
                and c.sujetodomicilioid_destino is not distinct from p.sujetodomicilioid_destino
                and c.fecha_carga is not distinct from p.fecha_carga
              )
            )
        )
      )
  ),
  grouped as (
    select
      f.group_key,
      case
        when v_order = 'asc' then min(f.row_sort_date)
        else max(f.row_sort_date)
      end as group_sort_date
    from filtered f
    group by f.group_key
  ),
  item_totals as (
    select count(*)::integer as total_items from filtered
  ),
  group_totals as (
    select count(*)::integer as total_groups from grouped
  ),
  ordered_groups as (
    select
      g.group_key,
      g.group_sort_date,
      row_number() over (
        order by
          case when v_order = 'asc' then g.group_sort_date end asc nulls first,
          case when v_order <> 'asc' then g.group_sort_date end desc nulls last,
          g.group_key asc
      )::integer as group_rank
    from grouped g
  ),
  page_groups as (
    select og.*
    from ordered_groups og
    where og.group_rank > v_offset
      and og.group_rank <= (v_offset + v_page_size)
  ),
  item_rows as (
    select
      gt.total_groups,
      it.total_items,
      pg.group_key,
      pg.group_rank,
      pg.group_sort_date,
      f.row_sort_date,
      to_jsonb(f) - 'group_key' - 'row_sort_date' as row_json
    from page_groups pg
    join filtered f on f.group_key = pg.group_key
    cross join item_totals it
    cross join group_totals gt
  ),
  meta_row as (
    select
      gt.total_groups,
      it.total_items
    from item_totals it
    cross join group_totals gt
  )
  select *
  from (
    select
      'meta'::text as row_type,
      m.total_groups,
      m.total_items,
      null::text as group_key,
      0::integer as group_rank,
      null::timestamptz as group_sort_date,
      null::timestamptz as row_sort_date,
      null::jsonb as row_json
    from meta_row m

    union all

    select
      'item'::text as row_type,
      i.total_groups,
      i.total_items,
      i.group_key,
      i.group_rank,
      i.group_sort_date,
      i.row_sort_date,
      i.row_json
    from item_rows i
  ) result_rows

  order by
    case when result_rows.row_type = 'meta' then 0 else 1 end,
    result_rows.group_rank asc,
    case when result_rows.row_type = 'item' and v_order = 'asc' then result_rows.row_sort_date end asc nulls first,
    case when result_rows.row_type = 'item' and v_order <> 'asc' then result_rows.row_sort_date end desc nulls last;
end;
$$;

comment on function public.get_pedidos_group_page(
  text,
  integer,
  integer,
  text,
  text,
  bigint,
  bigint,
  date,
  date,
  date,
  date,
  boolean,
  boolean,
  boolean,
  boolean,
  text,
  text
)
is 'Devuelve una pagina de pedidos/previsiones agrupada por PDF sin partir grupos, con totales, orden configurable y filtro de estado en Ceox (incluye in_ceox_outdated).';
