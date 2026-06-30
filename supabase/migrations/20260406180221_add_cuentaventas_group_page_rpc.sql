create index if not exists idx_cuentaventas_group_page
  on public.cuentaventas (archivo_pdf_id, llegada_correo desc, created_at desc);

create index if not exists idx_cuentaventa_detalle_cuentaventa_id
  on public.cuentaventa_detalle (cuentaventa_id);

drop function if exists public.get_cuentaventas_group_page(
  integer,
  integer,
  text,
  text,
  bigint,
  text,
  text,
  text,
  date,
  date,
  bigint[]
);

create or replace function public.get_cuentaventas_group_page(
  p_page integer default 1,
  p_page_size integer default 10,
  p_order text default 'date_desc',
  p_search text default null,
  p_cliente_id bigint default null,
  p_ceox_status text default 'all',
  p_alert_filter text default 'all',
  p_detalle_filter text default 'all',
  p_fecha_from date default null,
  p_fecha_to date default null,
  p_search_cliente_ids bigint[] default null
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
  v_offset integer := (v_page - 1) * v_page_size;
  v_order text := case lower(coalesce(p_order, 'date_desc'))
    when 'date_asc' then 'date_asc'
    when 'numero_asc' then 'numero_asc'
    when 'numero_desc' then 'numero_desc'
    else 'date_desc'
  end;
  v_search text := nullif(btrim(p_search), '');
  v_ceox_status text := case lower(coalesce(p_ceox_status, 'all'))
    when 'in_ceox' then 'in_ceox'
    when 'not_in_ceox' then 'not_in_ceox'
    else 'all'
  end;
  v_alert_filter text := case lower(coalesce(p_alert_filter, 'all'))
    when 'errors' then 'errors'
    when 'warnings' then 'warnings'
    when 'clean' then 'clean'
    else 'all'
  end;
  v_detalle_filter text := case lower(coalesce(p_detalle_filter, 'all'))
    when 'with' then 'with'
    when 'without' then 'without'
    else 'all'
  end;
  v_search_cliente_ids bigint[] := case
    when p_search_cliente_ids is null or cardinality(p_search_cliente_ids) = 0 then null
    else p_search_cliente_ids
  end;
begin
  return query
  with detail_flags as (
    select distinct
      cd.cuentaventa_id,
      true as has_details
    from public.cuentaventa_detalle cd
  ),
  pdf_detail_flags as (
    select
      cv.archivo_pdf_id,
      bool_or(not coalesce(df.has_details, false)) as pdf_has_missing_details
    from public.cuentaventas cv
    left join detail_flags df on df.cuentaventa_id = cv.id
    where cv.archivo_pdf_id is not null
    group by cv.archivo_pdf_id
  ),
  pdf_error_flags as (
    select
      e.archivo_pdf_id,
      bool_or(coalesce(e.codigo, '') in ('SIN_LINEAS', 'SIN_DETALLES')) as has_warning_error,
      bool_or(coalesce(e.codigo, '') not in ('SIN_LINEAS', 'SIN_DETALLES')) as has_critical_error
    from public.cuentaventa_errores e
    where e.archivo_pdf_id is not null
    group by e.archivo_pdf_id
  ),
  enriched as (
    select
      cv.id,
      cv.archivo_pdf_id,
      cv.numero_cuentaventa,
      cv.fechavaloracion,
      cv.created_at,
      cv.llegada_correo,
      cv.externo_id,
      cv.idcuentaventa_orizon,
      cv.clienteid,
      cv.observaciones_valoracion,
      coalesce(df.has_details, false) as has_details,
      case
        when cv.archivo_pdf_id is null then not coalesce(df.has_details, false)
        else coalesce(pdf_df.pdf_has_missing_details, false) or coalesce(pdf_ef.has_warning_error, false)
      end as has_warning,
      case
        when cv.archivo_pdf_id is null then false
        else coalesce(pdf_ef.has_critical_error, false)
      end as has_error,
      coalesce(cv.llegada_correo, cv.created_at) as row_sort_date,
      coalesce(nullif(btrim(cv.numero_cuentaventa), ''), cv.id::text) as row_sort_number,
      case when cv.archivo_pdf_id is null then '__null__' else cv.archivo_pdf_id::text end as group_key
    from public.cuentaventas cv
    left join detail_flags df on df.cuentaventa_id = cv.id
    left join pdf_detail_flags pdf_df on pdf_df.archivo_pdf_id = cv.archivo_pdf_id
    left join pdf_error_flags pdf_ef on pdf_ef.archivo_pdf_id = cv.archivo_pdf_id
  ),
  filtered as (
    select e.*
    from enriched e
    where (
        v_search is null
        or coalesce(e.numero_cuentaventa, '') ilike '%' || v_search || '%'
        or coalesce(e.externo_id::text, '') ilike '%' || v_search || '%'
        or coalesce(e.idcuentaventa_orizon::text, '') ilike '%' || v_search || '%'
        or e.id::text ilike '%' || v_search || '%'
        or coalesce(e.observaciones_valoracion, '') ilike '%' || v_search || '%'
        or (v_search_cliente_ids is not null and e.clienteid = any(v_search_cliente_ids))
      )
      and (p_cliente_id is null or e.clienteid = p_cliente_id)
      and (
        v_ceox_status = 'all'
        or (v_ceox_status = 'in_ceox' and e.idcuentaventa_orizon is not null)
        or (v_ceox_status = 'not_in_ceox' and e.idcuentaventa_orizon is null)
      )
      and (
        v_alert_filter = 'all'
        or (v_alert_filter = 'errors' and e.has_error)
        or (v_alert_filter = 'warnings' and e.has_warning)
        or (v_alert_filter = 'clean' and not e.has_error and not e.has_warning)
      )
      and (
        v_detalle_filter = 'all'
        or (v_detalle_filter = 'with' and e.has_details)
        or (v_detalle_filter = 'without' and not e.has_details)
      )
      and (p_fecha_from is null or coalesce(e.fechavaloracion::date, e.created_at::date) >= p_fecha_from)
      and (p_fecha_to is null or coalesce(e.fechavaloracion::date, e.created_at::date) <= p_fecha_to)
  ),
  grouped as (
    select
      f.group_key,
      max(f.row_sort_date) as group_sort_date,
      min(f.row_sort_number) as group_number_min,
      max(f.row_sort_number) as group_number_max
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
          case when v_order = 'date_asc' then g.group_sort_date end asc nulls first,
          case when v_order = 'date_desc' then g.group_sort_date end desc nulls last,
          case when v_order = 'numero_asc' then g.group_number_min end asc nulls first,
          case when v_order = 'numero_desc' then g.group_number_max end desc nulls last,
          g.group_sort_date desc nulls last,
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
      jsonb_build_object('id', f.id) as row_json
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
    case when result_rows.row_type = 'item' and v_order = 'date_asc' then result_rows.row_sort_date end asc nulls first,
    case when result_rows.row_type = 'item' and v_order = 'date_desc' then result_rows.row_sort_date end desc nulls last,
    case when result_rows.row_type = 'item' and v_order = 'numero_asc' then result_rows.row_json ->> 'id' end asc,
    case when result_rows.row_type = 'item' and v_order = 'numero_desc' then result_rows.row_json ->> 'id' end desc;
end;
$$;

comment on function public.get_cuentaventas_group_page(
  integer,
  integer,
  text,
  text,
  bigint,
  text,
  text,
  text,
  date,
  date,
  bigint[]
)
is 'Devuelve una pagina de cuentas de venta agrupada por PDF sin partir grupos, con filtros operativos y fila meta con totales.';
