-- Contabilizacion v3 para facturas recibidas.
--
-- La alta de gestion y el asiento contable siguen siendo dos operaciones
-- independientes. Supabase conserva la intencion antes de que el writer de
-- gestion fuerce FRR_Contabilizar='N', fija un request_id contable antes de
-- contactar con Netagro y solo marca `created` despues de persistir un
-- readback completo y cuadrado.

alter table public.erp_targets
  drop constraint if exists erp_targets_accounting_mode_check,
  drop constraint if exists erp_targets_sql_accounting_test_only_check;

alter table public.erp_targets
  add constraint erp_targets_accounting_mode_check check (
    accounting_mode in ('unavailable', 'official', 'sql_test')
  ),
  add constraint erp_targets_sql_accounting_test_only_check check (
    accounting_mode <> 'sql_test'
    or environment = 'test'
  );

alter table public.facturasrecibidas
  add column if not exists accounting_requested boolean not null default false,
  add column if not exists accounting_request_id uuid,
  add column if not exists accounting_payload_hash text,
  add column if not exists accounting_invoice_fingerprint text,
  add column if not exists accounting_error text,
  add column if not exists accounting_response jsonb,
  add column if not exists accounting_verified_at timestamptz,
  add column if not exists accounting_updated_at timestamptz;

update public.facturasrecibidas
set accounting_requested = true
where coalesce("FRR_Contabilizar", 'N') = 'S'
  and accounting_requested is distinct from true;

alter table public.facturasrecibidas
  drop constraint if exists facturasrecibidas_accounting_payload_hash_check,
  drop constraint if exists facturasrecibidas_accounting_fingerprint_check;

alter table public.facturasrecibidas
  add constraint facturasrecibidas_accounting_payload_hash_check check (
    accounting_payload_hash is null
    or accounting_payload_hash ~ '^[0-9a-f]{64}$'
  ),
  add constraint facturasrecibidas_accounting_fingerprint_check check (
    accounting_invoice_fingerprint is null
    or accounting_invoice_fingerprint ~ '^[0-9a-f]{64}$'
  );

create index if not exists idx_facturasrecibidas_accounting_pending
  on public.facturasrecibidas (accounting_status, accounting_updated_at)
  where accounting_requested
    and accounting_status in ('requested', 'pending', 'unknown', 'error');

create or replace function public.capture_factura_accounting_intent_v3()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.accounting_requested := coalesce(new."FRR_Contabilizar", 'N') = 'S';
    return new;
  end if;

  -- Mientras la factura sigue siendo editable, el selector es la autoridad.
  if coalesce(new.sync_status, 'draft') in ('draft', 'ready', 'error') then
    new.accounting_requested := coalesce(new."FRR_Contabilizar", 'N') = 'S';
  -- begin_factura_recibida_sync_v3 fuerza N en la cabecera local para reflejar
  -- exactamente el alta de gestion. Conservamos antes la intencion del usuario.
  elsif coalesce(old."FRR_Contabilizar", 'N') = 'S'
    and coalesce(new."FRR_Contabilizar", 'N') = 'N'
    and new.sync_status = 'sending'
  then
    new.accounting_requested := true;
  end if;

  return new;
end;
$$;

drop trigger if exists capture_factura_accounting_intent_v3
  on public.facturasrecibidas;
create trigger capture_factura_accounting_intent_v3
  before insert or update of "FRR_Contabilizar", sync_status
  on public.facturasrecibidas
  for each row execute function public.capture_factura_accounting_intent_v3();

create or replace function public.prepare_factura_recibida_accounting_v3(
  p_factura_id uuid,
  p_request_id uuid,
  p_target_id text,
  p_dataset_epoch uuid,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current public.facturasrecibidas%rowtype;
  v_target public.erp_targets%rowtype;
  v_attempt public.facturasrecibidas_sync_attempts%rowtype;
  v_request_payload jsonb;
  v_snapshot jsonb;
begin
  if p_factura_id is null
    or p_request_id is null
    or nullif(btrim(p_target_id), '') is null
    or p_dataset_epoch is null
  then
    raise exception 'INVALID_PAYLOAD: identidad contable incompleta';
  end if;

  select *
  into v_target
  from public.erp_targets
  where id = p_target_id
  for share;

  if not found
    or not v_target.active
    or v_target.dataset_epoch is distinct from p_dataset_epoch
    or v_target.accounting_mode not in ('official', 'sql_test')
    or (v_target.accounting_mode = 'sql_test' and v_target.environment <> 'test')
  then
    raise exception 'STALE_ENVIRONMENT: target contable no disponible';
  end if;

  select *
  into v_current
  from public.facturasrecibidas
  where id = p_factura_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: factura no encontrada';
  end if;
  if v_current.sync_status <> 'sent'
    or v_current.erp_reference_status <> 'valid'
    or v_current.erp_target_id is distinct from p_target_id
    or v_current.erp_dataset_epoch is distinct from p_dataset_epoch
    or coalesce(v_current.remote_frr_id, v_current."FRR_id", 0) <= 0
  then
    raise exception 'ACCOUNTING_NOT_READY: el alta de gestion no esta confirmada en este entorno';
  end if;
  if not v_current.accounting_requested then
    raise exception 'ACCOUNTING_NOT_REQUESTED: la factura no se marco para contabilizar';
  end if;

  if v_current.accounting_status = 'created' then
    if v_current.accounting_request_id is distinct from p_request_id then
      raise exception 'IDEMPOTENCY_CONFLICT: la factura ya tiene otro asiento confirmado';
    end if;
    return jsonb_build_object(
      'factura', to_jsonb(v_current),
      'version', v_current.row_version,
      'request_id', p_request_id,
      'remote_frr_id', coalesce(v_current.remote_frr_id, v_current."FRR_id"),
      'idempotent_replay', true
    );
  end if;

  if v_current.accounting_request_id is not null
    and v_current.accounting_request_id is distinct from p_request_id
    and v_current.accounting_status in ('requested', 'pending', 'unknown')
  then
    raise exception 'IDEMPOTENCY_CONFLICT: existe otra contabilizacion en curso';
  end if;

  v_request_payload := jsonb_build_object(
    'contract_version', 3,
    'operation', 'validate',
    'request_id', p_request_id,
    'target_id', p_target_id,
    'dataset_epoch', p_dataset_epoch,
    'factura_id', coalesce(v_current.remote_frr_id, v_current."FRR_id")
  );

  select *
  into v_attempt
  from public.facturasrecibidas_sync_attempts
  where request_id = p_request_id
    and phase = 'validate'
  for update;

  if found then
    if v_attempt.factura_id is distinct from p_factura_id
      or v_attempt.erp_target_id is distinct from p_target_id
      or v_attempt.erp_dataset_epoch is distinct from p_dataset_epoch
      or v_attempt.circuit is distinct from 'accounting'
    then
      raise exception 'IDEMPOTENCY_CONFLICT: request_id contable ya corresponde a otra operacion';
    end if;
  else
    insert into public.facturasrecibidas_sync_attempts (
      factura_id,
      request_id,
      contract_version,
      phase,
      operation,
      dry_run,
      status,
      request_payload,
      erp_target_id,
      erp_dataset_epoch,
      circuit,
      created_by
    ) values (
      p_factura_id,
      p_request_id,
      3,
      'validate',
      'validate',
      true,
      'in_progress',
      v_request_payload,
      p_target_id,
      p_dataset_epoch,
      'accounting',
      p_actor
    );
  end if;

  update public.facturasrecibidas
  set accounting_status = 'pending',
      accounting_request_id = p_request_id,
      accounting_payload_hash = case
        when accounting_request_id is distinct from p_request_id then null
        else accounting_payload_hash
      end,
      accounting_invoice_fingerprint = case
        when accounting_request_id is distinct from p_request_id then null
        else accounting_invoice_fingerprint
      end,
      accounting_error = null,
      accounting_response = case
        when accounting_request_id is distinct from p_request_id then null
        else accounting_response
      end,
      accounting_verified_at = null,
      accounting_updated_at = now(),
      row_version = row_version + 1,
      updated_by = p_actor,
      updated_at = now()
  where id = p_factura_id
  returning * into v_current;

  v_snapshot := public.factura_recibida_snapshot_v2(p_factura_id);
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
    p_factura_id,
    v_current.row_version,
    p_request_id,
    'update',
    'edge_accounting_v3',
    'accounting_pending',
    p_actor,
    v_snapshot
  );

  return jsonb_build_object(
    'factura', to_jsonb(v_current),
    'version', v_current.row_version,
    'request_id', p_request_id,
    'remote_frr_id', coalesce(v_current.remote_frr_id, v_current."FRR_id"),
    'idempotent_replay', false
  );
end;
$$;

create or replace function public.record_factura_recibida_accounting_v3(
  p_factura_id uuid,
  p_request_id uuid,
  p_target_id text,
  p_dataset_epoch uuid,
  p_status text,
  p_response jsonb default null,
  p_payload_hash text default null,
  p_invoice_fingerprint text default null,
  p_error text default null,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current public.facturasrecibidas%rowtype;
  v_target public.erp_targets%rowtype;
  v_attempt public.facturasrecibidas_sync_attempts%rowtype;
  v_attempt_phase text;
  v_accounting jsonb := coalesce(p_response->'accounting', '{}'::jsonb);
  v_lines jsonb := coalesce(p_response->'entries', '[]'::jsonb);
  v_technical_id bigint;
  v_visible_number text;
  v_accounting_date date;
  v_total_debit numeric(18,2) := 0;
  v_total_credit numeric(18,2) := 0;
  v_line_count integer := 0;
  v_asiento_id uuid;
  v_snapshot jsonb;
begin
  if p_status not in ('pending', 'created', 'error', 'unknown') then
    raise exception 'INVALID_PAYLOAD: estado contable no valido';
  end if;
  if p_payload_hash is not null and p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_PAYLOAD: payload_hash contable no valido';
  end if;
  if p_invoice_fingerprint is not null
    and p_invoice_fingerprint !~ '^[0-9a-f]{64}$'
  then
    raise exception 'INVALID_PAYLOAD: fingerprint contable no valido';
  end if;
  if p_status in ('pending', 'created')
    and (
      p_payload_hash is null
      or p_invoice_fingerprint is null
    )
  then
    raise exception 'INVALID_PAYLOAD: hashes contables requeridos';
  end if;

  select *
  into v_target
  from public.erp_targets
  where id = p_target_id
  for share;

  if not found
    or not v_target.active
    or v_target.dataset_epoch is distinct from p_dataset_epoch
    or v_target.accounting_mode not in ('official', 'sql_test')
    or (v_target.accounting_mode = 'sql_test' and v_target.environment <> 'test')
  then
    raise exception 'STALE_ENVIRONMENT: target contable no disponible';
  end if;

  select *
  into v_current
  from public.facturasrecibidas
  where id = p_factura_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: factura no encontrada';
  end if;
  if v_current.accounting_request_id is distinct from p_request_id
    or v_current.erp_target_id is distinct from p_target_id
    or v_current.erp_dataset_epoch is distinct from p_dataset_epoch
  then
    raise exception 'IDEMPOTENCY_CONFLICT: identidad contable no coincide';
  end if;

  if v_current.accounting_status = 'created' then
    return jsonb_build_object(
      'factura', to_jsonb(v_current),
      'version', v_current.row_version,
      'request_id', p_request_id,
      'idempotent_replay', true
    );
  end if;

  if p_status = 'pending' then
    if p_response is null or jsonb_typeof(p_response) <> 'object'
      or p_response->'contract_version' is distinct from '3'::jsonb
      or p_response->>'operation' <> 'validate'
      or p_response->>'request_id' <> p_request_id::text
      or p_response->>'target_id' <> p_target_id
      or p_response->>'dataset_epoch' <> p_dataset_epoch::text
      or p_response->'ok' is distinct from 'true'::jsonb
      or p_response->'eligible' is distinct from 'true'::jsonb
      or coalesce(p_response->>'factura_id', '') !~ '^[0-9]+$'
      or (p_response->>'factura_id')::bigint
        <> coalesce(v_current.remote_frr_id, v_current."FRR_id")
      or nullif(p_response->>'payload_hash', '') is null
      or p_response->>'payload_hash' <> p_payload_hash
      or nullif(p_response->>'invoice_fingerprint', '') is null
      or p_response->>'invoice_fingerprint' <> p_invoice_fingerprint
    then
      raise exception 'INVALID_READBACK: validacion contable v3 no coincide';
    end if;
  end if;

  if p_status = 'created' then
    if p_response is null or jsonb_typeof(p_response) <> 'object'
      or p_response->'contract_version' is distinct from '3'::jsonb
      or p_response->>'operation' <> 'commit'
      or p_response->>'request_id' <> p_request_id::text
      or p_response->>'target_id' <> p_target_id
      or p_response->>'dataset_epoch' <> p_dataset_epoch::text
      or p_response->'ok' is distinct from 'true'::jsonb
      or p_response->'eligible' is distinct from 'true'::jsonb
      or p_response->'readback_confirmed' is distinct from 'true'::jsonb
      or coalesce(p_response->>'factura_id', '') !~ '^[0-9]+$'
      or (p_response->>'factura_id')::bigint
        <> coalesce(v_current.remote_frr_id, v_current."FRR_id")
      or p_response->>'payload_hash' <> p_payload_hash
      or p_response->>'invoice_fingerprint' <> p_invoice_fingerprint
    then
      raise exception 'INVALID_READBACK: respuesta contable v3 no coincide';
    end if;
    if jsonb_typeof(v_accounting) <> 'object'
      or jsonb_typeof(v_lines) <> 'array'
      or v_accounting->'created' is distinct from 'true'::jsonb
      or lower(coalesce(v_accounting->>'status', '')) <> 'created'
      or v_accounting->'balanced' is distinct from 'true'::jsonb
      or coalesce(v_accounting->>'technical_id', '') !~ '^[1-9][0-9]*$'
      or nullif(btrim(v_accounting->>'visible_number'), '') is null
      or jsonb_array_length(v_lines) = 0
    then
      raise exception 'INVALID_READBACK: asiento creado, visible y cuadrado requerido';
    end if;

    v_technical_id := (v_accounting->>'technical_id')::bigint;
    v_visible_number := btrim(v_accounting->>'visible_number');
    begin
      v_accounting_date := nullif(v_accounting->>'date', '')::date;
    exception when invalid_datetime_format then
      raise exception 'INVALID_READBACK: fecha contable no valida';
    end;

    if exists (
      select 1
      from jsonb_array_elements(v_lines) line(value)
      where jsonb_typeof(line.value) <> 'object'
        or nullif(btrim(line.value->>'account'), '') is null
        or coalesce(line.value->>'debit', '') !~ '^[0-9]+([.][0-9]+)?$'
        or coalesce(line.value->>'credit', '') !~ '^[0-9]+([.][0-9]+)?$'
        or (
          (line.value->>'debit')::numeric > 0
          and (line.value->>'credit')::numeric > 0
        )
        or (
          (line.value->>'debit')::numeric = 0
          and (line.value->>'credit')::numeric = 0
        )
    ) then
      raise exception 'INVALID_READBACK: apuntes contables no validos';
    end if;

    select
      count(*)::integer,
      coalesce(sum((line.value->>'debit')::numeric), 0),
      coalesce(sum((line.value->>'credit')::numeric), 0)
    into v_line_count, v_total_debit, v_total_credit
    from jsonb_array_elements(v_lines) line(value);

    if v_line_count <= 0
      or v_total_debit <= 0
      or v_total_credit <= 0
      or abs(v_total_debit - v_total_credit) > 0.01
      or coalesce(v_accounting->>'total_debit', '') !~ '^[0-9]+([.][0-9]+)?$'
      or coalesce(v_accounting->>'total_credit', '') !~ '^[0-9]+([.][0-9]+)?$'
      or abs((v_accounting->>'total_debit')::numeric - v_total_debit) > 0.01
      or abs((v_accounting->>'total_credit')::numeric - v_total_credit) > 0.01
    then
      raise exception 'INVALID_READBACK: el asiento no cuadra exactamente';
    end if;

    select *
    into v_attempt
    from public.facturasrecibidas_sync_attempts
    where factura_id = p_factura_id
      and request_id = p_request_id
      and phase = 'commit'
      and circuit = 'accounting'
    for update;

    if not found
      or v_attempt.erp_target_id is distinct from p_target_id
      or v_attempt.erp_dataset_epoch is distinct from p_dataset_epoch
      or v_attempt.payload_hash is distinct from p_payload_hash
      or v_attempt.business_fingerprint is distinct from p_invoice_fingerprint
    then
      raise exception 'INVALID_SYNC_ATTEMPT: commit contable no encontrado';
    end if;

    update public.facturasrecibidas_sync_attempts
    set status = 'succeeded',
        response_payload = p_response,
        http_status = 200,
        error = null,
        error_code = null,
        error_category = null,
        retryable = false,
        reconciliation_required = false,
        completed_at = now(),
        updated_at = now()
    where id = v_attempt.id;

    insert into public.facturasrecibidas_asientos (
      factura_id,
      request_id,
      technical_id,
      visible_number,
      accounting_date,
      concept,
      status,
      total_debit,
      total_credit,
      balanced,
      raw
    ) values (
      p_factura_id,
      p_request_id,
      v_technical_id,
      v_visible_number,
      v_accounting_date,
      nullif(v_accounting->>'concept', ''),
      'created',
      v_total_debit,
      v_total_credit,
      true,
      p_response
    )
    on conflict (factura_id, request_id) do nothing
    returning id into v_asiento_id;

    if v_asiento_id is null then
      select id
      into v_asiento_id
      from public.facturasrecibidas_asientos
      where factura_id = p_factura_id
        and request_id = p_request_id;
    end if;

    insert into public.facturasrecibidas_asiento_apuntes (
      asiento_id,
      posicion,
      cuenta,
      descripcion,
      debe,
      haber,
      analytic,
      raw
    )
    select
      v_asiento_id,
      line.ordinality::integer,
      nullif(btrim(line.value->>'account'), ''),
      coalesce(
        nullif(line.value->>'description', ''),
        nullif(line.value->>'account_name', '')
      ),
      (line.value->>'debit')::numeric,
      (line.value->>'credit')::numeric,
      jsonb_strip_nulls(jsonb_build_object(
        'activity_id', line.value->'activity_id',
        'section_id', line.value->'section_id',
        'department_id', line.value->'department_id',
        'subdepartment_id', line.value->'subdepartment_id'
      )),
      line.value
    from jsonb_array_elements(v_lines) with ordinality line(value, ordinality)
    on conflict (asiento_id, posicion) do nothing;

    update public.facturasrecibidas
    set accounting_status = 'created',
        accounting_visible_number = v_visible_number,
        accounting_date = v_accounting_date,
        accounting_payload_hash = p_payload_hash,
        accounting_invoice_fingerprint = p_invoice_fingerprint,
        accounting_error = null,
        accounting_response = p_response,
        accounting_verified_at = now(),
        accounting_updated_at = now(),
        "FRR_IdAsientoNet" = v_technical_id,
        "FRR_Contabilizar" = 'S',
        row_version = row_version + 1,
        updated_by = p_actor,
        updated_at = now()
    where id = p_factura_id
    returning * into v_current;
  else
    if p_status = 'pending' then
      select *
      into v_attempt
      from public.facturasrecibidas_sync_attempts
      where factura_id = p_factura_id
        and request_id = p_request_id
        and phase = 'validate'
        and circuit = 'accounting'
      for update;

      if not found
        or v_attempt.erp_target_id is distinct from p_target_id
        or v_attempt.erp_dataset_epoch is distinct from p_dataset_epoch
      then
        raise exception 'INVALID_SYNC_ATTEMPT: validacion contable no encontrada';
      end if;

      update public.facturasrecibidas_sync_attempts
      set status = 'succeeded',
          response_payload = p_response,
          http_status = 200,
          error = null,
          error_code = null,
          error_category = null,
          retryable = false,
          reconciliation_required = false,
          payload_hash = p_payload_hash,
          business_fingerprint = p_invoice_fingerprint,
          completed_at = now(),
          updated_at = now()
      where id = v_attempt.id;

      insert into public.facturasrecibidas_sync_attempts (
        factura_id,
        request_id,
        contract_version,
        phase,
        operation,
        dry_run,
        status,
        request_payload,
        erp_target_id,
        erp_dataset_epoch,
        circuit,
        payload_hash,
        business_fingerprint,
        created_by
      ) values (
        p_factura_id,
        p_request_id,
        3,
        'commit',
        'commit',
        false,
        'in_progress',
        jsonb_build_object(
          'contract_version', 3,
          'operation', 'commit',
          'request_id', p_request_id,
          'target_id', p_target_id,
          'dataset_epoch', p_dataset_epoch,
          'factura_id', coalesce(v_current.remote_frr_id, v_current."FRR_id")
        ),
        p_target_id,
        p_dataset_epoch,
        'accounting',
        p_payload_hash,
        p_invoice_fingerprint,
        p_actor
      )
      on conflict (request_id, phase) do nothing;
    else
      select *
      into v_attempt
      from public.facturasrecibidas_sync_attempts
      where factura_id = p_factura_id
        and request_id = p_request_id
        and phase = 'commit'
        and circuit = 'accounting'
      for update;

      if found then
        v_attempt_phase := 'commit';
      else
        select *
        into v_attempt
        from public.facturasrecibidas_sync_attempts
        where factura_id = p_factura_id
          and request_id = p_request_id
          and phase = 'validate'
          and circuit = 'accounting'
        for update;
        v_attempt_phase := 'validate';
      end if;

      if not found
        or v_attempt.erp_target_id is distinct from p_target_id
        or v_attempt.erp_dataset_epoch is distinct from p_dataset_epoch
      then
        raise exception 'INVALID_SYNC_ATTEMPT: intento contable no encontrado';
      end if;

      update public.facturasrecibidas_sync_attempts
      set status = case when p_status = 'unknown' then 'unknown' else 'failed' end,
          response_payload = coalesce(p_response, response_payload),
          error = coalesce(nullif(btrim(p_error), ''), 'No se pudo completar la contabilizacion.'),
          error_code = case
            when p_status = 'unknown' then 'ambiguous_commit'
            when v_attempt_phase = 'validate' then 'accounting_validation_failed'
            else 'accounting_commit_failed'
          end,
          error_category = 'accounting',
          retryable = p_status = 'error' and v_attempt_phase = 'validate',
          reconciliation_required = p_status = 'unknown',
          payload_hash = coalesce(p_payload_hash, payload_hash),
          business_fingerprint = coalesce(p_invoice_fingerprint, business_fingerprint),
          completed_at = now(),
          updated_at = now()
      where id = v_attempt.id;
    end if;

    update public.facturasrecibidas
    set accounting_status = p_status,
        accounting_payload_hash = coalesce(p_payload_hash, accounting_payload_hash),
        accounting_invoice_fingerprint = coalesce(
          p_invoice_fingerprint,
          accounting_invoice_fingerprint
        ),
        accounting_error = case
          when p_status = 'pending' then null
          else coalesce(nullif(btrim(p_error), ''), 'No se pudo completar la contabilizacion.')
        end,
        accounting_response = coalesce(p_response, accounting_response),
        accounting_updated_at = now(),
        row_version = row_version + 1,
        updated_by = p_actor,
        updated_at = now()
    where id = p_factura_id
    returning * into v_current;
  end if;

  v_snapshot := public.factura_recibida_snapshot_v2(p_factura_id);
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
    p_factura_id,
    v_current.row_version,
    p_request_id,
    'update',
    'edge_accounting_v3',
    'accounting_' || p_status,
    p_actor,
    v_snapshot
  );

  return jsonb_build_object(
    'factura', to_jsonb(v_current),
    'version', v_current.row_version,
    'request_id', p_request_id,
    'accounting', case
      when v_asiento_id is null then v_accounting
      else (
        select to_jsonb(asiento) || jsonb_build_object(
          'lines', coalesce((
            select jsonb_agg(to_jsonb(apunte) order by apunte.posicion)
            from public.facturasrecibidas_asiento_apuntes apunte
            where apunte.asiento_id = asiento.id
          ), '[]'::jsonb)
        )
        from public.facturasrecibidas_asientos asiento
        where asiento.id = v_asiento_id
      )
    end
  );
end;
$$;

-- La capacidad contable no se habilita con UPDATE directo. Para SQL observado
-- solo existe la transicion auditada `unavailable -> sql_test`, limitada a un
-- target TEST con epoch vigente y con todas las salvaguardas verificadas.
create or replace function private.set_erp_target_accounting_mode_v3_impl(
  p_target_id text,
  p_dataset_epoch uuid,
  p_accounting_mode text,
  p_confirmation text default null,
  p_gates jsonb default '{}'::jsonb,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.erp_targets%rowtype;
  v_required_sql_test_gates constant jsonb := jsonb_build_object(
    'physical_backup_verified', true,
    'least_privilege_grants_verified', true,
    'accounting_canary_readback_verified', true,
    'rollback_verified', true,
    'api_runtime_reconciled', true
  );
  v_required_official_gates constant jsonb := jsonb_build_object(
    'official_mechanism_homologated', true,
    'readback_verified', true,
    'rollback_verified', true,
    'api_runtime_reconciled', true
  );
begin
  if nullif(btrim(p_target_id), '') is null
    or p_dataset_epoch is null
    or p_accounting_mode not in ('unavailable', 'official', 'sql_test')
  then
    raise exception 'INVALID_PAYLOAD: target, epoch y accounting_mode validos son requeridos';
  end if;
  if p_gates is null or jsonb_typeof(p_gates) <> 'object' then
    raise exception 'INVALID_PAYLOAD: gates debe ser un objeto';
  end if;

  select *
  into v_target
  from public.erp_targets
  where id = p_target_id
  for update;

  if not found or not v_target.active then
    raise exception 'STALE_ENVIRONMENT: target ERP no activo';
  end if;
  if v_target.dataset_epoch is null
    or v_target.dataset_epoch is distinct from p_dataset_epoch
    or v_target.snapshot_at is null
  then
    raise exception 'STALE_ENVIRONMENT: target sin snapshot/epoch vigente';
  end if;
  if v_target.accounting_mode = p_accounting_mode then
    return jsonb_build_object(
      'target', to_jsonb(v_target),
      'idempotent_replay', true
    );
  end if;

  if p_accounting_mode = 'sql_test' then
    if v_target.environment <> 'test' then
      raise exception 'ACTIVATION_GATE_FAILED: sql_test solo se permite en TEST';
    end if;
    if v_target.write_mode <> 'management' then
      raise exception 'ACTIVATION_GATE_FAILED: sql_test exige gestion habilitada y homologada';
    end if;
    if p_confirmation is distinct from
      ('ENABLE_SQL_ACCOUNTING_TEST:' || p_target_id || ':' || p_dataset_epoch::text)
    then
      raise exception 'ACTIVATION_CONFIRMATION_REQUIRED: confirmacion sql_test no coincide';
    end if;
    if not (p_gates @> v_required_sql_test_gates) then
      raise exception 'ACTIVATION_GATE_FAILED: faltan gates obligatorios para sql_test';
    end if;
  elsif p_accounting_mode = 'official' then
    if p_confirmation is distinct from
      ('ENABLE_OFFICIAL_ACCOUNTING:' || p_target_id || ':' || p_dataset_epoch::text)
    then
      raise exception 'ACTIVATION_CONFIRMATION_REQUIRED: confirmacion official no coincide';
    end if;
    if not (p_gates @> v_required_official_gates) then
      raise exception 'ACTIVATION_GATE_FAILED: falta homologacion oficial';
    end if;
  elsif p_accounting_mode <> 'unavailable' then
    raise exception 'ACTIVATION_GATE_FAILED: transicion contable no permitida';
  end if;

  update public.erp_targets
  set accounting_mode = p_accounting_mode,
      metadata = metadata || jsonb_build_object(
        'last_accounting_mode_transition',
        jsonb_build_object(
          'from', v_target.accounting_mode,
          'to', p_accounting_mode,
          'dataset_epoch', p_dataset_epoch,
          'actor', p_actor,
          'changed_at', now()
        ),
        'accounting_activation_gates',
        case
          when p_accounting_mode = 'unavailable' then '{}'::jsonb
          else p_gates
        end
      ),
      updated_at = now()
  where id = p_target_id
  returning * into v_target;

  return jsonb_build_object(
    'target', to_jsonb(v_target),
    'idempotent_replay', false
  );
end;
$$;

create or replace function public.set_erp_target_accounting_mode_v3(
  p_target_id text,
  p_dataset_epoch uuid,
  p_accounting_mode text,
  p_confirmation text default null,
  p_gates jsonb default '{}'::jsonb,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.set_erp_target_accounting_mode_v3_impl(
    p_target_id,
    p_dataset_epoch,
    p_accounting_mode,
    p_confirmation,
    p_gates,
    p_actor
  );
end;
$$;

comment on column public.facturasrecibidas.accounting_requested is
  'Intencion de contabilizar conservada separadamente del alta de gestion, que siempre se crea con FRR_Contabilizar=N.';
comment on column public.facturasrecibidas.accounting_request_id is
  'Request id idempotente fijado antes de contactar con el writer contable.';
comment on function public.prepare_factura_recibida_accounting_v3(uuid, uuid, text, uuid, uuid) is
  'Fija la identidad contable sobre una alta de gestion confirmada, sin escribir en Netagro.';
comment on function public.record_factura_recibida_accounting_v3(uuid, uuid, text, uuid, text, jsonb, text, text, text, uuid) is
  'Registra el resultado contable; created exige readback v3 completo, visible y cuadrado.';
comment on function public.set_erp_target_accounting_mode_v3(text, uuid, text, text, jsonb, uuid) is
  'Activa o reduce la capacidad contable mediante una transicion auditable; sql_test solo puede habilitarse en TEST.';

-- El hardening anterior quitaba DML a los clientes, pero una concesion ALL
-- historica podia sobrevivir en service_role. Reafirmamos aqui el minimo que
-- necesitan las Edge/RPC; los snapshots contables y revisiones son append-only.
revoke all privileges
on table
  public.facturasrecibidas,
  public.facturasrecibidas_ctb,
  public.facturasrecibidas_punteos,
  public.facturasrecibidas_sync_attempts,
  public.facturasrecibidas_asientos,
  public.facturasrecibidas_asiento_apuntes,
  public.facturasrecibidas_revisions
from service_role;

grant select, insert, update, delete
on table
  public.facturasrecibidas,
  public.facturasrecibidas_ctb,
  public.facturasrecibidas_punteos
to service_role;

grant select, insert, update
on table public.facturasrecibidas_sync_attempts
to service_role;

grant select, insert
on table
  public.facturasrecibidas_asientos,
  public.facturasrecibidas_asiento_apuntes,
  public.facturasrecibidas_revisions
to service_role;

revoke execute on function public.capture_factura_accounting_intent_v3()
  from public, anon, authenticated;
revoke execute on function public.prepare_factura_recibida_accounting_v3(
  uuid, uuid, text, uuid, uuid
) from public, anon, authenticated;
revoke execute on function public.record_factura_recibida_accounting_v3(
  uuid, uuid, text, uuid, text, jsonb, text, text, text, uuid
) from public, anon, authenticated;
revoke execute on function public.set_erp_target_accounting_mode_v3(
  text, uuid, text, text, jsonb, uuid
) from public, anon, authenticated;
revoke all on function private.set_erp_target_accounting_mode_v3_impl(
  text, uuid, text, text, jsonb, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.prepare_factura_recibida_accounting_v3(
  uuid, uuid, text, uuid, uuid
) to service_role;
grant execute on function public.record_factura_recibida_accounting_v3(
  uuid, uuid, text, uuid, text, jsonb, text, text, text, uuid
) to service_role;
grant execute on function public.set_erp_target_accounting_mode_v3(
  text, uuid, text, text, jsonb, uuid
) to service_role;
grant execute on function private.set_erp_target_accounting_mode_v3_impl(
  text, uuid, text, text, jsonb, uuid
) to service_role;

do $accounting_acl_assertions$
declare
  forbidden_privilege text;
  snapshot_table regclass;
begin
  if pg_catalog.has_table_privilege(
    'service_role',
    'public.erp_targets',
    'UPDATE'
  ) then
    raise exception 'ACL_INVALID: service_role puede mutar erp_targets directamente';
  end if;

  foreach forbidden_privilege in array array[
    'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ]
  loop
    if pg_catalog.has_table_privilege(
      'service_role',
      'public.facturasrecibidas_sync_attempts',
      forbidden_privilege
    ) then
      raise exception 'ACL_INVALID: service_role conserva % sobre sync_attempts',
        forbidden_privilege;
    end if;
  end loop;

  foreach snapshot_table in array array[
    'public.facturasrecibidas_asientos'::regclass,
    'public.facturasrecibidas_asiento_apuntes'::regclass,
    'public.facturasrecibidas_revisions'::regclass
  ]
  loop
    foreach forbidden_privilege in array array[
      'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    loop
      if pg_catalog.has_table_privilege(
        'service_role',
        snapshot_table,
        forbidden_privilege
      ) then
        raise exception 'ACL_INVALID: service_role conserva % sobre %',
          forbidden_privilege,
          snapshot_table;
      end if;
    end loop;
  end loop;

  if not pg_catalog.has_function_privilege(
    'service_role',
    'public.prepare_factura_recibida_accounting_v3(uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'service_role',
    'public.record_factura_recibida_accounting_v3(uuid,uuid,text,uuid,text,jsonb,text,text,text,uuid)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'service_role',
    'public.set_erp_target_accounting_mode_v3(text,uuid,text,text,jsonb,uuid)',
    'EXECUTE'
  ) then
    raise exception 'ACL_INVALID: faltan RPC contables para service_role';
  end if;

  if pg_catalog.has_function_privilege(
    'authenticated',
    'public.prepare_factura_recibida_accounting_v3(uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.record_factura_recibida_accounting_v3(uuid,uuid,text,uuid,text,jsonb,text,text,text,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.set_erp_target_accounting_mode_v3(text,uuid,text,text,jsonb,uuid)',
    'EXECUTE'
  ) then
    raise exception 'ACL_INVALID: authenticated puede ejecutar RPC contables';
  end if;
end;
$accounting_acl_assertions$;
