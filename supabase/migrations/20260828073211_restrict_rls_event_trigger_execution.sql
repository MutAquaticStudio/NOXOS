-- Harden the provider-installed RLS event-trigger function without changing
-- the event trigger itself. It is not an application RPC surface.
do $migration$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
    execute 'grant execute on function public.rls_auto_enable() to postgres';
  end if;
end
$migration$;
