-- Reglas administrables para completar exclusivamente decisiones ERP confirmadas
-- de facturas recibidas. El alcance es empresa y, opcionalmente, acreedor.

create table if not exists public.facturas_recibidas_erp_rules (
  id uuid primary key default gen_random_uuid(),
  empresa_id integer not null check (empresa_id > 0),
  proveedor_id integer check (proveedor_id is null or proveedor_id > 0),
  ejercicio_erp integer check (ejercicio_erp is null or ejercicio_erp > 0),
  tipo_factura varchar(2) check (
    tipo_factura is null
    or char_length(btrim(tipo_factura)) between 1 and 2
  ),
  regimen_id integer check (regimen_id is null or regimen_id > 0),
  fecha_ctb_policy text not null default 'manual' check (
    fecha_ctb_policy in ('manual', 'invoice_date')
  ),
  activo boolean not null default true,
  approval_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint facturas_recibidas_erp_rules_approval_note_check check (
    (
      ejercicio_erp is null
      and tipo_factura is null
      and regimen_id is null
      and fecha_ctb_policy = 'manual'
    )
    or nullif(btrim(approval_note), '') is not null
  )
);

create unique index if not exists facturas_recibidas_erp_rules_empresa_general_uidx
  on public.facturas_recibidas_erp_rules (empresa_id)
  where proveedor_id is null;

create unique index if not exists facturas_recibidas_erp_rules_empresa_proveedor_uidx
  on public.facturas_recibidas_erp_rules (empresa_id, proveedor_id)
  where proveedor_id is not null;

comment on table public.facturas_recibidas_erp_rules is
  'Reglas ERP aprobadas para facturas recibidas, con precedencia de proveedor sobre empresa.';
comment on column public.facturas_recibidas_erp_rules.empresa_id is
  'FRR_Idempresa a la que se aplica la regla.';
comment on column public.facturas_recibidas_erp_rules.proveedor_id is
  'FRR_idproveedor opcional. NULL representa la regla general de empresa.';
comment on column public.facturas_recibidas_erp_rules.fecha_ctb_policy is
  'manual no completa la fecha CTB; invoice_date solo puede activarse con aprobacion explicita.';
comment on column public.facturas_recibidas_erp_rules.approval_note is
  'Evidencia o nota de aprobacion obligatoria cuando la regla completa algun dato ERP.';

drop trigger if exists update_facturas_recibidas_erp_rules_updated_at
  on public.facturas_recibidas_erp_rules;
create trigger update_facturas_recibidas_erp_rules_updated_at
  before update on public.facturas_recibidas_erp_rules
  for each row
  execute function public.update_updated_at_column();

alter table public.facturas_recibidas_erp_rules enable row level security;

drop policy if exists "Facturas ERP rules: permitted read"
  on public.facturas_recibidas_erp_rules;
create policy "Facturas ERP rules: permitted read"
on public.facturas_recibidas_erp_rules
for select
to authenticated
using ((select public.can_access_route('/facturas-recibidas')));

drop policy if exists "Facturas ERP rules: admin insert"
  on public.facturas_recibidas_erp_rules;
create policy "Facturas ERP rules: admin insert"
on public.facturas_recibidas_erp_rules
for insert
to authenticated
with check ((select public.is_admin()));

drop policy if exists "Facturas ERP rules: admin update"
  on public.facturas_recibidas_erp_rules;
create policy "Facturas ERP rules: admin update"
on public.facturas_recibidas_erp_rules
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "Facturas ERP rules: admin delete"
  on public.facturas_recibidas_erp_rules;
create policy "Facturas ERP rules: admin delete"
on public.facturas_recibidas_erp_rules
for delete
to authenticated
using ((select public.is_admin()));

revoke all on table public.facturas_recibidas_erp_rules from public, anon, authenticated;
grant select, insert, update, delete on table public.facturas_recibidas_erp_rules to authenticated;
grant select, insert, update, delete on table public.facturas_recibidas_erp_rules to service_role;

insert into public.facturas_recibidas_erp_rules (
  empresa_id,
  proveedor_id,
  ejercicio_erp,
  tipo_factura,
  regimen_id,
  fecha_ctb_policy,
  activo,
  approval_note
)
values (
  1,
  null,
  25,
  null,
  null,
  'manual',
  true,
  'Ejercicio ERP 25 confirmado por la aceptacion de solo lectura del caso Onduspan el 22/07/2026.'
)
on conflict (empresa_id) where proveedor_id is null do nothing;
