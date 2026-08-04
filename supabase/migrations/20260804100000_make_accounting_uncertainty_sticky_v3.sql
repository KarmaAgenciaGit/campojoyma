-- Accounting uncertainty is fail-closed. This migration is intentionally
-- separate from 20260804093000 because that migration may already be deployed.

create or replace function public.disable_erp_target_accounting_on_identity_change_v3()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.accounting_mode <> 'unavailable'
    and (
      new.write_mode <> 'management'
      or new.dataset_epoch is distinct from old.dataset_epoch
      or new.snapshot_at is distinct from old.snapshot_at
    )
  then
    new.accounting_mode := 'unavailable';
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'accounting_auto_disabled_at', now(),
      'accounting_auto_disabled_reason',
      case
        when new.write_mode <> 'management' then 'management_write_mode_closed'
        else 'dataset_identity_changed'
      end
    );
  end if;
  return new;
end;
$$;

drop trigger if exists disable_erp_target_accounting_on_identity_change_v3
  on public.erp_targets;
create trigger disable_erp_target_accounting_on_identity_change_v3
before update of write_mode, dataset_epoch, snapshot_at
on public.erp_targets
for each row
execute function public.disable_erp_target_accounting_on_identity_change_v3();

create or replace function public.keep_unknown_factura_accounting_sticky_v3()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.accounting_status = 'unknown'
    and new.accounting_status not in ('unknown', 'created', 'stale')
  then
    raise exception
      'ACCOUNTING_RECONCILIATION_REQUIRED: el resultado contable incierto no puede reabrirse';
  end if;
  return new;
end;
$$;

drop trigger if exists keep_unknown_factura_accounting_sticky_v3
  on public.facturasrecibidas;
create trigger keep_unknown_factura_accounting_sticky_v3
before update of accounting_status
on public.facturasrecibidas
for each row
execute function public.keep_unknown_factura_accounting_sticky_v3();

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

  if v_current.accounting_status in ('pending', 'unknown') then
    if v_current.accounting_request_id is distinct from p_request_id then
      raise exception 'IDEMPOTENCY_CONFLICT: existe otra contabilizacion pendiente';
    end if;
    return jsonb_build_object(
      'factura', to_jsonb(v_current),
      'version', v_current.row_version,
      'request_id', p_request_id,
      'remote_frr_id', coalesce(v_current.remote_frr_id, v_current."FRR_id"),
      'idempotent_replay', true,
      'reconciliation_required', true
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

comment on function public.prepare_factura_recibida_accounting_v3(uuid, uuid, text, uuid, uuid) is
  'Claims one accounting operation. Existing pending/unknown requests are sticky and require reconciliation; they never reopen Netagro commit.';

comment on function public.disable_erp_target_accounting_on_identity_change_v3() is
  'Fail-closed guard: accounting is disabled whenever management writes close or the target dataset identity changes.';

revoke all on function public.disable_erp_target_accounting_on_identity_change_v3()
  from public, anon, authenticated, service_role;
revoke all on function public.keep_unknown_factura_accounting_sticky_v3()
  from public, anon, authenticated, service_role;
