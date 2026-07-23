-- La UI solo lee estas tablas. Toda mutacion pasa por Edge Functions y RPCs
-- ejecutados con service_role, donde se aplican versionado, idempotencia y
-- conciliacion ERP. Las politicas RLS mutantes existentes quedan inertes para
-- clientes sin privilegio de tabla.

revoke insert, update, delete
on table
  public.facturasrecibidas,
  public.facturasrecibidas_ctb,
  public.facturasrecibidas_punteos
from authenticated, anon, public;

grant select
on table
  public.facturasrecibidas,
  public.facturasrecibidas_ctb,
  public.facturasrecibidas_punteos
to authenticated;

grant select, insert, update, delete
on table
  public.facturasrecibidas,
  public.facturasrecibidas_ctb,
  public.facturasrecibidas_punteos
to service_role;

-- Falla la migracion si una concesion directa o heredada vuelve a abrir DML,
-- o si se rompe el acceso operativo esperado.
do $$
declare
  target_table regclass;
begin
  foreach target_table in array array[
    'public.facturasrecibidas'::regclass,
    'public.facturasrecibidas_ctb'::regclass,
    'public.facturasrecibidas_punteos'::regclass
  ]
  loop
    if pg_catalog.has_table_privilege(
      'authenticated',
      target_table,
      'INSERT, UPDATE, DELETE'
    ) then
      raise exception 'ACL_INVALID: authenticated conserva DML sobre %', target_table;
    end if;

    if pg_catalog.has_table_privilege(
      'anon',
      target_table,
      'INSERT, UPDATE, DELETE'
    ) then
      raise exception 'ACL_INVALID: anon conserva DML sobre %', target_table;
    end if;

    if not pg_catalog.has_table_privilege('authenticated', target_table, 'SELECT') then
      raise exception 'ACL_INVALID: authenticated perdio SELECT sobre %', target_table;
    end if;

    if not (
      pg_catalog.has_table_privilege('service_role', target_table, 'SELECT')
      and pg_catalog.has_table_privilege('service_role', target_table, 'INSERT')
      and pg_catalog.has_table_privilege('service_role', target_table, 'UPDATE')
      and pg_catalog.has_table_privilege('service_role', target_table, 'DELETE')
    ) then
      raise exception 'ACL_INVALID: service_role no conserva acceso operativo sobre %', target_table;
    end if;
  end loop;
end;
$$;
