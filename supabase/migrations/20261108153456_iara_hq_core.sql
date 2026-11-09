-- IARA HQ · schema core — orquestração, registro de agents, log de execução e custo de IA
create schema if not exists core;
create schema if not exists core_private;
revoke all on schema core_private from public, anon, authenticated;

create or replace function core.tg_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

-- quem pode usar o HQ (mesmo padrão do airton.members)
create table if not exists core.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists core.perfil (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  nome       text not null default 'Leo',
  timezone   text not null default 'America/Sao_Paulo',
  config     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
drop trigger if exists perfil_updated on core.perfil;
create trigger perfil_updated before update on core.perfil for each row execute function core.tg_updated_at();

create table if not exists core.agents (
  slug        text primary key,
  nome        text not null,
  dominio     text not null,
  briefing_fn text,
  ordem       int  not null default 100,
  ativo       boolean not null default true
);
insert into core.agents (slug, nome, dominio, briefing_fn, ordem) values
  ('iara',    'IARA',    'Orquestração da rotina + casa (decoração, compras, smart home)', 'core.briefing_casa',    10),
  ('claudia', 'ClaudIA', 'Saúde: peso, dieta e treino',                                    'core.briefing_claudia', 20),
  ('airton',  'AIrton',  'Finanças pessoais e investimentos',                              'core.briefing_airton',  30),
  ('sabia',   'SabIA',   'Estudos: trilha diária de conteúdo e livros',                    'sabia.briefing_hoje',   40)
on conflict (slug) do update set nome = excluded.nome, dominio = excluded.dominio, briefing_fn = excluded.briefing_fn, ordem = excluded.ordem;

create table if not exists core.rotina (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  dias      int[] not null,
  hora      time not null,
  minutos   int,
  atividade text not null,
  agent     text references core.agents(slug),
  ativo     boolean not null default true
);

-- log de execução por agent, com custo e tier (usado vs descartado)
create table if not exists core.agent_runs (
  id          bigint generated always as identity primary key,
  agent       text not null references core.agents(slug),
  user_id     uuid references auth.users(id) on delete cascade,
  tipo        text not null,
  status      text not null default 'rodando' check (status in ('rodando','ok','erro')),
  input       jsonb,
  output      jsonb,
  uso         jsonb,            -- por papel: {orquestrador:{...}, workers:{...}}
  custo_usd   numeric(10,4) not null default 0,
  chamadas    int not null default 0,
  descartado  boolean not null default false,  -- resultado gerado e jogado fora
  erro        text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists agent_runs_recentes on core.agent_runs (agent, started_at desc);

-- toda chamada de IA do HQ (mesmo formato de airton.ai_usage + run e papel)
create table if not exists core.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  at timestamptz not null default now(),
  agent text,
  feature text not null,
  papel text,                   -- orquestrador | worker
  run_id bigint references core.agent_runs(id) on delete set null,
  provider text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  web_searches int not null default 0,
  cost_usd numeric(10,5) not null default 0
);
create index if not exists ai_usage_at on core.ai_usage (at desc);

create or replace view core.v_ai_cost_month with (security_invoker = true) as
select date_trunc('month', at at time zone 'America/Sao_Paulo')::date mes, agent, feature, papel, provider, model,
       count(*) chamadas, sum(input_tokens) input_tokens, sum(cache_read_tokens) cache_read_tokens,
       sum(output_tokens) output_tokens, sum(web_searches) buscas, round(sum(cost_usd), 4) custo_usd
from core.ai_usage group by 1,2,3,4,5,6;

-- visão única de custo de IA de todos os assistentes
create or replace view core.v_ai_cost_all with (security_invoker = true) as
select 'airton' app, date_trunc('month', at at time zone 'America/Sao_Paulo')::date mes, feature, model, count(*) chamadas, round(sum(cost_usd),4) custo_usd
from airton.ai_usage group by 1,2,3,4
union all
select coalesce(agent,'core'), date_trunc('month', at at time zone 'America/Sao_Paulo')::date, feature, model, count(*), round(sum(cost_usd),4)
from core.ai_usage group by 1,2,3,4;

create table if not exists core.briefings (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  data       date not null,
  tipo       text not null check (tipo in ('manha','noite')),
  insumos    jsonb not null default '[]'::jsonb,
  texto      text,
  lido_em    timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, data, tipo)
);

-- adapters de briefing (plpgsql: tabelas resolvidas em runtime)
create or replace function core.briefing_claudia(p_user uuid, p_data date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return jsonb_build_object(
    'treinos_hoje', coalesce((
      select jsonb_agg(jsonb_build_object('titulo', s.title, 'esporte', s.sport, 'intensidade', s.intensity,
               'duracao_min', s.duration_min, 'distancia_km', s.distance_km, 'status', s.status) order by s.id)
      from public.plan_sessions s where s.user_id = p_user and s.local_date = p_data), '[]'::jsonb),
    'treinou_ontem', exists (select 1 from public.workout_logs w where w.user_id = p_user and w.local_date = p_data - 1));
end $$;

create or replace function core.briefing_airton(p_user uuid, p_data date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return jsonb_build_object(
    'disponivel_hoje', null,
    'eventos_7d', coalesce((
      select jsonb_agg(jsonb_build_object('data', e.date, 'descricao', e.label, 'valor', e.amount) order by e.date)
      from airton.planned_events e where e.user_id = p_user and e.date between p_data and p_data + 7), '[]'::jsonb),
    'metas', coalesce((
      select jsonb_agg(jsonb_build_object('meta', g.name, 'alvo', g.target_amount, 'atual', g.current_amount, 'prazo', g.target_date))
      from airton.goals g where g.user_id = p_user), '[]'::jsonb));
end $$;

create or replace function core.briefing_casa(p_user uuid, p_data date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if to_regclass('casa.chores') is null then
    return jsonb_build_object('status', 'schema casa ainda não migrado');
  end if;
  execute $q$ select coalesce(jsonb_agg(jsonb_build_object('tarefa', c.title, 'ultima_vez', c.last_done)), '[]'::jsonb)
    from casa.chores c where c.user_id = $1 and (c.last_done is null or c.last_done + c.every_days <= $2) $q$
  into v using p_user, p_data;
  return jsonb_build_object('tarefas_vencidas', v);
end $$;

create or replace function core.coletar_briefings(p_user uuid, p_data date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; v jsonb; saida jsonb := '[]'::jsonb;
begin
  for a in select slug, nome, briefing_fn from core.agents where ativo and briefing_fn is not null order by ordem loop
    begin
      execute format('select %s($1, $2)', a.briefing_fn) into v using p_user, p_data;
      saida := saida || jsonb_build_object('agent', a.slug, 'nome', a.nome, 'ok', true, 'dados', coalesce(v, '{}'::jsonb));
    exception when others then
      saida := saida || jsonb_build_object('agent', a.slug, 'nome', a.nome, 'ok', false, 'erro', sqlerrm);
    end;
  end loop;
  return saida;
end $$;

-- kv privado + chamada de funções pelo cron (padrão AIrton)
create table if not exists core_private.kv (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
insert into core_private.kv (key, value) values ('cron_secret', to_jsonb(encode(gen_random_bytes(32), 'hex')))
on conflict (key) do nothing;

create or replace function core_private.call_function(fn text, body jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path to '' as $function$
declare v_secret text := (select value #>> '{}' from core_private.kv where key = 'cron_secret');
begin
  return net.http_post(
    url := 'https://wrtrhdrohabspbaxpbeu.supabase.co/functions/v1/' || fn,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-iara-cron', v_secret),
    body := body, timeout_milliseconds := 150000);
end $function$;
revoke execute on function core_private.call_function(text, jsonb) from public, anon, authenticated;

-- segurança
alter table core.members    enable row level security;
alter table core.perfil     enable row level security;
alter table core.agents     enable row level security;
alter table core.rotina     enable row level security;
alter table core.agent_runs enable row level security;
alter table core.ai_usage   enable row level security;
alter table core.briefings  enable row level security;
alter table core_private.kv enable row level security;

drop policy if exists members_self on core.members;     create policy members_self on core.members for select to authenticated using (user_id = auth.uid());
drop policy if exists perfil_dono on core.perfil;       create policy perfil_dono on core.perfil for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists agents_leitura on core.agents;    create policy agents_leitura on core.agents for select to authenticated using (true);
drop policy if exists rotina_dono on core.rotina;       create policy rotina_dono on core.rotina for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists runs_leitura on core.agent_runs;  create policy runs_leitura on core.agent_runs for select to authenticated using (user_id = auth.uid());
drop policy if exists uso_leitura on core.ai_usage;     create policy uso_leitura on core.ai_usage for select to authenticated using (user_id = auth.uid());
drop policy if exists briefings_dono on core.briefings; create policy briefings_dono on core.briefings for select to authenticated using (user_id = auth.uid());
drop policy if exists briefings_lido on core.briefings; create policy briefings_lido on core.briefings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant usage on schema core to authenticated, service_role;
grant all on all tables in schema core to service_role;
grant select on core.members, core.agents, core.agent_runs, core.ai_usage, core.v_ai_cost_month to authenticated;
grant select, insert, update, delete on core.perfil, core.rotina to authenticated;
grant select, update on core.briefings to authenticated;
grant usage, select on all sequences in schema core to authenticated, service_role;

revoke execute on function core.briefing_claudia(uuid, date)  from public, anon, authenticated;
revoke execute on function core.briefing_airton(uuid, date)   from public, anon, authenticated;
revoke execute on function core.briefing_casa(uuid, date)     from public, anon, authenticated;
revoke execute on function core.coletar_briefings(uuid, date) from public, anon, authenticated;
grant  execute on function core.coletar_briefings(uuid, date) to service_role;;
