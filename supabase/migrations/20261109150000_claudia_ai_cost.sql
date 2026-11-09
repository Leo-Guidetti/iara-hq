-- ClaudIA v2 · custo de IA do próprio usuário, por mês e funcionalidade, para a tela de Perfil.
create or replace function public.claudia_ai_cost(p_months int default 3)
returns table (mes date, feature text, model text, chamadas bigint, input_tokens bigint, cache_read_tokens bigint, output_tokens bigint, custo_usd numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select date_trunc('month', u.at at time zone 'America/Sao_Paulo')::date, u.feature, u.model, count(*),
         sum(u.input_tokens), sum(u.cache_read_tokens), sum(u.output_tokens), round(sum(u.cost_usd), 4)
  from claudia.ai_usage u
  where u.user_id = (select auth.uid())
    and u.at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') - make_interval(months => greatest(0, least(p_months, 24)) - 1)
  group by 1, 2, 3
  order by 1 desc, 8 desc;
$$;

revoke all on function public.claudia_ai_cost(int) from public, anon;
grant execute on function public.claudia_ai_cost(int) to authenticated;
