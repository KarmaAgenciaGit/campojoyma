-- Cierra definitivamente la mutacion directa desde Data API para facturas
-- recibidas. La UI conserva lectura sujeta a RLS; toda escritura sigue pasando
-- por Edge Functions y los RPC v3 ejecutados con service_role.

alter table public.facturasrecibidas enable row level security;
alter table public.facturasrecibidas_ctb enable row level security;
alter table public.facturasrecibidas_punteos enable row level security;
alter table public.facturasrecibidas_sync_attempts enable row level security;
alter table public.facturasrecibidas_asientos enable row level security;
alter table public.facturasrecibidas_asiento_apuntes enable row level security;
alter table public.facturasrecibidas_revisions enable row level security;

-- Algunas instalaciones conservaron politicas INSERT/UPDATE/DELETE de la
-- primera version aunque sus ACL ya las hacian inertes. Se eliminan por comando
-- y no por nombre para cubrir tambien politicas legacy o creadas como FOR ALL.
do $policy_cleanup$
declare
  policy_to_drop record;
begin
  for policy_to_drop in
    select policy.schemaname, policy.tablename, policy.policyname
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = any (array[
        'facturasrecibidas',
        'facturasrecibidas_ctb',
        'facturasrecibidas_punteos',
        'facturasrecibidas_sync_attempts',
        'facturasrecibidas_asientos',
        'facturasrecibidas_asiento_apuntes',
        'facturasrecibidas_revisions'
      ]::text[])
      and policy.cmd <> 'SELECT'
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_to_drop.policyname,
      policy_to_drop.schemaname,
      policy_to_drop.tablename
    );
  end loop;
end;
$policy_cleanup$;

-- Revocar ALL evita que un privilegio residual (incluidos TRUNCATE,
-- REFERENCES o TRIGGER) sobreviva al hardening. PUBLIC se incluye porque sus
-- concesiones son heredadas por anon y authenticated.
revoke all privileges
on table
  public.facturasrecibidas,
  public.facturasrecibidas_ctb,
  public.facturasrecibidas_punteos,
  public.facturasrecibidas_sync_attempts,
  public.facturasrecibidas_asientos,
  public.facturasrecibidas_asiento_apuntes,
  public.facturasrecibidas_revisions
from public, anon, authenticated;

grant select
on table
  public.facturasrecibidas,
  public.facturasrecibidas_ctb,
  public.facturasrecibidas_punteos,
  public.facturasrecibidas_sync_attempts,
  public.facturasrecibidas_asientos,
  public.facturasrecibidas_asiento_apuntes,
  public.facturasrecibidas_revisions
to authenticated;

-- Reafirma el acceso minimo de servidor sin abrir nuevas capacidades a los
-- clientes. Los snapshots contables y revisiones siguen siendo append-only.
grant select, insert, update, delete
on table
  public.facturasrecibidas,
  public.facturasrecibidas_ctb,
  public.facturasrecibidas_punteos
to service_role;

grant select, insert, update
on table public.facturasrecibidas_sync_attempts
to service_role;

grant select, insert
on table
  public.facturasrecibidas_asientos,
  public.facturasrecibidas_asiento_apuntes,
  public.facturasrecibidas_revisions
to service_role;

-- Falla de forma cerrada ante cualquier reapertura de DML, perdida de RLS,
-- desaparicion de una politica de lectura o rotura de los RPC v3.
do $acl_assertions$
declare
  target_table regclass;
  client_role text;
  forbidden_privilege text;
  required_privilege text;
  required_service_privileges text[];
  rpc_signature text;
  rpc_function regprocedure;
begin
  foreach target_table in array array[
    'public.facturasrecibidas'::regclass,
    'public.facturasrecibidas_ctb'::regclass,
    'public.facturasrecibidas_punteos'::regclass,
    'public.facturasrecibidas_sync_attempts'::regclass,
    'public.facturasrecibidas_asientos'::regclass,
    'public.facturasrecibidas_asiento_apuntes'::regclass,
    'public.facturasrecibidas_revisions'::regclass
  ]
  loop
    if not (
      select relation.relrowsecurity
      from pg_catalog.pg_class relation
      where relation.oid = target_table
    ) then
      raise exception 'RLS_INVALID: RLS no esta activo sobre %', target_table;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_policy policy
      where policy.polrelid = target_table
        and policy.polcmd <> 'r'
    ) then
      raise exception 'RLS_INVALID: persiste una politica mutante sobre %',
        target_table;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_policy policy
      where policy.polrelid = target_table
        and policy.polcmd = 'r'
    ) then
      raise exception 'RLS_INVALID: falta una politica SELECT sobre %',
        target_table;
    end if;

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

    if pg_catalog.has_table_privilege('anon', target_table, 'SELECT') then
      raise exception 'ACL_INVALID: anon conserva SELECT sobre %', target_table;
    end if;

    required_service_privileges := case
      when target_table = any (array[
        'public.facturasrecibidas'::regclass,
        'public.facturasrecibidas_ctb'::regclass,
        'public.facturasrecibidas_punteos'::regclass
      ]) then array['SELECT', 'INSERT', 'UPDATE', 'DELETE']
      when target_table = 'public.facturasrecibidas_sync_attempts'::regclass
        then array['SELECT', 'INSERT', 'UPDATE']
      else array['SELECT', 'INSERT']
    end;

    foreach required_privilege in array required_service_privileges
    loop
      if not pg_catalog.has_table_privilege(
        'service_role',
        target_table,
        required_privilege
      ) then
        raise exception 'ACL_INVALID: service_role perdio % sobre %',
          required_privilege,
          target_table;
      end if;
    end loop;
  end loop;

  foreach rpc_signature in array array[
    'public.record_factura_recibida_validation_v3(uuid,bigint,uuid,text,uuid,text,text,jsonb,jsonb,boolean,integer,text,text,text,boolean,uuid)',
    'public.begin_factura_recibida_sync_v3(uuid,bigint,uuid,text,uuid,text,text,jsonb,uuid)',
    'public.finish_factura_recibida_sync_v3(uuid,uuid,text,text,jsonb,integer,text,text,text,boolean,boolean,uuid)',
    'public.finalize_factura_recibida_sync_v3(uuid,uuid,text,uuid,text,text,jsonb,jsonb,uuid)',
    'public.mark_stale_factura_recibida_syncs_v3(interval,uuid)',
    'public.rotate_erp_target_epoch_v3(text,uuid,timestamp with time zone,uuid)',
    'public.set_erp_target_write_mode_v3(text,uuid,text,text,jsonb,uuid)'
  ]
  loop
    rpc_function := pg_catalog.to_regprocedure(rpc_signature);

    if rpc_function is null then
      raise exception 'RPC_MISSING: no existe %', rpc_signature;
    end if;

    if not pg_catalog.has_function_privilege(
      'service_role',
      rpc_function,
      'EXECUTE'
    ) then
      raise exception 'RPC_INVALID: service_role no puede ejecutar %',
        rpc_signature;
    end if;

    foreach client_role in array array['authenticated', 'anon']
    loop
      if pg_catalog.has_function_privilege(
        client_role,
        rpc_function,
        'EXECUTE'
      ) then
        raise exception 'RPC_INVALID: % puede ejecutar %',
          client_role,
          rpc_signature;
      end if;
    end loop;
  end loop;
end;
$acl_assertions$;
