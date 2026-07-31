-- Keep the v2 RPC compatible with the v3 ERP identity columns.
-- jsonb_populate_record materializes absent fields as NULL, so table defaults do
-- not apply when the complete composite row is inserted. Set the server-owned
-- values explicitly and ignore any attempt to inject them through p_factura.

create or replace function public.create_factura_recibida_v2(
  p_factura jsonb,
  p_ctb jsonb default '[]'::jsonb,
  p_punteos jsonb default '[]'::jsonb,
  p_actor uuid default null,
  p_request_id uuid default null,
  p_change_source text default 'edge',
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_payload jsonb;
  v_factura public.facturasrecibidas%rowtype;
  v_source_kind text;
  v_snapshot jsonb;
  v_existing_id uuid;
begin
  if p_factura is null or jsonb_typeof(p_factura) <> 'object' then
    raise exception 'INVALID_PAYLOAD: factura debe ser un objeto JSON';
  end if;
  if p_ctb is null or jsonb_typeof(p_ctb) <> 'array' then
    raise exception 'INVALID_PAYLOAD: ctb debe ser un array JSON';
  end if;
  if p_punteos is null or jsonb_typeof(p_punteos) <> 'array' then
    raise exception 'INVALID_PAYLOAD: punteos debe ser un array JSON';
  end if;

  if p_request_id is not null then
    select revision.factura_id
    into v_existing_id
    from public.facturasrecibidas_revisions revision
    where revision.request_id = p_request_id
      and revision.change_type in ('create', 'ingest', 'extract')
    order by revision.created_at
    limit 1;

    if found then
      v_snapshot := public.factura_recibida_snapshot_v2(v_existing_id);
      if v_snapshot is not null then
        return v_snapshot || jsonb_build_object(
          'version', coalesce((v_snapshot#>>'{factura,row_version}')::bigint, 1),
          'request_id', p_request_id,
          'idempotent_replay', true
        );
      end if;
    end if;
  end if;

  v_source_kind := case
    when p_change_source in ('erp_import', 'readback') then 'erp_reference'
    when p_change_source = 'ingest' then 'n8n_draft'
    when p_change_source = 'extract' then 'front_draft'
    else 'manual_draft'
  end;
  v_payload :=
    (
      p_factura
      - array[
        'id',
        'row_version',
        'sync_status',
        'accounting_status',
        'accounting_visible_number',
        'accounting_date',
        'erp_last_read_at',
        'erp_last_read_payload',
        'last_request_id',
        'erp_sent_at',
        'erp_sent_by',
        'erp_response',
        'erp_error',
        'created_at',
        'updated_at',
        'FRR_id',
        'source_kind',
        'remote_frr_id',
        'is_readonly_reference',
        'erp_target_id',
        'erp_dataset_epoch',
        'erp_payload_hash',
        'erp_business_fingerprint',
        'erp_verified_at',
        'erp_reference_status',
        'erp_validation_status',
        'erp_validation_request_id',
        'erp_validated_at',
        'fecha_ctb_source'
      ]
    )
    || jsonb_build_object(
      'id', v_id,
      'estado', coalesce(nullif(p_factura->>'estado', ''), 'pendiente_revision'),
      'source_kind', v_source_kind,
      'remote_frr_id', case
        when v_source_kind = 'erp_reference'
          and coalesce(p_factura->>'remote_frr_id', '') ~ '^[0-9]+$'
          then (p_factura->>'remote_frr_id')::bigint
        else null
      end,
      'match_status', coalesce(nullif(p_factura->>'match_status', ''), 'unmatched'),
      'row_version', 1,
      'sync_status', case when v_source_kind = 'erp_reference' then 'sent' else
        case when coalesce(p_factura->>'estado', '') = 'validada' then 'ready' else 'draft' end
      end,
      'accounting_status', case
        when v_source_kind = 'erp_reference' and coalesce(
          case
            when coalesce(p_factura->>'FRR_IdAsientoNet', '') ~ '^[0-9]+$'
              then (p_factura->>'FRR_IdAsientoNet')::bigint
            else null
          end,
          0
        ) > 0 then 'pending'
        when coalesce(p_factura->>'FRR_Contabilizar', 'N') = 'S' then 'requested'
        else 'not_requested'
      end,
      'is_readonly_reference', case when v_source_kind = 'erp_reference' then true
        else false
      end,
      'erp_target_id', null,
      'erp_dataset_epoch', null,
      'erp_payload_hash', null,
      'erp_business_fingerprint', null,
      'erp_verified_at', null,
      'erp_reference_status', case
        when v_source_kind = 'erp_reference' then 'legacy_unverified'
        else 'unverified'
      end,
      'erp_validation_status', 'not_validated',
      'erp_validation_request_id', null,
      'erp_validated_at', null,
      'fecha_ctb_source', case
        when p_factura->>'fecha_ctb_source' = 'manual' then 'manual'
        else 'invoice_date'
      end,
      'extraction', coalesce(p_factura->'extraction', '{}'::jsonb),
      'validation_errors', coalesce(p_factura->'validation_errors', '[]'::jsonb),
      'match_evidence', coalesce(p_factura->'match_evidence', '{}'::jsonb),
      'created_by', p_actor,
      'updated_by', p_actor,
      'created_at', v_now,
      'updated_at', v_now
    );

  if v_source_kind <> 'erp_reference' then
    v_payload := v_payload - array[
      'FRR_numero',
      'FRR_IdAsientoNet',
      'FRR_IdUsuarioLog',
      'FRR_FechaLog',
      'FRR_HoraLog'
    ];
  end if;

  select *
  into v_factura
  from jsonb_populate_record(null::public.facturasrecibidas, v_payload);

  insert into public.facturasrecibidas
  select (v_factura).*
  returning * into v_factura;

  insert into public.facturasrecibidas_ctb (
    id,
    factura_id,
    posicion,
    "FRC_id",
    "FRC_idfacturarecibida",
    "FRC_Importe",
    "FRC_Cuenta",
    "FRC_IdActividad",
    "FRC_Idseccion",
    "FRC_Iddepartamento",
    "FRC_Idsubdepartamento",
    "FRC_IdUsuarioLog",
    "FRC_FechaLog",
    "FRC_HoraLog",
    created_at,
    updated_at
  )
  select
    gen_random_uuid(),
    v_id,
    item.ordinality::integer,
    case when v_source_kind = 'erp_reference' then row_value."FRC_id" else null end,
    case when v_source_kind = 'erp_reference' then row_value."FRC_idfacturarecibida" else null end,
    coalesce(row_value."FRC_Importe", 0),
    row_value."FRC_Cuenta",
    row_value."FRC_IdActividad",
    row_value."FRC_Idseccion",
    row_value."FRC_Iddepartamento",
    row_value."FRC_Idsubdepartamento",
    case when v_source_kind = 'erp_reference' then row_value."FRC_IdUsuarioLog" else null end,
    case when v_source_kind = 'erp_reference' then row_value."FRC_FechaLog" else null end,
    case when v_source_kind = 'erp_reference' then row_value."FRC_HoraLog" else null end,
    v_now,
    v_now
  from jsonb_array_elements(p_ctb) with ordinality as item(value, ordinality)
  cross join lateral jsonb_populate_record(
    null::public.facturasrecibidas_ctb,
    item.value
  ) as row_value;

  insert into public.facturasrecibidas_punteos (
    id,
    factura_id,
    posicion,
    remote_id,
    "Origen",
    "Serie",
    "Albaran",
    "Ref",
    "Fecha",
    "Importe P",
    "Importe",
    "S",
    "Ver",
    empresa_id,
    proveedor_id,
    cuenta_gasto,
    raw,
    source_table,
    source_id,
    importe_factura,
    line_count,
    source_lines,
    created_at,
    updated_at
  )
  select
    gen_random_uuid(),
    v_id,
    item.ordinality::integer,
    row_value.remote_id,
    row_value."Origen",
    row_value."Serie",
    row_value."Albaran",
    row_value."Ref",
    row_value."Fecha",
    coalesce(row_value."Importe P", 0),
    coalesce(row_value."Importe", 0),
    coalesce(row_value."S", false),
    coalesce(row_value."Ver", false),
    row_value.empresa_id,
    row_value.proveedor_id,
    row_value.cuenta_gasto,
    coalesce(row_value.raw, item.value),
    row_value.source_table,
    row_value.source_id,
    row_value.importe_factura,
    coalesce(row_value.line_count, 0),
    coalesce(row_value.source_lines, '[]'::jsonb),
    v_now,
    v_now
  from jsonb_array_elements(p_punteos) with ordinality as item(value, ordinality)
  cross join lateral jsonb_populate_record(
    null::public.facturasrecibidas_punteos,
    item.value
  ) as row_value;

  v_snapshot := public.factura_recibida_snapshot_v2(v_id);
  insert into public.facturasrecibidas_revisions (
    factura_id,
    revision_number,
    request_id,
    change_type,
    change_source,
    reason,
    changed_by,
    snapshot
  ) values (
    v_id,
    1,
    p_request_id,
    case when p_change_source = 'ingest' then 'ingest'
      when p_change_source = 'extract' then 'extract'
      else 'create'
    end,
    coalesce(nullif(p_change_source, ''), 'edge'),
    p_reason,
    p_actor,
    v_snapshot
  );

  return v_snapshot || jsonb_build_object(
    'version', 1,
    'request_id', p_request_id
  );
end;
$$;
