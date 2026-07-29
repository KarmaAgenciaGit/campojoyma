-- Staging local de albaranes de entrada. Igual que facturasrecibidas, esta
-- tabla conserva la trazabilidad de un documento procesado por Campojoyma,
-- pero no sustituye a netagrocomer.albentrada ni replica sus lineas.

create table if not exists public.albaranesentrada (
  id uuid primary key default gen_random_uuid(),
  estado text not null default 'pendiente_revision'
    check (
      estado = any (
        array[
          'pendiente_revision',
          'error_extraccion',
          'validado',
          'preparado_erp',
          'enviado_erp',
          'error_erp',
          'descartado'
        ]::text[]
      )
    ),
  agricultor_nombre text,
  source_pdf_name text,
  confidence numeric,
  extraction jsonb not null default '{}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  "AEN_idalbaran" bigint unique,
  "AEN_campa" integer,
  "AEN_serie" varchar(10),
  "AEN_albaran" bigint,
  "AEN_fecha" date,
  "AEN_idagricultor" integer,
  "AEN_idpuntoventa" integer,
  "AEN_idcentro" integer,
  "AEN_referencia" varchar(100),
  "AEN_IdEmpresaAgricultor" integer,
  erp_sent_at timestamptz,
  erp_sent_by uuid references auth.users(id) on delete set null,
  erp_response jsonb,
  erp_error text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source_kind text not null default 'front_draft'
    check (
      source_kind = any (
        array[
          'front_draft',
          'n8n_draft',
          'manual_draft',
          'erp_reference'
        ]::text[]
      )
    ),
  is_readonly_reference boolean not null default false,
  match_status text not null default 'unmatched'
    check (
      match_status = any (
        array[
          'unmatched',
          'matched',
          'ambiguous',
          'missing',
          'reference'
        ]::text[]
      )
    ),
  match_evidence jsonb not null default '{}'::jsonb,
  row_version bigint not null default 1 check (row_version > 0),
  sync_status text not null default 'draft'
    check (
      sync_status = any (
        array[
          'draft',
          'ready',
          'sending',
          'unknown',
          'sent',
          'error',
          'reconciling'
        ]::text[]
      )
    ),
  erp_last_read_at timestamptz,
  erp_last_read_payload jsonb,
  last_request_id uuid,
  check (confidence is null or (confidence >= 0 and confidence <= 1)),
  check (
    sync_status <> 'sent'
    or (
      estado = 'enviado_erp'
      and "AEN_idalbaran" is not null
      and erp_sent_at is not null
    )
  )
);

comment on table public.albaranesentrada is
  'Campojoyma staging de albaranes de entrada. No es la tabla ERP netagrocomer.albentrada y no replica permanentemente sus lineas.';

comment on column public.albaranesentrada."AEN_idalbaran" is
  'Identificador tecnico remoto de netagrocomer.albentrada confirmado por lectura ERP.';

comment on column public.albaranesentrada.extraction is
  'Evidencia documental y metadatos de extraccion; las lineas vigentes se consultan bajo demanda en el ERP.';

create unique index if not exists idx_albaranesentrada_business_identity
  on public.albaranesentrada (
    "AEN_campa",
    upper(nullif(btrim("AEN_serie"), '')),
    "AEN_albaran"
  )
  where "AEN_campa" is not null
    and nullif(btrim("AEN_serie"), '') is not null
    and "AEN_albaran" is not null
    and estado <> 'descartado';

create index if not exists idx_albaranesentrada_fecha
  on public.albaranesentrada ("AEN_fecha" desc);

create index if not exists idx_albaranesentrada_agricultor
  on public.albaranesentrada ("AEN_idagricultor");

drop trigger if exists update_albaranesentrada_updated_at
  on public.albaranesentrada;

create trigger update_albaranesentrada_updated_at
  before update on public.albaranesentrada
  for each row
  execute function public.update_updated_at_column();

alter table public.albaranesentrada enable row level security;

drop policy if exists "Albaranesentrada: select permitted"
  on public.albaranesentrada;

create policy "Albaranesentrada: select permitted"
on public.albaranesentrada
for select
to authenticated
using (
  public.can_access_route('/albaranes')
  or public.can_access_route('/facturas-recibidas')
);

revoke all
on table public.albaranesentrada
from anon, authenticated, public;

grant select
on table public.albaranesentrada
to authenticated;

grant select, insert, update, delete, truncate, references, trigger
on table public.albaranesentrada
to service_role;

-- Ejemplo funcional documentado en las capturas del ERP. Se conserva como
-- referencia enviada por el mismo usuario que creo/envio la prueba ONDUSPAN,
-- sin inventar un PDF ni duplicar las lineas del albaran.
with actor as (
  select coalesce(f.erp_sent_by, f.created_by) as user_id
  from public.facturasrecibidas f
  where f."FRR_numerofactura" in ('TEST-A-00748886-01', 'A-00748886')
    and lower(coalesce(f.proveedor_nombre, '')) like '%onduspan%'
  order by
    (f."FRR_numerofactura" = 'TEST-A-00748886-01') desc,
    f.erp_sent_at desc nulls last,
    f.created_at desc
  limit 1
)
insert into public.albaranesentrada (
  estado,
  agricultor_nombre,
  confidence,
  extraction,
  validation_errors,
  "AEN_idalbaran",
  "AEN_campa",
  "AEN_serie",
  "AEN_albaran",
  "AEN_fecha",
  "AEN_idagricultor",
  "AEN_idpuntoventa",
  "AEN_idcentro",
  "AEN_referencia",
  erp_sent_at,
  erp_sent_by,
  erp_response,
  created_by,
  updated_by,
  source_kind,
  is_readonly_reference,
  match_status,
  match_evidence,
  row_version,
  sync_status,
  erp_last_read_at,
  erp_last_read_payload
)
select
  'enviado_erp',
  'BENITO DIAZ DIAZ',
  1,
  jsonb_build_object(
    'source', 'direct_supabase_test_fixture',
    'document_kind', 'albaran_entrada',
    'ready_for_review', true,
    'raw_text_summary',
      'Albaran de entrada 25 / A26 / 8436, de fecha 27/07/2026, asociado al agricultor 1954 - BENITO DIAZ DIAZ.',
    'metadata',
      jsonb_build_object(
        'synthetic', true,
        'based_on_erp_aen_id', 82548,
        'based_on_evidence_sha256',
          'F29ACF042BB983F6D725613922F68552CCCC8F1F786425717EAB20DA345E572C',
        'warnings',
          jsonb_build_array(
            'Referencia de prueba creada en Supabase. No representa un nuevo alta real en Netagro.'
          )
      )
  ),
  '[]'::jsonb,
  82548,
  25,
  'A26',
  8436,
  date '2026-07-27',
  1954,
  1,
  1,
  null,
  now(),
  actor.user_id,
  jsonb_build_object(
    'ok', true,
    'source', 'manual_test_confirmation',
    'remote_aen_id', 82548,
    'readback_verified', true,
    'synthetic', true
  ),
  actor.user_id,
  actor.user_id,
  'front_draft',
  false,
  'matched',
  jsonb_build_object(
    'source', 'erp-read-sample',
    'remote_aen_id', 82548,
    'readback_verified', true,
    'synthetic', true
  ),
  2,
  'sent',
  now(),
  jsonb_build_object(
    'id', 82548,
    'campa', 25,
    'serie', 'A26',
    'numero', 8436,
    'fecha', '2026-07-27',
    'agricultor_id', 1954,
    'agricultor_nombre', 'BENITO DIAZ DIAZ',
    'punto_venta_id', 1,
    'centro_id', 1
  )
from (select 1) seed
left join actor on true
on conflict ("AEN_idalbaran") do nothing;
