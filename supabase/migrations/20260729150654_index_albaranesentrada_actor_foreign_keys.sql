create index if not exists idx_albaranesentrada_erp_sent_by
  on public.albaranesentrada (erp_sent_by);

create index if not exists idx_albaranesentrada_created_by
  on public.albaranesentrada (created_by);

create index if not exists idx_albaranesentrada_updated_by
  on public.albaranesentrada (updated_by);
