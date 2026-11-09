-- Cadastro aberto (amigos testando). Allowlist fica guardada para religar se precisar:
--   create trigger enforce_signup_allowlist before insert on auth.users for each row execute function private.enforce_signup_allowlist();
drop trigger if exists enforce_signup_allowlist on auth.users;

-- Controle de custo de IA: 1 linha por chamada; limite diário checado na rota.
create table public.ai_usage (
  id             bigint generated always as identity primary key,
  user_id        uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at     timestamptz not null default now(),
  route          text not null check (route in ('photo-review', 'coach', 'diet')),
  model          text not null,
  input_tokens   int,
  output_tokens  int
);
create index ai_usage_user_time on public.ai_usage (user_id, created_at desc);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon;
revoke update, delete on public.ai_usage from authenticated;
create policy "own usage read" on public.ai_usage for select to authenticated using ((select auth.uid()) = user_id);
create policy "own usage insert" on public.ai_usage for insert to authenticated with check ((select auth.uid()) = user_id);

-- Medicação genérica (amigos podem usar outro GLP-1 ou nenhum)
alter table public.medication_logs drop constraint if exists medication_logs_drug_check;
alter table public.medication_logs add constraint medication_logs_drug_check
  check (drug in ('tirzepatide', 'semaglutide', 'other'));;
