-- UX-03: metas financeiras (imóvel, carro...) com aporte necessário. Aditivo e idempotente.
alter table airton.goals add column if not exists priority int;                       -- nasce vazia: só o Leo dita a ordem (D2)
alter table airton.goals add column if not exists kind text;
alter table airton.goals add column if not exists status text not null default 'ativa';
alter table airton.goals add column if not exists updated_at timestamptz not null default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'goals_kind_check') then
    alter table airton.goals add constraint goals_kind_check
      check (kind is null or kind in ('imovel','carro','reserva','viagem','outro')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'goals_status_check') then
    alter table airton.goals add constraint goals_status_check
      check (status in ('ativa','concluida','cancelada')) not valid;
  end if;
end $$;

-- Escrita: a policy owner_all (dono + membro) e o grant da tabela já permitem insert/update direto.
-- goal_salvar existe para o hub/chat (intenção meta.salvar): valida e grava; cancelar = status 'cancelada'.
create or replace function airton.goal_salvar(p jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := airton._uid(null);
  v_id text := nullif(p->>'id', '');
  r airton.goals;
begin
  if v_id is null then
    if coalesce(btrim(p->>'name'), '') = '' then raise exception 'name required'; end if;
    if coalesce((p->>'target_amount')::numeric, 0) <= 0 then raise exception 'target_amount must be > 0'; end if;
    insert into airton.goals (user_id, name, target_amount, target_currency, target_date, current_amount, kind, priority, status)
    values (v_user, btrim(p->>'name'), (p->>'target_amount')::numeric,
            coalesce(p->>'target_currency', 'BRL'), nullif(p->>'target_date', '')::date,
            coalesce((p->>'current_amount')::numeric, 0), p->>'kind', nullif(p->>'priority', '')::int,
            coalesce(p->>'status', 'ativa'))
    returning * into r;
  else
    update airton.goals g set
      name = coalesce(nullif(btrim(p->>'name'), ''), g.name),
      target_amount = coalesce((p->>'target_amount')::numeric, g.target_amount),
      target_currency = coalesce(p->>'target_currency', g.target_currency),
      target_date = case when p ? 'target_date' then nullif(p->>'target_date', '')::date else g.target_date end,
      current_amount = coalesce((p->>'current_amount')::numeric, g.current_amount),
      kind = case when p ? 'kind' then p->>'kind' else g.kind end,
      priority = case when p ? 'priority' then nullif(p->>'priority', '')::int else g.priority end,
      status = coalesce(p->>'status', g.status),
      updated_at = now()
    where g.id = v_id and g.user_id = v_user
    returning * into r;
    if not found then raise exception 'goal not found'; end if;
  end if;
  return to_jsonb(r);
end $$;

-- Status das metas ativas.
-- falta        = max(alvo - atual, 0)
-- meses        = meses inteiros até target_date, mínimo 1 (prazo vencido ou hoje = 0)
-- aporte       = falta / meses   (só para metas BRL com prazo; USD não é convertido)
-- poupanca_media_3m = (renda + gastos líquidos de reembolso, kind income/expense/refund, transferências fora)
--                     dos 3 meses fechados anteriores / 3
-- poupanca_prevista = month_plan(mês atual).savings.goal (pct de poupança x renda prevista)
-- poupanca_base = prevista se > 0, senão média real. conflito = soma dos aportes > base.
-- ritmo: sem_prazo | atrasada (prazo vencido com falta, ou atual < alvo x fração linear created_at->prazo) | no_ritmo
create or replace function airton.goals_status(p_user uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_user uuid := airton._uid(p_user);
  v_today date := airton.today();
  v_m0 date := date_trunc('month', airton.today())::date;
  v_media numeric; v_prev numeric; v_base numeric; v_origem text;
  v_metas jsonb; v_total numeric;
begin
  select coalesce(sum(case when kind = 'income' then amount_brl when kind in ('expense','refund') then amount_brl else 0 end), 0) / 3
    into v_media
    from airton.transactions
   where user_id = v_user and date >= (v_m0 - interval '3 months')::date and date < v_m0;
  begin v_prev := (airton.month_plan(null, v_user)->'savings'->>'goal')::numeric;
  exception when others then v_prev := null; end;
  if coalesce(v_prev, 0) > 0 then v_base := v_prev; v_origem := 'prevista';
  else v_base := greatest(v_media, 0); v_origem := 'media_3m'; end if;

  with g as (
    select g.*, greatest(g.target_amount - g.current_amount, 0) as falta,
           case when g.target_date is null then null
                when g.target_date <= v_today then 0
                else greatest(1, (extract(year from age(g.target_date, v_today))::int * 12
                                  + extract(month from age(g.target_date, v_today))::int
                                  + case when extract(day from age(g.target_date, v_today)) > 0 then 1 else 0 end))
           end as meses
      from airton.goals g where g.user_id = v_user and g.status = 'ativa'
  ), x as (
    select g.*, case when g.meses > 0 and g.target_currency = 'BRL' then round(g.falta / g.meses, 2) end as aporte,
           case when g.target_date is null then 'sem_prazo'
                when g.falta = 0 then 'no_ritmo'
                when g.target_date <= v_today then 'atrasada'
                when g.current_amount < g.target_amount * least(1, greatest(0,
                     (v_today - g.created_at::date)::numeric / nullif(g.target_date - g.created_at::date, 0))) then 'atrasada'
                else 'no_ritmo' end as ritmo
      from g
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'name', name, 'kind', kind, 'priority', priority, 'target_amount', target_amount,
           'current_amount', current_amount, 'moeda', target_currency, 'target_date', target_date,
           'falta', falta, 'meses', meses, 'aporte_necessario', aporte, 'ritmo', ritmo)
         order by priority nulls last, target_date nulls last, created_at), '[]'::jsonb),
         coalesce(sum(aporte), 0)
    into v_metas, v_total from x;

  return jsonb_build_object(
    'metas', v_metas,
    'aporte_total', round(v_total, 2),
    'poupanca_prevista', round(v_prev, 2),
    'poupanca_media_3m', round(v_media, 2),
    'poupanca_base', round(v_base, 2),
    'base_origem', v_origem,
    'folga', round(v_base - v_total, 2),
    'conflito', v_total > v_base);
end $$;

grant execute on function airton.goal_salvar(jsonb), airton.goals_status(uuid) to authenticated, service_role;
revoke execute on function airton.goal_salvar(jsonb), airton.goals_status(uuid) from anon, public;

insert into core.intencoes (slug, agent, exemplos, rpc, slots, risco, confirmacao, desfazer_rpc) values
 ('meta.salvar', 'airton',
  array['cria uma meta de R$ 80 mil para o carro até 2028', 'muda o prazo da meta do apartamento', 'cancela a meta de viagem'],
  'airton.goal_salvar',
  '{"p":"jsonb{id?:text,name:text,target_amount:numeric,target_date?:date,current_amount?:numeric,kind?:text(imovel|carro|reserva|viagem|outro),priority?:int,status?:text(ativa|concluida|cancelada)}"}',
  'alto', 'sim', null),
 ('metas.status', 'airton',
  array['como estão minhas metas?', 'quanto preciso guardar por mês para o apartamento?', 'minhas metas cabem na poupança?'],
  'airton.goals_status',
  '{}',
  'baixo', 'nenhuma', null)
on conflict (slug) do update set
  agent = excluded.agent, exemplos = excluded.exemplos, rpc = excluded.rpc, slots = excluded.slots,
  risco = excluded.risco, confirmacao = excluded.confirmacao, desfazer_rpc = excluded.desfazer_rpc;
