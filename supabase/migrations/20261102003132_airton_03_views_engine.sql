
create or replace function airton.today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- Quem é o usuário da consulta: o logado (app) ou o informado pelo servidor (cron com service role).
create or replace function airton._uid(p_user uuid default null) returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    if p_user is not null and p_user <> auth.uid() then raise exception 'forbidden'; end if;
    if not exists (select 1 from airton.members where user_id = auth.uid()) then raise exception 'not a member'; end if;
    return auth.uid();
  end if;
  if p_user is null then raise exception 'user required'; end if;
  return p_user;
end $$;

-- Lançamento com a categoria de topo, a natureza e o "gasto" já com sinal
-- (gasto positivo; reembolso negativo; renda/transferência = 0).
create or replace view airton.v_tx with (security_invoker = on) as
select t.*,
       coalesce(p.id, c.id)         as top_category_id,
       coalesce(p.name, c.name)     as top_category_name,
       coalesce(p.color, c.color)   as top_category_color,
       c.name                       as category_name,
       coalesce(p.nature, c.nature,
         case t.kind when 'income' then 'renda' when 'transfer' then 'transferencia' else 'variavel' end) as nature,
       coalesce(t.installment_total, 0) > 1 as is_installment,
       case when t.kind in ('expense','refund') then -t.amount_brl else 0 end as spend
  from airton.transactions t
  left join airton.categories c on c.id = t.category_id
  left join airton.categories p on p.id = c.parent_id;

-- Compras parceladas: série = mesma conta + descrição sem "N/T" + total + valor.
create or replace view airton.v_installment_series with (security_invoker = on) as
with x as (
  select t.user_id, t.account_id, t.top_category_id, t.installment_total as total, t.installment_n as n,
         t.date, abs(t.amount_brl) as amount,
         lower(trim(regexp_replace(t.description, '\s*(parc(ela)?\.?\s*)?\d{1,2}\s*(/|de)\s*\d{1,2}\s*$', '', 'i'))) as base
    from airton.v_tx t
   where t.is_installment and t.kind = 'expense' and t.installment_n is not null
)
select distinct on (user_id, account_id, base, total, round(amount))
       user_id, account_id, base, total, n as last_n, date as last_date, amount, top_category_id,
       initcap(base) as label
  from x
 order by user_id, account_id, base, total, round(amount), n desc, date desc;

-- Parcelas futuras (ainda não lançadas) + planos cadastrados à mão.
create or replace view airton.v_installment_schedule with (security_invoker = on) as
select s.user_id, s.label, s.top_category_id as category_id, k as n, s.total,
       (s.last_date + make_interval(months => k - s.last_n))::date as date, s.amount, 'auto'::text as origin
  from airton.v_installment_series s
  cross join lateral generate_series(s.last_n + 1, s.total) k
 where s.last_n < s.total
union all
select p.user_id, p.label, p.category_id, k + 1, p.total,
       (p.first_date + make_interval(months => k))::date, p.installment_amount, 'manual'
  from airton.installment_plans p
  cross join lateral generate_series(0, p.total - 1) k;

-- ---------------------------------------------------------------------------
-- O MOTOR DO MÊS: quanto ainda dá para gastar.
--   renda prevista − meta de poupança − comprometido (fixos + parcelas + eventos)
--   = livre para o dia a dia;  disponível = livre − gasto do dia a dia.
create or replace function airton.month_plan(p_month date default null, p_user uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_user uuid := airton._uid(p_user);
  v_today date := airton.today();
  v_month date := date_trunc('month', coalesce(p_month, v_today))::date;
  v_end date := (date_trunc('month', coalesce(p_month, v_today)) + interval '1 month - 1 day')::date;
  v_dim int := extract(day from v_end)::int;
  v_current boolean := v_today between v_month and v_end;
  v_elapsed int; v_left int;
  v_cut date;
  v_salary numeric; v_salary_day int; v_income_received numeric; v_income_med numeric; v_planned_in numeric;
  v_income numeric; v_pct numeric; v_goal numeric;
  v_fixed numeric; v_fixed_spent numeric; v_inst_posted numeric; v_inst_rest numeric; v_planned_out numeric;
  v_committed numeric; v_free numeric; v_var_spent numeric; v_var_med numeric; v_available numeric;
  v_spent_total numeric; v_proj_var numeric; v_cats jsonb; v_upcoming jsonb; v_salary_expected date;
begin
  if v_current then v_elapsed := extract(day from v_today)::int; v_left := v_dim - v_elapsed + 1; v_cut := v_today;
  elsif v_today > v_end then v_elapsed := v_dim; v_left := 0; v_cut := v_end;
  else v_elapsed := 0; v_left := v_dim; v_cut := v_month - 1; end if;

  select case when coalesce((value->>'enabled')::boolean, false) then (value->>'amount')::numeric end,
         nullif(value->>'day','')::int
    into v_salary, v_salary_day
    from airton.settings where user_id = v_user and key = 'salary';
  select coalesce((value->>'pct')::numeric, 0.2) into v_pct from airton.settings where user_id = v_user and key = 'savings_target';
  v_pct := coalesce(v_pct, 0.2);

  select coalesce(sum(amount_brl), 0) into v_income_received
    from airton.transactions where user_id = v_user and kind = 'income' and date between v_month and least(v_end, v_cut);
  select percentile_cont(0.5) within group (order by s) into v_income_med from (
    select sum(amount_brl) s from airton.transactions
     where user_id = v_user and kind = 'income' and date >= (v_month - interval '3 months') and date < v_month
     group by date_trunc('month', date)) m;
  select coalesce(sum(amount), 0) into v_planned_in from airton.planned_events
   where user_id = v_user and amount > 0 and date between v_month and v_end and date > v_cut;
  v_income := greatest(v_income_received, coalesce(v_salary, v_income_med, 0)) + v_planned_in;
  v_goal := round(v_pct * v_income, 2);

  -- por categoria de topo: gasto no mês e mediana dos 3 meses fechados anteriores
  with months as (
    select top_category_id cid, date_trunc('month', date)::date m, sum(spend) s, sum(spend) filter (where not is_installment) sv
      from airton.v_tx
     where user_id = v_user and date >= (v_month - interval '3 months') and date <= least(v_end, v_cut)
       and nature not in ('renda','transferencia','investimento')
     group by 1, 2
  ), stats as (
    select c.id, c.name, c.color, c.nature, c.budget_monthly,
           coalesce((select s from months where cid = c.id and m = v_month), 0) as spent,
           coalesce((select sv from months where cid = c.id and m = v_month), 0) as spent_var,
           coalesce((select percentile_cont(0.5) within group (order by coalesce(mm.sv, 0))
                       from generate_series(1, 3) g(i)
                       left join months mm on mm.cid = c.id and mm.m = (v_month - make_interval(months => g.i))::date), 0) as median3
      from airton.categories c
     where c.user_id = v_user and c.parent_id is null and not c.archived
       and c.nature not in ('renda','transferencia','investimento')
  )
  select
    coalesce(sum(greatest(spent, coalesce(budget_monthly, median3))) filter (where nature = 'fixo'), 0),
    coalesce(sum(spent) filter (where nature = 'fixo'), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'color', color, 'nature', nature, 'budget', budget_monthly,
      'spent', round(spent, 2), 'spentVariable', round(spent_var, 2), 'median3', round(median3::numeric, 2),
      'expected', round(case when nature = 'fixo' then greatest(spent, coalesce(budget_monthly, median3))
                             when nature = 'eventual' then spent
                             else greatest(spent_var, coalesce(budget_monthly, median3)) end::numeric, 2)
    ) order by spent desc) filter (where spent <> 0 or median3 > 0 or budget_monthly is not null), '[]'::jsonb)
  into v_fixed, v_fixed_spent, v_cats
  from stats;

  -- gasto sem categoria também conta como dia a dia
  select coalesce(sum(spend) filter (where nature not in ('fixo','renda','transferencia','investimento') and not is_installment), 0),
         coalesce(sum(spend) filter (where is_installment and nature not in ('fixo','renda','transferencia','investimento')), 0),
         coalesce(sum(spend) filter (where nature not in ('renda','transferencia','investimento')), 0)
    into v_var_spent, v_inst_posted, v_spent_total
    from airton.v_tx where user_id = v_user and date between v_month and least(v_end, v_cut);

  select percentile_cont(0.5) within group (order by coalesce(s, 0)) into v_var_med
    from generate_series(1, 3) g(i)
    left join (select date_trunc('month', date)::date m, sum(spend) s from airton.v_tx
                where user_id = v_user and not is_installment
                  and nature not in ('fixo','renda','transferencia','investimento')
                  and date >= (v_month - interval '3 months') and date < v_month group by 1) x
      on x.m = (v_month - make_interval(months => g.i))::date;

  select coalesce(sum(amount), 0) into v_inst_rest from airton.v_installment_schedule
   where user_id = v_user and date between v_month and v_end and date > v_cut;
  select coalesce(-sum(amount), 0) into v_planned_out from airton.planned_events
   where user_id = v_user and amount < 0 and date between v_month and v_end and date > v_cut;

  v_committed := v_fixed + v_inst_posted + v_inst_rest + v_planned_out;
  v_free := v_income - v_goal - v_committed;
  v_available := v_free - v_var_spent;
  v_proj_var := case when v_left = 0 then v_var_spent
                     else v_var_spent + coalesce(v_var_med, 0) * v_left / v_dim end;

  if v_salary is not null and v_salary_day is not null and v_income_received < v_salary * 0.5 then
    v_salary_expected := make_date(extract(year from v_month)::int, extract(month from v_month)::int, least(v_salary_day, v_dim));
  end if;

  select coalesce(jsonb_agg(u order by u->>'date'), '[]'::jsonb) into v_upcoming from (
    select jsonb_build_object('date', date, 'label', label || ' (' || n || '/' || total || ')', 'amount', -amount, 'kind', 'parcela') u
      from airton.v_installment_schedule where user_id = v_user and date between greatest(v_month, v_cut + 1) and v_end
    union all
    select jsonb_build_object('date', date, 'label', label, 'amount', amount, 'kind', 'evento')
      from airton.planned_events where user_id = v_user and date between greatest(v_month, v_cut + 1) and v_end
    union all
    select jsonb_build_object('date', v_salary_expected, 'label', 'Salário', 'amount', v_salary, 'kind', 'salario')
     where v_salary_expected is not null and v_salary_expected > v_cut
  ) q;

  return jsonb_build_object(
    'month', to_char(v_month, 'YYYY-MM'), 'today', v_today, 'isCurrent', v_current,
    'daysInMonth', v_dim, 'daysElapsed', v_elapsed, 'daysLeft', v_left,
    'income', jsonb_build_object('expected', round(v_income, 2), 'received', round(v_income_received, 2),
                                 'salary', v_salary, 'plannedRest', round(v_planned_in, 2), 'median3', round(coalesce(v_income_med, 0)::numeric, 2)),
    'savings', jsonb_build_object('pct', v_pct, 'goal', v_goal),
    'committed', jsonb_build_object('total', round(v_committed, 2), 'fixed', round(v_fixed, 2), 'fixedSpent', round(v_fixed_spent, 2),
                                    'installmentsPosted', round(v_inst_posted, 2), 'installmentsRest', round(v_inst_rest, 2),
                                    'plannedRest', round(v_planned_out, 2)),
    'free', round(v_free, 2),
    'variableSpent', round(v_var_spent, 2),
    'available', round(v_available, 2),
    'perDay', case when v_left > 0 then round(v_available / v_left, 2) end,
    'idealByToday', round(v_free * v_elapsed / v_dim, 2),
    'variableMedian3', round(coalesce(v_var_med, 0)::numeric, 2),
    'spentTotal', round(v_spent_total, 2),
    'projectedSpend', round(v_fixed + v_inst_posted + v_inst_rest + v_planned_out + v_proj_var, 2),
    'projectedNet', round(v_income - (v_fixed + v_inst_posted + v_inst_rest + v_planned_out + v_proj_var), 2),
    'categories', v_cats,
    'upcoming', v_upcoming
  );
end $$;

-- Semana (seg→hoje) vs mediana das 8 semanas anteriores no mesmo trecho.
create or replace function airton.week_summary(p_date date default null, p_user uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_user uuid := airton._uid(p_user);
  v_day date := coalesce(p_date, airton.today());
  v_start date := v_day - ((extract(isodow from v_day)::int) - 1);
  v_span int := v_day - v_start;
  r jsonb;
begin
  with w as (
    select g.i, (v_start - 7 * g.i) ws, (v_start - 7 * g.i + v_span) we from generate_series(0, 8) g(i)
  ), agg as (
    select w.i, t.top_category_id cid, coalesce(t.top_category_name, 'Sem categoria') cname, sum(t.spend) s
      from w join airton.v_tx t on t.user_id = v_user and t.date between w.ws and w.we
       and t.nature not in ('renda','transferencia','investimento')
     group by 1, 2, 3
  ), totals as (
    select g.i, coalesce((select sum(s) from agg where agg.i = g.i), 0) s from generate_series(0, 8) g(i)
  ), cats as (
    select cname, max(cid) cid,
           coalesce(sum(s) filter (where i = 0), 0) spent,
           (select percentile_cont(0.5) within group (order by coalesce(a2.s, 0))
              from generate_series(1, 8) g(j) left join agg a2 on a2.i = g.j and a2.cname = agg.cname) typical
      from agg group by cname
  )
  select jsonb_build_object(
    'start', v_start, 'end', v_start + 6, 'span', v_span,
    'spent', round((select s from totals where i = 0), 2),
    'typical', round((select percentile_cont(0.5) within group (order by s) from totals where i > 0)::numeric, 2),
    'byCategory', coalesce((select jsonb_agg(jsonb_build_object('id', cid, 'name', cname, 'spent', round(spent, 2), 'typical', round(typical::numeric, 2)) order by spent desc)
                             from cats where spent > 0.5), '[]'::jsonb),
    'daily', (select jsonb_agg(jsonb_build_object('date', d::date,
                 'spent', round(coalesce((select sum(spend) from airton.v_tx t where t.user_id = v_user and t.date = d::date
                   and t.nature not in ('renda','transferencia','investimento')), 0), 2)) order by d)
                from generate_series(v_start, v_start + 6, interval '1 day') d),
    'biggest', coalesce((select jsonb_agg(x) from (
                 select jsonb_build_object('id', id, 'label', coalesce(merchant, description), 'amount', spend, 'date', date,
                        'category', top_category_name) x
                   from airton.v_tx where user_id = v_user and date between v_start and v_day and spend > 0
                    and nature not in ('renda','transferencia','investimento')
                  order by spend desc limit 5) b), '[]'::jsonb)
  ) into r;
  r := r || jsonb_build_object('deltaPct', case when (r->>'typical')::numeric > 50
          then ((r->>'spent')::numeric - (r->>'typical')::numeric) / (r->>'typical')::numeric end);
  return r;
end $$;

-- Ano: realizado + projeção até dezembro (mês corrente pelo motor + meses futuros pelo padrão).
create or replace function airton.year_summary(p_user uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_user uuid := airton._uid(p_user);
  v_today date := airton.today();
  v_y0 date := date_trunc('year', v_today)::date;
  v_month date := date_trunc('month', v_today)::date;
  v_inc numeric; v_spend numeric; v_mp jsonb; v_proj_net numeric; v_proj_inc numeric; m date; v_fut jsonb; v_pct numeric;
begin
  select coalesce(sum(amount_brl) filter (where kind = 'income'), 0),
         coalesce(sum(spend) filter (where nature not in ('renda','transferencia','investimento')), 0)
    into v_inc, v_spend
    from airton.v_tx where user_id = v_user and date >= v_y0 and date < v_month;
  v_mp := airton.month_plan(v_month, v_user);
  v_proj_inc := v_inc + (v_mp->'income'->>'expected')::numeric;
  v_proj_net := (v_inc - v_spend) + (v_mp->>'projectedNet')::numeric;
  m := v_month + interval '1 month';
  while extract(year from m) = extract(year from v_today) loop
    v_fut := airton.month_plan(m, v_user);
    v_proj_inc := v_proj_inc + (v_fut->'income'->>'expected')::numeric;
    v_proj_net := v_proj_net + (v_fut->>'projectedNet')::numeric;
    m := m + interval '1 month';
  end loop;
  v_pct := (v_mp->'savings'->>'pct')::numeric;
  return jsonb_build_object(
    'year', extract(year from v_today)::int,
    'ytdIncome', round(v_inc + (v_mp->'income'->>'received')::numeric, 2),
    'ytdSpend', round(v_spend + (v_mp->>'spentTotal')::numeric, 2),
    'projectedIncome', round(v_proj_inc, 2),
    'projectedNet', round(v_proj_net, 2),
    'savingsRate', case when v_proj_inc > 0 then round(v_proj_net / v_proj_inc, 4) end,
    'targetRate', v_pct);
end $$;

create or replace function airton.review_counts(p_user uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'pending', count(*) filter (where category_id is null or (cat_source = 'ai' and coalesce(cat_confidence, 0) < 0.7)),
    'uncategorized', count(*) filter (where category_id is null),
    'unconfirmed', count(*))
  from airton.transactions
  where user_id = airton._uid(p_user) and not reviewed and kind <> 'transfer'
    and date >= airton.today() - 30 and date <= airton.today()
$$;

grant execute on all functions in schema airton to authenticated, service_role;
grant select on airton.v_tx, airton.v_installment_series, airton.v_installment_schedule to authenticated, service_role;
;
