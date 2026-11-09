-- Etapa 0.5 · resumo semanal de custo de IA (push de domingo 20:00 SP pelo airton-notify).
-- Só aditiva: view nova com os três ai_usage e uma função de leitura para o service role.

create or replace view core.v_ai_usage_all as
  select 'airton'::text as app, feature, model, at, cost_usd from airton.ai_usage
  union all
  select 'claudia'::text, feature, model, at, cost_usd from claudia.ai_usage
  union all
  select coalesce(agent, 'core'), feature, model, at, cost_usd from core.ai_usage;

revoke all on core.v_ai_usage_all from public, anon, authenticated;

-- Custo da semana (últimos p_dias) e do mês corrente (fuso de São Paulo), por app e as maiores funcionalidades.
create or replace function airton.ai_cost_report(p_dias int default 7)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with u as (
    select app, feature, cost_usd, (at at time zone 'America/Sao_Paulo') as local_at
      from core.v_ai_usage_all
  ),
  agora as (select (now() at time zone 'America/Sao_Paulo') as t)
  select jsonb_build_object(
    'dias', p_dias,
    'semana_usd', (select round(coalesce(sum(cost_usd), 0), 4) from u, agora
                    where local_at >= agora.t - make_interval(days => p_dias)),
    'mes_usd',    (select round(coalesce(sum(cost_usd), 0), 4) from u, agora
                    where local_at >= date_trunc('month', agora.t)),
    'dia_do_mes', (select extract(day from t)::int from agora),
    'dias_no_mes', (select extract(day from (date_trunc('month', t) + interval '1 month - 1 day'))::int from agora),
    'por_app', coalesce((
      select jsonb_agg(jsonb_build_object('app', app, 'semana_usd', semana, 'mes_usd', mes) order by mes desc)
        from (
          select app,
                 round(coalesce(sum(cost_usd) filter (where local_at >= agora.t - make_interval(days => p_dias)), 0), 4) as semana,
                 round(coalesce(sum(cost_usd) filter (where local_at >= date_trunc('month', agora.t)), 0), 4) as mes
            from u, agora
           where local_at >= least(date_trunc('month', agora.t), agora.t - make_interval(days => p_dias))
           group by app
        ) a
    ), '[]'::jsonb),
    'top_semana', coalesce((
      select jsonb_agg(jsonb_build_object('app', app, 'feature', feature, 'usd', usd) order by usd desc)
        from (
          select app, feature, round(sum(cost_usd), 4) as usd
            from u, agora
           where local_at >= agora.t - make_interval(days => p_dias)
           group by app, feature
           order by usd desc
           limit 3
        ) t
    ), '[]'::jsonb)
  );
$$;

revoke all on function airton.ai_cost_report(int) from public, anon, authenticated;
grant execute on function airton.ai_cost_report(int) to service_role;
