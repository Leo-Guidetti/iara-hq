create table if not exists private.strava_tokens (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  athlete_id     bigint not null unique,
  athlete_name   text,
  access_token   text not null,
  refresh_token  text not null,
  expires_at     timestamptz not null,
  scope          text,
  last_sync_at   timestamptz,
  created_at     timestamptz not null default now()
);
revoke all on private.strava_tokens from public, anon, authenticated;

drop index if exists public.activities_external;
create unique index activities_external on public.activities (user_id, source, external_id);

create or replace function public.strava_save_tokens(p_athlete_id bigint, p_athlete_name text, p_access text, p_refresh text, p_expires_at timestamptz, p_scope text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  delete from private.strava_tokens where athlete_id = p_athlete_id and user_id <> auth.uid();
  insert into private.strava_tokens (user_id, athlete_id, athlete_name, access_token, refresh_token, expires_at, scope)
  values (auth.uid(), p_athlete_id, left(p_athlete_name, 120), p_access, p_refresh, p_expires_at, p_scope)
  on conflict (user_id) do update set athlete_id = excluded.athlete_id, athlete_name = excluded.athlete_name,
    access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, scope = excluded.scope;
end $$;

create or replace function public.strava_get_tokens()
returns table (athlete_id bigint, access_token text, refresh_token text, expires_at timestamptz, last_sync_at timestamptz)
language sql security definer set search_path = '' as $$
  select t.athlete_id, t.access_token, t.refresh_token, t.expires_at, t.last_sync_at from private.strava_tokens t where t.user_id = auth.uid();
$$;

create or replace function public.strava_update_tokens(p_access text, p_refresh text, p_expires_at timestamptz)
returns void language sql security definer set search_path = '' as $$
  update private.strava_tokens set access_token = p_access, refresh_token = p_refresh, expires_at = p_expires_at where user_id = auth.uid();
$$;

create or replace function public.strava_mark_synced()
returns void language sql security definer set search_path = '' as $$
  update private.strava_tokens set last_sync_at = now() where user_id = auth.uid();
$$;

create or replace function public.strava_status()
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('connected', true, 'athlete_id', t.athlete_id, 'athlete_name', t.athlete_name, 'last_sync_at', t.last_sync_at)
                   from private.strava_tokens t where t.user_id = auth.uid()), jsonb_build_object('connected', false));
$$;

create or replace function public.strava_disconnect()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  delete from public.activities where user_id = auth.uid() and source = 'strava';
  delete from private.strava_tokens where user_id = auth.uid();
end $$;

do $$
declare f text;
begin
  foreach f in array array['strava_save_tokens(bigint, text, text, text, timestamptz, text)', 'strava_get_tokens()', 'strava_update_tokens(text, text, timestamptz)',
                           'strava_mark_synced()', 'strava_status()', 'strava_disconnect()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;;
