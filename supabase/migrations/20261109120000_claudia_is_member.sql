-- ClaudIA v2 · o app checa acesso sem expor o schema claudia na Data API.
create or replace function public.claudia_is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from claudia.members m where m.user_id = (select auth.uid()));
$$;

revoke all on function public.claudia_is_member() from public, anon;
grant execute on function public.claudia_is_member() to authenticated;
