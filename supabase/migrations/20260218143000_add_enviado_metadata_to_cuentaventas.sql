-- Trazabilidad de envio a Ceox para cuentas de venta.
alter table public.cuentaventas
  add column if not exists enviado_por uuid,
  add column if not exists enviado_en timestamptz;

-- Indices para analitica/administracion.
create index if not exists cuentaventas_enviado_en_idx
  on public.cuentaventas (enviado_en desc)
  where enviado_en is not null;

create index if not exists cuentaventas_enviado_por_idx
  on public.cuentaventas (enviado_por)
  where enviado_por is not null;

-- Higiene: si ya existe ID remoto, debe figurar como enviada.
update public.cuentaventas
set enviado = true
where idcuentaventa_orizon is not null
  and enviado = false;

-- Backfill historico para cuentas enviadas sin timestamp.
update public.cuentaventas
set enviado_en = coalesce(updated_at, created_at)
where enviado_en is null
  and (
    enviado = true
    or idcuentaventa_orizon is not null
  );
