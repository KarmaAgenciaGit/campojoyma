-- Received invoices v2 homologation.
-- This migration keeps the ERP FRR/FRC mirror intact and adds:
-- optimistic concurrency, lossless atomic writes, ERP sync idempotency,
-- immutable revisions and accounting snapshots, and private PDF storage.

create extension if not exists pgcrypto with schema extensions;

alter table public.facturasrecibidas
  add column if not exists row_version bigint not null default 1;

alter table public.facturasrecibidas
  add column if not exists sync_status text not null default 'draft';

alter table public.facturasrecibidas
  add column if not exists accounting_status text not null default 'not_requested';

alter table public.facturasrecibidas
  add column if not exists accounting_visible_number text;

alter table public.facturasrecibidas
  add column if not exists accounting_date date;

alter table public.facturasrecibidas
  add column if not exists erp_last_read_at timestamptz;

alter table public.facturasrecibidas
  add column if not exists erp_last_read_payload jsonb;

alter table public.facturasrecibidas
  add column if not exists last_request_id uuid;

alter table public.facturasrecibidas_punteos
  add column if not exists line_count integer not null default 0;

alter table public.facturasrecibidas_punteos
  add column if not exists source_lines jsonb not null default '[]'::jsonb;

update public.facturasrecibidas
set sync_status = case
    when "FRR_id" is not null or remote_frr_id is not null or source_kind = 'erp_reference' then 'sent'
    when estado = 'preparada_erp' then 'ready'
    when estado = 'enviada_erp' then 'sent'
    when estado = 'error_erp' then 'error'
    when estado = 'validada' then 'ready'
    else 'draft'
  end,
  accounting_status = case
    when coalesce("FRR_IdAsientoNet", 0) > 0 then 'pending'
    when coalesce("FRR_Contabilizar", 'N') = 'S' then 'requested'
    else 'not_requested'
  end
where sync_status = 'draft'
   or accounting_status = 'not_requested';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_row_version_positive_check'
      and conrelid = 'public.facturasrecibidas'::regclass
  ) then
    alter table public.facturasrecibidas
      add constraint facturasrecibidas_row_version_positive_check
      check (row_version > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_sync_status_check'
      and conrelid = 'public.facturasrecibidas'::regclass
  ) then
    alter table public.facturasrecibidas
      add constraint facturasrecibidas_sync_status_check
      check (sync_status in (
        'draft',
        'ready',
        'sending',
        'unknown',
        'sent',
        'error',
        'reconciling'
      ));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_accounting_status_check'
      and conrelid = 'public.facturasrecibidas'::regclass
  ) then
    alter table public.facturasrecibidas
      add constraint facturasrecibidas_accounting_status_check
      check (accounting_status in (
        'not_requested',
        'requested',
        'pending',
        'created',
        'error',
        'unknown'
      ));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_accounting_created_id_check'
      and conrelid = 'public.facturasrecibidas'::regclass
  ) then
    alter table public.facturasrecibidas
      add constraint facturasrecibidas_accounting_created_id_check
      check (
        accounting_status <> 'created'
        or coalesce("FRR_IdAsientoNet", 0) > 0
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_punteos_line_count_check'
      and conrelid = 'public.facturasrecibidas_punteos'::regclass
  ) then
    alter table public.facturasrecibidas_punteos
      add constraint facturasrecibidas_punteos_line_count_check
      check (line_count >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_punteos_source_lines_check'
      and conrelid = 'public.facturasrecibidas_punteos'::regclass
  ) then
    alter table public.facturasrecibidas_punteos
      add constraint facturasrecibidas_punteos_source_lines_check
      check (jsonb_typeof(source_lines) = 'array');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_punteos_source_table_check'
      and conrelid = 'public.facturasrecibidas_punteos'::regclass
  ) then
    alter table public.facturasrecibidas_punteos
      add constraint facturasrecibidas_punteos_source_table_check
      check (
        source_table is null
        or source_table in (
          'albsalida_gastos',
          'albentrada_hisgastos',
          'albaranescompra_gastos',
          'facturas_gastos',
          'albarancoste',
          'albmaterial'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_punteos_source_pair_check'
      and conrelid = 'public.facturasrecibidas_punteos'::regclass
  ) then
    alter table public.facturasrecibidas_punteos
      add constraint facturasrecibidas_punteos_source_pair_check
      check (
        (source_table is null and source_id is null)
        or (source_table is not null and source_id is not null and source_id > 0)
      );
  end if;

end $$;

create index if not exists idx_facturasrecibidas_sync_status_updated
  on public.facturasrecibidas (sync_status, updated_at desc);

create index if not exists idx_facturasrecibidas_accounting_status
  on public.facturasrecibidas (accounting_status, updated_at desc);

create index if not exists idx_facturasrecibidas_last_request
  on public.facturasrecibidas (last_request_id)
  where last_request_id is not null;

create unique index if not exists idx_facturasrecibidas_ctb_remote_frc_id_unique
  on public.facturasrecibidas_ctb ("FRC_id")
  where "FRC_id" is not null;

create unique index if not exists idx_facturasrecibidas_punteos_source_unique
  on public.facturasrecibidas_punteos (factura_id, source_table, source_id)
  where source_table is not null and source_id is not null;

create table if not exists public.facturasrecibidas_revisions (
  id bigint generated always as identity primary key,
  factura_id uuid not null,
  revision_number bigint not null,
  request_id uuid,
  change_type text not null,
  change_source text not null,
  reason text,
  changed_by uuid,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (factura_id, revision_number)
);

create table if not exists public.facturasrecibidas_sync_attempts (
  id uuid primary key default gen_random_uuid(),
  factura_id uuid not null,
  request_id uuid not null,
  contract_version smallint not null default 2,
  phase text not null,
  dry_run boolean not null,
  status text not null default 'in_progress',
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb,
  http_status integer,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid,
  updated_at timestamptz not null default now(),
  unique (request_id, phase)
);

create table if not exists public.facturasrecibidas_asientos (
  id uuid primary key default gen_random_uuid(),
  factura_id uuid not null references public.facturasrecibidas(id) on delete restrict,
  request_id uuid not null,
  technical_id bigint,
  visible_number text,
  accounting_date date,
  concept text,
  status text not null,
  total_debit numeric(18,2) not null default 0,
  total_credit numeric(18,2) not null default 0,
  balanced boolean not null default false,
  raw jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now(),
  unique (factura_id, request_id)
);

create table if not exists public.facturasrecibidas_asiento_apuntes (
  id uuid primary key default gen_random_uuid(),
  asiento_id uuid not null references public.facturasrecibidas_asientos(id) on delete restrict,
  posicion integer not null,
  cuenta text,
  descripcion text,
  debe numeric(18,2) not null default 0,
  haber numeric(18,2) not null default 0,
  analytic jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  unique (asiento_id, posicion)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_revisions_change_type_check'
      and conrelid = 'public.facturasrecibidas_revisions'::regclass
  ) then
    alter table public.facturasrecibidas_revisions
      add constraint facturasrecibidas_revisions_change_type_check
      check (change_type in (
        'create',
        'update',
        'extract',
        'ingest',
        'sync_begin',
        'sync_error',
        'sync_unknown',
        'sync_finalize',
        'delete'
      ));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_sync_contract_check'
      and conrelid = 'public.facturasrecibidas_sync_attempts'::regclass
  ) then
    alter table public.facturasrecibidas_sync_attempts
      add constraint facturasrecibidas_sync_contract_check
      check (contract_version = 2);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_sync_phase_check'
      and conrelid = 'public.facturasrecibidas_sync_attempts'::regclass
  ) then
    alter table public.facturasrecibidas_sync_attempts
      add constraint facturasrecibidas_sync_phase_check
      check (phase in ('dry_run', 'commit', 'readback', 'reconcile'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_sync_attempt_status_check'
      and conrelid = 'public.facturasrecibidas_sync_attempts'::regclass
  ) then
    alter table public.facturasrecibidas_sync_attempts
      add constraint facturasrecibidas_sync_attempt_status_check
      check (status in ('in_progress', 'succeeded', 'failed', 'unknown'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_asientos_status_check'
      and conrelid = 'public.facturasrecibidas_asientos'::regclass
  ) then
    alter table public.facturasrecibidas_asientos
      add constraint facturasrecibidas_asientos_status_check
      check (status in ('pending', 'created', 'error', 'unknown'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_asientos_totals_check'
      and conrelid = 'public.facturasrecibidas_asientos'::regclass
  ) then
    alter table public.facturasrecibidas_asientos
      add constraint facturasrecibidas_asientos_totals_check
      check (total_debit >= 0 and total_credit >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_asiento_apuntes_amounts_check'
      and conrelid = 'public.facturasrecibidas_asiento_apuntes'::regclass
  ) then
    alter table public.facturasrecibidas_asiento_apuntes
      add constraint facturasrecibidas_asiento_apuntes_amounts_check
      check (
        debe >= 0
        and haber >= 0
        and not (debe > 0 and haber > 0)
      );
  end if;
end $$;

create index if not exists idx_facturasrecibidas_revisions_factura
  on public.facturasrecibidas_revisions (factura_id, revision_number desc);

create index if not exists idx_facturasrecibidas_revisions_request
  on public.facturasrecibidas_revisions (request_id)
  where request_id is not null;

create unique index if not exists idx_facturasrecibidas_revisions_create_request_unique
  on public.facturasrecibidas_revisions (request_id)
  where request_id is not null
    and change_type in ('create', 'ingest', 'extract');

create index if not exists idx_facturasrecibidas_sync_attempts_factura
  on public.facturasrecibidas_sync_attempts (factura_id, started_at desc);

create index if not exists idx_facturasrecibidas_sync_attempts_pending
  on public.facturasrecibidas_sync_attempts (started_at)
  where status in ('in_progress', 'unknown');

create index if not exists idx_facturasrecibidas_asientos_factura
  on public.facturasrecibidas_asientos (factura_id, captured_at desc);

create index if not exists idx_facturasrecibidas_asientos_technical
  on public.facturasrecibidas_asientos (technical_id)
  where technical_id is not null;

create index if not exists idx_facturasrecibidas_asiento_apuntes_asiento
  on public.facturasrecibidas_asiento_apuntes (asiento_id, posicion);

create or replace function public.prevent_facturas_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'AUDIT_IMMUTABLE: los registros de auditoria contable no se pueden modificar ni borrar';
end;
$$;

drop trigger if exists prevent_facturas_revisions_mutation on public.facturasrecibidas_revisions;
create trigger prevent_facturas_revisions_mutation
  before update or delete on public.facturasrecibidas_revisions
  for each row execute function public.prevent_facturas_audit_mutation();

drop trigger if exists prevent_facturas_asientos_mutation on public.facturasrecibidas_asientos;
create trigger prevent_facturas_asientos_mutation
  before update or delete on public.facturasrecibidas_asientos
  for each row execute function public.prevent_facturas_audit_mutation();

drop trigger if exists prevent_facturas_asiento_apuntes_mutation on public.facturasrecibidas_asiento_apuntes;
create trigger prevent_facturas_asiento_apuntes_mutation
  before update or delete on public.facturasrecibidas_asiento_apuntes
  for each row execute function public.prevent_facturas_audit_mutation();

create or replace function public.enforce_factura_accounting_snapshot_v2()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.accounting_status = 'created' and not exists (
    select 1
    from public.facturasrecibidas_asientos asiento
    where asiento.factura_id = new.id
      and asiento.status = 'created'
      and asiento.balanced
      and asiento.technical_id = new."FRR_IdAsientoNet"
      and nullif(btrim(asiento.visible_number), '') is not null
      and asiento.total_debit > 0
      and abs(asiento.total_debit - asiento.total_credit) <= 0.01
      and exists (
        select 1
        from public.facturasrecibidas_asiento_apuntes apunte
        where apunte.asiento_id = asiento.id
      )
  ) then
    raise exception 'ACCOUNTING_SNAPSHOT_REQUIRED: created exige un asiento ERP balanceado y persistido';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_factura_accounting_snapshot on public.facturasrecibidas;
create trigger enforce_factura_accounting_snapshot
  before insert or update of accounting_status, "FRR_IdAsientoNet"
  on public.facturasrecibidas
  for each row execute function public.enforce_factura_accounting_snapshot_v2();

create or replace function public.factura_recibida_snapshot_v2(p_factura_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'factura', to_jsonb(f),
    'ctb', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.posicion)
      from public.facturasrecibidas_ctb c
      where c.factura_id = f.id
    ), '[]'::jsonb),
    'punteos', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.posicion)
      from public.facturasrecibidas_punteos p
      where p.factura_id = f.id
    ), '[]'::jsonb)
  )
  from public.facturasrecibidas f
  where f.id = p_factura_id;
$$;

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
        'is_readonly_reference'
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
    coalesce(row_value."S", true),
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

create or replace function public.save_factura_recibida_v2(
  p_factura_id uuid,
  p_expected_version bigint,
  p_factura jsonb,
  p_ctb jsonb default null,
  p_punteos jsonb default null,
  p_actor uuid default null,
  p_request_id uuid default null,
  p_change_source text default 'edge_update',
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current public.facturasrecibidas%rowtype;
  v_updated public.facturasrecibidas%rowtype;
  v_payload jsonb;
  v_columns text;
  v_snapshot jsonb;
  v_now timestamptz := now();
begin
  if p_factura_id is null then
    raise exception 'INVALID_PAYLOAD: factura_id es requerido';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'INVALID_PAYLOAD: expected_version es requerido';
  end if;
  if p_factura is null or jsonb_typeof(p_factura) <> 'object' then
    raise exception 'INVALID_PAYLOAD: factura debe ser un objeto JSON';
  end if;
  if p_ctb is not null and jsonb_typeof(p_ctb) <> 'array' then
    raise exception 'INVALID_PAYLOAD: ctb debe ser null o un array JSON';
  end if;
  if p_punteos is not null and jsonb_typeof(p_punteos) <> 'array' then
    raise exception 'INVALID_PAYLOAD: punteos debe ser null o un array JSON';
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
    or v_current.sync_status in ('sending', 'unknown', 'reconciling', 'sent')
  then
    raise exception 'FACTURA_LOCKED: la factura tiene identidad ERP o una sincronizacion no editable';
  end if;

  v_payload :=
    to_jsonb(v_current)
    || (
      p_factura
      - array[
        'id',
        'FRR_id',
        'FRR_numero',
        'FRR_IdAsientoNet',
        'FRR_IdUsuarioLog',
        'FRR_FechaLog',
        'FRR_HoraLog',
        'remote_frr_id',
        'is_readonly_reference',
        'source_kind',
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
        'created_by',
        'created_at',
        'updated_at'
      ]
    )
    || jsonb_build_object(
      'row_version', v_current.row_version + 1,
      'sync_status', case
        when coalesce(p_factura->>'estado', v_current.estado) = 'validada' then 'ready'
        else 'draft'
      end,
      'accounting_status', case
        when coalesce(p_factura->>'FRR_Contabilizar', v_current."FRR_Contabilizar", 'N') = 'S'
          then 'requested'
        else 'not_requested'
      end,
      'updated_by', p_actor,
      'updated_at', v_now
    );

  select string_agg(format('%I', attribute.attname), ', ' order by attribute.attnum)
  into v_columns
  from pg_attribute attribute
  where attribute.attrelid = 'public.facturasrecibidas'::regclass
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attname <> 'id';

  execute format(
    'update public.facturasrecibidas
       set (%1$s) = (
         select %1$s
         from jsonb_populate_record(null::public.facturasrecibidas, $1)
       )
     where id = $2
     returning *',
    v_columns
  )
  into v_updated
  using v_payload, p_factura_id;

  if p_ctb is not null then
    delete from public.facturasrecibidas_ctb existing
    where existing.factura_id = p_factura_id
      and not exists (
        select 1
        from jsonb_array_elements(p_ctb) with ordinality as incoming(value, ordinality)
        where incoming.ordinality::integer = existing.posicion
      );

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
      p_factura_id,
      item.ordinality::integer,
      null,
      null,
      coalesce(row_value."FRC_Importe", 0),
      row_value."FRC_Cuenta",
      row_value."FRC_IdActividad",
      row_value."FRC_Idseccion",
      row_value."FRC_Iddepartamento",
      row_value."FRC_Idsubdepartamento",
      null,
      null,
      null,
      v_now,
      v_now
    from jsonb_array_elements(p_ctb) with ordinality as item(value, ordinality)
    cross join lateral jsonb_populate_record(
      null::public.facturasrecibidas_ctb,
      item.value
    ) as row_value
    on conflict (factura_id, posicion) do update
      set "FRC_Importe" = excluded."FRC_Importe",
          "FRC_Cuenta" = excluded."FRC_Cuenta",
          "FRC_IdActividad" = excluded."FRC_IdActividad",
          "FRC_Idseccion" = excluded."FRC_Idseccion",
          "FRC_Iddepartamento" = excluded."FRC_Iddepartamento",
          "FRC_Idsubdepartamento" = excluded."FRC_Idsubdepartamento",
          updated_at = excluded.updated_at;
  end if;

  if p_punteos is not null then
    delete from public.facturasrecibidas_punteos existing
    where existing.factura_id = p_factura_id
      and not exists (
        select 1
        from jsonb_array_elements(p_punteos) with ordinality as incoming(value, ordinality)
        where incoming.ordinality::integer = existing.posicion
      );

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
      p_factura_id,
      item.ordinality::integer,
      row_value.remote_id,
      row_value."Origen",
      row_value."Serie",
      row_value."Albaran",
      row_value."Ref",
      row_value."Fecha",
      coalesce(row_value."Importe P", 0),
      coalesce(row_value."Importe", 0),
      coalesce(row_value."S", true),
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
    ) as row_value
    on conflict (factura_id, posicion) do update
      set remote_id = excluded.remote_id,
          "Origen" = excluded."Origen",
          "Serie" = excluded."Serie",
          "Albaran" = excluded."Albaran",
          "Ref" = excluded."Ref",
          "Fecha" = excluded."Fecha",
          "Importe P" = excluded."Importe P",
          "Importe" = excluded."Importe",
          "S" = excluded."S",
          "Ver" = excluded."Ver",
          empresa_id = excluded.empresa_id,
          proveedor_id = excluded.proveedor_id,
          cuenta_gasto = excluded.cuenta_gasto,
          raw = excluded.raw,
          source_table = excluded.source_table,
          source_id = excluded.source_id,
          importe_factura = excluded.importe_factura,
          line_count = excluded.line_count,
          source_lines = excluded.source_lines,
          updated_at = excluded.updated_at;
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
    v_updated.row_version,
    p_request_id,
    case when p_change_source = 'extract' then 'extract' else 'update' end,
    coalesce(nullif(p_change_source, ''), 'edge_update'),
    p_reason,
    p_actor,
    v_snapshot
  );

  return v_snapshot || jsonb_build_object(
    'version', v_updated.row_version,
    'request_id', p_request_id
  );
end;
$$;

create or replace function public.begin_factura_recibida_sync_v2(
  p_factura_id uuid,
  p_expected_version bigint,
  p_request_id uuid,
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
  v_existing public.facturasrecibidas_sync_attempts%rowtype;
  v_snapshot jsonb;
begin
  if p_factura_id is null or p_request_id is null then
    raise exception 'INVALID_PAYLOAD: factura_id y request_id son requeridos';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'INVALID_PAYLOAD: expected_version es requerido';
  end if;

  select *
  into v_current
  from public.facturasrecibidas
  where id = p_factura_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: factura no encontrada';
  end if;

  select *
  into v_existing
  from public.facturasrecibidas_sync_attempts
  where request_id = p_request_id
  order by started_at
  limit 1;

  if found then
    if v_existing.factura_id <> p_factura_id then
      raise exception 'IDEMPOTENCY_CONFLICT: request_id pertenece a otra factura';
    end if;
    if v_current.sync_status = 'sent' and v_current.last_request_id = p_request_id then
      return jsonb_build_object(
        'replayed', true,
        'terminal', true,
        'factura', to_jsonb(v_current),
        'version', v_current.row_version,
        'response', v_current.erp_response
      );
    end if;
    if v_current.sync_status in ('unknown', 'reconciling') then
      raise exception 'SYNC_RECONCILIATION_REQUIRED: no se puede reenviar hasta reconciliar el resultado anterior';
    end if;
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
    or v_current.sync_status in ('sending', 'unknown', 'reconciling', 'sent')
  then
    raise exception 'FACTURA_LOCKED: la factura no se puede enviar';
  end if;

  insert into public.facturasrecibidas_sync_attempts (
    factura_id,
    request_id,
    phase,
    dry_run,
    status,
    request_payload,
    created_by
  ) values (
    p_factura_id,
    p_request_id,
    'dry_run',
    true,
    'in_progress',
    coalesce(p_payload, '{}'::jsonb),
    p_actor
  )
  on conflict (request_id, phase) do update
    set request_payload = excluded.request_payload,
        status = 'in_progress',
        error = null,
        completed_at = null,
        updated_at = now();

  update public.facturasrecibidas
  set estado = 'preparada_erp',
      sync_status = 'sending',
      accounting_status = case
        when coalesce("FRR_Contabilizar", 'N') = 'S' then 'requested'
        else 'not_requested'
      end,
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
    'edge_send',
    p_actor,
    v_snapshot
  );

  return jsonb_build_object(
    'replayed', false,
    'terminal', false,
    'factura', to_jsonb(v_current),
    'version', v_current.row_version,
    'request_id', p_request_id
  );
end;
$$;

create or replace function public.finish_factura_recibida_sync_v2(
  p_factura_id uuid,
  p_request_id uuid,
  p_phase text,
  p_status text,
  p_response jsonb default null,
  p_http_status integer default null,
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
  v_snapshot jsonb;
begin
  if p_phase not in ('dry_run', 'commit', 'readback', 'reconcile') then
    raise exception 'INVALID_PAYLOAD: fase de sincronizacion no valida';
  end if;
  if p_status not in ('in_progress', 'succeeded', 'failed', 'unknown') then
    raise exception 'INVALID_PAYLOAD: estado de intento no valido';
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

  insert into public.facturasrecibidas_sync_attempts (
    factura_id,
    request_id,
    phase,
    dry_run,
    status,
    request_payload,
    response_payload,
    http_status,
    error,
    completed_at,
    created_by
  ) values (
    p_factura_id,
    p_request_id,
    p_phase,
    p_phase = 'dry_run',
    p_status,
    case when p_status = 'in_progress' then coalesce(p_response, '{}'::jsonb) else '{}'::jsonb end,
    case when p_status = 'in_progress' then null else p_response end,
    p_http_status,
    p_error,
    case when p_status = 'in_progress' then null else now() end,
    p_actor
  )
  on conflict (request_id, phase) do update
    set status = excluded.status,
        request_payload = case
          when excluded.status = 'in_progress' then excluded.request_payload
          else public.facturasrecibidas_sync_attempts.request_payload
        end,
        response_payload = excluded.response_payload,
        http_status = excluded.http_status,
        error = excluded.error,
        completed_at = excluded.completed_at,
        updated_at = now();

  if p_status in ('failed', 'unknown') then
    update public.facturasrecibidas
    set estado = 'error_erp',
        sync_status = case when p_status = 'unknown' then 'unknown' else 'error' end,
        accounting_status = case
          when p_phase in ('commit', 'readback') and p_status = 'unknown' then 'unknown'
          else accounting_status
        end,
        erp_response = coalesce(p_response, erp_response),
        erp_error = coalesce(nullif(p_error, ''), 'Fallo de sincronizacion ERP'),
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
      'edge_send',
      p_error,
      p_actor,
      v_snapshot
    );
  end if;

  return jsonb_build_object(
    'factura', to_jsonb(v_current),
    'version', v_current.row_version,
    'request_id', p_request_id,
    'phase', p_phase,
    'status', p_status
  );
end;
$$;

create or replace function public.finalize_factura_recibida_sync_v2(
  p_factura_id uuid,
  p_request_id uuid,
  p_write_response jsonb,
  p_readback jsonb,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current public.facturasrecibidas%rowtype;
  v_header jsonb := coalesce(p_readback->'factura', '{}'::jsonb);
  v_accounting jsonb := coalesce(
    p_readback->'accounting',
    p_readback->'asiento',
    '{}'::jsonb
  );
  v_readback_ctb jsonb := coalesce(p_readback->'ctb', '[]'::jsonb);
  v_readback_punteos jsonb := coalesce(p_readback->'punteos', '[]'::jsonb);
  v_lines jsonb;
  v_remote_text text;
  v_readback_text text;
  v_remote_id bigint;
  v_readback_id bigint;
  v_technical_text text;
  v_technical_id bigint;
  v_visible_number text;
  v_accounting_date date;
  v_accounting_status text;
  v_total_debit numeric(18,2) := 0;
  v_total_credit numeric(18,2) := 0;
  v_line_count integer := 0;
  v_balanced boolean := false;
  v_asiento_id uuid;
  v_snapshot jsonb;
  v_expected_ctb_count integer;
  v_expected_punteos_count integer;
begin
  if p_write_response is null or jsonb_typeof(p_write_response) <> 'object' then
    raise exception 'INVALID_WRITE_RESPONSE: respuesta de escritura ausente';
  end if;
  if p_readback is null or jsonb_typeof(p_readback) <> 'object' then
    raise exception 'INVALID_READBACK: lectura ERP ausente';
  end if;
  if lower(coalesce(p_write_response->>'ok', 'true')) not in ('true', '1') then
    raise exception 'INVALID_WRITE_RESPONSE: ERP no confirmo ok=true';
  end if;
  if lower(coalesce(p_write_response->>'dry_run', 'false')) in ('true', '1') then
    raise exception 'INVALID_WRITE_RESPONSE: no se puede finalizar con dry_run=true';
  end if;

  v_remote_text := coalesce(
    nullif(p_write_response->>'FRR_id', ''),
    nullif(p_write_response#>>'{factura,FRR_id}', ''),
    nullif(p_write_response#>>'{data,FRR_id}', ''),
    nullif(p_write_response#>>'{result,FRR_id}', '')
  );
  if v_remote_text !~ '^[0-9]+$' then
    raise exception 'INVALID_WRITE_RESPONSE: FRR_id remoto positivo requerido';
  end if;
  v_remote_id := v_remote_text::bigint;
  if v_remote_id <= 0 then
    raise exception 'INVALID_WRITE_RESPONSE: FRR_id remoto positivo requerido';
  end if;

  v_readback_text := coalesce(
    nullif(v_header->>'FRR_id', ''),
    nullif(v_header->>'id', ''),
    nullif(p_readback->>'FRR_id', '')
  );
  if v_readback_text !~ '^[0-9]+$' then
    raise exception 'INVALID_READBACK: no se pudo confirmar FRR_id en ERP';
  end if;
  v_readback_id := v_readback_text::bigint;
  if v_readback_id <> v_remote_id then
    raise exception 'INVALID_READBACK: FRR_id escrito (%) y leido (%) no coinciden',
      v_remote_id,
      v_readback_id;
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
  if v_current."FRR_id" is not null and v_current."FRR_id" <> v_remote_id then
    raise exception 'REMOTE_ID_CONFLICT: la factura ya tiene otro FRR_id';
  end if;

  if jsonb_typeof(v_readback_ctb) <> 'array'
    or jsonb_typeof(v_readback_punteos) <> 'array'
  then
    raise exception 'INVALID_READBACK: ctb y punteos deben ser arrays';
  end if;

  select count(*)::integer
  into v_expected_ctb_count
  from public.facturasrecibidas_ctb
  where factura_id = p_factura_id;

  select count(*)::integer
  into v_expected_punteos_count
  from public.facturasrecibidas_punteos
  where factura_id = p_factura_id;

  if jsonb_array_length(v_readback_ctb) <> v_expected_ctb_count then
    raise exception 'INVALID_READBACK: CTB escrito (%) y leido (%) no coincide',
      v_expected_ctb_count,
      jsonb_array_length(v_readback_ctb);
  end if;
  if jsonb_array_length(v_readback_punteos) <> v_expected_punteos_count then
    raise exception 'INVALID_READBACK: punteos escritos (%) y leidos (%) no coinciden',
      v_expected_punteos_count,
      jsonb_array_length(v_readback_punteos);
  end if;

  update public.facturasrecibidas_ctb existing
  set "FRC_id" = coalesce(incoming."FRC_id", existing."FRC_id"),
      "FRC_idfacturarecibida" = v_remote_id,
      "FRC_Importe" = coalesce(incoming."FRC_Importe", existing."FRC_Importe"),
      "FRC_Cuenta" = coalesce(incoming."FRC_Cuenta", existing."FRC_Cuenta"),
      "FRC_IdActividad" = coalesce(incoming."FRC_IdActividad", existing."FRC_IdActividad"),
      "FRC_Idseccion" = coalesce(incoming."FRC_Idseccion", existing."FRC_Idseccion"),
      "FRC_Iddepartamento" = coalesce(incoming."FRC_Iddepartamento", existing."FRC_Iddepartamento"),
      "FRC_Idsubdepartamento" = coalesce(incoming."FRC_Idsubdepartamento", existing."FRC_Idsubdepartamento"),
      "FRC_IdUsuarioLog" = incoming."FRC_IdUsuarioLog",
      "FRC_FechaLog" = incoming."FRC_FechaLog",
      "FRC_HoraLog" = incoming."FRC_HoraLog",
      updated_at = now()
  from (
    select
      item.ordinality::integer as incoming_position,
      row_value."FRC_id",
      row_value."FRC_Importe",
      row_value."FRC_Cuenta",
      row_value."FRC_IdActividad",
      row_value."FRC_Idseccion",
      row_value."FRC_Iddepartamento",
      row_value."FRC_Idsubdepartamento",
      row_value."FRC_IdUsuarioLog",
      row_value."FRC_FechaLog",
      row_value."FRC_HoraLog"
    from jsonb_array_elements(v_readback_ctb) with ordinality as item(value, ordinality)
    cross join lateral jsonb_populate_record(
      null::public.facturasrecibidas_ctb,
      item.value
    ) as row_value
  ) incoming
  where existing.factura_id = p_factura_id
    and existing.posicion = incoming.incoming_position;

  update public.facturasrecibidas_punteos existing
  set remote_id = coalesce(incoming.remote_id, existing.remote_id),
      "Origen" = coalesce(incoming."Origen", existing."Origen"),
      "Serie" = coalesce(incoming."Serie", existing."Serie"),
      "Albaran" = coalesce(incoming."Albaran", existing."Albaran"),
      "Ref" = coalesce(incoming."Ref", existing."Ref"),
      "Fecha" = coalesce(incoming."Fecha", existing."Fecha"),
      "Importe P" = coalesce(incoming."Importe P", existing."Importe P"),
      "Importe" = coalesce(incoming."Importe", existing."Importe"),
      "S" = coalesce(incoming."S", existing."S"),
      "Ver" = coalesce(incoming."Ver", existing."Ver"),
      empresa_id = coalesce(incoming.empresa_id, existing.empresa_id),
      proveedor_id = coalesce(incoming.proveedor_id, existing.proveedor_id),
      cuenta_gasto = coalesce(incoming.cuenta_gasto, existing.cuenta_gasto),
      raw = coalesce(incoming.raw, incoming.raw_value, existing.raw),
      source_table = coalesce(incoming.source_table, existing.source_table),
      source_id = coalesce(incoming.source_id, existing.source_id),
      importe_factura = coalesce(incoming.importe_factura, existing.importe_factura),
      line_count = coalesce(incoming.line_count, existing.line_count),
      source_lines = coalesce(incoming.source_lines, existing.source_lines),
      updated_at = now()
  from (
    select
      item.ordinality::integer as incoming_position,
      item.value as raw_value,
      row_value.remote_id,
      row_value."Origen",
      row_value."Serie",
      row_value."Albaran",
      row_value."Ref",
      row_value."Fecha",
      row_value."Importe P",
      row_value."Importe",
      row_value."S",
      row_value."Ver",
      row_value.empresa_id,
      row_value.proveedor_id,
      row_value.cuenta_gasto,
      row_value.raw,
      row_value.source_table,
      row_value.source_id,
      row_value.importe_factura,
      row_value.line_count,
      row_value.source_lines
    from jsonb_array_elements(v_readback_punteos) with ordinality as item(value, ordinality)
    cross join lateral jsonb_populate_record(
      null::public.facturasrecibidas_punteos,
      item.value
    ) as row_value
  ) incoming
  where existing.factura_id = p_factura_id
    and existing.posicion = incoming.incoming_position;

  v_technical_text := coalesce(
    nullif(v_accounting->>'technical_id', ''),
    nullif(v_accounting->>'FRR_IdAsientoNet', ''),
    nullif(v_header->>'FRR_IdAsientoNet', '')
  );
  if v_technical_text ~ '^[0-9]+$' then
    v_technical_id := v_technical_text::bigint;
  end if;

  v_visible_number := coalesce(
    nullif(v_accounting->>'visible_number', ''),
    nullif(v_accounting->>'numero', ''),
    nullif(v_accounting->>'asiento', '')
  );

  begin
    v_accounting_date := coalesce(
      nullif(v_accounting->>'date', '')::date,
      nullif(v_accounting->>'fecha', '')::date,
      nullif(v_header->>'FRR_fechactb', '')::date
    );
  exception when invalid_datetime_format then
    v_accounting_date := null;
  end;

  v_lines := coalesce(
    v_accounting->'lines',
    v_accounting->'apuntes',
    p_readback->'apuntes',
    '[]'::jsonb
  );
  if jsonb_typeof(v_lines) <> 'array' then
    v_lines := '[]'::jsonb;
  end if;

  select
    count(*)::integer,
    coalesce(sum(
      case
        when coalesce(line.value->>'debe', line.value->>'debit', '') ~ '^[0-9]+([.][0-9]+)?$'
          then coalesce(line.value->>'debe', line.value->>'debit')::numeric
        when lower(coalesce(line.value->>'side', line.value->>'lado', '')) = 'debe'
          and coalesce(line.value->>'amount', line.value->>'importe', '') ~ '^[0-9]+([.][0-9]+)?$'
          then coalesce(line.value->>'amount', line.value->>'importe')::numeric
        else 0
      end
    ), 0),
    coalesce(sum(
      case
        when coalesce(line.value->>'haber', line.value->>'credit', '') ~ '^[0-9]+([.][0-9]+)?$'
          then coalesce(line.value->>'haber', line.value->>'credit')::numeric
        when lower(coalesce(line.value->>'side', line.value->>'lado', '')) = 'haber'
          and coalesce(line.value->>'amount', line.value->>'importe', '') ~ '^[0-9]+([.][0-9]+)?$'
          then coalesce(line.value->>'amount', line.value->>'importe')::numeric
        else 0
      end
    ), 0)
  into v_line_count, v_total_debit, v_total_credit
  from jsonb_array_elements(v_lines) as line(value);

  v_balanced :=
    v_line_count > 0
    and abs(v_total_debit - v_total_credit) <= 0.01;

  v_accounting_status := case
    when lower(coalesce(v_accounting->>'status', '')) = 'error' then 'error'
    when lower(coalesce(v_accounting->>'status', '')) = 'unknown' then 'unknown'
    when coalesce(v_technical_id, 0) > 0
      and v_visible_number is not null
      and v_balanced
      then 'created'
    when coalesce(v_technical_id, 0) > 0 or v_visible_number is not null then 'pending'
    when coalesce(v_current."FRR_Contabilizar", 'N') = 'S' then 'pending'
    else 'not_requested'
  end;

  if coalesce(v_current."FRR_Contabilizar", 'N') = 'S'
    and (
      v_accounting_status <> 'created'
      or coalesce(v_technical_id, 0) <= 0
      or v_visible_number is null
      or v_line_count <= 0
      or not v_balanced
    )
  then
    raise exception 'INVALID_READBACK: contabilizacion solicitada exige asiento creado, numero visible e importes Debe/Haber cuadrados';
  end if;

  if coalesce(v_current."FRR_Contabilizar", 'N') = 'S'
    and jsonb_typeof(v_accounting) = 'object'
    and (v_accounting <> '{}'::jsonb or v_line_count > 0)
  then
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
      coalesce(
        nullif(v_accounting->>'concept', ''),
        nullif(v_accounting->>'concepto', ''),
        nullif(v_header->>'FRR_Concepto', '')
      ),
      case when v_accounting_status = 'not_requested' then 'pending' else v_accounting_status end,
      v_total_debit,
      v_total_credit,
      v_balanced,
      v_accounting
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
      coalesce(
        nullif(line.value->>'cuenta', ''),
        nullif(line.value->>'account', ''),
        nullif(line.value->>'account_code', '')
      ),
      coalesce(
        nullif(line.value->>'descripcion', ''),
        nullif(line.value->>'concepto', ''),
        nullif(line.value->>'description', '')
      ),
      case
        when coalesce(line.value->>'debe', line.value->>'debit', '') ~ '^[0-9]+([.][0-9]+)?$'
          then coalesce(line.value->>'debe', line.value->>'debit')::numeric
        when lower(coalesce(line.value->>'side', line.value->>'lado', '')) = 'debe'
          and coalesce(line.value->>'amount', line.value->>'importe', '') ~ '^[0-9]+([.][0-9]+)?$'
          then coalesce(line.value->>'amount', line.value->>'importe')::numeric
        else 0
      end,
      case
        when coalesce(line.value->>'haber', line.value->>'credit', '') ~ '^[0-9]+([.][0-9]+)?$'
          then coalesce(line.value->>'haber', line.value->>'credit')::numeric
        when lower(coalesce(line.value->>'side', line.value->>'lado', '')) = 'haber'
          and coalesce(line.value->>'amount', line.value->>'importe', '') ~ '^[0-9]+([.][0-9]+)?$'
          then coalesce(line.value->>'amount', line.value->>'importe')::numeric
        else 0
      end,
      coalesce(line.value->'analytic', line.value->'analitica', '{}'::jsonb),
      line.value
    from jsonb_array_elements(v_lines) with ordinality as line(value, ordinality)
    on conflict (asiento_id, posicion) do nothing;
  end if;

  update public.facturasrecibidas
  set estado = 'enviada_erp',
      sync_status = 'sent',
      accounting_status = v_accounting_status,
      accounting_visible_number = v_visible_number,
      accounting_date = v_accounting_date,
      "FRR_id" = v_remote_id,
      "FRR_numero" = case
        when coalesce(v_header->>'FRR_numero', p_write_response->>'FRR_numero', '') ~ '^[0-9]+$'
          then coalesce(v_header->>'FRR_numero', p_write_response->>'FRR_numero')::bigint
        else "FRR_numero"
      end,
      "FRR_IdAsientoNet" = coalesce(v_technical_id, "FRR_IdAsientoNet"),
      erp_sent_at = coalesce(erp_sent_at, now()),
      erp_sent_by = coalesce(erp_sent_by, p_actor),
      erp_response = p_write_response,
      erp_error = null,
      erp_last_read_at = now(),
      erp_last_read_payload = p_readback,
      row_version = row_version + 1,
      updated_by = p_actor,
      updated_at = now()
  where id = p_factura_id
  returning * into v_current;

  insert into public.facturasrecibidas_sync_attempts (
    factura_id,
    request_id,
    phase,
    dry_run,
    status,
    response_payload,
    completed_at,
    created_by
  ) values (
    p_factura_id,
    p_request_id,
    'readback',
    false,
    'succeeded',
    p_readback,
    now(),
    p_actor
  )
  on conflict (request_id, phase) do update
    set status = 'succeeded',
        response_payload = excluded.response_payload,
        error = null,
        completed_at = now(),
        updated_at = now();

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
    'sync_finalize',
    'edge_readback',
    p_actor,
    v_snapshot
  );

  return jsonb_build_object(
    'factura', to_jsonb(v_current),
    'version', v_current.row_version,
    'request_id', p_request_id,
    'accounting', case when v_asiento_id is null then jsonb_build_object(
      'status', v_accounting_status,
      'technical_id', v_technical_id,
      'visible_number', v_visible_number,
      'date', v_accounting_date
    ) else (
      select to_jsonb(a) || jsonb_build_object(
        'lines',
        coalesce((
          select jsonb_agg(to_jsonb(l) order by l.posicion)
          from public.facturasrecibidas_asiento_apuntes l
          where l.asiento_id = a.id
        ), '[]'::jsonb)
      )
      from public.facturasrecibidas_asientos a
      where a.id = v_asiento_id
    ) end
  );
end;
$$;

create or replace function public.delete_factura_recibida_v2(
  p_factura_id uuid,
  p_expected_version bigint,
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
  v_current public.facturasrecibidas%rowtype;
  v_snapshot jsonb;
begin
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
    or v_current.sync_status in ('sending', 'unknown', 'reconciling', 'sent')
  then
    raise exception 'FACTURA_LOCKED: la factura no se puede borrar';
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
    v_current.row_version + 1,
    p_request_id,
    'delete',
    'edge_delete',
    p_reason,
    p_actor,
    v_snapshot
  );

  delete from public.facturasrecibidas where id = p_factura_id;

  return jsonb_build_object(
    'deleted', true,
    'factura_id', p_factura_id,
    'request_id', p_request_id
  );
end;
$$;

alter table public.facturasrecibidas_revisions enable row level security;
alter table public.facturasrecibidas_sync_attempts enable row level security;
alter table public.facturasrecibidas_asientos enable row level security;
alter table public.facturasrecibidas_asiento_apuntes enable row level security;

drop policy if exists "Facturas revisions: admin read" on public.facturasrecibidas_revisions;
create policy "Facturas revisions: admin read"
on public.facturasrecibidas_revisions
for select
to authenticated
using ((select public.is_admin()));

drop policy if exists "Facturas sync attempts: admin read" on public.facturasrecibidas_sync_attempts;
create policy "Facturas sync attempts: admin read"
on public.facturasrecibidas_sync_attempts
for select
to authenticated
using ((select public.is_admin()));

drop policy if exists "Facturas asientos: permitted read" on public.facturasrecibidas_asientos;
create policy "Facturas asientos: permitted read"
on public.facturasrecibidas_asientos
for select
to authenticated
using (
  (select public.can_access_route('/facturas-recibidas'))
  and exists (
    select 1
    from public.facturasrecibidas f
    where f.id = facturasrecibidas_asientos.factura_id
  )
);

drop policy if exists "Facturas asiento apuntes: permitted read" on public.facturasrecibidas_asiento_apuntes;
create policy "Facturas asiento apuntes: permitted read"
on public.facturasrecibidas_asiento_apuntes
for select
to authenticated
using (
  (select public.can_access_route('/facturas-recibidas'))
  and exists (
    select 1
    from public.facturasrecibidas_asientos a
    join public.facturasrecibidas f on f.id = a.factura_id
    where a.id = facturasrecibidas_asiento_apuntes.asiento_id
  )
);

revoke all on public.facturasrecibidas from anon;
revoke all on public.facturasrecibidas_ctb from anon;
revoke all on public.facturasrecibidas_punteos from anon;
revoke all on public.facturasrecibidas_revisions from anon;
revoke all on public.facturasrecibidas_sync_attempts from anon;
revoke all on public.facturasrecibidas_asientos from anon;
revoke all on public.facturasrecibidas_asiento_apuntes from anon;

grant select on public.facturasrecibidas_revisions to authenticated;
grant select on public.facturasrecibidas_sync_attempts to authenticated;
grant select on public.facturasrecibidas_asientos to authenticated;
grant select on public.facturasrecibidas_asiento_apuntes to authenticated;

grant select, insert, update, delete on public.facturasrecibidas to service_role;
grant select, insert, update, delete on public.facturasrecibidas_ctb to service_role;
grant select, insert, update, delete on public.facturasrecibidas_punteos to service_role;
grant select, insert on public.facturasrecibidas_revisions to service_role;
grant select, insert, update on public.facturasrecibidas_sync_attempts to service_role;
grant select, insert on public.facturasrecibidas_asientos to service_role;
grant select, insert on public.facturasrecibidas_asiento_apuntes to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke execute on function public.prevent_facturas_audit_mutation() from public, anon, authenticated;
revoke execute on function public.enforce_factura_accounting_snapshot_v2() from public, anon, authenticated;
revoke execute on function public.factura_recibida_snapshot_v2(uuid) from public, anon, authenticated;
revoke execute on function public.create_factura_recibida_v2(jsonb, jsonb, jsonb, uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.save_factura_recibida_v2(uuid, bigint, jsonb, jsonb, jsonb, uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.begin_factura_recibida_sync_v2(uuid, bigint, uuid, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.finish_factura_recibida_sync_v2(uuid, uuid, text, text, jsonb, integer, text, uuid) from public, anon, authenticated;
revoke execute on function public.finalize_factura_recibida_sync_v2(uuid, uuid, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.delete_factura_recibida_v2(uuid, bigint, uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.factura_recibida_snapshot_v2(uuid) to service_role;
grant execute on function public.create_factura_recibida_v2(jsonb, jsonb, jsonb, uuid, uuid, text, text) to service_role;
grant execute on function public.save_factura_recibida_v2(uuid, bigint, jsonb, jsonb, jsonb, uuid, uuid, text, text) to service_role;
grant execute on function public.begin_factura_recibida_sync_v2(uuid, bigint, uuid, jsonb, uuid) to service_role;
grant execute on function public.finish_factura_recibida_sync_v2(uuid, uuid, text, text, jsonb, integer, text, uuid) to service_role;
grant execute on function public.finalize_factura_recibida_sync_v2(uuid, uuid, jsonb, jsonb, uuid) to service_role;
grant execute on function public.delete_factura_recibida_v2(uuid, bigint, uuid, uuid, text) to service_role;

insert into storage.buckets (
  id,
  name,
  "public",
  file_size_limit,
  allowed_mime_types
) values (
  'facturas-recibidas-pdf',
  'facturas-recibidas-pdf',
  false,
  20971520,
  array['application/pdf']::text[]
)
on conflict (id) do update
set name = excluded.name,
    "public" = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Facturas PDF: permitted read" on storage.objects;
create policy "Facturas PDF: permitted read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'facturas-recibidas-pdf'
  and (select public.can_access_route('/facturas-recibidas'))
  and exists (
    select 1
    from public.archivos_pdf pdf
    where pdf.storage_bucket = storage.objects.bucket_id
      and pdf.storage_path = storage.objects.name
      and (
        pdf.created_by = (select auth.uid())
        or exists (
          select 1
          from public.facturasrecibidas factura
          where factura.archivo_pdf_id = pdf.id
        )
      )
  )
);

drop policy if exists "Facturas PDF: restrict read" on storage.objects;
create policy "Facturas PDF: restrict read"
on storage.objects
as restrictive
for select
to anon, authenticated
using (
  bucket_id <> 'facturas-recibidas-pdf'
  or (
    (select auth.uid()) is not null
    and (select public.can_access_route('/facturas-recibidas'))
    and exists (
      select 1
      from public.archivos_pdf pdf
      where pdf.storage_bucket = storage.objects.bucket_id
        and pdf.storage_path = storage.objects.name
        and (
          pdf.created_by = (select auth.uid())
          or exists (
            select 1
            from public.facturasrecibidas factura
            where factura.archivo_pdf_id = pdf.id
          )
        )
    )
  )
);

drop policy if exists "Facturas PDF: block browser insert" on storage.objects;
create policy "Facturas PDF: block browser insert"
on storage.objects
as restrictive
for insert
to anon, authenticated
with check (bucket_id <> 'facturas-recibidas-pdf');

drop policy if exists "Facturas PDF: block browser update" on storage.objects;
create policy "Facturas PDF: block browser update"
on storage.objects
as restrictive
for update
to anon, authenticated
using (bucket_id <> 'facturas-recibidas-pdf')
with check (bucket_id <> 'facturas-recibidas-pdf');

drop policy if exists "Facturas PDF: block browser delete" on storage.objects;
create policy "Facturas PDF: block browser delete"
on storage.objects
as restrictive
for delete
to anon, authenticated
using (bucket_id <> 'facturas-recibidas-pdf');

comment on column public.facturasrecibidas.row_version is
  'Optimistic concurrency version. Every atomic local or ERP state transition increments it.';
comment on column public.facturasrecibidas.sync_status is
  'Local-to-ERP synchronization state. unknown/reconciling are deliberately non-editable.';
comment on column public.facturasrecibidas.accounting_status is
  'Accounting lifecycle independent from the invoice document lifecycle.';
comment on column public.facturasrecibidas.accounting_visible_number is
  'Human-visible ERP journal entry number. FRR_IdAsientoNet remains the technical identifier.';
comment on column public.facturasrecibidas.erp_last_read_payload is
  'Last complete ERP readback used to confirm a write; not a substitute for immutable revisions.';
comment on table public.facturasrecibidas_revisions is
  'Immutable complete snapshots of invoice header, FRC lines and punteos. factura_id intentionally has no FK so audit survives an allowed draft deletion.';
comment on table public.facturasrecibidas_sync_attempts is
  'Idempotent request/phase history for API contract v2 ERP writes and reconciliation. factura_id intentionally has no FK so failed/unknown attempts survive draft deletion.';
comment on table public.facturasrecibidas_asientos is
  'Immutable accounting-entry snapshots read from ERP. This table never generates ERP accounting.';
comment on table public.facturasrecibidas_asiento_apuntes is
  'Immutable debit/credit lines belonging to an ERP accounting-entry snapshot.';
comment on column public.facturasrecibidas_punteos.source_lines is
  'Read-only ERP source detail, including albmaterial lines when include_lines=true.';
comment on column public.archivos_pdf.hash_sha256 is
  'SHA-256 of the decoded PDF bytes, never of the base64 text representation.';
