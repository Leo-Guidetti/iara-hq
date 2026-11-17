-- UX-07: revisar lançamentos dentro do hub. Aditivo e idempotente.
-- Mesmo critério do airton.review_counts (não revisado, não transferência, últimos 30 dias):
--   total = 'unconfirmed'; precisa_voce = 'pending' (sem categoria ou IA com confiança < 0,7).
-- A categorização (airton-ai/_shared/categorize.ts) grava a sugestão direto em category_id com
-- cat_source (rule|history|ai|structural) e cat_confidence; não há coluna separada. Logo:
--   categoria_sugerida = category_id quando cat_source <> 'manual' (decisão automática ainda não revisada).
create or replace function airton.review_list(p_limit int default 30, p_user uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with u as (select airton._uid(p_user) as id),
  base as (
    select t.*, (t.category_id is null or (t.cat_source = 'ai' and coalesce(t.cat_confidence, 0) < 0.7)) as precisa
      from airton.transactions t, u
     where t.user_id = u.id and not t.reviewed and t.kind <> 'transfer'
       and t.date >= airton.today() - 30 and t.date <= airton.today()
  ),
  lst as (
    select b.*, a.name as conta_nome, c.name as cat_nome, s.name as sug_nome
      from base b
      left join airton.accounts a on a.id = b.account_id
      left join airton.categories c on c.id = b.category_id
      left join airton.categories s on s.id = b.category_id and b.cat_source is distinct from 'manual'
     order by b.precisa desc, b.date desc, b.id
     limit greatest(coalesce(p_limit, 30), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'precisa_voce', (select count(*) from base where precisa),
    'sem_categoria', (select count(*) from base where category_id is null),
    'itens', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'data', date, 'descricao', description, 'estabelecimento', merchant,
        'valor', amount, 'moeda', currency, 'tipo', kind,
        'conta_id', account_id, 'conta', conta_nome,
        'categoria_id', category_id, 'categoria', cat_nome,
        'categoria_sugerida_id', case when cat_source is distinct from 'manual' then category_id end,
        'categoria_sugerida', sug_nome,
        'origem_categoria', cat_source, 'confianca', cat_confidence, 'precisa_voce', precisa)
        order by precisa desc, date desc, id) from lst), '[]'::jsonb),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'nome', c.name, 'pai_id', c.parent_id, 'natureza', c.nature, 'icone', c.icon)
        order by c.sort, c.name)
      from airton.categories c, u where c.user_id = u.id and not c.archived), '[]'::jsonb))
$$;

grant execute on function airton.review_list(int, uuid) to authenticated, service_role;
revoke execute on function airton.review_list(int, uuid) from anon, public;

insert into core.intencoes (slug, agent, exemplos, rpc, slots, risco, confirmacao, desfazer_rpc) values
 ('lancamento.categorizar', 'airton',
  array['põe o mercado na categoria alimentação', 'categoriza esse lançamento como transporte'],
  'airton.set_category',
  '{"p_ids":"text[]","p_category":"text","p_learn":"boolean?"}',
  'medio', 'repetir', null),
 ('lancamento.confirmar', 'airton',
  array['confirma esses lançamentos', 'está tudo certo, pode confirmar'],
  'airton.confirm',
  '{"p_ids":"text[]"}',
  'medio', 'repetir', null)
on conflict (slug) do update set
  agent = excluded.agent, exemplos = excluded.exemplos, rpc = excluded.rpc, slots = excluded.slots,
  risco = excluded.risco, confirmacao = excluded.confirmacao, desfazer_rpc = excluded.desfazer_rpc;
