alter table airton.ai_usage
  add column if not exists provider text not null default 'anthropic',
  add column if not exists cache_read_tokens integer not null default 0,
  add column if not exists cache_write_tokens integer not null default 0,
  add column if not exists web_searches integer not null default 0;

create index if not exists ai_usage_at_idx on airton.ai_usage (at);

-- custo por mês / funcionalidade / modelo (para conferir o gasto sem abrir o Console)
create or replace view airton.v_ai_cost_month
with (security_invoker = true) as
select date_trunc('month', at at time zone 'America/Sao_Paulo')::date as mes,
       provider, feature, model,
       count(*) as chamadas,
       sum(input_tokens) as input_tokens,
       sum(cache_read_tokens) as cache_read_tokens,
       sum(cache_write_tokens) as cache_write_tokens,
       sum(output_tokens) as output_tokens,
       sum(web_searches) as buscas,
       round(sum(cost_usd)::numeric, 4) as custo_usd
from airton.ai_usage
group by 1, 2, 3, 4;;
