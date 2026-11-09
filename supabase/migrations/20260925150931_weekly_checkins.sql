-- Check-in semanal gerado por IA (1 por semana; regenerar sobrescreve).
create table public.weekly_checkins (
  id              bigint generated always as identity primary key,
  user_id         uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  week_start      date not null,
  score           int check (score between 0 and 100),
  payload         jsonb not null,
  model           text not null,
  prompt_version  text not null,
  created_at      timestamptz not null default now(),
  unique (user_id, week_start)
);
alter table public.weekly_checkins enable row level security;
revoke all on public.weekly_checkins from anon;
create policy "own rows" on public.weekly_checkins for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter table public.ai_usage drop constraint if exists ai_usage_route_check;
alter table public.ai_usage add constraint ai_usage_route_check
  check (route in ('photo-review', 'coach', 'diet', 'checkin'));;
