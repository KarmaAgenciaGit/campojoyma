-- Facturas recibidas ERP contract v3.
--
-- This migration is intentionally fail-closed:
--   * it does not enable MariaDB writes;
--   * it does not fabricate a dataset epoch;
--   * historical remote identifiers remain auditable but unverified;
--   * validation is a separate state and never opens `sending`;
--   * only service_role may mutate targets, attempts or sync state.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema private to service_role;

create table if not exists public.erp_targets (
  id text primary key,
  display_name text not null,
  environment text not null,
  dataset_epoch uuid,
  snapshot_at timestamptz,
  write_mode text not null default 'disabled',
  accounting_mode text not null default 'unavailable',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_targets_id_check check (
    id ~ '^[a-z0-9][a-z0-9_-]{2,63}$'
  ),
  constraint erp_targets_environment_check check (
    environment in ('test', 'production')
  ),
  constraint erp_targets_write_mode_check check (
    write_mode in ('disabled', 'blocked', 'management')
  ),
  constraint erp_targets_accounting_mode_check check (
    accounting_mode in ('unavailable', 'official')
  ),
  constraint erp_targets_metadata_object_check check (
    jsonb_typeof(metadata) = 'object'
  ),
  constraint erp_targets_dataset_identity_check check (
    (
      dataset_epoch is null
      and snapshot_at is null
      and write_mode = 'disabled'
    )
    or (
      dataset_epoch is not null
      and snapshot_at is not null
    )
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'erp_targets_dataset_identity_check'
      and conrelid = 'public.erp_targets'::regclass
  ) then
    alter table public.erp_targets
      add constraint erp_targets_dataset_identity_check check (
        (
          dataset_epoch is null
          and snapshot_at is null
          and write_mode = 'disabled'
        )
        or (
          dataset_epoch is not null
          and snapshot_at is not null
        )
      );
  end if;
end;
$$;

create unique index if not exists erp_targets_one_active_per_environment_uidx
  on public.erp_targets (environment)
  where active;

insert into public.erp_targets (
  id,
  display_name,
  environment,
  dataset_epoch,
  snapshot_at,
  write_mode,
  accounting_mode,
  active,
  metadata
)
values (
  'netagro-test-write',
  'Netagro TEST persistente',
  'test',
  null,
  null,
  'disabled',
  'unavailable',
  true,
  jsonb_build_object(
    'provisioning_status',
    'pending',
    'note',
    'dataset_epoch debe provisionarse junto al clon persistente antes de validar o escribir'
  )
)
on conflict (id) do nothing;

alter table public.facturasrecibidas
  add column if not exists erp_target_id text,
  add column if not exists erp_dataset_epoch uuid,
  add column if not exists erp_payload_hash text,
  add column if not exists erp_business_fingerprint text,
  add column if not exists erp_verified_at timestamptz,
  add column if not exists erp_reference_status text not null default 'unverified',
  add column if not exists erp_validation_status text not null default 'not_validated',
  add column if not exists erp_validation_request_id uuid,
  add column if not exists erp_validated_at timestamptz,
  add column if not exists fecha_ctb_source text not null default 'invoice_date';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_erp_target_id_fkey'
      and conrelid = 'public.facturasrecibidas'::regclass
  ) then
    alter table public.facturasrecibidas
      add constraint facturasrecibidas_erp_target_id_fkey
      foreign key (erp_target_id)
      references public.erp_targets(id)
      on update restrict
      on delete restrict;
  end if;
end;
$$;

alter table public.facturasrecibidas
  drop constraint if exists facturasrecibidas_sync_status_check,
  drop constraint if exists facturasrecibidas_accounting_status_check,
  drop constraint if exists facturasrecibidas_erp_identity_pair_check,
  drop constraint if exists facturasrecibidas_erp_payload_hash_check,
  drop constraint if exists facturasrecibidas_erp_business_fingerprint_check,
  drop constraint if exists facturasrecibidas_erp_reference_status_check,
  drop constraint if exists facturasrecibidas_erp_validation_status_check,
  drop constraint if exists facturasrecibidas_fecha_ctb_source_check,
  drop constraint if exists facturasrecibidas_validation_identity_check;

alter table public.facturasrecibidas
  add constraint facturasrecibidas_sync_status_check check (
    sync_status in (
      'draft',
      'ready',
      'sending',
      'unknown',
      'sent',
      'error',
      'reconciling',
      'stale'
    )
  ),
  add constraint facturasrecibidas_accounting_status_check check (
    accounting_status in (
      'not_requested',
      'requested',
      'pending',
      'created',
      'reference_unverified',
      'error',
      'unknown',
      'stale'
    )
  ),
  add constraint facturasrecibidas_erp_identity_pair_check check (
    (erp_target_id is null and erp_dataset_epoch is null)
    or (erp_target_id is not null and erp_dataset_epoch is not null)
  ),
  add constraint facturasrecibidas_erp_payload_hash_check check (
    erp_payload_hash is null
    or erp_payload_hash ~ '^[0-9a-f]{64}$'
  ),
  add constraint facturasrecibidas_erp_business_fingerprint_check check (
    erp_business_fingerprint is null
    or erp_business_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  add constraint facturasrecibidas_erp_reference_status_check check (
    erp_reference_status in (
      'unverified',
      'legacy_unverified',
      'valid',
      'stale'
    )
  ),
  add constraint facturasrecibidas_erp_validation_status_check check (
    erp_validation_status in ('not_validated', 'valid', 'invalid', 'stale')
  ),
  add constraint facturasrecibidas_fecha_ctb_source_check check (
    fecha_ctb_source in ('invoice_date', 'manual')
  ),
  add constraint facturasrecibidas_validation_identity_check check (
    erp_validation_status = 'not_validated'
    or (
      erp_validation_status = 'stale'
      and (
        remote_frr_id is not null
        or "FRR_id" is not null
      )
    )
    or (
      erp_validation_request_id is not null
      and erp_validated_at is not null
      and erp_target_id is not null
      and erp_dataset_epoch is not null
      and erp_payload_hash is not null
      and erp_business_fingerprint is not null
    )
  );

update public.facturasrecibidas
set fecha_ctb_source = case
    when "FRR_fechactb" is null
      or "FRR_fechafactura" is null
      or "FRR_fechactb" = "FRR_fechafactura"
      then 'invoice_date'
    else 'manual'
  end
where fecha_ctb_source is distinct from case
    when "FRR_fechactb" is null
      or "FRR_fechafactura" is null
      or "FRR_fechactb" = "FRR_fechafactura"
      then 'invoice_date'
    else 'manual'
  end;

-- Existing remote references predate target/epoch identity. Keep them visible,
-- but never present them as verified against the current clone.
with changed as (
  update public.facturasrecibidas
  set erp_reference_status = 'legacy_unverified',
      erp_validation_status = 'not_validated',
      accounting_status = case
        when accounting_status = 'created' then 'reference_unverified'
        when coalesce("FRR_IdAsientoNet", 0) > 0 then 'reference_unverified'
        else accounting_status
      end,
      row_version = row_version + 1,
      updated_at = now()
  where remote_frr_id is not null
    and remote_frr_id <> 49681
    and erp_target_id is null
    and erp_dataset_epoch is null
    and (
      erp_reference_status is distinct from 'legacy_unverified'
      or erp_validation_status is distinct from 'not_validated'
      or accounting_status is distinct from case
        when accounting_status = 'created' then 'reference_unverified'
        when coalesce("FRR_IdAsientoNet", 0) > 0 then 'reference_unverified'
        else accounting_status
      end
    )
  returning id, row_version
)
insert into public.facturasrecibidas_revisions (
  factura_id,
  revision_number,
  change_type,
  change_source,
  reason,
  snapshot
)
select
  changed.id,
  changed.row_version,
  'update',
  'migration_erp_v3',
  'legacy_unverified',
  public.factura_recibida_snapshot_v2(changed.id)
from changed
on conflict (factura_id, revision_number) do nothing;

-- The TEST clone refresh reused this numeric identifier for a different invoice.
-- Preserve every audit record and mark only the local reference as stale.
with changed as (
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
      erp_error = 'Referencia ERP caducada tras refrescar el clon TEST',
      row_version = row_version + 1,
      updated_at = now()
  where remote_frr_id = 49681
    and erp_target_id is null
    and erp_dataset_epoch is null
    and (
      sync_status is distinct from 'stale'
      or erp_reference_status is distinct from 'stale'
      or erp_validation_status is distinct from 'stale'
      or accounting_status is distinct from case
        when accounting_status in (
          'created',
          'pending',
          'requested',
          'reference_unverified'
        )
          then 'stale'
        else accounting_status
      end
      or erp_error is distinct from
        'Referencia ERP caducada tras refrescar el clon TEST'
    )
  returning id, row_version
)
insert into public.facturasrecibidas_revisions (
  factura_id,
  revision_number,
  change_type,
  change_source,
  reason,
  snapshot
)
select
  changed.id,
  changed.row_version,
  'update',
  'migration_erp_v3',
  'stale_environment',
  public.factura_recibida_snapshot_v2(changed.id)
from changed
on conflict (factura_id, revision_number) do nothing;

drop index if exists public.idx_facturasrecibidas_remote_frr_id_unique;

create unique index if not exists
  idx_facturasrecibidas_target_epoch_remote_frr_id_unique
on public.facturasrecibidas (
  erp_target_id,
  erp_dataset_epoch,
  remote_frr_id
)
where erp_target_id is not null
  and erp_dataset_epoch is not null
  and remote_frr_id is not null;

create index if not exists idx_facturasrecibidas_target_epoch_status
  on public.facturasrecibidas (
    erp_target_id,
    erp_dataset_epoch,
    sync_status,
    updated_at desc
  )
  where erp_target_id is not null;

create index if not exists idx_facturasrecibidas_validation_status
  on public.facturasrecibidas (
    erp_validation_status,
    erp_validated_at desc
  );

alter table public.facturasrecibidas_sync_attempts
  add column if not exists operation text,
  add column if not exists erp_target_id text,
  add column if not exists erp_dataset_epoch uuid,
  add column if not exists circuit text,
  add column if not exists payload_hash text,
  add column if not exists business_fingerprint text,
  add column if not exists error_code text,
  add column if not exists error_category text,
  add column if not exists retryable boolean not null default false,
  add column if not exists reconciliation_required boolean not null default false;

update public.facturasrecibidas_sync_attempts
set operation = case
    when phase = 'dry_run' then 'validate'
    else phase
  end
where operation is null;

alter table public.facturasrecibidas_sync_attempts
  alter column operation set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_sync_attempts_erp_target_id_fkey'
      and conrelid = 'public.facturasrecibidas_sync_attempts'::regclass
  ) then
    alter table public.facturasrecibidas_sync_attempts
      add constraint facturasrecibidas_sync_attempts_erp_target_id_fkey
      foreign key (erp_target_id)
      references public.erp_targets(id)
      on update restrict
      on delete restrict;
  end if;
end;
$$;

alter table public.facturasrecibidas_sync_attempts
  drop constraint if exists facturasrecibidas_sync_contract_check,
  drop constraint if exists facturasrecibidas_sync_phase_check,
  drop constraint if exists facturasrecibidas_sync_operation_check,
  drop constraint if exists facturasrecibidas_sync_identity_pair_check,
  drop constraint if exists facturasrecibidas_sync_payload_hash_check,
  drop constraint if exists facturasrecibidas_sync_business_fingerprint_check,
  drop constraint if exists facturasrecibidas_sync_error_category_check;

alter table public.facturasrecibidas_sync_attempts
  add constraint facturasrecibidas_sync_contract_check check (
    contract_version in (2, 3)
  ),
  add constraint facturasrecibidas_sync_phase_check check (
    phase in ('dry_run', 'validate', 'commit', 'readback', 'reconcile')
  ),
  add constraint facturasrecibidas_sync_operation_check check (
    operation in ('validate', 'commit', 'readback', 'reconcile')
  ),
  add constraint facturasrecibidas_sync_identity_pair_check check (
    (erp_target_id is null and erp_dataset_epoch is null)
    or (erp_target_id is not null and erp_dataset_epoch is not null)
  ),
  add constraint facturasrecibidas_sync_payload_hash_check check (
    payload_hash is null or payload_hash ~ '^[0-9a-f]{64}$'
  ),
  add constraint facturasrecibidas_sync_business_fingerprint_check check (
    business_fingerprint is null
    or business_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  add constraint facturasrecibidas_sync_error_category_check check (
    error_category is null
    or error_category in (
      'validation',
      'environment',
      'conflict',
      'transport',
      'accounting'
    )
  );

create index if not exists idx_facturas_sync_attempts_target_epoch
  on public.facturasrecibidas_sync_attempts (
    erp_target_id,
    erp_dataset_epoch,
    started_at desc
  )
  where erp_target_id is not null;

create index if not exists idx_facturas_sync_attempts_watchdog
  on public.facturasrecibidas_sync_attempts (started_at)
  where status = 'in_progress'
    and operation in ('commit', 'readback', 'reconcile');

create or replace function public.fill_factura_sync_attempt_operation_v3()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.operation is null then
    new.operation := case
      when new.phase = 'dry_run' then 'validate'
      else new.phase
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists fill_factura_sync_attempt_operation_v3
  on public.facturasrecibidas_sync_attempts;
create trigger fill_factura_sync_attempt_operation_v3
  before insert on public.facturasrecibidas_sync_attempts
  for each row
  execute function public.fill_factura_sync_attempt_operation_v3();

alter table public.facturas_recibidas_erp_rules
  add column if not exists punteo_difference_policy text;

alter table public.facturas_recibidas_erp_rules
  drop constraint if exists facturas_recibidas_erp_rules_punteo_difference_policy_check;

alter table public.facturas_recibidas_erp_rules
  add constraint facturas_recibidas_erp_rules_punteo_difference_policy_check
  check (
    punteo_difference_policy is null
    or punteo_difference_policy in ('warning', 'block')
  );

update public.facturas_recibidas_erp_rules
set punteo_difference_policy = 'warning',
    approval_note = concat_ws(
      ' ',
      nullif(btrim(approval_note), ''),
      'Las diferencias de punteo se muestran como aviso salvo regla aprobada de bloqueo.'
    ),
    updated_at = now()
where empresa_id = 1
  and proveedor_id is null
  and punteo_difference_policy is null;

comment on table public.erp_targets is
  'Entornos ERP autorizados. dataset_epoch identifica de forma inmutable el snapshot actualmente conectado.';
comment on column public.erp_targets.dataset_epoch is
  'Debe provisionarse junto al clon; NULL mantiene validacion y escritura cerradas.';
comment on column public.facturasrecibidas.erp_reference_status is
  'Validez de la referencia remota respecto a target_id + dataset_epoch.';
comment on column public.facturasrecibidas.erp_validation_status is
  'Validacion ERP independiente del estado documental y del registro remoto.';
comment on column public.facturasrecibidas.fecha_ctb_source is
  'invoice_date sigue la fecha de factura; manual impide sobrescrituras automaticas.';
comment on column public.facturas_recibidas_erp_rules.punteo_difference_policy is
  'warning muestra diferencias; block impide validar. NULL hereda la regla general.';

drop trigger if exists update_erp_targets_updated_at on public.erp_targets;
create trigger update_erp_targets_updated_at
  before update on public.erp_targets
  for each row
  execute function public.update_updated_at_column();

alter table public.erp_targets enable row level security;

drop policy if exists "ERP targets: permitted read" on public.erp_targets;
create policy "ERP targets: permitted read"
on public.erp_targets
for select
to authenticated
using ((select public.can_access_route('/facturas-recibidas')));

revoke all on table public.erp_targets
  from public, anon, authenticated, service_role;
grant select on table public.erp_targets
  to authenticated, service_role;

-- Keep the existing admin-only attempt policy, but make Data API grants
-- explicit for the 2026 Supabase exposure change.
alter table public.facturasrecibidas_sync_attempts enable row level security;
revoke all on table public.facturasrecibidas_sync_attempts
  from public, anon, authenticated;
grant select on table public.facturasrecibidas_sync_attempts
  to authenticated;
grant select, insert, update on table public.facturasrecibidas_sync_attempts
  to service_role;

create or replace function public.enforce_factura_received_state_v3()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_has_blocking_errors boolean := false;
begin
  if new.fecha_ctb_source not in ('invoice_date', 'manual') then
    new.fecha_ctb_source := 'invoice_date';
  end if;

  if tg_op = 'INSERT' then
    if new.fecha_ctb_source = 'invoice_date' and new."FRR_fechactb" is null then
      new."FRR_fechactb" := new."FRR_fechafactura";
    end if;
  else
    if new.fecha_ctb_source = 'invoice_date' then
      if new."FRR_fechafactura" is distinct from old."FRR_fechafactura" then
        if new."FRR_fechactb" is not distinct from old."FRR_fechactb"
          or new."FRR_fechactb" is not distinct from new."FRR_fechafactura"
        then
          new."FRR_fechactb" := new."FRR_fechafactura";
        else
          new.fecha_ctb_source := 'manual';
        end if;
      elsif new."FRR_fechactb" is distinct from old."FRR_fechactb" then
        new.fecha_ctb_source := 'manual';
      end if;
    end if;

    -- Any editable revision invalidates the previous ERP validation. Sync and
    -- readback transitions have their own explicit state machine below.
    if new.row_version > old.row_version
      and new.sync_status in ('draft', 'ready')
    then
      new.erp_validation_status := 'not_validated';
      new.erp_validation_request_id := null;
      new.erp_validated_at := null;
      new.erp_payload_hash := null;
      new.erp_business_fingerprint := null;
    end if;
  end if;

  if new.sync_status in ('draft', 'ready') then
    if jsonb_typeof(coalesce(new.validation_errors, '[]'::jsonb)) = 'array' then
      select exists (
        select 1
        from jsonb_array_elements(new.validation_errors) issue(value)
        where lower(coalesce(issue.value->>'severity', 'error')) <> 'warning'
      )
      into v_has_blocking_errors;
    else
      v_has_blocking_errors := true;
    end if;

    -- Discarding is an explicit, safe manual decision. It is terminal for this
    -- staging row unless a future dedicated restore flow is introduced.
    if new.estado = 'descartada'
      or (tg_op = 'UPDATE' and old.estado = 'descartada')
    then
      new.estado := 'descartada';
      new.sync_status := 'draft';
    elsif new.duplicada_de is not null then
      new.estado := 'duplicada';
      new.sync_status := 'draft';
    elsif v_has_blocking_errors then
      new.estado := 'pendiente_revision';
      new.sync_status := 'draft';
    else
      new.estado := 'validada';
      new.sync_status := 'ready';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_factura_received_state_v3
  on public.facturasrecibidas;
create trigger enforce_factura_received_state_v3
  before insert or update on public.facturasrecibidas
  for each row
  execute function public.enforce_factura_received_state_v3();

create or replace function public.record_factura_recibida_validation_v3(
  p_factura_id uuid,
  p_expected_version bigint,
  p_request_id uuid,
  p_target_id text,
  p_dataset_epoch uuid,
  p_payload_hash text,
  p_business_fingerprint text,
  p_payload jsonb,
  p_response jsonb,
  p_valid boolean,
  p_http_status integer default null,
  p_error_code text default null,
  p_error_category text default null,
  p_error text default null,
  p_retryable boolean default false,
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
  v_existing public.facturasrecibidas_sync_attempts%rowtype;
  v_legacy_payload jsonb;
begin
  if p_factura_id is null
    or p_request_id is null
    or nullif(btrim(p_target_id), '') is null
    or p_dataset_epoch is null
  then
    raise exception 'INVALID_PAYLOAD: factura, request, target y dataset_epoch son requeridos';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'INVALID_PAYLOAD: expected_version es requerido';
  end if;
  if p_payload_hash !~ '^[0-9a-f]{64}$'
    or p_business_fingerprint !~ '^[0-9a-f]{64}$'
  then
    raise exception 'INVALID_PAYLOAD: hashes SHA-256 en minusculas son requeridos';
  end if;
  if p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or p_payload->'contract_version' is distinct from '3'::jsonb
    or p_payload->>'operation' <> 'validate'
    or p_payload->>'request_id' <> p_request_id::text
    or p_payload->>'target_id' <> p_target_id
    or p_payload->>'dataset_epoch' <> p_dataset_epoch::text
  then
    raise exception 'INVALID_PAYLOAD: payload validate v3 no coincide con su identidad';
  end if;
  if p_error_category is not null
    and p_error_category not in (
      'validation',
      'environment',
      'conflict',
      'transport',
      'accounting'
    )
  then
    raise exception 'INVALID_PAYLOAD: categoria de error no valida';
  end if;

  select *
  into v_target
  from public.erp_targets
  where id = p_target_id
  for share;

  if not found or not v_target.active then
    raise exception 'STALE_ENVIRONMENT: target ERP no activo';
  end if;
  if v_target.dataset_epoch is null
    or v_target.dataset_epoch is distinct from p_dataset_epoch
  then
    raise exception 'STALE_ENVIRONMENT: dataset_epoch no coincide con el target';
  end if;
  if v_target.write_mode = 'disabled' then
    raise exception 'WRITER_DISABLED: el target no admite validacion';
  end if;

  select *
  into v_current
  from public.facturasrecibidas
  where id = p_factura_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: factura no encontrada';
  end if;
  if v_current.row_version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: esperada %, actual %',
      p_expected_version,
      v_current.row_version;
  end if;
  if v_current."FRR_id" is not null
    or v_current.remote_frr_id is not null
    or v_current.is_readonly_reference
    or v_current.source_kind = 'erp_reference'
    or v_current.accounting_status = 'created'
    or v_current.sync_status in (
      'sending',
      'unknown',
      'reconciling',
      'sent',
      'stale'
    )
  then
    raise exception 'FACTURA_LOCKED: la factura no se puede validar para alta';
  end if;

  select *
  into v_existing
  from public.facturasrecibidas_sync_attempts
  where request_id = p_request_id
    and phase = 'validate'
  for update;

  if found then
    if v_existing.factura_id <> p_factura_id
      or v_existing.erp_target_id is distinct from p_target_id
      or v_existing.erp_dataset_epoch is distinct from p_dataset_epoch
      or v_existing.payload_hash is distinct from p_payload_hash
      or v_existing.business_fingerprint is distinct from p_business_fingerprint
    then
      raise exception 'IDEMPOTENCY_CONFLICT: request_id ya corresponde a otro payload o entorno';
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
      response_payload,
      http_status,
      error,
      error_code,
      error_category,
      retryable,
      reconciliation_required,
      erp_target_id,
      erp_dataset_epoch,
      circuit,
      payload_hash,
      business_fingerprint,
      completed_at,
      created_by
    ) values (
      p_factura_id,
      p_request_id,
      3,
      'validate',
      'validate',
      true,
      case when p_valid then 'succeeded' else 'failed' end,
      p_payload,
      p_response,
      p_http_status,
      p_error,
      p_error_code,
      p_error_category,
      coalesce(p_retryable, false),
      false,
      p_target_id,
      p_dataset_epoch,
      case
        when p_payload#>>'{cabecera,FRR_tipofactura}' = 'GE'
          then 'genero'
        else 'acreedores'
      end,
      p_payload_hash,
      p_business_fingerprint,
      now(),
      p_actor
    );
  end if;

  if found then
    update public.facturasrecibidas_sync_attempts
    set status = case when p_valid then 'succeeded' else 'failed' end,
        response_payload = p_response,
        http_status = p_http_status,
        error = p_error,
        error_code = p_error_code,
        error_category = p_error_category,
        retryable = coalesce(p_retryable, false),
        reconciliation_required = false,
        completed_at = now(),
        updated_at = now()
    where request_id = p_request_id
      and phase = 'validate';
  end if;

  -- Transitional alias for the audited v2 finalizer. This is never used to
  -- open `sending`; it only keeps the immutable relations snapshot readable by
  -- finalize_factura_recibida_sync_v2 during the v3 rollout.
  v_legacy_payload :=
    (
      p_payload
      - array[
        'operation',
        'target_id',
        'dataset_epoch',
        'payload_hash',
        'accounting_mode'
      ]
    )
    || jsonb_build_object(
      'contract_version',
      2,
      'request_id',
      p_request_id::text,
      'dry_run',
      true
    );

  insert into public.facturasrecibidas_sync_attempts (
    factura_id,
    request_id,
    contract_version,
    phase,
    operation,
    dry_run,
    status,
    request_payload,
    response_payload,
    http_status,
    erp_target_id,
    erp_dataset_epoch,
    circuit,
    payload_hash,
    business_fingerprint,
    completed_at,
    created_by
  ) values (
    p_factura_id,
    p_request_id,
    2,
    'dry_run',
    'validate',
    true,
    case when p_valid then 'succeeded' else 'failed' end,
    v_legacy_payload,
    p_response,
    p_http_status,
    p_target_id,
    p_dataset_epoch,
    case
      when p_payload#>>'{cabecera,FRR_tipofactura}' = 'GE'
        then 'genero'
      else 'acreedores'
    end,
    p_payload_hash,
    p_business_fingerprint,
    now(),
    p_actor
  )
  on conflict (request_id, phase) do nothing;

  update public.facturasrecibidas
  set erp_target_id = p_target_id,
      erp_dataset_epoch = p_dataset_epoch,
      erp_payload_hash = p_payload_hash,
      erp_business_fingerprint = p_business_fingerprint,
      erp_validation_status = case when p_valid then 'valid' else 'invalid' end,
      erp_validation_request_id = p_request_id,
      erp_validated_at = now(),
      erp_error = case when p_valid then null else p_error end,
      updated_by = p_actor,
      updated_at = now()
  where id = p_factura_id
  returning * into v_current;

  return jsonb_build_object(
    'factura',
    to_jsonb(v_current),
    'version',
    v_current.row_version,
    'request_id',
    p_request_id,
    'target_id',
    p_target_id,
    'dataset_epoch',
    p_dataset_epoch,
    'payload_hash',
    p_payload_hash,
    'valid',
    p_valid,
    'idempotent_replay',
    v_existing.id is not null
  );
end;
$$;

create or replace function public.begin_factura_recibida_sync_v3(
  p_factura_id uuid,
  p_expected_version bigint,
  p_request_id uuid,
  p_target_id text,
  p_dataset_epoch uuid,
  p_payload_hash text,
  p_business_fingerprint text,
  p_payload jsonb,
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
  v_validation public.facturasrecibidas_sync_attempts%rowtype;
  v_commit public.facturasrecibidas_sync_attempts%rowtype;
  v_snapshot jsonb;
begin
  if p_factura_id is null
    or p_request_id is null
    or nullif(btrim(p_target_id), '') is null
    or p_dataset_epoch is null
  then
    raise exception 'INVALID_PAYLOAD: factura, request, target y dataset_epoch son requeridos';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'INVALID_PAYLOAD: expected_version es requerido';
  end if;
  if p_payload_hash !~ '^[0-9a-f]{64}$'
    or p_business_fingerprint !~ '^[0-9a-f]{64}$'
  then
    raise exception 'INVALID_PAYLOAD: hashes SHA-256 en minusculas son requeridos';
  end if;
  if p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or p_payload->'contract_version' is distinct from '3'::jsonb
    or p_payload->>'operation' <> 'commit'
    or p_payload->>'request_id' <> p_request_id::text
    or p_payload->>'target_id' <> p_target_id
    or p_payload->>'dataset_epoch' <> p_dataset_epoch::text
  then
    raise exception 'INVALID_PAYLOAD: payload commit v3 no coincide con su identidad';
  end if;

  select *
  into v_target
  from public.erp_targets
  where id = p_target_id
  for share;

  if not found or not v_target.active then
    raise exception 'STALE_ENVIRONMENT: target ERP no activo';
  end if;
  if v_target.dataset_epoch is null
    or v_target.dataset_epoch is distinct from p_dataset_epoch
  then
    raise exception 'STALE_ENVIRONMENT: dataset_epoch no coincide con el target';
  end if;
  if v_target.write_mode <> 'management' then
    raise exception 'WRITER_DISABLED: el target no admite altas de gestion';
  end if;

  select *
  into v_current
  from public.facturasrecibidas
  where id = p_factura_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: factura no encontrada';
  end if;

  if v_current.sync_status = 'sent'
    and v_current.last_request_id = p_request_id
  then
    return jsonb_build_object(
      'replayed',
      true,
      'terminal',
      true,
      'factura',
      to_jsonb(v_current),
      'version',
      v_current.row_version,
      'response',
      v_current.erp_response
    );
  end if;
  if v_current.row_version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: esperada %, actual %',
      p_expected_version,
      v_current.row_version;
  end if;
  if v_current.sync_status in ('sending', 'unknown', 'reconciling', 'sent', 'stale')
    or v_current."FRR_id" is not null
    or v_current.remote_frr_id is not null
    or v_current.is_readonly_reference
    or v_current.source_kind = 'erp_reference'
    or v_current.accounting_status = 'created'
  then
    raise exception 'FACTURA_LOCKED: la factura no se puede enviar';
  end if;
  if v_current.erp_validation_status <> 'valid'
    or v_current.erp_validation_request_id is distinct from p_request_id
    or v_current.erp_target_id is distinct from p_target_id
    or v_current.erp_dataset_epoch is distinct from p_dataset_epoch
    or v_current.erp_payload_hash is distinct from p_payload_hash
    or v_current.erp_business_fingerprint is distinct from p_business_fingerprint
  then
    raise exception 'VALIDATION_REQUIRED: la validacion no coincide con factura, request, target, epoch o payload';
  end if;

  select *
  into v_validation
  from public.facturasrecibidas_sync_attempts
  where factura_id = p_factura_id
    and request_id = p_request_id
    and phase = 'validate'
  for update;

  if not found
    or v_validation.contract_version <> 3
    or v_validation.status <> 'succeeded'
    or v_validation.erp_target_id is distinct from p_target_id
    or v_validation.erp_dataset_epoch is distinct from p_dataset_epoch
    or v_validation.payload_hash is distinct from p_payload_hash
    or v_validation.business_fingerprint is distinct from p_business_fingerprint
  then
    raise exception 'VALIDATION_REQUIRED: no existe una validacion v3 vigente';
  end if;

  select *
  into v_commit
  from public.facturasrecibidas_sync_attempts
  where request_id = p_request_id
    and phase = 'commit'
  for update;

  if found and (
    v_commit.factura_id <> p_factura_id
    or v_commit.erp_target_id is distinct from p_target_id
    or v_commit.erp_dataset_epoch is distinct from p_dataset_epoch
    or v_commit.payload_hash is distinct from p_payload_hash
  ) then
    raise exception 'IDEMPOTENCY_CONFLICT: request_id ya corresponde a otro commit';
  end if;
  if found and v_commit.status = 'unknown' then
    raise exception 'SYNC_RECONCILIATION_REQUIRED: el commit anterior es ambiguo';
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
    created_by
  ) values (
    p_factura_id,
    p_request_id,
    3,
    'commit',
    'commit',
    false,
    'in_progress',
    p_payload,
    p_target_id,
    p_dataset_epoch,
    v_validation.circuit,
    p_payload_hash,
    p_business_fingerprint,
    p_actor
  )
  on conflict (request_id, phase) do update
  set status = 'in_progress',
      request_payload = excluded.request_payload,
      response_payload = null,
      http_status = null,
      error = null,
      error_code = null,
      error_category = null,
      retryable = false,
      reconciliation_required = false,
      completed_at = null,
      started_at = now(),
      updated_at = now();

  update public.facturasrecibidas
  set sync_status = 'sending',
      accounting_status = 'not_requested',
      "FRR_Contabilizar" = 'N',
      last_request_id = p_request_id,
      erp_error = null,
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
    changed_by,
    snapshot
  ) values (
    p_factura_id,
    v_current.row_version,
    p_request_id,
    'sync_begin',
    'edge_send_v3',
    p_actor,
    v_snapshot
  );

  return jsonb_build_object(
    'replayed',
    false,
    'terminal',
    false,
    'factura',
    to_jsonb(v_current),
    'version',
    v_current.row_version,
    'request_id',
    p_request_id,
    'target_id',
    p_target_id,
    'dataset_epoch',
    p_dataset_epoch,
    'payload_hash',
    p_payload_hash
  );
end;
$$;

create or replace function public.finish_factura_recibida_sync_v3(
  p_factura_id uuid,
  p_request_id uuid,
  p_phase text,
  p_status text,
  p_response jsonb default null,
  p_http_status integer default null,
  p_error_code text default null,
  p_error_category text default null,
  p_error text default null,
  p_retryable boolean default false,
  p_reconciliation_required boolean default false,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current public.facturasrecibidas%rowtype;
  v_commit public.facturasrecibidas_sync_attempts%rowtype;
  v_snapshot jsonb;
  v_target_sync_status text;
begin
  if p_phase not in ('commit', 'readback', 'reconcile') then
    raise exception 'INVALID_PAYLOAD: fase v3 no valida';
  end if;
  if p_status not in ('in_progress', 'succeeded', 'failed', 'unknown') then
    raise exception 'INVALID_PAYLOAD: estado de intento no valido';
  end if;
  if p_error_category is not null
    and p_error_category not in (
      'validation',
      'environment',
      'conflict',
      'transport',
      'accounting'
    )
  then
    raise exception 'INVALID_PAYLOAD: categoria de error no valida';
  end if;

  select *
  into v_current
  from public.facturasrecibidas
  where id = p_factura_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: factura no encontrada';
  end if;
  if v_current.last_request_id is distinct from p_request_id then
    raise exception 'IDEMPOTENCY_CONFLICT: request_id no coincide con el envio activo';
  end if;

  select *
  into v_commit
  from public.facturasrecibidas_sync_attempts
  where factura_id = p_factura_id
    and request_id = p_request_id
    and phase = 'commit';

  if not found
    or v_commit.contract_version <> 3
    or v_commit.erp_target_id is distinct from v_current.erp_target_id
    or v_commit.erp_dataset_epoch is distinct from v_current.erp_dataset_epoch
    or v_commit.payload_hash is distinct from v_current.erp_payload_hash
  then
    raise exception 'INVALID_SYNC_ATTEMPT: commit v3 no coincide con la factura';
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
    response_payload,
    http_status,
    error,
    error_code,
    error_category,
    retryable,
    reconciliation_required,
    erp_target_id,
    erp_dataset_epoch,
    circuit,
    payload_hash,
    business_fingerprint,
    completed_at,
    created_by
  ) values (
    p_factura_id,
    p_request_id,
    3,
    p_phase,
    p_phase,
    false,
    p_status,
    case when p_status = 'in_progress'
      then coalesce(p_response, '{}'::jsonb)
      else '{}'::jsonb
    end,
    case when p_status = 'in_progress' then null else p_response end,
    p_http_status,
    p_error,
    p_error_code,
    p_error_category,
    coalesce(p_retryable, false),
    coalesce(p_reconciliation_required, false),
    v_commit.erp_target_id,
    v_commit.erp_dataset_epoch,
    v_commit.circuit,
    v_commit.payload_hash,
    v_commit.business_fingerprint,
    case when p_status = 'in_progress' then null else now() end,
    p_actor
  )
  on conflict (request_id, phase) do update
  set status = excluded.status,
      request_payload = case
        when excluded.status = 'in_progress'
          then excluded.request_payload
        else public.facturasrecibidas_sync_attempts.request_payload
      end,
      response_payload = excluded.response_payload,
      http_status = excluded.http_status,
      error = excluded.error,
      error_code = excluded.error_code,
      error_category = excluded.error_category,
      retryable = excluded.retryable,
      reconciliation_required = excluded.reconciliation_required,
      completed_at = excluded.completed_at,
      started_at = case
        when excluded.status = 'in_progress'
          then now()
        else public.facturasrecibidas_sync_attempts.started_at
      end,
      updated_at = now();

  if p_status in ('failed', 'unknown') then
    -- Derive the state before the nested IF. This keeps the CASE and the
    -- surrounding IF/END IF blocks explicit and avoids the former 42601 parse.
    v_target_sync_status := case
      when p_status = 'unknown' then 'unknown'
      else 'error'
    end;

    if v_current.sync_status is distinct from v_target_sync_status then
      update public.facturasrecibidas
      set sync_status = v_target_sync_status,
          -- Contract v3 only performs management registration
          -- (FRR_Contabilizar='N'); uncertainty must not contaminate accounting.
          erp_response = coalesce(p_response, erp_response),
          erp_error = coalesce(
            nullif(p_error, ''),
            'No se pudo completar la operacion con Netagro.'
          ),
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
        case when p_status = 'unknown' then 'sync_unknown' else 'sync_error' end,
        'edge_send_v3',
        p_error_code,
        p_actor,
        v_snapshot
      );
    end if;
  end if;

  return jsonb_build_object(
    'factura',
    to_jsonb(v_current),
    'version',
    v_current.row_version,
    'request_id',
    p_request_id,
    'phase',
    p_phase,
    'status',
    p_status
  );
end;
$$;

create or replace function private.finalize_factura_recibida_sync_v3_impl(
  p_factura_id uuid,
  p_request_id uuid,
  p_target_id text,
  p_dataset_epoch uuid,
  p_payload_hash text,
  p_business_fingerprint text,
  p_write_response jsonb,
  p_readback jsonb,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.facturasrecibidas%rowtype;
  v_target public.erp_targets%rowtype;
  v_commit public.facturasrecibidas_sync_attempts%rowtype;
  v_reconcile public.facturasrecibidas_sync_attempts%rowtype;
  v_result jsonb;
  v_snapshot jsonb;
begin
  select *
  into v_target
  from public.erp_targets
  where id = p_target_id
  for share;

  if not found
    or not v_target.active
    or v_target.dataset_epoch is distinct from p_dataset_epoch
  then
    raise exception 'STALE_ENVIRONMENT: target o dataset_epoch ya no estan vigentes';
  end if;

  select *
  into v_current
  from public.facturasrecibidas
  where id = p_factura_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: factura no encontrada';
  end if;
  if v_current.last_request_id is distinct from p_request_id
    or v_current.erp_target_id is distinct from p_target_id
    or v_current.erp_dataset_epoch is distinct from p_dataset_epoch
    or v_current.erp_payload_hash is distinct from p_payload_hash
    or v_current.erp_business_fingerprint is distinct from p_business_fingerprint
  then
    raise exception 'IDEMPOTENCY_CONFLICT: identidad de finalizacion no coincide';
  end if;

  select *
  into v_commit
  from public.facturasrecibidas_sync_attempts
  where factura_id = p_factura_id
    and request_id = p_request_id
    and phase = 'commit'
  for update;

  if not found
    or v_commit.contract_version <> 3
    or v_commit.erp_target_id is distinct from p_target_id
    or v_commit.erp_dataset_epoch is distinct from p_dataset_epoch
    or v_commit.payload_hash is distinct from p_payload_hash
    or v_commit.business_fingerprint is distinct from p_business_fingerprint
  then
    raise exception 'INVALID_SYNC_ATTEMPT: commit v3 con identidad completa no encontrado';
  end if;

  if v_commit.status = 'unknown' then
    -- Un commit ambiguo solo se puede cerrar desde una reconciliacion v3 ya
    -- abierta para la misma identidad. El comparador v2 que se invoca debajo
    -- sigue siendo la autoridad exacta sobre cabecera, CTB y punteos.
    select *
    into v_reconcile
    from public.facturasrecibidas_sync_attempts
    where factura_id = p_factura_id
      and request_id = p_request_id
      and phase = 'reconcile'
    for update;

    if not found
      or v_reconcile.contract_version <> 3
      or v_reconcile.status <> 'in_progress'
      or v_reconcile.erp_target_id is distinct from p_target_id
      or v_reconcile.erp_dataset_epoch is distinct from p_dataset_epoch
      or v_reconcile.circuit is distinct from v_commit.circuit
      or v_reconcile.payload_hash is distinct from p_payload_hash
      or v_reconcile.business_fingerprint is distinct from p_business_fingerprint
    then
      raise exception 'SYNC_RECONCILIATION_REQUIRED: falta una reconciliacion v3 activa con identidad exacta';
    end if;
  elsif v_commit.status <> 'succeeded' then
    raise exception 'INVALID_SYNC_ATTEMPT: commit v3 completado no encontrado';
  end if;

  if v_current.sync_status = 'sent'
    and v_current.erp_reference_status = 'valid'
    and v_current.erp_verified_at is not null
    and coalesce(v_current.remote_frr_id, v_current."FRR_id") is not null
  then
    return jsonb_build_object(
      'factura',
      to_jsonb(v_current),
      'version',
      v_current.row_version,
      'request_id',
      p_request_id,
      'target_id',
      p_target_id,
      'dataset_epoch',
      p_dataset_epoch,
      'payload_hash',
      p_payload_hash,
      'verified_at',
      v_current.erp_verified_at,
      'idempotent_replay',
      true
    );
  end if;

  -- Reuse the already-hardened v2 readback comparator during the transition.
  -- Edge passes a normalized v2 compatibility response here; the authoritative
  -- v3 response remains stored on the commit attempt.
  v_result := public.finalize_factura_recibida_sync_v2(
    p_factura_id,
    p_request_id,
    p_write_response,
    p_readback,
    p_actor
  );

  if v_commit.status = 'unknown' then
    update public.facturasrecibidas_sync_attempts
    set status = 'succeeded',
        error = null,
        error_code = null,
        error_category = null,
        retryable = false,
        reconciliation_required = false,
        completed_at = now(),
        updated_at = now()
    where id = v_commit.id;
  end if;

  update public.facturasrecibidas factura
  set estado = case
        when factura.duplicada_de is not null then 'duplicada'
        when jsonb_typeof(coalesce(factura.validation_errors, '[]'::jsonb)) <> 'array'
          then 'pendiente_revision'
        when exists (
          select 1
          from jsonb_array_elements(factura.validation_errors) issue(value)
          where lower(coalesce(issue.value->>'severity', 'error')) <> 'warning'
        )
          then 'pendiente_revision'
        else 'validada'
      end,
      erp_target_id = p_target_id,
      erp_dataset_epoch = p_dataset_epoch,
      erp_payload_hash = p_payload_hash,
      erp_business_fingerprint = p_business_fingerprint,
      erp_reference_status = 'valid',
      erp_validation_status = 'valid',
      erp_verified_at = now(),
      row_version = factura.row_version + 1,
      updated_by = p_actor,
      updated_at = now()
  where id = p_factura_id
  returning * into v_current;

  update public.facturasrecibidas_sync_attempts
  set erp_target_id = p_target_id,
      erp_dataset_epoch = p_dataset_epoch,
      payload_hash = p_payload_hash,
      business_fingerprint = p_business_fingerprint,
      updated_at = now()
  where factura_id = p_factura_id
    and request_id = p_request_id;

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
    'sync_finalize',
    'edge_readback_v3',
    'readback_verified_v3',
    p_actor,
    v_snapshot
  );

  return v_result || jsonb_build_object(
    'factura',
    to_jsonb(v_current),
    'version',
    v_current.row_version,
    'target_id',
    p_target_id,
    'dataset_epoch',
    p_dataset_epoch,
    'payload_hash',
    p_payload_hash,
    'verified_at',
    v_current.erp_verified_at
  );
end;
$$;

create or replace function public.finalize_factura_recibida_sync_v3(
  p_factura_id uuid,
  p_request_id uuid,
  p_target_id text,
  p_dataset_epoch uuid,
  p_payload_hash text,
  p_business_fingerprint text,
  p_write_response jsonb,
  p_readback jsonb,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.finalize_factura_recibida_sync_v3_impl(
    p_factura_id,
    p_request_id,
    p_target_id,
    p_dataset_epoch,
    p_payload_hash,
    p_business_fingerprint,
    p_write_response,
    p_readback,
    p_actor
  );
end;
$$;

create or replace function public.mark_stale_factura_recibida_syncs_v3(
  p_cutoff interval default interval '10 minutes',
  p_actor uuid default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt record;
  v_current public.facturasrecibidas%rowtype;
  v_snapshot jsonb;
  v_count integer := 0;
begin
  if p_cutoff is null
    or p_cutoff < interval '1 minute'
    or p_cutoff > interval '24 hours'
  then
    raise exception 'INVALID_PAYLOAD: cutoff debe estar entre 1 minuto y 24 horas';
  end if;

  for v_attempt in
    select
      attempt.id,
      attempt.factura_id,
      attempt.request_id,
      attempt.phase
    from public.facturasrecibidas_sync_attempts attempt
    join public.facturasrecibidas factura
      on factura.id = attempt.factura_id
    where attempt.status = 'in_progress'
      and attempt.operation in ('commit', 'readback', 'reconcile')
      and attempt.started_at <= now() - p_cutoff
      and factura.sync_status in ('sending', 'reconciling')
    order by attempt.started_at
    for update of attempt skip locked
  loop
    update public.facturasrecibidas_sync_attempts
    set status = 'unknown',
        error = 'La operacion supero el tiempo maximo y requiere reconciliacion.',
        error_code = 'ambiguous_commit',
        error_category = 'transport',
        retryable = false,
        reconciliation_required = true,
        completed_at = now(),
        updated_at = now()
    where id = v_attempt.id;

    update public.facturasrecibidas
    set sync_status = 'unknown',
        erp_error = 'Resultado ERP incierto; es necesario reconciliar antes de reenviar.',
        row_version = row_version + 1,
        updated_by = p_actor,
        updated_at = now()
    where id = v_attempt.factura_id
      and last_request_id = v_attempt.request_id
      and sync_status in ('sending', 'reconciling')
    returning * into v_current;

    if found then
      v_snapshot := public.factura_recibida_snapshot_v2(v_attempt.factura_id);
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
        v_attempt.factura_id,
        v_current.row_version,
        v_attempt.request_id,
        'sync_unknown',
        'watchdog_v3',
        'ambiguous_commit',
        p_actor,
        v_snapshot
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

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
      'target_id',
      p_target_id,
      'dataset_epoch',
      p_dataset_epoch,
      'idempotent_replay',
      true,
      'stale_references',
      0,
      'invalidated_validations',
      0
    );
  end if;

  -- A refresh must never strand a request whose outcome is still uncertain.
  -- The operator must reconcile it in the current epoch before rotating.
  if exists (
    select 1
    from public.facturasrecibidas factura
    where factura.erp_target_id = p_target_id
      and factura.erp_dataset_epoch is distinct from p_dataset_epoch
      and factura.sync_status in ('sending', 'unknown', 'reconciling')
  ) then
    raise exception 'EPOCH_ROTATION_BLOCKED: existen operaciones inciertas o en curso';
  end if;

  -- Confirmed ERP references remain bound to their historical target/epoch.
  -- They become stale evidence, but their identity and audit trail are kept.
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

  -- A validation without a remote reference is not a historical ERP record.
  -- Detach it from the old generation and force a fresh validation/request.
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

create or replace function public.rotate_erp_target_epoch_v3(
  p_target_id text,
  p_dataset_epoch uuid,
  p_snapshot_at timestamptz,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.rotate_erp_target_epoch_v3_impl(
    p_target_id,
    p_dataset_epoch,
    p_snapshot_at,
    p_actor
  );
end;
$$;

-- Runbook de activacion del target:
--   1. rotate_erp_target_epoch_v3(...) deja siempre write_mode=disabled;
--   2. validar snapshot/runtime y pasar a blocked con confirmacion explicita;
--   3. superar todos los gates y pasar de blocked a management;
--   4. rollback: volver a blocked o disabled (reduccion segura, sin borrar).
-- Nunca habilitar management con un UPDATE directo sobre erp_targets.
create or replace function private.set_erp_target_write_mode_v3_impl(
  p_target_id text,
  p_dataset_epoch uuid,
  p_write_mode text,
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
  v_required_gates constant jsonb := jsonb_build_object(
    'runtime_reconciled', true,
    'idempotency_store_ready', true,
    'counter_protocol_verified', true,
    'punteo_mapping_verified', true,
    'canary_readback_verified', true,
    'concurrency_tests_passed', true,
    'failure_injection_tests_passed', true
  );
begin
  if nullif(btrim(p_target_id), '') is null
    or p_dataset_epoch is null
    or p_write_mode not in ('disabled', 'blocked', 'management')
  then
    raise exception 'INVALID_PAYLOAD: target, epoch y write_mode validos son requeridos';
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
  if v_target.write_mode = p_write_mode then
    return jsonb_build_object(
      'target',
      to_jsonb(v_target),
      'idempotent_replay',
      true
    );
  end if;

  if p_write_mode = 'blocked' and v_target.write_mode = 'disabled' then
    if p_confirmation is distinct from
      ('ENABLE_VALIDATION:' || p_target_id || ':' || p_dataset_epoch::text)
    then
      raise exception 'ACTIVATION_CONFIRMATION_REQUIRED: confirmacion de validacion no coincide';
    end if;
  elsif p_write_mode = 'management' then
    if v_target.write_mode <> 'blocked' then
      raise exception 'ACTIVATION_GATE_FAILED: management exige transicion previa por blocked';
    end if;
    if p_confirmation is distinct from
      ('ENABLE_MANAGEMENT:' || p_target_id || ':' || p_dataset_epoch::text)
    then
      raise exception 'ACTIVATION_CONFIRMATION_REQUIRED: confirmacion de management no coincide';
    end if;
    if not (p_gates @> v_required_gates) then
      raise exception 'ACTIVATION_GATE_FAILED: faltan gates obligatorios para management';
    end if;
    if exists (
      select 1
      from public.facturasrecibidas factura
      where factura.erp_target_id = p_target_id
        and factura.erp_dataset_epoch = p_dataset_epoch
        and factura.sync_status in ('sending', 'unknown', 'reconciling')
    ) then
      raise exception 'ACTIVATION_GATE_FAILED: existen operaciones inciertas o en curso';
    end if;
  elsif p_write_mode not in ('disabled', 'blocked') then
    raise exception 'ACTIVATION_GATE_FAILED: transicion de write_mode no permitida';
  end if;

  update public.erp_targets
  set write_mode = p_write_mode,
      metadata = metadata || jsonb_build_object(
        'last_write_mode_transition',
        jsonb_build_object(
          'from',
          v_target.write_mode,
          'to',
          p_write_mode,
          'dataset_epoch',
          p_dataset_epoch,
          'actor',
          p_actor,
          'changed_at',
          now()
        ),
        'activation_gates',
        case when p_write_mode = 'management' then p_gates else '{}'::jsonb end
      ),
      updated_at = now()
  where id = p_target_id
  returning * into v_target;

  return jsonb_build_object(
    'target',
    to_jsonb(v_target),
    'idempotent_replay',
    false
  );
end;
$$;

create or replace function public.set_erp_target_write_mode_v3(
  p_target_id text,
  p_dataset_epoch uuid,
  p_write_mode text,
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
  return private.set_erp_target_write_mode_v3_impl(
    p_target_id,
    p_dataset_epoch,
    p_write_mode,
    p_confirmation,
    p_gates,
    p_actor
  );
end;
$$;

revoke execute on function public.enforce_factura_received_state_v3()
  from public, anon, authenticated;
revoke execute on function public.fill_factura_sync_attempt_operation_v3()
  from public, anon, authenticated;
revoke execute on function public.record_factura_recibida_validation_v3(
  uuid, bigint, uuid, text, uuid, text, text, jsonb, jsonb, boolean,
  integer, text, text, text, boolean, uuid
) from public, anon, authenticated;
revoke execute on function public.begin_factura_recibida_sync_v3(
  uuid, bigint, uuid, text, uuid, text, text, jsonb, uuid
) from public, anon, authenticated;
revoke execute on function public.finish_factura_recibida_sync_v3(
  uuid, uuid, text, text, jsonb, integer, text, text, text, boolean,
  boolean, uuid
) from public, anon, authenticated;
revoke execute on function public.finalize_factura_recibida_sync_v3(
  uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid
) from public, anon, authenticated;
revoke execute on function public.mark_stale_factura_recibida_syncs_v3(
  interval, uuid
) from public, anon, authenticated;
revoke execute on function public.rotate_erp_target_epoch_v3(
  text, uuid, timestamptz, uuid
) from public, anon, authenticated;
revoke execute on function public.set_erp_target_write_mode_v3(
  text, uuid, text, text, jsonb, uuid
) from public, anon, authenticated;

revoke all on function private.finalize_factura_recibida_sync_v3_impl(
  uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.rotate_erp_target_epoch_v3_impl(
  text, uuid, timestamptz, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.set_erp_target_write_mode_v3_impl(
  text, uuid, text, text, jsonb, uuid
) from public, anon, authenticated, service_role;

-- Contract v2 queda cerrado incluso para codigo Edge antiguo que conserve la
-- service role. finalize_v2 solo se reutiliza internamente desde el finalizador
-- privado v3 como comparador de readback; ningun consumidor puede abrir,
-- finalizar ni reparar una escritura v2 directamente.
revoke execute on function public.begin_factura_recibida_sync_v2(
  uuid, bigint, uuid, jsonb, uuid
) from public, anon, authenticated, service_role;
revoke execute on function public.finish_factura_recibida_sync_v2(
  uuid, uuid, text, text, jsonb, integer, text, uuid
) from public, anon, authenticated, service_role;
revoke execute on function public.finalize_factura_recibida_sync_v2(
  uuid, uuid, jsonb, jsonb, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.record_factura_recibida_validation_v3(
  uuid, bigint, uuid, text, uuid, text, text, jsonb, jsonb, boolean,
  integer, text, text, text, boolean, uuid
) to service_role;
grant execute on function public.begin_factura_recibida_sync_v3(
  uuid, bigint, uuid, text, uuid, text, text, jsonb, uuid
) to service_role;
grant execute on function public.finish_factura_recibida_sync_v3(
  uuid, uuid, text, text, jsonb, integer, text, text, text, boolean,
  boolean, uuid
) to service_role;
grant execute on function public.finalize_factura_recibida_sync_v3(
  uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid
) to service_role;
grant execute on function public.mark_stale_factura_recibida_syncs_v3(
  interval, uuid
) to service_role;
grant execute on function public.rotate_erp_target_epoch_v3(
  text, uuid, timestamptz, uuid
) to service_role;
grant execute on function public.set_erp_target_write_mode_v3(
  text, uuid, text, text, jsonb, uuid
) to service_role;

grant execute on function private.finalize_factura_recibida_sync_v3_impl(
  uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid
) to service_role;
grant execute on function private.rotate_erp_target_epoch_v3_impl(
  text, uuid, timestamptz, uuid
) to service_role;
grant execute on function private.set_erp_target_write_mode_v3_impl(
  text, uuid, text, text, jsonb, uuid
) to service_role;

-- Watchdog real, independiente de que llegue otra peticion Edge.
-- Runbook:
--   * comprobar el job y sus ejecuciones en cron.job / cron.job_run_details;
--   * pausar o retirar el job por su nombre fijo antes de mantenimiento;
--   * nunca reenvia una factura: solo mueve intentos inciertos a reconciliacion.
-- `cron.schedule` reemplaza de forma idempotente un job con el mismo nombre.
create extension if not exists pg_cron;

select cron.schedule(
  'facturas-recibidas-erp-watchdog-v3',
  '* * * * *',
  $watchdog$
    select public.mark_stale_factura_recibida_syncs_v3(
      interval '10 minutes',
      null
    );
  $watchdog$
);
