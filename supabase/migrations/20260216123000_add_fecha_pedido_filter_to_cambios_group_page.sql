-- Añade filtro por fecha y hora de pedido al RPC de cambios agrupados por PDF.
create or replace function public.get_cambios_group_page(
  p_page integer default 1,
  p_page_size integer default 10,
  p_order text default 'desc',
  p_referencia text default null,
  p_cliente_id bigint default null,
  p_domicilio_destino_id bigint default null,
  p_tipo_pedido text default null,
  p_revisado text default null,
  p_version text default null,
  p_change_type text default null,
  p_fecha_pedido_from timestamptz default null,
  p_fecha_pedido_to timestamptz default null
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
  v_tipo_pedido text := nullif(btrim(p_tipo_pedido), '');
  v_revisado text := case
    when lower(coalesce(p_revisado, '')) in ('revisado', 'pendiente') then lower(p_revisado)
    else null
  end;
  v_version text := case
    when lower(coalesce(p_version, '')) in ('new', 'old') then lower(p_version)
    else null
  end;
  v_change_type text := case
    when lower(coalesce(p_change_type, '')) in ('nuevo', 'anulacion', 'transportista', 'matricula', 'lineas', 'mixto', 'cabecera', 'legacy')
      then lower(p_change_type)
    else null
  end;
begin
  return query
  with line_meta as (
    select
      src.pedidoid as cambio_id,
      bool_or(src.has_nonempty_meta) as has_line_meta,
      count(*) filter (where src.action_value is not null)::integer as action_count,
      count(*) filter (where src.action_value = 'add')::integer as add_count,
      count(*) filter (where src.action_value = 'cancel')::integer as cancel_count
    from (
      select
        cpl.pedidoid,
        (
          cpl.change_meta is not null
          and jsonb_typeof(cpl.change_meta) = 'object'
          and cpl.change_meta <> '{}'::jsonb
        ) as has_nonempty_meta,
        lower(
          coalesce(
            case
              when cpl.change_meta is not null and jsonb_typeof(cpl.change_meta) = 'object'
                then cpl.change_meta -> '_change' ->> 'action'
              else null
            end,
            nullif(btrim(cpl.accion::text), '')
          )
        ) as action_value
      from public.cambios_pedido_linea cpl
    ) src
    group by src.pedidoid
  ),
  enriched as (
    select
      c.*,
      case when c.archivo_pdf_id is null then '__null__' else c.archivo_pdf_id::text end as group_key,
      coalesce(c.fecha_carga::timestamptz, c.fecha_pedido::timestamptz, c.created_at) as row_sort_date,
      (
        c.change_meta is not null
        and jsonb_typeof(c.change_meta) = 'object'
        and c.change_meta <> '{}'::jsonb
      ) as has_header_meta,
      coalesce(lm.has_line_meta, false) as has_line_meta,
      (
        coalesce(lm.action_count, 0) > 0
        and coalesce(lm.add_count, 0) = coalesce(lm.action_count, 0)
      ) as all_add,
      (
        coalesce(lm.action_count, 0) > 0
        and coalesce(lm.cancel_count, 0) = coalesce(lm.action_count, 0)
      ) as all_cancel,
      (
        coalesce(c.change_meta -> '_change' ->> 'action', '')
      ) as header_action,
      coalesce(
        (
          select array_agg(lower(trim(col)))
          from jsonb_array_elements_text(
            case
              when c.change_meta is not null and jsonb_typeof(c.change_meta) = 'object'
                then coalesce(c.change_meta -> '_change' -> 'columns', '[]'::jsonb)
              else '[]'::jsonb
            end
          ) as cols(col)
        ),
        '{}'
      ) as header_columns,
      (
        coalesce(nullif(btrim(c.matricula_tractora), ''), nullif(btrim(c.matricula_remolque), '')) is not null
      ) as has_matricula_values,
      case
        when coalesce(c.change_meta -> '_match' ->> 'matched_pedido_id', '') ~ '^[0-9]+$'
          then (c.change_meta -> '_match' ->> 'matched_pedido_id')::bigint
        when coalesce(c.change_meta ->> 'matched_pedido_id', '') ~ '^[0-9]+$'
          then (c.change_meta ->> 'matched_pedido_id')::bigint
        else null
      end as manual_match_id
    from public.cambios_pedidos c
    left join line_meta lm on lm.cambio_id = c.id
  ),
  classified as (
    select
      e.*,
      (
        e.has_header_meta
        and e.header_action = 'update'
        and 'transportista' = any(e.header_columns)
      ) as has_transportista_change,
      (
        (
          e.has_header_meta
          and e.header_action = 'update'
          and (
            'matricula' = any(e.header_columns)
            or 'matricula_tractora' = any(e.header_columns)
            or 'matricula_remolque' = any(e.header_columns)
          )
        )
        or ((not e.has_header_meta or coalesce(array_length(e.header_columns, 1), 0) = 0) and e.has_matricula_values)
      ) as has_matricula_change,
      (e.has_line_meta and e.all_add) as is_nuevo_pedido,
      (e.has_line_meta and e.all_cancel) as is_cancelacion
    from enriched e
  ),
  matched as (
    select
      c.*,
      (
        c.manual_match_id is not null
        and exists (
          select 1
          from public.pedidos p
          where p.id = c.manual_match_id
            and p.tipo_pedido = coalesce(c.tipo_pedido, 'P220')
        )
      )
      or (
        c.idpedido_orizon is not null
        and exists (
          select 1
          from public.pedidos p
          where p.tipo_pedido = coalesce(c.tipo_pedido, 'P220')
            and p.idpedido_orizon = c.idpedido_orizon
        )
      )
      or (
        coalesce(c.tipo_pedido, 'P220') = 'P220'
        and c.referencia_cliente is not null
        and btrim(c.referencia_cliente) <> ''
        and exists (
          select 1
          from public.pedidos p
          where p.tipo_pedido = 'P220'
            and p.referencia_cliente = c.referencia_cliente
        )
      )
      or (
        coalesce(c.tipo_pedido, 'P220') = 'P22E'
        and c.clienteid is not null
        and c.sujetodomicilioid_destino is not null
        and c.fecha_carga is not null
        and exists (
          select 1
          from public.pedidos p
          where p.tipo_pedido = 'P22E'
            and p.clienteid = c.clienteid
            and p.sujetodomicilioid_destino = c.sujetodomicilioid_destino
            and p.fecha_carga = c.fecha_carga
        )
      ) as header_matched
    from classified c
  ),
  normalized as (
    select
      m.*,
      (m.has_transportista_change or m.has_matricula_change) as has_header_change,
      case
        when m.is_nuevo_pedido and m.header_matched then 'lineas'
        when m.is_nuevo_pedido then 'nuevo'
        when m.is_cancelacion then 'anulacion'
        when (m.has_transportista_change or m.has_matricula_change) and m.has_line_meta then 'mixto'
        when m.has_transportista_change then 'transportista'
        when m.has_matricula_change then 'matricula'
        when m.has_header_meta and not m.has_line_meta then 'cabecera'
        when m.has_line_meta then 'lineas'
        else 'legacy'
      end as change_kind
    from matched m
  ),
  filtered as (
    select *
    from normalized c
    where (
      v_referencia is null
      or coalesce(c.referencia_cliente, '') ilike '%' || v_referencia || '%'
      or coalesce(c.referencia2_cliente, '') ilike '%' || v_referencia || '%'
    )
      and (p_fecha_pedido_from is null or c.fecha_pedido is null or c.fecha_pedido::timestamptz >= p_fecha_pedido_from)
      and (p_fecha_pedido_to is null or c.fecha_pedido is null or c.fecha_pedido::timestamptz <= p_fecha_pedido_to)
      and (p_cliente_id is null or c.clienteid = p_cliente_id)
      and (p_domicilio_destino_id is null or c.sujetodomicilioid_destino = p_domicilio_destino_id)
      and (v_tipo_pedido is null or c.tipo_pedido = v_tipo_pedido)
      and (
        v_revisado is null
        or (v_revisado = 'revisado' and c.revisado = true)
        or (v_revisado = 'pendiente' and coalesce(c.revisado, false) = false)
      )
      and (
        v_version is null
        or (v_version = 'new' and (c.has_header_meta or c.has_line_meta))
        or (v_version = 'old' and not c.has_header_meta and not c.has_line_meta)
      )
      and (
        v_change_type is null
        or c.change_kind = v_change_type
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
      to_jsonb(f)
        - 'group_key'
        - 'group_sort_date'
        - 'group_rank'
        - 'row_sort_date'
        - 'has_header_meta'
        - 'has_line_meta'
        - 'all_add'
        - 'all_cancel'
        - 'header_action'
        - 'header_columns'
        - 'has_matricula_values'
        - 'manual_match_id'
        - 'has_transportista_change'
        - 'has_matricula_change'
        - 'is_nuevo_pedido'
        - 'is_cancelacion'
        - 'header_matched'
        - 'has_header_change'
        - 'change_kind' as row_json
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

comment on function public.get_cambios_group_page(
  integer, integer, text, text, bigint, bigint, text, text, text, text, timestamptz, timestamptz
)
is 'Devuelve una página de cambios agrupada por PDF sin partir grupos, incluyendo fila meta con totales y filtro por fecha/hora de pedido.';
