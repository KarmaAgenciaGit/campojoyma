-- Las referencias históricas leídas desde Netagro pueden acreditar que la
-- contabilización fue solicitada y que existe un ID técnico, pero no siempre
-- pueden verificar un número visible ni los apuntes del diario. Ese estado no
-- equivale a "pending" ni permite declarar un asiento creado.
alter table public.facturasrecibidas
  drop constraint if exists facturasrecibidas_accounting_status_check;

alter table public.facturasrecibidas
  add constraint facturasrecibidas_accounting_status_check
  check (accounting_status in (
    'not_requested',
    'requested',
    'pending',
    'created',
    'reference_only',
    'error',
    'unknown'
  ));

create or replace function public.import_factura_recibida_reference_v2(
  p_factura jsonb,
  p_ctb jsonb default '[]'::jsonb,
  p_punteos jsonb default '[]'::jsonb,
  p_erp_readback jsonb default '{}'::jsonb,
  p_actor uuid default null,
  p_request_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_remote_id bigint;
  v_header_remote_id bigint;
  v_header_technical_id bigint;
  v_accounting_technical_id bigint;
  v_accounting jsonb;
  v_entries jsonb;
  v_visible_number text;
  v_existing_id uuid;
  v_existing_remote_id bigint;
  v_created jsonb;
  v_factura_id uuid;
  v_factura public.facturasrecibidas%rowtype;
  v_snapshot jsonb;
  v_now timestamptz := now();
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
  if p_erp_readback is null or jsonb_typeof(p_erp_readback) <> 'object' then
    raise exception 'INVALID_PAYLOAD: erp_readback debe ser un objeto JSON';
  end if;
  if p_request_id is null then
    raise exception 'INVALID_PAYLOAD: request_id es requerido';
  end if;

  if coalesce(p_factura->>'remote_frr_id', '') !~ '^[0-9]+$' then
    raise exception 'INVALID_PAYLOAD: remote_frr_id positivo es requerido';
  end if;
  v_remote_id := (p_factura->>'remote_frr_id')::bigint;
  if v_remote_id <= 0 then
    raise exception 'INVALID_PAYLOAD: remote_frr_id positivo es requerido';
  end if;

  if coalesce(p_factura->>'FRR_id', '') !~ '^[0-9]+$' then
    raise exception 'INVALID_PAYLOAD: FRR_id leído de ERP es requerido';
  end if;
  v_header_remote_id := (p_factura->>'FRR_id')::bigint;
  if v_header_remote_id <> v_remote_id then
    raise exception
      'INVALID_READBACK: FRR_id % no coincide con remote_frr_id %',
      v_header_remote_id,
      v_remote_id;
  end if;

  if coalesce(p_factura->>'FRR_Idempresa', '') !~ '^[0-9]+$'
    or coalesce(p_factura->>'FRR_ejercicio', '') !~ '^[0-9]+$'
    or coalesce(p_factura->>'FRR_idproveedor', '') !~ '^[0-9]+$'
    or nullif(btrim(p_factura->>'FRR_numerofactura'), '') is null
  then
    raise exception
      'INVALID_PAYLOAD: empresa, ejercicio, proveedor y número de factura son requeridos';
  end if;

  if coalesce(p_factura->>'FRR_IdAsientoNet', '') !~ '^[0-9]+$' then
    raise exception 'INVALID_READBACK: falta el ID técnico contable';
  end if;
  v_header_technical_id := (p_factura->>'FRR_IdAsientoNet')::bigint;
  if v_header_technical_id <= 0 then
    raise exception 'INVALID_READBACK: el ID técnico contable debe ser positivo';
  end if;

  v_accounting := case
    when jsonb_typeof(p_erp_readback->'accounting') = 'object'
      then p_erp_readback->'accounting'
    else '{}'::jsonb
  end;
  if lower(coalesce(v_accounting->>'status', '')) <> 'reference_only' then
    raise exception 'INVALID_READBACK: accounting.status debe ser reference_only';
  end if;
  if lower(coalesce(v_accounting->>'created', '')) not in ('false', '0', 'n', 'no') then
    raise exception 'INVALID_READBACK: reference_only exige created=false explícito';
  end if;

  v_visible_number := nullif(btrim(coalesce(
    v_accounting->>'visible_number',
    v_accounting->>'numero',
    v_accounting->>'asiento_numero'
  )), '');
  if v_visible_number is not null then
    raise exception
      'INVALID_READBACK: reference_only no puede acreditar número visible de asiento';
  end if;

  if coalesce(
    v_accounting->>'technical_id',
    v_accounting->>'FRR_IdAsientoNet',
    v_accounting->>'id'
  ) !~ '^[0-9]+$' then
    raise exception 'INVALID_READBACK: falta technical_id contable';
  end if;
  v_accounting_technical_id := coalesce(
    v_accounting->>'technical_id',
    v_accounting->>'FRR_IdAsientoNet',
    v_accounting->>'id'
  )::bigint;
  if v_accounting_technical_id <> v_header_technical_id then
    raise exception
      'INVALID_READBACK: technical_id % no coincide con FRR_IdAsientoNet %',
      v_accounting_technical_id,
      v_header_technical_id;
  end if;

  v_entries := case
    when jsonb_typeof(p_erp_readback->'entries') = 'array'
      then p_erp_readback->'entries'
    else '[]'::jsonb
  end;
  if jsonb_array_length(v_entries) <> 0 then
    raise exception
      'INVALID_READBACK: reference_only no permite persistir apuntes como asiento creado';
  end if;

  select revision.factura_id, factura.remote_frr_id
  into v_existing_id, v_existing_remote_id
  from public.facturasrecibidas_revisions revision
  join public.facturasrecibidas factura on factura.id = revision.factura_id
  where revision.request_id = p_request_id
    and revision.change_type = 'create'
    and revision.change_source = 'erp_import'
  order by revision.created_at
  limit 1;

  if found then
    if v_existing_remote_id is distinct from v_remote_id then
      raise exception
        'REQUEST_CONFLICT: request_id ya pertenece a remote_frr_id %',
        v_existing_remote_id;
    end if;
    v_snapshot := public.factura_recibida_snapshot_v2(v_existing_id);
    return v_snapshot || jsonb_build_object(
      'version', coalesce((v_snapshot#>>'{factura,row_version}')::bigint, 1),
      'request_id', p_request_id,
      'idempotent_replay', true,
      'accounting', v_accounting
    );
  end if;

  v_created := public.create_factura_recibida_v2(
    p_factura || jsonb_build_object(
      'estado', 'validada',
      'remote_frr_id', v_remote_id,
      'source_kind', 'erp_reference',
      'is_readonly_reference', true,
      'match_status', 'reference'
    ),
    p_ctb,
    p_punteos,
    p_actor,
    p_request_id,
    'erp_import',
    coalesce(nullif(p_reason, ''), 'Importación de referencia ERP de solo lectura')
  );

  v_factura_id := nullif(v_created#>>'{factura,id}', '')::uuid;
  if v_factura_id is null then
    raise exception 'IMPORT_FAILED: create_factura_recibida_v2 no devolvió factura_id';
  end if;

  update public.facturasrecibidas
  set accounting_status = 'reference_only',
      accounting_visible_number = null,
      accounting_date = null,
      erp_last_read_at = v_now,
      erp_last_read_payload = p_erp_readback,
      row_version = row_version + 1,
      updated_by = p_actor,
      updated_at = v_now
  where id = v_factura_id
    and "FRR_id" is null
    and remote_frr_id = v_remote_id
    and source_kind = 'erp_reference'
    and is_readonly_reference
    and sync_status = 'sent'
  returning * into v_factura;

  if not found then
    raise exception 'IMPORT_FAILED: la referencia ERP creada no cumple las invariantes';
  end if;
  if v_factura."FRR_IdAsientoNet" is distinct from v_header_technical_id then
    raise exception 'IMPORT_FAILED: se perdió el ID técnico contable';
  end if;
  if exists (
    select 1
    from public.facturasrecibidas_asientos asiento
    where asiento.factura_id = v_factura_id
  ) then
    raise exception
      'IMPORT_FAILED: reference_only no puede crear una fila de asiento';
  end if;

  v_snapshot := public.factura_recibida_snapshot_v2(v_factura_id);
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
    v_factura_id,
    v_factura.row_version,
    p_request_id,
    'update',
    'erp_import',
    coalesce(nullif(p_reason, ''), 'Readback ERP reference_only persistido'),
    p_actor,
    v_snapshot
  );

  return v_snapshot || jsonb_build_object(
    'version', v_factura.row_version,
    'request_id', p_request_id,
    'idempotent_replay', false,
    'accounting', v_accounting
  );
end;
$$;

revoke all on function public.import_factura_recibida_reference_v2(
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  uuid,
  uuid,
  text
) from public, anon, authenticated;

grant execute on function public.import_factura_recibida_reference_v2(
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  uuid,
  uuid,
  text
) to service_role;

comment on function public.import_factura_recibida_reference_v2(
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  uuid,
  uuid,
  text
) is
  'Importa una referencia ERP completa y auditable; reference_only conserva el readback sin declarar ni fabricar un asiento.';

create or replace function public.replace_factura_recibida_draft_with_reference_v2(
  p_draft_id uuid,
  p_expected_version bigint,
  p_factura jsonb,
  p_ctb jsonb,
  p_punteos jsonb,
  p_erp_readback jsonb,
  p_actor uuid,
  p_request_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current public.facturasrecibidas%rowtype;
  v_existing_reference public.facturasrecibidas%rowtype;
  v_archivo public.archivos_pdf%rowtype;
  v_existing_reference_id uuid;
  v_remote_conflict_id uuid;
  v_remote_id bigint;
  v_company_id bigint;
  v_exercise_id bigint;
  v_provider_id bigint;
  v_invoice_number text;
  v_deleted_snapshot jsonb;
  v_deleted_version bigint;
  v_old_pdf_id bigint;
  v_pdf_reference_count bigint;
  v_archivo_payload jsonb := 'null'::jsonb;
  v_deleted jsonb;
  v_import_factura jsonb;
  v_imported jsonb;
  v_snapshot jsonb;
begin
  if p_draft_id is null then
    raise exception 'INVALID_PAYLOAD: draft_id es requerido';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'INVALID_PAYLOAD: expected_version es requerido';
  end if;
  if p_factura is null or jsonb_typeof(p_factura) <> 'object' then
    raise exception 'INVALID_PAYLOAD: factura debe ser un objeto JSON';
  end if;
  if p_ctb is null or jsonb_typeof(p_ctb) <> 'array' then
    raise exception 'INVALID_PAYLOAD: ctb debe ser un array JSON';
  end if;
  if p_punteos is null or jsonb_typeof(p_punteos) <> 'array' then
    raise exception 'INVALID_PAYLOAD: punteos debe ser un array JSON';
  end if;
  if p_erp_readback is null or jsonb_typeof(p_erp_readback) <> 'object' then
    raise exception 'INVALID_PAYLOAD: erp_readback debe ser un objeto JSON';
  end if;
  if p_actor is null then
    raise exception 'INVALID_PAYLOAD: actor es requerido';
  end if;
  if p_request_id is null then
    raise exception 'INVALID_PAYLOAD: request_id es requerido';
  end if;

  if coalesce(p_factura->>'remote_frr_id', '') !~ '^[0-9]+$' then
    raise exception 'INVALID_PAYLOAD: remote_frr_id positivo es requerido';
  end if;
  v_remote_id := (p_factura->>'remote_frr_id')::bigint;
  if v_remote_id <= 0 then
    raise exception 'INVALID_PAYLOAD: remote_frr_id positivo es requerido';
  end if;

  if coalesce(p_factura->>'FRR_Idempresa', '') !~ '^[0-9]+$'
    or coalesce(p_factura->>'FRR_ejercicio', '') !~ '^[0-9]+$'
    or coalesce(p_factura->>'FRR_idproveedor', '') !~ '^[0-9]+$'
    or nullif(btrim(p_factura->>'FRR_numerofactura'), '') is null
  then
    raise exception
      'INVALID_PAYLOAD: empresa, ejercicio, proveedor y número de factura son requeridos';
  end if;

  v_company_id := (p_factura->>'FRR_Idempresa')::bigint;
  v_exercise_id := (p_factura->>'FRR_ejercicio')::bigint;
  v_provider_id := (p_factura->>'FRR_idproveedor')::bigint;
  v_invoice_number := btrim(p_factura->>'FRR_numerofactura');

  if v_company_id <= 0 or v_exercise_id <= 0 or v_provider_id <= 0 then
    raise exception
      'INVALID_PAYLOAD: empresa, ejercicio y proveedor deben ser positivos';
  end if;

  -- Un mismo request_id permite reanudar la limpieza de Storage si la Edge
  -- cayó después del commit. Nunca se vuelve a buscar ni a borrar el borrador.
  select revision.factura_id
  into v_existing_reference_id
  from public.facturasrecibidas_revisions revision
  where revision.request_id = p_request_id
    and revision.change_type = 'create'
    and revision.change_source = 'erp_import'
  order by revision.created_at
  limit 1;

  if found then
    select *
    into v_existing_reference
    from public.facturasrecibidas factura
    where factura.id = v_existing_reference_id;

    if not found then
      raise exception
        'REQUEST_CONFLICT: la referencia ERP del request_id ya no existe';
    end if;
    if v_existing_reference.remote_frr_id is distinct from v_remote_id
      or v_existing_reference."FRR_Idempresa"::bigint is distinct from v_company_id
      or v_existing_reference."FRR_ejercicio"::bigint is distinct from v_exercise_id
      or v_existing_reference."FRR_idproveedor"::bigint is distinct from v_provider_id
      or btrim(v_existing_reference."FRR_numerofactura") is distinct from v_invoice_number
    then
      raise exception
        'REQUEST_CONFLICT: request_id ya pertenece a otra referencia ERP';
    end if;

    select revision.snapshot
    into v_deleted_snapshot
    from public.facturasrecibidas_revisions revision
    where revision.request_id = p_request_id
      and revision.factura_id = p_draft_id
      and revision.change_type = 'delete'
      and revision.change_source = 'edge_delete'
    order by revision.created_at
    limit 1;

    if not found then
      raise exception
        'REQUEST_CONFLICT: request_id no acredita la sustitución del borrador indicado';
    end if;

    if coalesce(v_deleted_snapshot#>>'{factura,row_version}', '') !~ '^[0-9]+$' then
      raise exception
        'REQUEST_CONFLICT: la revisión de borrado no conserva una versión válida';
    end if;
    v_deleted_version := (v_deleted_snapshot#>>'{factura,row_version}')::bigint;
    if v_deleted_version <> p_expected_version then
      raise exception
        'VERSION_CONFLICT: esperada %, sustituida %',
        p_expected_version,
        v_deleted_version;
    end if;

    if coalesce(v_deleted_snapshot#>>'{factura,archivo_pdf_id}', '') ~ '^[0-9]+$' then
      v_old_pdf_id := (v_deleted_snapshot#>>'{factura,archivo_pdf_id}')::bigint;
      select *
      into v_archivo
      from public.archivos_pdf archivo
      where archivo.id = v_old_pdf_id;

      if found then
        v_archivo_payload := jsonb_build_object(
          'id', v_archivo.id,
          'storage_bucket', v_archivo.storage_bucket,
          'storage_path', v_archivo.storage_path,
          'nombre_archivo', v_archivo.nombre_archivo,
          'hash_sha256', v_archivo.hash_sha256,
          'tamanio_bytes', v_archivo.tamanio_bytes,
          'mime_type', v_archivo.mime_type
        );
      elsif jsonb_typeof(
        v_existing_reference.match_evidence#>'{replacement_cleanup,archivo_pdf}'
      ) = 'object' then
        v_archivo_payload :=
          v_existing_reference.match_evidence#>'{replacement_cleanup,archivo_pdf}';
      end if;
    end if;

    v_snapshot := public.factura_recibida_snapshot_v2(v_existing_reference.id);
    return v_snapshot || jsonb_build_object(
      'version', v_existing_reference.row_version,
      'request_id', p_request_id,
      'idempotent_replay', true,
      'accounting', coalesce(
        v_existing_reference.erp_last_read_payload->'accounting',
        '{}'::jsonb
      ),
      'replaced_draft', jsonb_build_object(
        'id', p_draft_id,
        'expected_version', p_expected_version,
        'deleted', true,
        'idempotent_replay', true
      ),
      'archivo_pdf', v_archivo_payload
    );
  end if;

  if exists (
    select 1
    from public.facturasrecibidas_revisions revision
    where revision.request_id = p_request_id
  ) then
    raise exception 'REQUEST_CONFLICT: request_id ya fue utilizado';
  end if;

  select *
  into v_current
  from public.facturasrecibidas factura
  where factura.id = p_draft_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: borrador no encontrado';
  end if;
  if v_current.row_version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: esperada %, actual %',
      p_expected_version,
      v_current.row_version;
  end if;
  if v_current.source_kind is distinct from 'front_draft'
    or v_current.estado is distinct from 'pendiente_revision'
  then
    raise exception
      'DRAFT_REQUIRED: solo puede sustituirse un front_draft pendiente de revisión';
  end if;
  if v_current."FRR_id" is not null
    or v_current.remote_frr_id is not null
    or v_current.is_readonly_reference
  then
    raise exception
      'FACTURA_LOCKED: el borrador ya tiene identidad ERP';
  end if;
  if v_current.sync_status is distinct from 'draft'
    or v_current.last_request_id is not null
    or v_current.erp_sent_at is not null
    or v_current.erp_sent_by is not null
    or v_current.erp_response is not null
    or v_current.erp_error is not null
    or exists (
      select 1
      from public.facturasrecibidas_sync_attempts attempt
      where attempt.factura_id = p_draft_id
    )
  then
    raise exception
      'FACTURA_LOCKED: el borrador ya tiene actividad de sincronización';
  end if;
  if v_current.accounting_status is distinct from 'not_requested'
    or v_current."FRR_IdAsientoNet" is not null
    or v_current.accounting_visible_number is not null
    or v_current.accounting_date is not null
    or exists (
      select 1
      from public.facturasrecibidas_asientos asiento
      where asiento.factura_id = p_draft_id
    )
  then
    raise exception
      'FACTURA_LOCKED: el borrador ya tiene estado o evidencia contable';
  end if;
  if exists (
    select 1
    from public.facturasrecibidas_ctb ctb
    where ctb.factura_id = p_draft_id
  ) or exists (
    select 1
    from public.facturasrecibidas_punteos punteo
    where punteo.factura_id = p_draft_id
  ) then
    raise exception
      'DRAFT_NOT_EMPTY: el borrador contiene CTB o punteos persistidos';
  end if;

  if v_current."FRR_Idempresa"::bigint is distinct from v_company_id
    or v_current."FRR_ejercicio"::bigint is distinct from v_exercise_id
    or v_current."FRR_idproveedor"::bigint is distinct from v_provider_id
    or btrim(v_current."FRR_numerofactura") is distinct from v_invoice_number
  then
    raise exception
      'DRAFT_MISMATCH: empresa, ejercicio, proveedor o número no coinciden con ERP';
  end if;

  if v_current.archivo_pdf_id is null then
    raise exception 'PDF_REQUIRED: el borrador no tiene archivo PDF asociado';
  end if;
  v_old_pdf_id := v_current.archivo_pdf_id;

  select *
  into v_archivo
  from public.archivos_pdf archivo
  where archivo.id = v_old_pdf_id
  for update;

  if not found
    or nullif(btrim(v_archivo.storage_bucket), '') is null
    or nullif(btrim(v_archivo.storage_path), '') is null
  then
    raise exception
      'PDF_REQUIRED: falta la metadata de Storage del PDF asociado';
  end if;

  select count(*)
  into v_pdf_reference_count
  from public.facturasrecibidas factura
  where factura.archivo_pdf_id = v_old_pdf_id;

  if v_pdf_reference_count <> 1 then
    raise exception
      'PDF_SHARED: el PDF % tiene % referencias de facturas recibidas',
      v_old_pdf_id,
      v_pdf_reference_count;
  end if;

  v_archivo_payload := jsonb_build_object(
    'id', v_archivo.id,
    'storage_bucket', v_archivo.storage_bucket,
    'storage_path', v_archivo.storage_path,
    'nombre_archivo', v_archivo.nombre_archivo,
    'hash_sha256', v_archivo.hash_sha256,
    'tamanio_bytes', v_archivo.tamanio_bytes,
    'mime_type', v_archivo.mime_type
  );

  select factura.id
  into v_remote_conflict_id
  from public.facturasrecibidas factura
  where factura.remote_frr_id = v_remote_id
  limit 1;

  if found then
    raise exception
      'REMOTE_ALREADY_IMPORTED: remote_frr_id % ya pertenece a %',
      v_remote_id,
      v_remote_conflict_id;
  end if;

  v_deleted := public.delete_factura_recibida_v2(
    p_draft_id,
    p_expected_version,
    p_actor,
    p_request_id,
    coalesce(nullif(btrim(p_reason), ''), 'Sustitución por referencia ERP')
  );

  if coalesce((v_deleted->>'deleted')::boolean, false) is not true then
    raise exception 'REPLACE_FAILED: delete_factura_recibida_v2 no confirmó el borrado';
  end if;

  v_import_factura := p_factura || jsonb_build_object(
    'match_evidence',
    case
      when jsonb_typeof(p_factura->'match_evidence') = 'object'
        then p_factura->'match_evidence'
      else '{}'::jsonb
    end || jsonb_build_object(
      'replacement_cleanup',
      jsonb_build_object(
        'draft_id', p_draft_id,
        'archivo_pdf', v_archivo_payload
      )
    )
  );

  v_imported := public.import_factura_recibida_reference_v2(
    v_import_factura,
    p_ctb,
    p_punteos,
    p_erp_readback,
    p_actor,
    p_request_id,
    coalesce(nullif(btrim(p_reason), ''), 'Sustitución por referencia ERP')
  );

  if nullif(v_imported#>>'{factura,id}', '') is null
    or (v_imported#>>'{factura,remote_frr_id}')::bigint is distinct from v_remote_id
  then
    raise exception
      'REPLACE_FAILED: la importación no devolvió la referencia ERP esperada';
  end if;

  return v_imported || jsonb_build_object(
    'replaced_draft', jsonb_build_object(
      'id', p_draft_id,
      'expected_version', p_expected_version,
      'deleted', true,
      'idempotent_replay', false
    ),
    'archivo_pdf', v_archivo_payload
  );
end;
$$;

revoke all on function public.replace_factura_recibida_draft_with_reference_v2(
  uuid,
  bigint,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  uuid,
  uuid,
  text
) from public, anon, authenticated;

grant execute on function public.replace_factura_recibida_draft_with_reference_v2(
  uuid,
  bigint,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  uuid,
  uuid,
  text
) to service_role;

comment on function public.replace_factura_recibida_draft_with_reference_v2(
  uuid,
  bigint,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  uuid,
  uuid,
  text
) is
  'Sustituye atómicamente un front_draft intacto por una referencia ERP y devuelve la metadata del PDF para limpieza posterior mediante Storage API.';

comment on column public.facturasrecibidas.accounting_status is
  'Estado contable independiente. reference_only conserva una lectura ERP no verificable como asiento creado.';
