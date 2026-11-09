-- ClaudIA · core schema
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  sex           text check (sex in ('male', 'female')),
  birth_date    date,
  height_cm     numeric(5,1) check (height_cm between 120 and 230),
  goal          text,
  timezone      text not null default 'America/Sao_Paulo',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create or replace function public.set_local_date()
returns trigger language plpgsql set search_path = '' as $$
declare
  ts timestamptz := (to_jsonb(new) ->> tg_argv[0])::timestamptz;
  tz text;
begin
  select p.timezone into tz from public.profiles p where p.id = new.user_id;
  new.local_date := (ts at time zone coalesce(tz, 'America/Sao_Paulo'))::date;
  return new;
end $$;

create table public.weight_entries (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  measured_at  timestamptz not null default now(),
  local_date   date not null,
  weight_kg    numeric(5,2) not null check (weight_kg between 30 and 300),
  source       text not null default 'manual' check (source in ('manual', 'shortcut', 'apple_health')),
  fasted       boolean not null default true,
  note         text,
  created_at   timestamptz not null default now()
);
create index weight_entries_user_time on public.weight_entries (user_id, measured_at desc);
create trigger weight_local_date before insert or update of measured_at on public.weight_entries
  for each row execute function public.set_local_date('measured_at');

create table public.measurements (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  measured_at  timestamptz not null default now(),
  local_date   date not null,
  waist_cm     numeric(5,1) check (waist_cm between 40 and 200),
  neck_cm      numeric(4,1) check (neck_cm between 20 and 70),
  hip_cm       numeric(5,1) check (hip_cm between 50 and 200),
  chest_cm     numeric(5,1) check (chest_cm between 50 and 200),
  arm_cm       numeric(4,1) check (arm_cm between 15 and 70),
  thigh_cm     numeric(4,1) check (thigh_cm between 25 and 100),
  note         text,
  created_at   timestamptz not null default now()
);
create index measurements_user_time on public.measurements (user_id, measured_at desc);
create trigger measurements_local_date before insert or update of measured_at on public.measurements
  for each row execute function public.set_local_date('measured_at');

create table public.progress_photos (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  taken_at      timestamptz not null default now(),
  local_date    date not null,
  pose          text not null check (pose in ('front', 'side', 'back')),
  storage_path  text not null unique,
  protocol      jsonb not null default '{}'::jsonb,
  note          text,
  created_at    timestamptz not null default now()
);
create index progress_photos_user_date on public.progress_photos (user_id, local_date desc, pose);
create trigger photos_local_date before insert or update of taken_at on public.progress_photos
  for each row execute function public.set_local_date('taken_at');

create table public.photo_reviews (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at          timestamptz not null default now(),
  baseline_date       date,
  current_date_ref    date not null,
  photo_ids           bigint[] not null,
  bf_low              numeric(4,1) check (bf_low between 3 and 60),
  bf_high             numeric(4,1) check (bf_high between 3 and 60),
  confidence          text check (confidence in ('low', 'medium', 'high')),
  protocol_consistent boolean,
  summary             text,
  observations        jsonb not null default '{}'::jsonb,
  model               text not null,
  prompt_version      text not null,
  input_tokens        int,
  output_tokens       int,
  check (bf_low is null or bf_high is null or bf_low <= bf_high)
);
create index photo_reviews_user_time on public.photo_reviews (user_id, created_at desc);

create table public.medication_logs (
  id               bigint generated always as identity primary key,
  user_id          uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  administered_at  timestamptz not null default now(),
  local_date       date not null,
  drug             text not null default 'tirzepatide',
  dose_mg          numeric(4,1) not null check (dose_mg > 0 and dose_mg <= 20),
  injection_site   text check (injection_site in ('abdomen', 'thigh', 'arm')),
  side_effects     text[],
  note             text,
  created_at       timestamptz not null default now()
);
create index medication_logs_user_time on public.medication_logs (user_id, administered_at desc);
create trigger medication_local_date before insert or update of administered_at on public.medication_logs
  for each row execute function public.set_local_date('administered_at');

create table public.daily_activity (
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  local_date    date not null,
  active_kcal   int check (active_kcal >= 0),
  resting_kcal  int check (resting_kcal >= 0),
  steps         int check (steps >= 0),
  exercise_min  int check (exercise_min >= 0),
  sleep_min     int check (sleep_min >= 0),
  resting_hr    int check (resting_hr between 25 and 150),
  hrv_ms        numeric(5,1),
  source        text not null default 'apple_health',
  updated_at    timestamptz not null default now(),
  primary key (user_id, local_date)
);

create table public.workout_plans (
  id              bigint generated always as identity primary key,
  user_id         uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at      timestamptz not null default now(),
  valid_from      date not null default current_date,
  valid_to        date,
  is_active       boolean not null default true,
  goal            text,
  plan            jsonb not null,
  rationale       text,
  model           text,
  prompt_version  text
);
create unique index workout_plans_one_active on public.workout_plans (user_id) where is_active;

create table public.workout_logs (
  id             bigint generated always as identity primary key,
  user_id        uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  performed_at   timestamptz not null default now(),
  local_date     date not null,
  plan_id        bigint references public.workout_plans (id) on delete set null,
  exercise       text not null,
  set_number     smallint not null check (set_number between 1 and 20),
  reps           smallint check (reps between 0 and 100),
  load_kg        numeric(5,1) check (load_kg >= 0),
  rpe            numeric(3,1) check (rpe between 1 and 10),
  duration_min   numeric(5,1),
  note           text,
  created_at     timestamptz not null default now()
);
create index workout_logs_user_time on public.workout_logs (user_id, performed_at desc);
create index workout_logs_user_exercise on public.workout_logs (user_id, exercise, performed_at desc);
create index workout_logs_plan on public.workout_logs (plan_id);
create trigger workout_local_date before insert or update of performed_at on public.workout_logs
  for each row execute function public.set_local_date('performed_at');

create table public.food_logs (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  eaten_at     timestamptz not null default now(),
  local_date   date not null,
  meal         text check (meal in ('breakfast', 'lunch', 'dinner', 'snack', 'shake')),
  description  text not null,
  protein_g    numeric(5,1) check (protein_g >= 0),
  kcal         int check (kcal >= 0),
  carbs_g      numeric(5,1) check (carbs_g >= 0),
  fat_g        numeric(5,1) check (fat_g >= 0),
  source       text not null default 'manual' check (source in ('manual', 'ai_estimate')),
  created_at   timestamptz not null default now()
);
create index food_logs_user_time on public.food_logs (user_id, eaten_at desc);
create trigger food_local_date before insert or update of eaten_at on public.food_logs
  for each row execute function public.set_local_date('eaten_at');

create table public.diet_recommendations (
  id                bigint generated always as identity primary key,
  user_id           uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at        timestamptz not null default now(),
  tdee_estimate     int,
  tdee_method       text check (tdee_method in ('mifflin', 'adaptive')),
  kcal_target       int,
  protein_g_target  int,
  rationale         text,
  payload           jsonb not null default '{}'::jsonb,
  model             text,
  prompt_version    text
);
create index diet_recommendations_user_time on public.diet_recommendations (user_id, created_at desc);

create table public.ingest_tokens (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  token_hash    text not null unique,
  label         text not null default 'iPhone',
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index ingest_tokens_user on public.ingest_tokens (user_id);;
