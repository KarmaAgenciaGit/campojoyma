-- Create table to store error logs received via webhook or internal services
create table if not exists public.errores (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text,
  tipo text,
  motivo text not null,
  detalles text,
  severidad text,
  estado text,
  metadata jsonb,
  raw_payload jsonb
);

alter table public.errores enable row level security;

create policy "Authenticated users can view errors"
on public.errores
for select
using (auth.role() = 'authenticated'::text);

create index if not exists errores_created_at_idx on public.errores (created_at desc);
create index if not exists errores_source_idx on public.errores (source);
