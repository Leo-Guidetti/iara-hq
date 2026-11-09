create schema if not exists claudia;
create table if not exists claudia.members (user_id uuid primary key references auth.users(id) on delete cascade, created_at timestamptz not null default now());
alter table claudia.members enable row level security;
insert into claudia.members (user_id)
  select u.id from auth.users u join private.allowed_emails a on lower(a.email)=lower(u.email)
  on conflict do nothing;
create table if not exists claudia.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid(), at timestamptz not null default now(),
  feature text not null, provider text not null default 'anthropic', model text not null,
  input_tokens int not null default 0, output_tokens int not null default 0,
  cache_read_tokens int not null default 0, cache_write_tokens int not null default 0,
  web_searches int not null default 0, cost_usd numeric not null default 0);
create index if not exists ai_usage_at_idx on claudia.ai_usage (at);
alter table claudia.ai_usage enable row level security;
create or replace view claudia.v_ai_cost_month with (security_invoker=on) as
 select date_trunc('month', at at time zone 'America/Sao_Paulo')::date mes, provider, feature, model,
   count(*) chamadas, sum(input_tokens) input_tokens, sum(cache_read_tokens) cache_read_tokens,
   sum(cache_write_tokens) cache_write_tokens, sum(output_tokens) output_tokens,
   sum(web_searches) buscas, round(sum(cost_usd),4) custo_usd
 from claudia.ai_usage group by 1,2,3,4;
revoke all on schema claudia from anon, authenticated;;
