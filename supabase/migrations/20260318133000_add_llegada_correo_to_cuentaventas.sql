alter table public.cuentaventas
  add column if not exists llegada_correo timestamptz null;
