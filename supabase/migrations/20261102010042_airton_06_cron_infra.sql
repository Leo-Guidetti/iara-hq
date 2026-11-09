
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- segredo compartilhado entre o pg_cron e as Edge Functions (as funções leem daqui com a service role)
insert into airton_private.kv (key, value)
values ('cron_secret', to_jsonb(encode(gen_random_bytes(24), 'hex')))
on conflict (key) do nothing;

create or replace function airton_private.call_function(fn text, body jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_secret text := (select value #>> '{}' from airton_private.kv where key = 'cron_secret');
begin
  return net.http_post(
    url := 'https://wrtrhdrohabspbaxpbeu.supabase.co/functions/v1/' || fn,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-airton-cron', v_secret),
    body := body,
    timeout_milliseconds := 150000);
end $$;
revoke all on function airton_private.call_function(text, jsonb) from public, anon, authenticated;
;
