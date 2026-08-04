-- Resume accounting only while the operation is provably pre-commit.
-- This migration supersedes (without editing) the already deployed accounting
-- migrations. A commit phase is an irreversible boundary: it may only be
-- replayed through FastAPI with the exact same request_id and hashes. A new
-- request, an unknown result or a changed identity can never reopen it.

create or replace function private.assert_no_unresolved_factura_accounting_v3(
  p_target_id text,
  p_dataset_epoch uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.facturasrecibidas factura
    where factura.erp_target_id = p_target_id
      and (
        p_dataset_epoch is null
        or factura.erp_dataset_epoch = p_dataset_epoch
      )
      and factura.accounting_status in ('requested', 'pending', 'unknown')
  ) then
    raise exception
      'ACCOUNTING_OPERATION_BLOCKS_ENVIRONMENT_CHANGE: existen facturas contables pendientes o inciertas';
  end if;

  if exists (
    select 1
    from public.facturasrecibidas_sync_attempts attempt
    where attempt.erp_target_id = p_target_id
      and (
        p_dataset_epoch is null
        or attempt.erp_dataset_epoch = p_dataset_epoch
      )
      and attempt.circuit = 'accounting'
      and (
        attempt.status in ('in_progress', 'unknown')
        or attempt.reconciliation_required
      )
  ) then
    raise exception
      'ACCOUNTING_OPERATION_BLOCKS_ENVIRONMENT_CHANGE: existen intentos contables en curso o pendientes de reconciliacion';
  end if;
end;
$$;

-- Supersede the deployed sticky guard. An uncertain commit cannot be hidden as
-- stale (or any other state) and then reopened under a fresh request. The only
-- terminal transition is an exact created readback already persisted by the
-- privileged accounting recorder for the same request and hashes.
create or replace function public.keep_unknown_factura_accounting_sticky_v3()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.accounting_status <> 'unknown'
    or new.accounting_status = 'unknown'
  then
    return new;
  end if;

  if new.accounting_status <> 'created' then
    raise exception
      'ACCOUNTING_RECONCILIATION_REQUIRED: el resultado contable incierto no puede cambiar de estado sin readback exacto';
  end if;

  if new.accounting_request_id is null
    or new.accounting_request_id is distinct from old.accounting_request_id
    or new.erp_target_id is distinct from old.erp_target_id
    or new.erp_dataset_epoch is distinct from old.erp_dataset_epoch
    or new.accounting_payload_hash is null
    or new.accounting_payload_hash is distinct from old.accounting_payload_hash
    or new.accounting_invoice_fingerprint is null
    or new.accounting_invoice_fingerprint
      is distinct from old.accounting_invoice_fingerprint
    or new.accounting_verified_at is null
    or coalesce(new."FRR_IdAsientoNet", 0) <= 0
    or not exists (
      select 1
      from public.facturasrecibidas_sync_attempts attempt
      join public.facturasrecibidas_asientos asiento
        on asiento.factura_id = old.id
       and asiento.request_id = old.accounting_request_id
      where attempt.factura_id = old.id
        and attempt.request_id = old.accounting_request_id
        and attempt.phase = 'commit'
        and attempt.circuit = 'accounting'
        and attempt.status = 'succeeded'
        and not attempt.reconciliation_required
        and attempt.erp_target_id is not distinct from old.erp_target_id
        and attempt.erp_dataset_epoch is not distinct from old.erp_dataset_epoch
        and attempt.payload_hash is not distinct from old.accounting_payload_hash
        and attempt.business_fingerprint
          is not distinct from old.accounting_invoice_fingerprint
        and asiento.technical_id = new."FRR_IdAsientoNet"
        and asiento.status = 'created'
        and asiento.balanced
    )
  then
    raise exception
      'ACCOUNTING_RECONCILIATION_REQUIRED: falta evidencia persistida del readback contable exacto';
  end if;

  return new;
end;
$$;

create or replace function public.guard_erp_target_against_unresolved_accounting_v3()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.accounting_mode in ('official', 'sql_test')
    and new.write_mode <> 'management'
  then
    raise exception
      'ACCOUNTING_MODE_REQUIRES_MANAGEMENT: la contabilidad exige escritura de gestion activa';
  end if;

  if new.dataset_epoch is distinct from old.dataset_epoch
    or new.snapshot_at is distinct from old.snapshot_at
  then
    perform private.assert_no_unresolved_factura_accounting_v3(old.id, null);
  elsif new.write_mode is distinct from old.write_mode
    and (
      (old.write_mode = 'disabled' and new.write_mode = 'blocked')
      or (old.write_mode <> 'management' and new.write_mode = 'management')
    )
  then
    perform private.assert_no_unresolved_factura_accounting_v3(
      old.id,
      new.dataset_epoch
    );
  elsif new.accounting_mode is distinct from old.accounting_mode
    and new.accounting_mode in ('official', 'sql_test')
  then
    perform private.assert_no_unresolved_factura_accounting_v3(
      old.id,
      new.dataset_epoch
    );
  end if;

  return new;
end;
$$;

drop trigger if exists guard_erp_target_against_unresolved_accounting_v3
  on public.erp_targets;
create trigger guard_erp_target_against_unresolved_accounting_v3
before update of dataset_epoch, snapshot_at, write_mode, accounting_mode
on public.erp_targets
for each row
execute function public.guard_erp_target_against_unresolved_accounting_v3();

-- `record_factura_recibida_accounting_v3(..., 'pending', ...)` from the
-- deployed migration used to pre-create phase=commit. Suppress only that
-- legacy, unclaimed row. The explicit claim RPC below is the sole path that
-- may create the commit phase and includes commit_claimed=true in its payload.
create or replace function public.require_explicit_factura_accounting_commit_claim_v3()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.circuit = 'accounting'
    and new.phase = 'commit'
    and new.operation = 'commit'
    and new.status = 'in_progress'
    and new.request_payload->'commit_claimed' is distinct from 'true'::jsonb
  then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists require_explicit_factura_accounting_commit_claim_v3
  on public.facturasrecibidas_sync_attempts;
create trigger require_explicit_factura_accounting_commit_claim_v3
before insert on public.facturasrecibidas_sync_attempts
for each row
execute function public.require_explicit_factura_accounting_commit_claim_v3();

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
  v_validate public.facturasrecibidas_sync_attempts%rowtype;
  v_commit public.facturasrecibidas_sync_attempts%rowtype;
  v_request_payload jsonb;
  v_snapshot jsonb;
  v_resume_phase text := 'validate';
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
    or v_target.write_mode <> 'management'
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
  if v_current.is_readonly_reference
    or v_current.source_kind = 'erp_reference'
  then
    raise exception 'ACCOUNTING_NOT_READY: la referencia ERP es de solo consulta';
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
      'idempotent_replay', true,
      'resume_phase', 'created'
    );
  end if;

  if v_current.accounting_status = 'unknown' then
    if v_current.accounting_request_id is distinct from p_request_id then
      raise exception 'IDEMPOTENCY_CONFLICT: existe otra contabilizacion incierta';
    end if;
    return jsonb_build_object(
      'factura', to_jsonb(v_current),
      'version', v_current.row_version,
      'request_id', p_request_id,
      'remote_frr_id', coalesce(v_current.remote_frr_id, v_current."FRR_id"),
      'idempotent_replay', true,
      'resume_phase', 'reconcile',
      'reconciliation_required', true
    );
  end if;

  -- Closed allowlist: imported/stale references and any future state must never
  -- fall through to the fresh-request path. Pending is handled below only when
  -- its exact request and precommit evidence can be demonstrated.
  if v_current.accounting_status not in (
    'not_requested',
    'requested',
    'error',
    'pending'
  ) then
    raise exception
      'ACCOUNTING_NOT_READY: el estado contable no permite iniciar ni reanudar la operacion';
  end if;

  if v_current.accounting_request_id is not null
    and v_current.accounting_request_id is distinct from p_request_id
    and v_current.accounting_status in ('requested', 'pending', 'unknown')
  then
    raise exception 'IDEMPOTENCY_CONFLICT: existe otra contabilizacion en curso';
  end if;

  select *
  into v_commit
  from public.facturasrecibidas_sync_attempts
  where request_id = p_request_id
    and phase = 'commit'
  for update;

  if found then
    if v_commit.factura_id is distinct from p_factura_id
      or v_commit.erp_target_id is distinct from p_target_id
      or v_commit.erp_dataset_epoch is distinct from p_dataset_epoch
      or v_commit.circuit is distinct from 'accounting'
    then
      raise exception 'IDEMPOTENCY_CONFLICT: request_id contable ya corresponde a otra operacion';
    end if;

    -- A persisted in_progress claim may be replayed only with the exact same
    -- request and hashes. FastAPI's external idempotency store decides whether
    -- this is the first call, a cached result or still in progress.
    if v_current.accounting_status = 'pending'
      and v_current.accounting_request_id is not distinct from p_request_id
      and v_commit.status = 'in_progress'
      and not v_commit.reconciliation_required
      and v_current.accounting_payload_hash is not null
      and v_current.accounting_payload_hash is not distinct from v_commit.payload_hash
      and v_current.accounting_invoice_fingerprint is not null
      and v_current.accounting_invoice_fingerprint
        is not distinct from v_commit.business_fingerprint
    then
      return jsonb_build_object(
        'factura', to_jsonb(v_current),
        'version', v_current.row_version,
        'request_id', p_request_id,
        'remote_frr_id', coalesce(v_current.remote_frr_id, v_current."FRR_id"),
        'idempotent_replay', true,
        'resume_phase', 'commit',
        'commit_attempt_status', v_commit.status,
        'reconciliation_required', false
      );
    end if;

    return jsonb_build_object(
      'factura', to_jsonb(v_current),
      'version', v_current.row_version,
      'request_id', p_request_id,
      'remote_frr_id', coalesce(v_current.remote_frr_id, v_current."FRR_id"),
      'idempotent_replay', true,
      'resume_phase', 'reconcile',
      'commit_attempt_status', v_commit.status,
      'reconciliation_required', true
    );
  end if;

  select *
  into v_validate
  from public.facturasrecibidas_sync_attempts
  where request_id = p_request_id
    and phase = 'validate'
  for update;

  if v_current.accounting_status = 'pending' then
    if v_current.accounting_request_id is distinct from p_request_id then
      raise exception 'IDEMPOTENCY_CONFLICT: existe otra contabilizacion pendiente';
    end if;
    if not found
      or v_validate.factura_id is distinct from p_factura_id
      or v_validate.erp_target_id is distinct from p_target_id
      or v_validate.erp_dataset_epoch is distinct from p_dataset_epoch
      or v_validate.circuit is distinct from 'accounting'
    then
      raise exception 'ACCOUNTING_RECONCILIATION_REQUIRED: no se puede demostrar el estado precommit';
    end if;
    if v_validate.reconciliation_required
      or v_validate.status not in ('in_progress', 'succeeded')
      or (
        v_validate.status = 'succeeded'
        and (
          v_validate.payload_hash is null
          or v_validate.business_fingerprint is null
        )
      )
    then
      return jsonb_build_object(
        'factura', to_jsonb(v_current),
        'version', v_current.row_version,
        'request_id', p_request_id,
        'remote_frr_id', coalesce(v_current.remote_frr_id, v_current."FRR_id"),
        'idempotent_replay', true,
        'resume_phase', 'reconcile',
        'validation_attempt_status', v_validate.status,
        'reconciliation_required', true
      );
    end if;

    v_resume_phase := case
      when v_validate.status = 'succeeded' then 'precommit'
      else 'validate'
    end;
    return jsonb_build_object(
      'factura', to_jsonb(v_current),
      'version', v_current.row_version,
      'request_id', p_request_id,
      'remote_frr_id', coalesce(v_current.remote_frr_id, v_current."FRR_id"),
      'idempotent_replay', true,
      'resume_phase', v_resume_phase,
      'reconciliation_required', false
    );
  end if;

  v_request_payload := jsonb_build_object(
    'contract_version', 3,
    'operation', 'validate',
    'request_id', p_request_id,
    'target_id', p_target_id,
    'dataset_epoch', p_dataset_epoch,
    'factura_id', coalesce(v_current.remote_frr_id, v_current."FRR_id")
  );

  if found then
    if v_validate.factura_id is distinct from p_factura_id
      or v_validate.erp_target_id is distinct from p_target_id
      or v_validate.erp_dataset_epoch is distinct from p_dataset_epoch
      or v_validate.circuit is distinct from 'accounting'
    then
      raise exception 'IDEMPOTENCY_CONFLICT: request_id contable ya corresponde a otra operacion';
    end if;
    if v_validate.reconciliation_required
      or v_validate.status in ('unknown', 'failed')
    then
      raise exception 'IDEMPOTENCY_CONFLICT: use un request_id nuevo tras un intento fallido o incierto';
    end if;
    v_resume_phase := case
      when v_validate.status = 'succeeded' then 'precommit'
      else 'validate'
    end;
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
    'idempotent_replay', false,
    'resume_phase', v_resume_phase,
    'reconciliation_required', false
  );
end;
$$;

create or replace function public.begin_factura_recibida_accounting_commit_v3(
  p_factura_id uuid,
  p_request_id uuid,
  p_target_id text,
  p_dataset_epoch uuid,
  p_payload_hash text,
  p_invoice_fingerprint text,
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
  v_validate public.facturasrecibidas_sync_attempts%rowtype;
  v_commit public.facturasrecibidas_sync_attempts%rowtype;
begin
  if p_factura_id is null
    or p_request_id is null
    or nullif(btrim(p_target_id), '') is null
    or p_dataset_epoch is null
    or p_payload_hash !~ '^[0-9a-f]{64}$'
    or p_invoice_fingerprint !~ '^[0-9a-f]{64}$'
  then
    raise exception 'INVALID_PAYLOAD: identidad y hashes contables requeridos';
  end if;

  select *
  into v_target
  from public.erp_targets
  where id = p_target_id
  for share;

  if not found
    or not v_target.active
    or v_target.dataset_epoch is distinct from p_dataset_epoch
    or v_target.write_mode <> 'management'
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
    or v_current.is_readonly_reference
    or v_current.source_kind = 'erp_reference'
    or not v_current.accounting_requested
    or v_current.accounting_status <> 'pending'
    or v_current.accounting_request_id is distinct from p_request_id
    or v_current.erp_target_id is distinct from p_target_id
    or v_current.erp_dataset_epoch is distinct from p_dataset_epoch
    or coalesce(v_current.remote_frr_id, v_current."FRR_id", 0) <= 0
    or v_current.accounting_payload_hash is distinct from p_payload_hash
    or v_current.accounting_invoice_fingerprint
      is distinct from p_invoice_fingerprint
  then
    raise exception 'ACCOUNTING_NOT_READY: la operacion no esta en precommit';
  end if;

  select *
  into v_validate
  from public.facturasrecibidas_sync_attempts
  where factura_id = p_factura_id
    and request_id = p_request_id
    and phase = 'validate'
    and circuit = 'accounting'
  for update;

  if not found
    or v_validate.status <> 'succeeded'
    or v_validate.reconciliation_required
    or v_validate.erp_target_id is distinct from p_target_id
    or v_validate.erp_dataset_epoch is distinct from p_dataset_epoch
    or v_validate.payload_hash is distinct from p_payload_hash
    or v_validate.business_fingerprint is distinct from p_invoice_fingerprint
  then
    raise exception 'ACCOUNTING_NOT_READY: la validacion precommit no coincide';
  end if;

  select *
  into v_commit
  from public.facturasrecibidas_sync_attempts
  where request_id = p_request_id
    and phase = 'commit'
  for update;

  if found then
    if v_commit.factura_id is distinct from p_factura_id
      or v_commit.erp_target_id is distinct from p_target_id
      or v_commit.erp_dataset_epoch is distinct from p_dataset_epoch
      or v_commit.circuit is distinct from 'accounting'
      or v_commit.payload_hash is distinct from p_payload_hash
      or v_commit.business_fingerprint is distinct from p_invoice_fingerprint
    then
      raise exception 'IDEMPOTENCY_CONFLICT: commit contable ya pertenece a otra operacion';
    end if;

    if v_commit.status = 'in_progress'
      and not v_commit.reconciliation_required
    then
      return jsonb_build_object(
        'factura', to_jsonb(v_current),
        'version', v_current.row_version,
        'request_id', p_request_id,
        'commit_authorized', true,
        'commit_replay', true,
        'commit_attempt_status', v_commit.status,
        'reconciliation_required', false,
        'idempotent_replay', true
      );
    end if;

    return jsonb_build_object(
      'factura', to_jsonb(v_current),
      'version', v_current.row_version,
      'request_id', p_request_id,
      'commit_authorized', false,
      'commit_attempt_status', v_commit.status,
      'reconciliation_required', true,
      'idempotent_replay', true
    );
  end if;

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
    reconciliation_required,
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
      'factura_id', coalesce(v_current.remote_frr_id, v_current."FRR_id"),
      'commit_claimed', true,
      'commit_claimed_at', now()
    ),
    p_target_id,
    p_dataset_epoch,
    'accounting',
    p_payload_hash,
    p_invoice_fingerprint,
    false,
    p_actor
  )
  returning * into v_commit;

  return jsonb_build_object(
    'factura', to_jsonb(v_current),
    'version', v_current.row_version,
    'request_id', p_request_id,
    'commit_authorized', true,
    'commit_attempt_status', v_commit.status,
    'reconciliation_required', false,
    'idempotent_replay', false
  );
end;
$$;

-- Override the epoch rotation entry point so the accounting check runs before
-- references are marked stale. A later target trigger alone would be too late:
-- those row updates occur earlier in the same transaction.
create or replace function private.rotate_erp_target_epoch_v3_impl(
  p_target_id text,
  p_dataset_epoch uuid,
  p_snapshot_at timestamptz,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.erp_targets%rowtype;
  v_stale_count integer := 0;
  v_invalidated_count integer := 0;
begin
  if nullif(btrim(p_target_id), '') is null
    or p_dataset_epoch is null
    or p_snapshot_at is null
  then
    raise exception 'INVALID_PAYLOAD: target, dataset_epoch y snapshot_at son requeridos';
  end if;

  select *
  into v_target
  from public.erp_targets
  where id = p_target_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: target ERP no encontrado';
  end if;
  if v_target.dataset_epoch is not distinct from p_dataset_epoch then
    if v_target.snapshot_at is distinct from p_snapshot_at then
      raise exception 'IDEMPOTENCY_CONFLICT: dataset_epoch ya esta ligado a otro snapshot_at';
    end if;
    return jsonb_build_object(
      'target_id', p_target_id,
      'dataset_epoch', p_dataset_epoch,
      'idempotent_replay', true,
      'stale_references', 0,
      'invalidated_validations', 0
    );
  end if;

  perform private.assert_no_unresolved_factura_accounting_v3(p_target_id, null);

  if exists (
    select 1
    from public.facturasrecibidas factura
    where factura.erp_target_id = p_target_id
      and factura.erp_dataset_epoch is distinct from p_dataset_epoch
      and factura.sync_status in ('sending', 'unknown', 'reconciling')
  ) then
    raise exception 'EPOCH_ROTATION_BLOCKED: existen operaciones inciertas o en curso';
  end if;

  with stale_references as (
    update public.facturasrecibidas
    set sync_status = 'stale',
        erp_reference_status = 'stale',
        erp_validation_status = 'stale',
        accounting_status = case
          when accounting_status in (
            'created',
            'pending',
            'requested',
            'reference_unverified'
          )
            then 'stale'
          else accounting_status
        end,
        erp_error = 'Referencia ERP caducada tras cambiar la generacion del entorno',
        row_version = row_version + 1,
        updated_by = p_actor,
        updated_at = now()
    where erp_target_id = p_target_id
      and erp_dataset_epoch is distinct from p_dataset_epoch
      and (
        remote_frr_id is not null
        or "FRR_id" is not null
      )
    returning id, row_version
  )
  insert into public.facturasrecibidas_revisions (
    factura_id,
    revision_number,
    change_type,
    change_source,
    reason,
    changed_by,
    snapshot
  )
  select
    stale_references.id,
    stale_references.row_version,
    'update',
    'epoch_rotation_v3',
    'stale_environment',
    p_actor,
    public.factura_recibida_snapshot_v2(stale_references.id)
  from stale_references;

  get diagnostics v_stale_count = row_count;

  with invalidated_validations as (
    update public.facturasrecibidas
    set sync_status = case
          when duplicada_de is not null then 'draft'
          when jsonb_typeof(coalesce(validation_errors, '[]'::jsonb)) <> 'array'
            then 'draft'
          when exists (
            select 1
            from jsonb_array_elements(
              coalesce(validation_errors, '[]'::jsonb)
            ) issue(value)
            where lower(coalesce(issue.value->>'severity', 'error')) <> 'warning'
          )
            then 'draft'
          else 'ready'
        end,
        erp_reference_status = 'unverified',
        erp_validation_status = 'not_validated',
        erp_validation_request_id = null,
        erp_validated_at = null,
        erp_payload_hash = null,
        erp_business_fingerprint = null,
        erp_verified_at = null,
        erp_target_id = null,
        erp_dataset_epoch = null,
        last_request_id = null,
        erp_response = null,
        erp_error = null,
        row_version = row_version + 1,
        updated_by = p_actor,
        updated_at = now()
    where erp_target_id = p_target_id
      and erp_dataset_epoch is distinct from p_dataset_epoch
      and remote_frr_id is null
      and "FRR_id" is null
    returning id, row_version
  )
  insert into public.facturasrecibidas_revisions (
    factura_id,
    revision_number,
    change_type,
    change_source,
    reason,
    changed_by,
    snapshot
  )
  select
    invalidated_validations.id,
    invalidated_validations.row_version,
    'update',
    'epoch_rotation_v3',
    'epoch_validation_invalidated',
    p_actor,
    public.factura_recibida_snapshot_v2(invalidated_validations.id)
  from invalidated_validations;

  get diagnostics v_invalidated_count = row_count;

  update public.erp_targets
  set dataset_epoch = p_dataset_epoch,
      snapshot_at = p_snapshot_at,
      write_mode = 'disabled',
      accounting_mode = 'unavailable',
      metadata = metadata || jsonb_build_object(
        'provisioning_status',
        'epoch_rotated',
        'rotated_at',
        now(),
        'rotated_by',
        p_actor
      ),
      updated_at = now()
  where id = p_target_id
  returning * into v_target;

  return jsonb_build_object(
    'target',
    to_jsonb(v_target),
    'stale_references',
    v_stale_count,
    'invalidated_validations',
    v_invalidated_count,
    'idempotent_replay',
    false
  );
end;
$$;

comment on function public.begin_factura_recibida_accounting_commit_v3(
  uuid, uuid, text, uuid, text, text, uuid
) is
  'Abre una sola vez la fase commit contable tras validate=succeeded. Solo in_progress permite replay del mismo request/hash; unknown exige reconciliacion.';

comment on function private.assert_no_unresolved_factura_accounting_v3(
  text, uuid
) is
  'Bloquea rotacion/activacion del target si existen estados o intentos contables en curso o inciertos.';

revoke all on function private.assert_no_unresolved_factura_accounting_v3(
  text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.keep_unknown_factura_accounting_sticky_v3()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_erp_target_against_unresolved_accounting_v3()
  from public, anon, authenticated, service_role;
revoke all on function public.require_explicit_factura_accounting_commit_claim_v3()
  from public, anon, authenticated, service_role;
revoke execute on function public.begin_factura_recibida_accounting_commit_v3(
  uuid, uuid, text, uuid, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.begin_factura_recibida_accounting_commit_v3(
  uuid, uuid, text, uuid, text, text, uuid
) to service_role;

do $accounting_resume_acl_assertions$
begin
  if pg_catalog.has_function_privilege(
    'anon',
    'public.begin_factura_recibida_accounting_commit_v3(uuid,uuid,text,uuid,text,text,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.begin_factura_recibida_accounting_commit_v3(uuid,uuid,text,uuid,text,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'ACL_INVALID: clientes pueden abrir el commit contable';
  end if;

  if not pg_catalog.has_function_privilege(
    'service_role',
    'public.begin_factura_recibida_accounting_commit_v3(uuid,uuid,text,uuid,text,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'ACL_INVALID: service_role no puede abrir el commit contable';
  end if;
end;
$accounting_resume_acl_assertions$;
