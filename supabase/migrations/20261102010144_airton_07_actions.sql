
alter table airton.transactions add column if not exists of_ref text;
create unique index if not exists transactions_of_ref_uq on airton.transactions (user_id, of_ref) where of_ref is not null;

-- chave do estabelecimento: minúsculas, sem acento, sem números/parcela, 3 primeiras palavras úteis
create or replace function airton.merchant_key(d text) returns text
language sql immutable set search_path = '' as $$
  select array_to_string((array(
    select w from unnest(regexp_split_to_array(
      regexp_replace(lower(translate(coalesce(d, ''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')),
                     '[^a-z]+', ' ', 'g'), '\s+')) w
     where length(w) >= 3 and w not in ('pix','enviado','enviada','recebido','recebida','para','pagamento','compra','parcela','ted','doc',
                                        'transferencia','sao','paulo','nupay','ltda','com','bra','dos','das','www','http','https')
     limit 3)), ' ')
$$;

-- natureza -> tipo coerente com o sinal
create or replace function airton.kind_for(p_category text, p_amount numeric, p_current text) returns text
language sql stable set search_path = '' as $$
  select case
    when n.nature = 'transferencia' or n.nature = 'investimento' then 'transfer'
    when n.nature = 'renda' then case when p_amount >= 0 then 'income' else 'expense' end
    when n.nature is not null then case when p_amount >= 0 then 'refund' else 'expense' end
    else coalesce(p_current, case when p_amount >= 0 then 'income' else 'expense' end)
  end
  from (select coalesce(p.nature, c.nature) nature
          from (select 1) x
          left join airton.categories c on c.id = p_category
          left join airton.categories p on p.id = c.parent_id) n
$$;

-- Aplica categoria como decisão sua. learn=true cria/atualiza a regra pelo estabelecimento
-- e devolve quantos outros lançamentos parecidos ainda não revisados existem.
create or replace function airton.set_category(p_ids text[], p_category text, p_learn boolean default true)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_user uuid := airton._uid(null); v_key text; v_similar text[] := '{}';
begin
  update airton.transactions t
     set category_id = p_category,
         kind = airton.kind_for(p_category, t.amount, t.kind),
         cat_source = 'manual', cat_confidence = 1, reviewed = true
   where t.user_id = v_user and t.id = any(p_ids);
  if p_learn and array_length(p_ids, 1) = 1 and p_category is not null then
    select airton.merchant_key(coalesce(merchant, description)) into v_key
      from airton.transactions where id = p_ids[1] and user_id = v_user;
    if v_key is not null and length(v_key) >= 4
       and (select description from airton.transactions where id = p_ids[1]) !~* '^\s*(pix|ted|doc|transfer)' then
      delete from airton.rules where user_id = v_user and pattern = v_key;
      insert into airton.rules (user_id, pattern, category_id, priority) values (v_user, v_key, p_category, 50);
      select coalesce(array_agg(id), '{}') into v_similar from airton.transactions
       where user_id = v_user and id <> p_ids[1] and not reviewed
         and coalesce(category_id, '') <> p_category
         and airton.merchant_key(coalesce(merchant, description)) = v_key;
    end if;
  end if;
  return jsonb_build_object('updated', array_length(p_ids, 1), 'similar', to_jsonb(v_similar));
end $$;

create or replace function airton.confirm(p_ids text[]) returns int
language sql security invoker set search_path = '' as $$
  with u as (
    update airton.transactions set reviewed = true,
           cat_source = case when category_id is not null then 'manual' else cat_source end
     where user_id = airton._uid(null) and id = any(p_ids) returning 1)
  select count(*)::int from u
$$;

create or replace function airton.set_kind(p_ids text[], p_kind text) returns int
language sql security invoker set search_path = '' as $$
  with u as (
    update airton.transactions set kind = p_kind, reviewed = true
     where user_id = airton._uid(null) and id = any(p_ids) returning 1)
  select count(*)::int from u
$$;

grant execute on all functions in schema airton to authenticated, service_role;
;
