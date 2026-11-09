alter table public.workout_logs
  add column if not exists plan_session_id bigint references public.plan_sessions (id) on delete set null;
create index if not exists workout_logs_session on public.workout_logs (plan_session_id);
create index if not exists workout_logs_user_date on public.workout_logs (user_id, local_date desc);

create table if not exists public.plan_changes (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  plan_id      bigint references public.workout_plans (id) on delete set null,
  session_id   bigint references public.plan_sessions (id) on delete set null,
  local_date   date,
  source       text not null check (source in ('user', 'ai')),
  scope        text not null check (scope in ('session', 'template', 'plan')),
  summary      text not null check (char_length(summary) <= 600),
  instruction  text check (char_length(instruction) <= 600),
  before       jsonb,
  after        jsonb
);
create index if not exists plan_changes_user_time on public.plan_changes (user_id, created_at desc);
create index if not exists plan_changes_plan on public.plan_changes (plan_id);
create index if not exists plan_changes_session on public.plan_changes (session_id);

alter table public.plan_changes enable row level security;
revoke all on public.plan_changes from anon;
drop policy if exists "own rows" on public.plan_changes;
create policy "own rows" on public.plan_changes for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter table public.ai_usage drop constraint if exists ai_usage_route_check;
alter table public.ai_usage add constraint ai_usage_route_check
  check (route in ('photo-review', 'coach', 'diet', 'checkin', 'coach-chat', 'coach-session'));;
