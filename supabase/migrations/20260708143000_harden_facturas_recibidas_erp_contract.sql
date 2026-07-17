-- Align Campojoyma received-invoice staging with ERP semantics.
-- Keep FRR_* in facturasrecibidas, keep FRC_* only in facturasrecibidas_ctb,
-- and store ERP "Albaranes/Gtos para puntear" separately.

alter table public.facturasrecibidas
  add column if not exists source_kind text not null default 'ocr_draft';

alter table public.facturasrecibidas
  add column if not exists remote_frr_id bigint;

alter table public.facturasrecibidas
  add column if not exists is_readonly_reference boolean not null default false;

alter table public.facturasrecibidas
  add column if not exists match_status text not null default 'unmatched';

alter table public.facturasrecibidas
  add column if not exists match_evidence jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_source_kind_check'
      and conrelid = 'public.facturasrecibidas'::regclass
  ) then
    alter table public.facturasrecibidas
      add constraint facturasrecibidas_source_kind_check
      check (source_kind in (
        'ocr_draft',
        'email_draft',
        'front_draft',
        'n8n_draft',
        'manual_draft',
        'erp_reference'
      ));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_match_status_check'
      and conrelid = 'public.facturasrecibidas'::regclass
  ) then
    alter table public.facturasrecibidas
      add constraint facturasrecibidas_match_status_check
      check (match_status in (
        'unmatched',
        'matched',
        'ambiguous',
        'missing',
        'reference'
      ));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'facturasrecibidas_reference_frr_id_null_check'
      and conrelid = 'public.facturasrecibidas'::regclass
  ) then
    alter table public.facturasrecibidas
      add constraint facturasrecibidas_reference_frr_id_null_check
      check (source_kind <> 'erp_reference' or "FRR_id" is null);
  end if;
end $$;

update public.facturasrecibidas
set source_kind = case
    when extraction->>'source' = 'apiCampojoyma-read-sample' then 'erp_reference'
    when extraction->>'source' in ('xfuego-front', 'campojoyma-front') then 'front_draft'
    when extraction->>'source' in ('campojoyma-email', 'campojoyma-factura-extraer') then 'email_draft'
    when source_kind is null or source_kind = '' then 'ocr_draft'
    else source_kind
  end,
  remote_frr_id = coalesce(
    remote_frr_id,
    case
      when extraction->>'remote_id' ~ '^[0-9]+$' then (extraction->>'remote_id')::bigint
      else null
    end
  ),
  is_readonly_reference = case
    when extraction->>'source' = 'apiCampojoyma-read-sample' then true
    else is_readonly_reference
  end,
  match_status = case
    when extraction->>'source' = 'apiCampojoyma-read-sample' then 'reference'
    when match_status is null or match_status = '' then 'unmatched'
    else match_status
  end,
  match_evidence = case
    when extraction->>'source' = 'apiCampojoyma-read-sample' then jsonb_build_object(
      'source', extraction->>'source',
      'remote_frr_id', case when extraction->>'remote_id' ~ '^[0-9]+$' then (extraction->>'remote_id')::bigint else null end,
      'note', 'Referencia ERP importada para comparacion. No es un borrador enviable.'
    )
    when match_evidence is null then '{}'::jsonb
    else match_evidence
  end;

delete from public.facturasrecibidas_ctb ctb
using public.facturasrecibidas factura
where ctb.factura_id = factura.id
  and factura.source_kind = 'erp_reference'
  and ctb."FRC_id" is null
  and ctb."FRC_idfacturarecibida" is null;

create index if not exists idx_facturasrecibidas_source_kind
  on public.facturasrecibidas (source_kind);

create index if not exists idx_facturasrecibidas_match_status
  on public.facturasrecibidas (match_status);

create unique index if not exists idx_facturasrecibidas_remote_frr_id_unique
  on public.facturasrecibidas (remote_frr_id)
  where remote_frr_id is not null;

create table if not exists public.facturasrecibidas_punteos (
  id uuid primary key default gen_random_uuid(),
  factura_id uuid not null references public.facturasrecibidas(id) on delete cascade,
  posicion integer not null default 1,
  remote_id text,
  "Origen" varchar(10),
  "Serie" varchar(20),
  "Albaran" bigint,
  "Ref" varchar(50),
  "Fecha" date,
  "Importe P" numeric(12,2) default 0,
  "Importe" numeric(12,2) default 0,
  "S" boolean not null default true,
  "Ver" boolean not null default false,
  empresa_id integer,
  proveedor_id integer,
  cuenta_gasto varchar(15),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (factura_id, posicion)
);

create index if not exists idx_facturasrecibidas_punteos_factura
  on public.facturasrecibidas_punteos (factura_id, posicion);

create index if not exists idx_facturasrecibidas_punteos_remote
  on public.facturasrecibidas_punteos (remote_id)
  where remote_id is not null;

drop trigger if exists update_facturasrecibidas_punteos_updated_at on public.facturasrecibidas_punteos;
create trigger update_facturasrecibidas_punteos_updated_at
  before update on public.facturasrecibidas_punteos
  for each row
  execute function public.update_updated_at_column();

alter table public.facturasrecibidas_punteos enable row level security;

drop policy if exists "Facturasrecibidas_punteos: select permitted" on public.facturasrecibidas_punteos;
create policy "Facturasrecibidas_punteos: select permitted"
on public.facturasrecibidas_punteos
for select
to authenticated
using (
  public.can_access_route('/facturas-recibidas')
  and exists (
    select 1
    from public.facturasrecibidas f
    where f.id = facturasrecibidas_punteos.factura_id
  )
);

drop policy if exists "Facturasrecibidas_punteos: insert permitted" on public.facturasrecibidas_punteos;
create policy "Facturasrecibidas_punteos: insert permitted"
on public.facturasrecibidas_punteos
for insert
to authenticated
with check (
  public.can_access_route('/facturas-recibidas')
  and exists (
    select 1
    from public.facturasrecibidas f
    where f.id = facturasrecibidas_punteos.factura_id
  )
);

drop policy if exists "Facturasrecibidas_punteos: update permitted" on public.facturasrecibidas_punteos;
create policy "Facturasrecibidas_punteos: update permitted"
on public.facturasrecibidas_punteos
for update
to authenticated
using (
  public.can_access_route('/facturas-recibidas')
  and exists (
    select 1
    from public.facturasrecibidas f
    where f.id = facturasrecibidas_punteos.factura_id
  )
)
with check (
  public.can_access_route('/facturas-recibidas')
  and exists (
    select 1
    from public.facturasrecibidas f
    where f.id = facturasrecibidas_punteos.factura_id
  )
);

drop policy if exists "Facturasrecibidas_punteos: delete permitted" on public.facturasrecibidas_punteos;
create policy "Facturasrecibidas_punteos: delete permitted"
on public.facturasrecibidas_punteos
for delete
to authenticated
using (
  public.can_access_route('/facturas-recibidas')
  and exists (
    select 1
    from public.facturasrecibidas f
    where f.id = facturasrecibidas_punteos.factura_id
  )
);

grant select, insert, update, delete on public.facturasrecibidas_punteos to authenticated;

comment on column public.facturasrecibidas.source_kind is
  'Origen funcional del registro: borrador OCR/email/front/n8n/manual o referencia ERP de solo lectura.';
comment on column public.facturasrecibidas.remote_frr_id is
  'FRR_id remoto usado para referencias ERP leidas desde la API antes de existir como alta local.';
comment on column public.facturasrecibidas.is_readonly_reference is
  'True si el registro solo sirve para comparar con ERP y no debe enviarse de nuevo.';
comment on column public.facturasrecibidas.match_status is
  'Estado del enlace resuelto por API/n8n para acreedor, factura, cuenta y punteos.';
comment on column public.facturasrecibidas.match_evidence is
  'Evidencias de matching usadas por n8n/API para resolver IDs ERP.';
comment on table public.facturasrecibidas_punteos is
  'Candidatos o enlaces ERP de la tabla Albaranes/Gtos para puntear de facturas recibidas.';
comment on table public.facturasrecibidas_ctb is
  'Solo apuntes contables reales FRC_* de facturas recibidas. No guardar aqui FRR_igasto/FRR_ctagasto.';
