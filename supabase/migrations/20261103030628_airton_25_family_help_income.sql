alter table airton.categories drop constraint if exists categories_income_type_check;
alter table airton.categories add constraint categories_income_type_check check (income_type in ('salario','plr','extra','outros','familia'));

create or replace function airton._family_match(p_user uuid, p_desc text) returns boolean language sql stable set search_path to '' as $$
  select exists (select 1 from airton.settings s, jsonb_array_elements_text(coalesce(s.value->'terms', '[]'::jsonb)) t
                  where s.user_id = p_user and s.key = 'family_help' and length(btrim(t)) >= 4 and p_desc ilike '%' || btrim(t) || '%')
$$;

create or replace function airton._tx_before() returns trigger language plpgsql set search_path to '' as $$
declare emp airton.employments; v_base numeric; v_amt numeric; v_ev text; v_fam text;
begin
  if new.amount > 0 and coalesce(new.cat_source, '') <> 'manual' and coalesce(current_setting('airton.reclass', true), 'off') <> 'on'
     and not airton._is_invest_account(new.account_id) then
    emp := airton._employment_for(new.user_id, new.date, new.description);
    if emp.id is not null then
      v_base := airton._employment_base(emp, new.date);
      new.kind := 'income';
      new.category_id := airton._income_cat(new.user_id,
        case when v_base is not null and new.amount >= emp.variable_factor * v_base then 'plr' else 'salario' end);
      new.cat_source := 'rule'; new.cat_confidence := 1; new.reviewed := true;
    elsif airton._family_match(new.user_id, new.description) then
      v_fam := airton._income_cat(new.user_id, 'familia');
      if v_fam is not null then
        new.kind := 'income'; new.category_id := v_fam; new.cat_source := 'rule'; new.cat_confidence := 1; new.reviewed := true;
      end if;
    end if;
  end if;
  if new.planned_event_id is null and new.kind <> 'transfer' and not new.planned_manual then
    v_amt := round(new.amount * coalesce(new.fx_rate_brl, 1) * coalesce(new.share_pct, 1), 2);
    select e.id into v_ev from airton.planned_events e
     where e.user_id = new.user_id and e.auto_match
       and airton._ev_tx_ok(e, new.date, v_amt, new.description || ' ' || coalesce(new.merchant, ''), new.category_id)
       and (e.date_end is not null or not exists (select 1 from airton.transactions x where x.planned_event_id = e.id and x.id <> new.id))
     order by (e.date_end is null) desc, abs(new.date - e.date) limit 1;
    new.planned_event_id := v_ev;
  end if;
  return new;
end $$;

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
  v_sal_rec numeric; v_var_rec numeric; v_oth_rec numeric; v_fam_rec numeric; v_fam_avg numeric; v_fam numeric; v_var_total numeric;
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

  select coalesce(sum(t.amount_brl) filter (where c.income_type = 'salario'), 0),
         coalesce(sum(t.amount_brl) filter (where c.income_type in ('plr','extra')), 0),
         coalesce(sum(t.amount_brl) filter (where c.income_type is null or c.income_type = 'outros'), 0),
         coalesce(sum(t.amount_brl) filter (where c.income_type = 'familia'), 0)
    into v_sal_rec, v_var_rec, v_oth_rec, v_fam_rec
    from airton.transactions t left join airton.categories c on c.id = t.category_id
   where t.user_id = v_user and t.kind = 'income' and t.date between v_month and least(v_end, v_cut);
  v_income_received := v_sal_rec + v_var_rec + v_oth_rec + v_fam_rec;

  -- ajuda familiar: média dos 3 meses fechados anteriores (meses sem ajuda contam como zero)
  select coalesce(sum(t.amount_brl), 0) / 3 into v_fam_avg
    from airton.transactions t join airton.categories c on c.id = t.category_id
   where t.user_id = v_user and t.kind = 'income' and c.income_type = 'familia'
     and t.date >= (least(v_month, date_trunc('month', v_today)::date) - interval '3 months') and t.date < least(v_month, date_trunc('month', v_today)::date);
  v_fam := case when v_past then v_fam_rec else greatest(v_fam_rec, v_fam_avg) end;

  select percentile_cont(0.5) within group (order by s) into v_income_med from (
    select sum(t.amount_brl) s from airton.transactions t left join airton.categories c on c.id = t.category_id
     where t.user_id = v_user and t.kind = 'income' and t.date >= (v_month - interval '3 months') and t.date < v_month
       and case when v_has_emp then c.income_type = 'salario' else coalesce(c.income_type, 'outros') not in ('plr','extra','familia') end
     group by date_trunc('month', t.date)) m;

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

  if v_past then
    v_income := v_sal_rec + v_oth_rec + v_fam;
  elsif v_has_emp then
    v_income := greatest(v_sal_rec, case when v_current or v_salary is null then coalesce(v_salary, v_income_med, 0) else v_salary end) + v_oth_rec + v_fam;
  else
    v_income := greatest(v_sal_rec + v_oth_rec, coalesce(v_salary, v_income_med, 0)) + v_fam;
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
                                 'family', round(v_fam, 2), 'familyReceived', round(v_fam_rec, 2), 'familyAvg3', round(coalesce(v_fam_avg, 0), 2),
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

do $$
declare v_user uuid := '69706b26-5f72-4dfd-9d81-8ecb8157086c'; v_top text; v_fam text;
begin
  select id into v_top from airton.categories where user_id = v_user and parent_id is null and nature = 'renda' order by sort limit 1;
  update airton.categories set name = 'Renda' where id = v_top and name = 'Renda (salário + bônus)';
  select id into v_fam from airton.categories where user_id = v_user and income_type = 'familia';
  if v_fam is null then
    insert into airton.categories (user_id, name, parent_id, color, nature, income_type, sort)
    values (v_user, 'Ajuda familiar', v_top, '#22c55e', 'renda', 'familia', 5) returning id into v_fam;
  end if;
  insert into airton.settings (user_id, key, value)
  values (v_user, 'family_help', '{"terms": ["Luiz Henrique de Souza C", "Luciana Moscatel Guidett"]}'::jsonb)
  on conflict (user_id, key) do update set value = excluded.value;

  insert into airton_private.tx_backup (reason, id, kind, category_id, cat_source, cat_confidence, reviewed)
  select 'familia_2026-11-03', id, kind, category_id, cat_source, cat_confidence, reviewed from airton.transactions
   where user_id = v_user and amount > 0 and airton._family_match(v_user, description);
  perform set_config('airton.reclass', 'on', true);
  update airton.transactions set kind = 'income', category_id = v_fam, cat_source = 'rule', cat_confidence = 1, reviewed = true
   where user_id = v_user and amount > 0 and airton._family_match(v_user, description)
     and not airton._is_invest_account(account_id);
  perform set_config('airton.reclass', 'off', true);
end $$;;
