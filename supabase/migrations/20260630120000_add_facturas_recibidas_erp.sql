-- Facturas recibidas ERP staging model.
-- The platform keeps its own UUID primary key while mirroring ERP FRR/FRC fields.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path to public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  user_email text,
  role text not null default 'user' check (role in ('admin', 'user')),
  allowed_routes text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.archivos_pdf (
  id bigserial primary key,
  hash_sha256 text not null unique,
  b64_contenido text,
  storage_bucket text,
  storage_path text,
  storage_uploaded_at timestamptz,
  nombre_archivo text,
  tamanio_bytes bigint not null default 0,
  mime_type text not null default 'application/pdf',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_archivos_pdf_hash on public.archivos_pdf (hash_sha256);
create index if not exists idx_archivos_pdf_created on public.archivos_pdf (created_at desc);
create unique index if not exists idx_archivos_pdf_storage_path_unique
  on public.archivos_pdf (storage_bucket, storage_path)
  where storage_bucket is not null
    and storage_path is not null;

drop trigger if exists update_user_roles_updated_at on public.user_roles;
create trigger update_user_roles_updated_at
  before update on public.user_roles
  for each row
  execute function public.update_updated_at_column();

drop trigger if exists trigger_archivos_pdf_updated_at on public.archivos_pdf;
create trigger trigger_archivos_pdf_updated_at
  before update on public.archivos_pdf
  for each row
  execute function public.update_updated_at_column();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'admin'
  );
$$;

create table if not exists public.facturasrecibidas (
  id uuid primary key default gen_random_uuid(),
  archivo_pdf_id bigint references public.archivos_pdf(id) on delete set null,
  duplicada_de uuid references public.facturasrecibidas(id) on delete set null,
  estado text not null default 'pendiente_revision'
    check (estado in (
      'pendiente_revision',
      'error_ocr',
      'validada',
      'preparada_erp',
      'enviada_erp',
      'error_erp',
      'duplicada',
      'descartada'
    )),

  proveedor_nombre text,
  proveedor_nif text,
  source_pdf_name text,
  source_page_number integer,
  source_page_count integer,
  email_from text,
  email_subject text,
  email_received_at timestamptz,
  confidence numeric(5,4),
  extraction jsonb not null default '{}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb,

  "FRR_id" bigint,
  "FRR_numero" bigint,
  "FRR_fechafactura" date,
  "FRR_numerofactura" varchar(20),
  "FRR_ejercicio" integer,
  "FRR_idcentro" integer,
  "FRR_idproveedor" integer,
  "FRR_idregimen" integer,
  "FRR_fechactb" date,
  "FRR_base1" numeric(12,2) default 0,
  "FRR_base2" numeric(12,2) default 0,
  "FRR_base3" numeric(12,2) default 0,
  "FRR_base4" numeric(12,2) default 0,
  "FRR_base5" numeric(12,2) default 0,
  "FRR_iva1" numeric(10,2) default 0,
  "FRR_iva2" numeric(10,2) default 0,
  "FRR_iva3" numeric(10,2) default 0,
  "FRR_iva4" numeric(10,2) default 0,
  "FRR_iva5" numeric(10,2) default 0,
  "FRR_cuota1" numeric(12,2) default 0,
  "FRR_cuota2" numeric(12,2) default 0,
  "FRR_cuota3" numeric(12,2) default 0,
  "FRR_cuota4" numeric(12,2) default 0,
  "FRR_cuota5" numeric(12,2) default 0,
  "FRR_baseret" numeric(12,2) default 0,
  "FRR_ret" numeric(10,2) default 0,
  "FRR_cuotaret" numeric(12,2) default 0,
  "FRR_igasto1" numeric(12,2) default 0,
  "FRR_ctagasto1" varchar(11),
  "FRR_igasto2" numeric(12,2) default 0,
  "FRR_ctagasto2" varchar(11),
  "FRR_igasto3" numeric(12,2) default 0,
  "FRR_ctagasto3" varchar(11),
  "FRR_igasto4" numeric(12,2) default 0,
  "FRR_ctagasto4" varchar(11),
  "FRR_totalfac" numeric(12,2),
  "FRR_tipofactura" varchar(2),
  "FRR_idcuenta" varchar(11),
  "FRR_idpuntoventa" integer,
  "FRR_ClaveIRPF" varchar(5),
  "FRR_IdAsientoNet" integer,
  "FRR_CtaCartera" varchar(11),
  "FRR_IdBanco" integer,
  "FRR_IdFormaPago" integer,
  "FechaVto" date,
  "ImporteVto" numeric(18,2),
  "FRR_Modificable" varchar(1),
  "FRR_Idempresa" integer,
  "FRR_idpago" integer,
  "FRR_IdUsuarioLog" integer,
  "FRR_FechaLog" date,
  "FRR_HoraLog" varchar(8),
  "FRR_Concepto" varchar(50),
  "FRR_GeneraCartera" varchar(1),
  "FRR_FechaVto1" date,
  "FRR_ImporteVto1" numeric(18,2),
  "FRR_FechaVto2" date,
  "FRR_ImporteVto2" numeric(18,2),
  "FRR_FechaVto3" date,
  "FRR_ImporteVto3" numeric(18,2),
  "FRR_IdTipoDoc" integer,
  "FRR_IdAgricultorDto" integer,
  "FRR_CtaSuplido" varchar(11),
  "FRR_ImpSuplido" numeric(18,2) default 0,
  "FRR_CuotaNoDeducible" numeric(18,2) default 0,
  "FRR_CancelarporCtb" varchar(1),
  "FRR_Observaciones" varchar(50),
  "FRR_FechaPrevPago" date,
  "FRR_BancoPrevPago" integer,
  "FRR_IdSeccion" integer,
  "FRR_IdActividad" integer,
  "FRR_ObservacionesAEAT" varchar(50),
  "FRR_Contabilizar" varchar(1),
  "FRR_IdfacturaRec" integer,

  erp_sent_at timestamptz,
  erp_sent_by uuid,
  erp_response jsonb,
  erp_error text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.facturasrecibidas_ctb (
  id uuid primary key default gen_random_uuid(),
  factura_id uuid not null references public.facturasrecibidas(id) on delete cascade,
  posicion integer not null default 1,
  "FRC_id" bigint,
  "FRC_idfacturarecibida" bigint,
  "FRC_Importe" numeric(12,2) default 0,
  "FRC_Cuenta" varchar(15),
  "FRC_IdActividad" integer,
  "FRC_Idseccion" integer,
  "FRC_Iddepartamento" integer,
  "FRC_Idsubdepartamento" integer,
  "FRC_IdUsuarioLog" integer,
  "FRC_FechaLog" date,
  "FRC_HoraLog" varchar(8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (factura_id, posicion)
);

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

create index if not exists idx_facturasrecibidas_estado on public.facturasrecibidas (estado);
create index if not exists idx_facturasrecibidas_archivo_pdf on public.facturasrecibidas (archivo_pdf_id);
create index if not exists idx_facturasrecibidas_duplicada_de on public.facturasrecibidas (duplicada_de);
create index if not exists idx_facturasrecibidas_proveedor on public.facturasrecibidas ("FRR_idproveedor");
create index if not exists idx_facturasrecibidas_numero on public.facturasrecibidas ("FRR_numerofactura");
create index if not exists idx_facturasrecibidas_fecha on public.facturasrecibidas ("FRR_fechafactura");
create index if not exists idx_facturasrecibidas_ctb_factura on public.facturasrecibidas_ctb (factura_id);

create unique index if not exists idx_facturasrecibidas_frr_id_unique
  on public.facturasrecibidas ("FRR_id")
  where "FRR_id" is not null;

create unique index if not exists idx_facturasrecibidas_supplier_invoice_unique
  on public.facturasrecibidas (
    coalesce("FRR_Idempresa", 0),
    coalesce("FRR_ejercicio", 0),
    "FRR_idproveedor",
    nullif(btrim("FRR_numerofactura"), '')
  )
  where "FRR_idproveedor" is not null
    and nullif(btrim("FRR_numerofactura"), '') is not null
    and estado <> 'duplicada';

create index if not exists idx_acreedores_cache_nif
  on public.acreedores_cache (nullif(btrim("ACR_Nif"), ''));

create index if not exists idx_acreedores_cache_nombre
  on public.acreedores_cache (lower("ACR_Nombre"));

drop trigger if exists update_facturasrecibidas_updated_at on public.facturasrecibidas;
create trigger update_facturasrecibidas_updated_at
  before update on public.facturasrecibidas
  for each row
  execute function public.update_updated_at_column();

drop trigger if exists update_facturasrecibidas_ctb_updated_at on public.facturasrecibidas_ctb;
create trigger update_facturasrecibidas_ctb_updated_at
  before update on public.facturasrecibidas_ctb
  for each row
  execute function public.update_updated_at_column();

drop trigger if exists update_acreedores_cache_updated_at on public.acreedores_cache;
create trigger update_acreedores_cache_updated_at
  before update on public.acreedores_cache
  for each row
  execute function public.update_updated_at_column();

alter table public.user_roles
  add column if not exists allowed_routes text[];

update public.user_roles
set allowed_routes = array['/facturas-recibidas']::text[]
where role = 'user'
  and allowed_routes is null;

create or replace function public.can_access_route(_route text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_admin()
     or exists (
       select 1
       from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role = 'user'
         and _route = any(coalesce(ur.allowed_routes, '{}'::text[]))
     );
$$;

create or replace function public.get_app_users()
returns table(id uuid, email text, created_at timestamptz)
language sql
stable
security definer
set search_path to public, auth
as $$
  select u.id, u.email::text, u.created_at
  from auth.users u
  where auth.uid() is not null
    and public.is_admin()
  order by u.email nulls last;
$$;

create or replace function public.admin_delete_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to public, auth
as $$
declare
  v_caller_id uuid := auth.uid();
  v_target_email text;
begin
  if v_caller_id is null then
    raise exception 'No autorizado';
  end if;

  if not public.is_admin() then
    raise exception 'Solo administradores';
  end if;

  if p_user_id is null then
    raise exception 'user_id es requerido';
  end if;

  if v_caller_id = p_user_id then
    raise exception 'No puedes eliminar tu propio usuario desde este panel';
  end if;

  select u.email into v_target_email
  from auth.users u
  where u.id = p_user_id;

  if not found then
    raise exception 'Usuario no encontrado en Auth';
  end if;

  delete from auth.users where id = p_user_id;
  return jsonb_build_object('deleted', true, 'user_id', p_user_id, 'email', v_target_email);
end;
$$;

create or replace function public.admin_create_user(
  p_email text,
  p_password text,
  p_role text default 'user',
  p_allowed_routes text[] default array['/facturas-recibidas']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path to public, auth, extensions
as $$
declare
  v_caller_id uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_role text := coalesce(nullif(p_role, ''), 'user');
  v_allowed_routes text[] := coalesce(p_allowed_routes, array['/facturas-recibidas']::text[]);
  v_user_id uuid;
  v_now timestamptz := now();
begin
  if v_caller_id is null then
    raise exception 'No autorizado';
  end if;

  if not public.is_admin() then
    raise exception 'Solo administradores';
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'Email no valido';
  end if;

  if p_password is null or length(p_password) < 6 then
    raise exception 'La contrasena debe tener al menos 6 caracteres';
  end if;

  if v_role not in ('admin', 'user') then
    raise exception 'Rol no valido';
  end if;

  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_user_id is null then
    v_user_id := gen_random_uuid();

    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      created_at,
      updated_at,
      phone,
      phone_change,
      phone_change_token,
      email_change_token_current,
      email_change_confirm_status,
      reauthentication_token,
      is_sso_user,
      is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000'::uuid,
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      crypt(p_password, gen_salt('bf')),
      v_now,
      '',
      '',
      '',
      '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('email_verified', true),
      null,
      v_now,
      v_now,
      null,
      '',
      '',
      '',
      0,
      '',
      false,
      false
    );

    insert into auth.identities (
      provider_id,
      user_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at,
      id
    ) values (
      v_user_id::text,
      v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', false, 'phone_verified', false),
      'email',
      v_now,
      v_now,
      v_now,
      gen_random_uuid()
    ) on conflict (provider_id, provider) do update
      set user_id = excluded.user_id,
          identity_data = excluded.identity_data,
          updated_at = excluded.updated_at;
  else
    update auth.users
    set encrypted_password = crypt(p_password, gen_salt('bf')),
        instance_id = '00000000-0000-0000-0000-000000000000'::uuid,
        updated_at = v_now,
        email_confirmed_at = coalesce(email_confirmed_at, v_now),
        raw_app_meta_data = coalesce(raw_app_meta_data, '{"provider":"email","providers":["email"]}'::jsonb)
    where id = v_user_id;
  end if;

  insert into public.user_roles (user_id, user_email, role, allowed_routes, created_at, updated_at)
  values (v_user_id, v_email, v_role, case when v_role = 'admin' then null else v_allowed_routes end, v_now, v_now)
  on conflict (user_id) do update
    set user_email = excluded.user_email,
        role = excluded.role,
        allowed_routes = excluded.allowed_routes,
        updated_at = excluded.updated_at;

  return jsonb_build_object('id', v_user_id, 'email', v_email, 'role', v_role);
end;
$$;

create or replace function public.handle_new_user_role()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
begin
  insert into public.user_roles (user_id, user_email, role, allowed_routes)
  values (new.id, new.email, 'user', array['/facturas-recibidas']::text[])
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_assign_role on auth.users;
create trigger on_auth_user_created_assign_role
  after insert on auth.users
  for each row execute function public.handle_new_user_role();

alter table public.user_roles enable row level security;

drop policy if exists "User_roles: select own or admin" on public.user_roles;
create policy "User_roles: select own or admin"
on public.user_roles
for select
to authenticated
using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "User_roles: insert admin" on public.user_roles;
create policy "User_roles: insert admin"
on public.user_roles
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "User_roles: update admin" on public.user_roles;
create policy "User_roles: update admin"
on public.user_roles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "User_roles: delete admin" on public.user_roles;
create policy "User_roles: delete admin"
on public.user_roles
for delete
to authenticated
using (public.is_admin());

alter table public.facturasrecibidas enable row level security;
alter table public.facturasrecibidas_ctb enable row level security;
alter table public.acreedores_cache enable row level security;

drop policy if exists "Facturasrecibidas: select permitted" on public.facturasrecibidas;
create policy "Facturasrecibidas: select permitted"
on public.facturasrecibidas
for select
to authenticated
using (public.can_access_route('/facturas-recibidas'));

drop policy if exists "Facturasrecibidas: insert permitted" on public.facturasrecibidas;
create policy "Facturasrecibidas: insert permitted"
on public.facturasrecibidas
for insert
to authenticated
with check (public.can_access_route('/facturas-recibidas'));

drop policy if exists "Facturasrecibidas: update permitted" on public.facturasrecibidas;
create policy "Facturasrecibidas: update permitted"
on public.facturasrecibidas
for update
to authenticated
using (public.can_access_route('/facturas-recibidas'))
with check (public.can_access_route('/facturas-recibidas'));

drop policy if exists "Facturasrecibidas: delete permitted" on public.facturasrecibidas;
create policy "Facturasrecibidas: delete permitted"
on public.facturasrecibidas
for delete
to authenticated
using (public.can_access_route('/facturas-recibidas'));

drop policy if exists "Facturasrecibidas_ctb: select permitted" on public.facturasrecibidas_ctb;
create policy "Facturasrecibidas_ctb: select permitted"
on public.facturasrecibidas_ctb
for select
to authenticated
using (
  public.can_access_route('/facturas-recibidas')
  and
  exists (
    select 1
    from public.facturasrecibidas f
    where f.id = facturasrecibidas_ctb.factura_id
  )
);

drop policy if exists "Facturasrecibidas_ctb: insert permitted" on public.facturasrecibidas_ctb;
create policy "Facturasrecibidas_ctb: insert permitted"
on public.facturasrecibidas_ctb
for insert
to authenticated
with check (
  public.can_access_route('/facturas-recibidas')
  and
  exists (
    select 1
    from public.facturasrecibidas f
    where f.id = facturasrecibidas_ctb.factura_id
  )
);

drop policy if exists "Facturasrecibidas_ctb: update permitted" on public.facturasrecibidas_ctb;
create policy "Facturasrecibidas_ctb: update permitted"
on public.facturasrecibidas_ctb
for update
to authenticated
using (
  public.can_access_route('/facturas-recibidas')
  and
  exists (
    select 1
    from public.facturasrecibidas f
    where f.id = facturasrecibidas_ctb.factura_id
  )
)
with check (
  public.can_access_route('/facturas-recibidas')
  and
  exists (
    select 1
    from public.facturasrecibidas f
    where f.id = facturasrecibidas_ctb.factura_id
  )
);

drop policy if exists "Facturasrecibidas_ctb: delete permitted" on public.facturasrecibidas_ctb;
create policy "Facturasrecibidas_ctb: delete permitted"
on public.facturasrecibidas_ctb
for delete
to authenticated
using (
  public.can_access_route('/facturas-recibidas')
  and
  exists (
    select 1
    from public.facturasrecibidas f
    where f.id = facturasrecibidas_ctb.factura_id
  )
);

alter table public.archivos_pdf enable row level security;

drop policy if exists "Archivos_pdf: select facturas recibidas" on public.archivos_pdf;
create policy "Archivos_pdf: select facturas recibidas"
on public.archivos_pdf
for select
to authenticated
using (
  public.can_access_route('/facturas-recibidas')
  and exists (
    select 1
    from public.facturasrecibidas f
    where f.archivo_pdf_id = archivos_pdf.id
  )
);

drop policy if exists "Archivos_pdf: insert permitted" on public.archivos_pdf;
create policy "Archivos_pdf: insert permitted"
on public.archivos_pdf
for insert
to authenticated
with check (public.can_access_route('/facturas-recibidas'));

drop policy if exists "Archivos_pdf: update admin" on public.archivos_pdf;
create policy "Archivos_pdf: update admin"
on public.archivos_pdf
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Archivos_pdf: delete admin" on public.archivos_pdf;
create policy "Archivos_pdf: delete admin"
on public.archivos_pdf
for delete
to authenticated
using (public.is_admin());

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

revoke all on function public.is_admin() from public;
revoke all on function public.can_access_route(text) from public;
revoke all on function public.get_app_users() from public;
revoke all on function public.admin_delete_user(uuid) from public;
revoke all on function public.admin_create_user(text, text, text, text[]) from public;
revoke all on function public.handle_new_user_role() from public;
revoke execute on function public.is_admin() from anon;
revoke execute on function public.can_access_route(text) from anon;
revoke execute on function public.get_app_users() from anon;
revoke execute on function public.admin_delete_user(uuid) from anon;
revoke execute on function public.admin_create_user(text, text, text, text[]) from anon;
revoke execute on function public.handle_new_user_role() from anon;
revoke execute on function public.handle_new_user_role() from authenticated;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.user_roles to authenticated;
grant select, insert, update, delete on public.archivos_pdf to authenticated;
grant select, insert, update, delete on public.facturasrecibidas to authenticated;
grant select, insert, update, delete on public.facturasrecibidas_ctb to authenticated;
grant select, insert, update, delete on public.acreedores_cache to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_access_route(text) to authenticated;
grant execute on function public.get_app_users() to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
grant execute on function public.admin_create_user(text, text, text, text[]) to authenticated;

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
