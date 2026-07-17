alter table public.archivos_pdf
  add column if not exists created_by uuid;

alter table public.archivos_pdf
  alter column created_by set default auth.uid();

drop policy if exists "Archivos_pdf: select facturas recibidas" on public.archivos_pdf;
create policy "Archivos_pdf: select facturas recibidas"
on public.archivos_pdf
for select
to authenticated
using (
  public.can_access_route('/facturas-recibidas')
  and (
    created_by = (select auth.uid())
    or exists (
      select 1
      from public.facturasrecibidas f
      where f.archivo_pdf_id = archivos_pdf.id
    )
  )
);

drop policy if exists "Archivos_pdf: insert permitted" on public.archivos_pdf;
create policy "Archivos_pdf: insert permitted"
on public.archivos_pdf
for insert
to authenticated
with check (
  public.can_access_route('/facturas-recibidas')
  and created_by = (select auth.uid())
);

drop policy if exists "Archivos_pdf: delete admin" on public.archivos_pdf;
create policy "Archivos_pdf: delete admin"
on public.archivos_pdf
for delete
to authenticated
using (
  public.is_admin()
  or (
    public.can_access_route('/facturas-recibidas')
    and created_by = (select auth.uid())
    and not exists (
      select 1
      from public.facturasrecibidas f
      where f.archivo_pdf_id = archivos_pdf.id
    )
  )
);
