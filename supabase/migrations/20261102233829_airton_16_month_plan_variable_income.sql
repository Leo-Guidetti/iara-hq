create or replace function airton.month_plan(p_month date default null, p_user uuid default null)
returns jsonb language plpgsql stable set search_path to '' as $function$
declare
  v_user uuid := airton._uid(p_user);
  v_today date := airton.today();
  v_month date := date_trunc('month', coalesce(p_month, v_today))::date;
  v_end date := (date_trunc('month', coalesce(p_month, v_today)) + interval '1 month - 1 day')::date;
  v_dim int := extract(day from v_end)::int;
  v_current boolean := v_today between v_month and v_end;
  v_past boolean := v_today > v_end;
  v_has_emp boolean;
  v_elapsed int; v_left int; v_cut date;
  v_salary numeric; v_salary_day int; v_income_received numeric; v_income_med numeric; v_planned_in numeric;
  v_sal_rec numeric; v_var_rec numeric; v_oth_rec numeric; v_var_total numeric;
  v_income numeric; v_pct numeric; v_goal numeric;
  v_fixed numeric; v_fixed_spent numeric; v_inst_posted numeric; v_inst_rest numeric; v_planned_out numeric;
  v_committed numeric; v_free numeric; v_var_spent numeric; v_var_med numeric; v_available numeric;
  v_spent_total numeric; v_proj_var numeric; v_cats jsonb; v_upcoming jsonb; v_salary_expected date;
begin
  if v_current then v_elapsed := extract(day from v_today)::int; v_left := v_dim - v_elapsed + 1; v_cut := v_today;
  elsif v_past then v_elapsed := v_dim; v_left := 0; v_cut := v_end;
  else v_elapsed := 0; v_left := v_dim; v_cut := v_month - 1; end if;

  v_has_emp := exists (select 1 from airton.employments where user_id = v_user);
  select case when coalesce((value->>'enabled')::boolean, false) then (value->>'amount')::numeric end, nullif(value->>'day','')::int
    into v_salary, v_salary_day from airton.settings where user_id = v_user and key = 'salary';
  select coalesce((value->>'pct')::numeric, 0.2) into v_pct from airton.settings where user_id = v_user and key = 'savings_target';
  v_pct := coalesce(v_pct, 0.2);

  -- renda recebida: salário (fixo), variável (PLR/bônus/13º/férias) e outros (reembolsos, rendimentos)
  select coalesce(sum(t.amount_brl) filter (where c.income_type = 'salario'), 0),
         coalesce(sum(t.amount_brl) filter (where c.income_type in ('plr','extra')), 0),
         coalesce(sum(t.amount_brl) filter (where c.income_type is null or c.income_type = 'outros'), 0)
    into v_sal_rec, v_var_rec, v_oth_rec
    from airton.transactions t left join airton.categories c on c.id = t.category_id
   where t.user_id = v_user and t.kind = 'income' and t.date between v_month and least(v_end, v_cut);
  v_income_received := v_sal_rec + v_var_rec + v_oth_rec;

  select percentile_cont(0.5) within group (order by s) into v_income_med from (
    select sum(t.amount_brl) s from airton.transactions t left join airton.categories c on c.id = t.category_id
     where t.user_id = v_user and t.kind = 'income' and t.date >= (v_month - interval '3 months') and t.date < v_month
       and case when v_has_emp then c.income_type = 'salario' else coalesce(c.income_type, 'outros') not in ('plr','extra') end
     group by date_trunc('month', t.date)) m;

  -- eventos planejados ainda não realizados (o realizado já está nos lançamentos)
  select coalesce(sum(case when e.amount > 0 then
                    case when e.date_end is null then case when coalesce(r.n, 0) = 0 then e.amount else 0 end
                         else greatest(0, e.amount - coalesce(r.realized, 0)) end else 0 end), 0),
         coalesce(sum(case when e.amount < 0 then
                    case when e.date_end is null then case when coalesce(r.n, 0) = 0 then -e.amount else 0 end
                         else greatest(0, -e.amount + coalesce(r.realized, 0)) end else 0 end), 0)
    into v_planned_in, v_planned_out
    from airton.planned_events e
    left join lateral (select sum(t.amount_brl) realized, count(*) n from airton.transactions t where t.planned_event_id = e.id) r on true
   where e.user_id = v_user and e.date between v_month and v_end and coalesce(e.date_end, e.date) > v_cut;

  -- renda que sustenta o dia a dia = salário (fixo) + outros. Variável vai para a sobra.
  if v_past then
    v_income := v_sal_rec + v_oth_rec;
  elsif v_has_emp then
    v_income := greatest(v_sal_rec, case when v_current or v_salary is null then coalesce(v_salary, v_income_med, 0) else v_salary end) + v_oth_rec;
  else
    v_income := greatest(v_sal_rec + v_oth_rec, coalesce(v_salary, v_income_med, 0));
  end if;
  v_var_total := v_var_rec + v_planned_in;
  v_goal := round(v_pct * v_income, 2);

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

  v_committed := v_fixed + v_inst_posted + v_inst_rest + v_planned_out;
  v_free := v_income - v_goal - v_committed;
  v_available := v_free - v_var_spent;
  v_proj_var := case when v_left = 0 then v_var_spent else v_var_spent + coalesce(v_var_med, 0) * v_left / v_dim end;

  if v_salary is not null and v_salary_day is not null and not v_past
     and (case when v_has_emp then v_sal_rec else v_sal_rec + v_oth_rec end) < v_salary * 0.5 then
    v_salary_expected := make_date(extract(year from v_month)::int, extract(month from v_month)::int, least(v_salary_day, v_dim));
  end if;

  select coalesce(jsonb_agg(u order by u->>'date'), '[]'::jsonb) into v_upcoming from (
    select jsonb_build_object('date', date, 'label', label || ' (' || n || '/' || total || ')', 'amount', -amount, 'kind', 'parcela') u
      from airton.v_installment_schedule where user_id = v_user and date between greatest(v_month, v_cut + 1) and v_end
    union all
    select jsonb_build_object('date', e.date, 'label', e.label, 'amount', e.amount, 'kind', case when e.income_type in ('plr','extra') then 'variavel' else 'evento' end)
      from airton.planned_events e
     where e.user_id = v_user and e.date between greatest(v_month, v_cut + 1) and v_end
       and not exists (select 1 from airton.transactions t where t.planned_event_id = e.id)
    union all
    select jsonb_build_object('date', v_salary_expected, 'label', 'Salário', 'amount', v_salary, 'kind', 'salario')
     where v_salary_expected is not null and v_salary_expected > v_cut
  ) q;

  return jsonb_build_object(
    'month', to_char(v_month, 'YYYY-MM'), 'today', v_today, 'isCurrent', v_current,
    'daysInMonth', v_dim, 'daysElapsed', v_elapsed, 'daysLeft', v_left,
    'income', jsonb_build_object('expected', round(v_income, 2), 'received', round(v_income_received, 2),
                                 'salaryReceived', round(v_sal_rec, 2), 'otherReceived', round(v_oth_rec, 2),
                                 'variableReceived', round(v_var_rec, 2), 'variablePlanned', round(v_planned_in, 2),
                                 'total', round(v_income + v_var_total, 2),
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
    'projectedNet', round(v_income + v_var_total - (v_fixed + v_inst_posted + v_inst_rest + v_planned_out + v_proj_var), 2),
    'categories', v_cats,
    'upcoming', v_upcoming
  );
end $function$;

create or replace function airton.year_summary(p_user uuid default null)
returns jsonb language plpgsql stable set search_path to '' as $function$
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
  v_proj_inc := v_inc + (v_mp->'income'->>'total')::numeric;
  v_proj_net := (v_inc - v_spend) + (v_mp->>'projectedNet')::numeric;
  m := v_month + interval '1 month';
  while extract(year from m) = extract(year from v_today) loop
    v_fut := airton.month_plan(m, v_user);
    v_proj_inc := v_proj_inc + (v_fut->'income'->>'total')::numeric;
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
end $function$;

create or replace function airton.year_series(p_year int default null, p_user uuid default null)
returns jsonb language plpgsql stable set search_path to '' as $$
declare
  v_user uuid := airton._uid(p_user);
  v_today date := airton.today();
  v_year int := coalesce(p_year, extract(year from v_today)::int);
  v_cur date := date_trunc('month', v_today)::date;
  v_y0 date := make_date(v_year, 1, 1);
  m date; v_mp jsonb; v_months jsonb := '[]'::jsonb; v_row jsonb; v_real jsonb;
  v_cats jsonb; v_prev jsonb; v_ytd jsonb; v_pct numeric;
begin
  select coalesce((value->>'pct')::numeric, 0.2) into v_pct from airton.settings where user_id = v_user and key = 'savings_target';
  v_pct := coalesce(v_pct, 0.2);

  for i in 0..11 loop
    m := (v_y0 + make_interval(months => i))::date;
    select jsonb_build_object(
      'income', round(coalesce(sum(t.amount_brl) filter (where t.kind = 'income'), 0), 2),
      'incomeVar', round(coalesce(sum(t.amount_brl) filter (where t.kind = 'income' and c.income_type in ('plr','extra')), 0), 2),
      'spend', round(coalesce(sum(t.spend) filter (where t.nature not in ('renda','transferencia','investimento')), 0), 2),
      'variavel', round(coalesce(sum(t.spend) filter (where t.nature = 'variavel'), 0), 2),
      'fixo', round(coalesce(sum(t.spend) filter (where t.nature = 'fixo'), 0), 2),
      'eventual', round(coalesce(sum(t.spend) filter (where t.nature = 'eventual'), 0), 2),
      'parcelas', round(coalesce(sum(t.spend) filter (where t.is_installment and t.nature not in ('renda','transferencia','investimento')), 0), 2),
      'investido', round(coalesce(-sum(t.amount_brl) filter (where t.nature = 'investimento'), 0), 2))
      into v_real
      from airton.v_tx t left join airton.categories c on c.id = t.category_id
     where t.user_id = v_user and t.date >= m and t.date < m + interval '1 month' and t.date <= v_today;

    if m < v_cur then
      v_row := v_real || jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'status', 'real',
        'incomeFixed', round((v_real->>'income')::numeric - (v_real->>'incomeVar')::numeric, 2),
        'net', round((v_real->>'income')::numeric - (v_real->>'spend')::numeric, 2));
    else
      v_mp := airton.month_plan(m, v_user);
      v_row := jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'status', case when m = v_cur then 'atual' else 'proj' end,
        'real', v_real,
        'income', round((v_mp->'income'->>'total')::numeric, 2),
        'incomeFixed', round((v_mp->'income'->>'expected')::numeric, 2),
        'incomeVar', round((v_mp->'income'->>'variableReceived')::numeric + (v_mp->'income'->>'variablePlanned')::numeric, 2),
        'spend', round(greatest((v_mp->>'projectedSpend')::numeric, (v_real->>'spend')::numeric), 2),
        'fixo', round(greatest((v_mp->'committed'->>'fixed')::numeric, (v_real->>'fixo')::numeric), 2),
        'parcelas', round((v_mp->'committed'->>'installmentsPosted')::numeric + (v_mp->'committed'->>'installmentsRest')::numeric, 2),
        'planejado', round((v_mp->'committed'->>'plannedRest')::numeric, 2),
        'net', round((v_mp->>'projectedNet')::numeric, 2),
        'goal', round((v_mp->'savings'->>'goal')::numeric, 2));
      v_row := v_row || jsonb_build_object('variavel', round(greatest(0, (v_row->>'spend')::numeric - (v_row->>'fixo')::numeric - (v_row->>'parcelas')::numeric - (v_row->>'planejado')::numeric), 2));
    end if;
    v_months := v_months || jsonb_build_array(v_row);
  end loop;

  select coalesce(jsonb_agg(c order by (c->>'total')::numeric desc), '[]'::jsonb) into v_cats from (
    select jsonb_build_object('id', top_category_id, 'name', coalesce(top_category_name, 'Sem categoria'), 'color', top_category_color, 'nature', nature,
      'total', round(sum(spend), 2),
      'months', (select jsonb_agg(round(coalesce(x.s, 0), 2) order by g.i) from generate_series(0, 11) g(i)
                  left join lateral (select sum(t2.spend) s from airton.v_tx t2 where t2.user_id = v_user
                    and coalesce(t2.top_category_id, '-') = coalesce(t.top_category_id, '-')
                    and t2.nature not in ('renda','transferencia','investimento')
                    and t2.date >= (v_y0 + make_interval(months => g.i)) and t2.date < (v_y0 + make_interval(months => g.i + 1)) and t2.date <= v_today) x on true)) c
    from airton.v_tx t
    where t.user_id = v_user and t.date >= v_y0 and t.date < v_y0 + interval '1 year' and t.date <= v_today
      and t.nature not in ('renda','transferencia','investimento')
    group by top_category_id, top_category_name, top_category_color, nature
    having sum(spend) <> 0) s(c);

  select jsonb_build_object('income', round(coalesce(sum(amount_brl) filter (where kind = 'income'), 0), 2),
                            'spend', round(coalesce(sum(spend) filter (where nature not in ('renda','transferencia','investimento')), 0), 2))
    into v_ytd from airton.v_tx where user_id = v_user and date >= v_y0 and date <= least(v_today, make_date(v_year, 12, 31));
  select jsonb_build_object('income', round(coalesce(sum(amount_brl) filter (where kind = 'income'), 0), 2),
                            'spend', round(coalesce(sum(spend) filter (where nature not in ('renda','transferencia','investimento')), 0), 2))
    into v_prev from airton.v_tx where user_id = v_user and date >= make_date(v_year - 1, 1, 1)
      and date <= (least(v_today, make_date(v_year, 12, 31)) - interval '1 year');

  return jsonb_build_object('year', v_year, 'today', v_today, 'targetRate', v_pct, 'months', v_months, 'categories', v_cats, 'ytd', v_ytd, 'prevYtd', v_prev);
end $$;

create or replace function airton.income_history(p_user uuid default null)
returns jsonb language sql stable set search_path to '' as $$
  with u as (select airton._uid(p_user) id),
  inc as (
    select t.date, t.amount_brl, c.income_type, t.source,
           coalesce(
             substring(t.source_ref from '^inc_(emp_[a-z0-9]+)_'),
             (select e.id from airton.employments e where e.user_id = t.user_id
                and t.date between e.start_date and coalesce(e.end_date, '9999-12-31')
              order by e.start_date desc limit 1),
             (select e.id from airton.employments e where e.user_id = t.user_id
                and t.date >= e.start_date - 10 and (e.end_date is null or t.date <= e.end_date + 45)
              order by e.start_date desc limit 1)) emp
      from airton.transactions t join airton.categories c on c.id = t.category_id, u
     where t.user_id = u.id and t.kind = 'income' and c.income_type in ('salario','plr','extra')
  )
  select jsonb_build_object(
    'months', coalesce((select jsonb_agg(x order by x->>'month') from (
        select jsonb_build_object('month', to_char(date_trunc('month', date), 'YYYY-MM'), 'employment_id', emp,
          'salario', round(coalesce(sum(amount_brl) filter (where income_type = 'salario'), 0), 2),
          'plr', round(coalesce(sum(amount_brl) filter (where income_type = 'plr'), 0), 2),
          'extra', round(coalesce(sum(amount_brl) filter (where income_type = 'extra'), 0), 2),
          'manual', bool_or(source = 'manual')) x
        from inc group by date_trunc('month', date), emp) s), '[]'::jsonb),
    'employments', coalesce((select jsonb_agg(to_jsonb(e) order by e.start_date) from airton.employments e, u where e.user_id = u.id), '[]'::jsonb))
$$;;
