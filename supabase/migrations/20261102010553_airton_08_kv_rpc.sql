
create or replace function airton.kv_get(p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select value from airton_private.kv where key = p_key
$$;
create or replace function airton.kv_set(p_key text, p_value jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into airton_private.kv (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now()
$$;
revoke all on function airton.kv_get(text) from public, anon, authenticated;
revoke all on function airton.kv_set(text, jsonb) from public, anon, authenticated;
grant execute on function airton.kv_get(text) to service_role;
grant execute on function airton.kv_set(text, jsonb) to service_role;
revoke all on function airton._uid(uuid) from anon;
;
