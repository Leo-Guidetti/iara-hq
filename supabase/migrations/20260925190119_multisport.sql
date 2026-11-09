create table public.training_profiles (
  user_id            uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  sports             jsonb not null default '[]',
  goal               text,
  event              jsonb,
  weekdays           int[] not null default '{0,2,4}',
  session_minutes    int not null default 60 check (session_minutes between 15 and 240),
  equipment          text not null default 'gym' check (equipment in ('gym', 'home_dumbbells', 'bodyweight')),
  limitations        text,
  hr_max             int check (hr_max between 120 and 230),
  hr_rest            int check (hr_rest between 30 and 110),
  ftp_w              int check (ftp_w between 50 and 600),
  run_threshold_s_km int check (run_threshold_s_km between 150 and 900),
  swim_css_s_100     int check (swim_css_s_100 between 50 and 300),
  updated_at         timestamptz not null default now()
);

create table public.plan_sessions (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  plan_id       bigint references public.workout_plans (id) on delete set null,
  local_date    date not null,
  sport         text not null,
  title         text not null,
  intensity     text not null default 'moderate'
                check (intensity in ('recovery', 'easy', 'moderate', 'tempo', 'threshold', 'intervals', 'long', 'strength')),
  duration_min  int check (duration_min between 5 and 480),
  distance_km   numeric(6,2) check (distance_km >= 0),
  target        jsonb not null default '{}',
  status        text not null default 'planned' check (status in ('planned', 'done', 'skipped')),
  origin        text not null default 'ai' check (origin in ('ai', 'user')),
  edited        boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index plan_sessions_user_date on public.plan_sessions (user_id, local_date);

create table public.activities (
  id               bigint generated always as identity primary key,
  user_id          uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  started_at       timestamptz not null default now(),
  local_date       date not null,
  sport            text not null,
  title            text,
  duration_min     numeric(6,1) not null check (duration_min > 0 and duration_min <= 1440),
  distance_km      numeric(7,3) check (distance_km >= 0),
  elevation_m      int check (elevation_m >= 0),
  avg_hr           int check (avg_hr between 30 and 230),
  max_hr           int check (max_hr between 30 and 240),
  avg_power_w      int check (avg_power_w between 0 and 2000),
  avg_cadence      int check (avg_cadence between 0 and 300),
  kcal             int check (kcal >= 0),
  kcal_estimated   boolean not null default false,
  rpe              numeric(3,1) check (rpe between 1 and 10),
  load             numeric(7,1) generated always as (rpe * duration_min) stored,
  source           text not null default 'manual' check (source in ('manual', 'apple_health', 'strava', 'shortcut')),
  external_id      text,
  plan_session_id  bigint references public.plan_sessions (id) on delete set null,
  details          jsonb not null default '{}',
  notes            text,
  created_at       timestamptz not null default now()
);
create unique index activities_external on public.activities (user_id, source, external_id) where external_id is not null;
create index activities_user_date on public.activities (user_id, local_date desc);
create index activities_plan_session on public.activities (plan_session_id);
create index plan_sessions_plan on public.plan_sessions (plan_id);
create trigger activities_local_date before insert or update of started_at on public.activities
  for each row execute function public.set_local_date('started_at');

alter table public.workout_plans add column if not exists materialized_through date;

do $$
declare t text;
begin
  foreach t in array array['training_profiles', 'plan_sessions', 'activities'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using ((select auth.uid()) = user_id)
         with check ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

alter table public.plan_sessions add constraint plan_sessions_sport_check check (sport in
  ('run', 'walk', 'hike', 'swim', 'ride_indoor', 'ride_outdoor', 'strength', 'hiit', 'yoga', 'mobility', 'row', 'other'));
alter table public.activities add constraint activities_sport_check check (sport in
  ('run', 'walk', 'hike', 'swim', 'ride_indoor', 'ride_outdoor', 'strength', 'hiit', 'yoga', 'mobility', 'row', 'other'));

alter table public.ai_usage drop constraint if exists ai_usage_route_check;
alter table public.ai_usage add constraint ai_usage_route_check
  check (route in ('photo-review', 'coach', 'diet', 'checkin', 'coach-chat'));

create or replace function public.ingest_health(p_token text, p_activities jsonb default '[]', p_daily jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid; tid bigint; a jsonb; d jsonb; n_act int := 0; n_day int := 0; sp text;
begin
  select t.user_id, t.id into uid, tid from public.ingest_tokens t
  where t.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and t.revoked_at is null;
  if uid is null then raise exception 'invalid token' using errcode = '28000'; end if;
  if jsonb_array_length(coalesce(p_activities, '[]')) > 200 or jsonb_array_length(coalesce(p_daily, '[]')) > 400 then
    raise exception 'batch too large' using errcode = '22003';
  end if;
  update public.ingest_tokens set last_used_at = now() where id = tid;

  for a in select * from jsonb_array_elements(coalesce(p_activities, '[]')) loop
    sp := a ->> 'sport';
    if sp is null or sp not in ('run', 'walk', 'hike', 'swim', 'ride_indoor', 'ride_outdoor', 'strength', 'hiit', 'yoga', 'mobility', 'row', 'other') then sp := 'other'; end if;
    if (a ->> 'duration_min')::numeric is null or (a ->> 'duration_min')::numeric <= 0 or (a ->> 'started_at') is null then continue; end if;
    insert into public.activities (user_id, started_at, sport, title, duration_min, distance_km, elevation_m, avg_hr, max_hr,
                                   avg_power_w, avg_cadence, kcal, source, external_id, details)
    values (uid, (a ->> 'started_at')::timestamptz, sp, left(a ->> 'title', 120),
            least((a ->> 'duration_min')::numeric, 1440), nullif(a ->> 'distance_km', '')::numeric,
            nullif(a ->> 'elevation_m', '')::numeric::int, nullif(a ->> 'avg_hr', '')::numeric::int, nullif(a ->> 'max_hr', '')::numeric::int,
            nullif(a ->> 'avg_power_w', '')::numeric::int, nullif(a ->> 'avg_cadence', '')::numeric::int,
            nullif(a ->> 'kcal', '')::numeric::int, 'apple_health', left(a ->> 'external_id', 200), coalesce(a -> 'details', '{}'))
    on conflict (user_id, source, external_id) where external_id is not null do update set
      sport = excluded.sport, title = excluded.title, duration_min = excluded.duration_min, distance_km = excluded.distance_km,
      elevation_m = excluded.elevation_m, avg_hr = excluded.avg_hr, max_hr = excluded.max_hr, avg_power_w = excluded.avg_power_w,
      avg_cadence = excluded.avg_cadence, kcal = excluded.kcal, details = excluded.details;
    n_act := n_act + 1;
  end loop;

  for d in select * from jsonb_array_elements(coalesce(p_daily, '[]')) loop
    if (d ->> 'local_date') is null then continue; end if;
    insert into public.daily_activity (user_id, local_date, steps, active_kcal, resting_kcal, exercise_min, sleep_min, resting_hr, hrv_ms, source, updated_at)
    values (uid, (d ->> 'local_date')::date, nullif(d ->> 'steps', '')::numeric::int, nullif(d ->> 'active_kcal', '')::numeric::int,
            nullif(d ->> 'resting_kcal', '')::numeric::int, nullif(d ->> 'exercise_min', '')::numeric::int, nullif(d ->> 'sleep_min', '')::numeric::int,
            nullif(d ->> 'resting_hr', '')::numeric::int, nullif(d ->> 'hrv_ms', '')::numeric, 'apple_health', now())
    on conflict (user_id, local_date) do update set
      steps = coalesce(excluded.steps, public.daily_activity.steps),
      active_kcal = coalesce(excluded.active_kcal, public.daily_activity.active_kcal),
      resting_kcal = coalesce(excluded.resting_kcal, public.daily_activity.resting_kcal),
      exercise_min = coalesce(excluded.exercise_min, public.daily_activity.exercise_min),
      sleep_min = coalesce(excluded.sleep_min, public.daily_activity.sleep_min),
      resting_hr = coalesce(excluded.resting_hr, public.daily_activity.resting_hr),
      hrv_ms = coalesce(excluded.hrv_ms, public.daily_activity.hrv_ms),
      updated_at = now();
    n_day := n_day + 1;
  end loop;
  return jsonb_build_object('activities', n_act, 'days', n_day);
end $$;
revoke execute on function public.ingest_health(text, jsonb, jsonb) from public, authenticated;
grant execute on function public.ingest_health(text, jsonb, jsonb) to anon;;
