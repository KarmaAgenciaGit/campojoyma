-- The ERP v3 state-machine functions are SECURITY INVOKER and protect the
-- active target snapshot with SELECT ... FOR SHARE. PostgreSQL requires UPDATE
-- on at least one column in addition to SELECT for that row-locking clause.
-- Keep the grant column-scoped: the Edge service only needs to satisfy the lock
-- privilege check, not to mutate the ERP target configuration.
grant update (updated_at)
on table public.erp_targets
to service_role;
