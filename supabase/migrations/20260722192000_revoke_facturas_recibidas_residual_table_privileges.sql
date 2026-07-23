-- Cierra privilegios de tabla heredados que no pasan por RLS. INSERT, UPDATE y
-- DELETE ya estaban revocados; TRUNCATE, REFERENCES y TRIGGER tambien deben
-- quedar reservados a los procesos de servidor.

revoke truncate, references, trigger
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

grant select, insert, update, delete, truncate, references, trigger
on table
  public.facturasrecibidas,
  public.facturasrecibidas_ctb,
  public.facturasrecibidas_punteos
to service_role;

do $$
declare
  target_table regclass;
  client_role text;
  forbidden_privilege text;
begin
  foreach target_table in array array[
    'public.facturasrecibidas'::regclass,
    'public.facturasrecibidas_ctb'::regclass,
    'public.facturasrecibidas_punteos'::regclass
  ]
  loop
    foreach client_role in array array['authenticated', 'anon']
    loop
      foreach forbidden_privilege in array array[
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER'
      ]
      loop
        if pg_catalog.has_table_privilege(
          client_role,
          target_table,
          forbidden_privilege
        ) then
          raise exception 'ACL_INVALID: % conserva % sobre %',
            client_role,
            forbidden_privilege,
            target_table;
        end if;
      end loop;
    end loop;

    if not pg_catalog.has_table_privilege(
      'authenticated',
      target_table,
      'SELECT'
    ) then
      raise exception 'ACL_INVALID: authenticated perdio SELECT sobre %',
        target_table;
    end if;

    foreach forbidden_privilege in array array[
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER'
    ]
    loop
      if not pg_catalog.has_table_privilege(
        'service_role',
        target_table,
        forbidden_privilege
      ) then
        raise exception 'ACL_INVALID: service_role perdio % sobre %',
          forbidden_privilege,
          target_table;
      end if;
    end loop;
  end loop;
end;
$$;
