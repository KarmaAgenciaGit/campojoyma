-- Hardening for Campojoyma received-invoice OCR staging.
-- Supabase public.facturasrecibidas is staging, not the real ERP table.

alter table public.archivos_pdf
  add column if not exists storage_bucket text;

alter table public.archivos_pdf
  add column if not exists storage_path text;

alter table public.archivos_pdf
  add column if not exists storage_uploaded_at timestamptz;

alter table public.archivos_pdf
  alter column b64_contenido drop not null;

create unique index if not exists idx_archivos_pdf_storage_path_unique
  on public.archivos_pdf (storage_bucket, storage_path)
  where storage_bucket is not null
    and storage_path is not null;

drop index if exists public.idx_facturasrecibidas_supplier_invoice_unique;

create unique index idx_facturasrecibidas_supplier_invoice_unique
  on public.facturasrecibidas (
    coalesce("FRR_Idempresa", 0),
    coalesce("FRR_ejercicio", 0),
    "FRR_idproveedor",
    nullif(btrim("FRR_numerofactura"), '')
  )
  where "FRR_idproveedor" is not null
    and nullif(btrim("FRR_numerofactura"), '') is not null
    and estado <> 'duplicada';

create table if not exists public.acreedores_cache (
  "ACR_Codigo" integer primary key,
  "ACR_Nombre" text,
  "ACR_Nif" text,
  "ACR_Cuenta" text,
  activo boolean not null default true,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_acreedores_cache_nif
  on public.acreedores_cache (nullif(btrim("ACR_Nif"), ''));

create index if not exists idx_acreedores_cache_nombre
  on public.acreedores_cache (lower("ACR_Nombre"));

drop trigger if exists update_acreedores_cache_updated_at on public.acreedores_cache;
create trigger update_acreedores_cache_updated_at
  before update on public.acreedores_cache
  for each row
  execute function public.update_updated_at_column();

alter table public.acreedores_cache enable row level security;

drop policy if exists "Acreedores_cache: select facturas recibidas" on public.acreedores_cache;
create policy "Acreedores_cache: select facturas recibidas"
on public.acreedores_cache
for select
to authenticated
using (public.can_access_route('/facturas-recibidas'));

drop policy if exists "Acreedores_cache: insert admin" on public.acreedores_cache;
create policy "Acreedores_cache: insert admin"
on public.acreedores_cache
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "Acreedores_cache: update admin" on public.acreedores_cache;
create policy "Acreedores_cache: update admin"
on public.acreedores_cache
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Acreedores_cache: delete admin" on public.acreedores_cache;
create policy "Acreedores_cache: delete admin"
on public.acreedores_cache
for delete
to authenticated
using (public.is_admin());

grant select, insert, update, delete on public.acreedores_cache to authenticated;

comment on table public.facturasrecibidas is
  'Campojoyma OCR staging for received invoices. This is not the real ERP MariaDB erpcomer.facturasrecibidas table.';
comment on table public.facturasrecibidas_ctb is
  'Campojoyma OCR staging accounting lines for received invoices. The local relation is factura_id; ERP IDs are filled after sync.';
comment on table public.acreedores_cache is
  'Local cache of ERP acreedores for OCR/provider validation. acreedores.ACR_Codigo maps to facturasrecibidas.FRR_idproveedor.';
comment on column public.archivos_pdf.b64_contenido is
  'Temporary fallback for tests. Prefer Supabase Storage and keep only storage_bucket/storage_path plus hash metadata here.';
comment on column public.archivos_pdf.storage_bucket is
  'Private Supabase Storage bucket for the PDF when migrated out of Postgres base64.';
comment on column public.archivos_pdf.storage_path is
  'Private Supabase Storage object path for the PDF when migrated out of Postgres base64.';
comment on column public.facturasrecibidas_ctb.factura_id is
  'Local staging UUID relation to public.facturasrecibidas.id.';
comment on column public.facturasrecibidas_ctb."FRC_idfacturarecibida" is
  'Remote ERP facturasrecibidas.FRR_id. Keep null before the invoice is sent/synced to ERP.';
