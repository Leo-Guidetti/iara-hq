create or replace function airton._is_invest_account(p_acc text) returns boolean language sql stable set search_path to '' as $$
  select coalesce((select type like 'investment%' from airton.accounts where id = p_acc), false)
$$;

create or replace function airton.reclass_employer_month(p_user uuid, p_emp text, p_month date)
returns int language plpgsql set search_path to '' as $$
declare e airton.employments; v_base numeric; v_sal text; v_plr text; v_ext text; v_tr text; v_has_manual_sal boolean; v_salary_id text; n int := 0;
  v_ids text[]; v_plr_ids text[];
begin
  select * into e from airton.employments where id = p_emp and user_id = p_user;
  if not found then return 0; end if;
  perform set_config('airton.reclass', 'on', true);
  v_base := airton._employment_base(e, p_month);
  v_sal := airton._income_cat(p_user, 'salario'); v_plr := airton._income_cat(p_user, 'plr'); v_ext := airton._income_cat(p_user, 'extra');
  select id into v_tr from airton.categories where user_id = p_user and parent_id is null and nature = 'transferencia' order by sort limit 1;

  select coalesce(array_agg(t.id) filter (where coalesce(t.cat_source, '') <> 'manual'), '{}'),
         coalesce(array_agg(t.id) filter (where coalesce(t.cat_source, '') <> 'manual' and v_base is not null and t.amount >= e.variable_factor * v_base), '{}'),
         coalesce(bool_or(coalesce(t.cat_source, '') = 'manual' and t.category_id = v_sal), false)
    into v_ids, v_plr_ids, v_has_manual_sal
    from airton.transactions t join airton.accounts a on a.id = t.account_id
   where t.user_id = p_user and t.amount > 0 and t.source <> 'manual' and a.type not like 'investment%'
     and date_trunc('month', t.date) = date_trunc('month', p_month)
     and t.date >= e.start_date - 10 and (e.end_date is null or t.date <= e.end_date + 45)
     and exists (select 1 from unnest(e.payer_terms) x where length(btrim(x)) >= 3 and t.description ilike '%' || btrim(x) || '%')
     and (airton._employment_for(p_user, t.date, t.description)).id = e.id;
  if cardinality(v_ids) = 0 and not v_has_manual_sal then perform set_config('airton.reclass', 'off', true); return 0; end if;

  update airton.transactions set kind = 'income', category_id = v_plr, cat_source = 'rule', cat_confidence = 1, reviewed = true
   where id = any(v_plr_ids);
  if not v_has_manual_sal then
    select t.id into v_salary_id from airton.transactions t
     where t.id = any(v_ids) and not (t.id = any(v_plr_ids))
     order by (extract(day from t.date) >= 20) desc, abs(extract(day from t.date) - 25), abs(t.amount - coalesce(v_base, t.amount)) limit 1;
  end if;
  update airton.transactions set kind = 'income', category_id = v_sal, cat_source = 'rule', cat_confidence = 1, reviewed = true
   where id = v_salary_id;
  update airton.transactions set kind = 'income', category_id = v_ext, cat_source = 'rule', cat_confidence = 0.9, reviewed = true
   where id = any(v_ids) and not (id = any(v_plr_ids)) and id is distinct from v_salary_id;
  get diagnostics n = row_count;
  update airton.transactions t set kind = 'transfer', category_id = v_tr, notes = 'Estimativa substituída pelo crédito real do banco'
   where t.user_id = p_user and t.source = 'manual' and t.source_ref like 'inc_' || e.id || '_%' and t.kind = 'income'
     and date_trunc('month', t.date) = date_trunc('month', p_month);
  perform set_config('airton.reclass', 'off', true);
  return n;
end $$;

create or replace function airton._tx_before() returns trigger language plpgsql set search_path to '' as $$
declare emp airton.employments; v_base numeric; v_amt numeric; v_ev text;
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

create or replace function airton._tx_after_employer() returns trigger language plpgsql set search_path to '' as $$
declare emp airton.employments;
begin
  if coalesce(current_setting('airton.reclass', true), 'off') = 'on' then return null; end if;
  if new.amount > 0 and new.source <> 'manual' and not airton._is_invest_account(new.account_id) then
    emp := airton._employment_for(new.user_id, new.date, new.description);
    if emp.id is not null then perform airton.reclass_employer_month(new.user_id, emp.id, new.date); end if;
  end if;
  return null;
end $$;

do $$
declare v_user uuid := '69706b26-5f72-4dfd-9d81-8ecb8157086c'; v_tr text; v_inv text; r record;
begin
  select id into v_tr from airton.categories where user_id = v_user and parent_id is null and nature = 'transferencia' order by sort limit 1;
  perform set_config('airton.reclass', 'on', true);
  -- cópias na conta de investimento voltam a ser movimentação interna
  update airton.transactions t set kind = 'transfer', category_id = v_tr, cat_source = 'structural', cat_confidence = 1, reviewed = true, planned_event_id = null
   where t.user_id = v_user and airton._is_invest_account(t.account_id) and t.kind = 'income'
     and exists (select 1 from airton.categories c where c.id = t.category_id and c.income_type in ('salario','plr','extra'));
  perform set_config('airton.reclass', 'off', true);
  for r in select id from airton.employments where user_id = v_user and employer = 'XP' order by start_date loop
    perform airton.apply_employment(r.id);
  end loop;
end $$;;
