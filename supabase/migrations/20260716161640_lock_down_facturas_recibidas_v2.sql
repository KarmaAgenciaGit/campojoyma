-- Apply only after the v2 Edge Functions and frontend have been promoted.
-- This is deliberately separate from the additive v2 schema migration so a
-- staged rollout cannot cut off the legacy browser write path prematurely.
-- archivos_pdf is shared by other modules and is intentionally not changed.

alter table public.facturasrecibidas enable row level security;
alter table public.facturasrecibidas_ctb enable row level security;
alter table public.facturasrecibidas_punteos enable row level security;

drop policy if exists "Facturasrecibidas: select permitted" on public.facturasrecibidas;
create policy "Facturasrecibidas: select permitted"
on public.facturasrecibidas
for select
to authenticated
using ((select public.can_access_route('/facturas-recibidas')));

drop policy if exists "Facturasrecibidas_ctb: select permitted" on public.facturasrecibidas_ctb;
create policy "Facturasrecibidas_ctb: select permitted"
on public.facturasrecibidas_ctb
for select
to authenticated
using (
  (select public.can_access_route('/facturas-recibidas'))
  and exists (
    select 1
    from public.facturasrecibidas f
    where f.id = facturasrecibidas_ctb.factura_id
  )
);

drop policy if exists "Facturasrecibidas_punteos: select permitted" on public.facturasrecibidas_punteos;
create policy "Facturasrecibidas_punteos: select permitted"
on public.facturasrecibidas_punteos
for select
to authenticated
using (
  (select public.can_access_route('/facturas-recibidas'))
  and exists (
    select 1
    from public.facturasrecibidas f
    where f.id = facturasrecibidas_punteos.factura_id
  )
);

drop policy if exists "Facturasrecibidas: insert permitted" on public.facturasrecibidas;
drop policy if exists "Facturasrecibidas: update permitted" on public.facturasrecibidas;
drop policy if exists "Facturasrecibidas: delete permitted" on public.facturasrecibidas;
drop policy if exists "Facturasrecibidas_ctb: insert permitted" on public.facturasrecibidas_ctb;
drop policy if exists "Facturasrecibidas_ctb: update permitted" on public.facturasrecibidas_ctb;
drop policy if exists "Facturasrecibidas_ctb: delete permitted" on public.facturasrecibidas_ctb;
drop policy if exists "Facturasrecibidas_punteos: insert permitted" on public.facturasrecibidas_punteos;
drop policy if exists "Facturasrecibidas_punteos: update permitted" on public.facturasrecibidas_punteos;
drop policy if exists "Facturasrecibidas_punteos: delete permitted" on public.facturasrecibidas_punteos;

revoke insert, update, delete on public.facturasrecibidas from authenticated;
revoke insert, update, delete on public.facturasrecibidas_ctb from authenticated;
revoke insert, update, delete on public.facturasrecibidas_punteos from authenticated;

revoke all on public.facturasrecibidas from anon;
revoke all on public.facturasrecibidas_ctb from anon;
revoke all on public.facturasrecibidas_punteos from anon;

grant select on public.facturasrecibidas to authenticated;
grant select on public.facturasrecibidas_ctb to authenticated;
grant select on public.facturasrecibidas_punteos to authenticated;

grant select, insert, update, delete on public.facturasrecibidas to service_role;
grant select, insert, update, delete on public.facturasrecibidas_ctb to service_role;
grant select, insert, update, delete on public.facturasrecibidas_punteos to service_role;
