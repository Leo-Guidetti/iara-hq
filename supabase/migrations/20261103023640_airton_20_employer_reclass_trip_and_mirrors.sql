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
    from airton.transactions t
   where t.user_id = p_user and t.amount > 0 and t.source <> 'manual'
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
  -- salário estimado à mão deixa de contar quando o banco mostra crédito do empregador no mês
  update airton.transactions t set kind = 'transfer', category_id = v_tr, notes = 'Estimativa substituída pelo crédito real do banco'
   where t.user_id = p_user and t.source = 'manual' and t.source_ref like 'inc_' || e.id || '_%' and t.kind = 'income'
     and date_trunc('month', t.date) = date_trunc('month', p_month);
  perform set_config('airton.reclass', 'off', true);
  return n;
end $$;

create or replace function airton._tx_before() returns trigger language plpgsql set search_path to '' as $$
declare emp airton.employments; v_base numeric; v_amt numeric; v_ev text;
begin
  if new.amount > 0 and coalesce(new.cat_source, '') <> 'manual' and coalesce(current_setting('airton.reclass', true), 'off') <> 'on' then
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
  if new.amount > 0 and new.source <> 'manual' then
    emp := airton._employment_for(new.user_id, new.date, new.description);
    if emp.id is not null then perform airton.reclass_employer_month(new.user_id, emp.id, new.date); end if;
  end if;
  return null;
end $$;
create trigger tx_c_after_employer after insert or update of category_id, amount, date on airton.transactions
  for each row execute function airton._tx_after_employer();

create or replace function airton.apply_employment(p_emp text)
returns int language plpgsql set search_path to '' as $$
declare e airton.employments; m date; n int := 0;
begin
  select * into e from airton.employments where id = p_emp;
  if not found then return 0; end if;
  for m in select distinct date_trunc('month', t.date)::date from airton.transactions t
            where t.user_id = e.user_id and t.amount > 0 and t.source <> 'manual'
              and t.date >= e.start_date - 10 and (e.end_date is null or t.date <= e.end_date + 45)
              and exists (select 1 from unnest(e.payer_terms) x where length(btrim(x)) >= 3 and t.description ilike '%' || btrim(x) || '%')
            order by 1 loop
    n := n + coalesce(airton.reclass_employer_month(e.user_id, e.id, m), 0) + 1;
  end loop;
  perform airton.match_event(id) from airton.planned_events where user_id = e.user_id and amount > 0;
  return n;
end $$;

-- conta de investimento XP espelha os lançamentos da conta corrente: não grava a cópia
create or replace function airton._tx_skip_mirror() returns trigger language plpgsql set search_path to '' as $$
begin
  if new.source = 'openfinance'
     and exists (select 1 from airton.accounts a where a.id = new.account_id and a.type like 'investment%')
     and exists (select 1 from airton.transactions x join airton.accounts b on b.id = x.account_id
                  where x.user_id = new.user_id and b.type not like 'investment%' and x.date = new.date and x.amount = new.amount
                    and lower(btrim(x.description)) = lower(btrim(new.description))) then
    return null;
  end if;
  return new;
end $$;
create trigger tx_0_skip_mirror before insert on airton.transactions for each row execute function airton._tx_skip_mirror();

do $$
declare v_user uuid := '69706b26-5f72-4dfd-9d81-8ecb8157086c'; v_tr text;
begin
  select id into v_tr from airton.categories where user_id = v_user and parent_id is null and nature = 'transferencia' order by sort limit 1;

  -- backup antes das mudanças
  insert into airton_private.tx_backup (reason, id, kind, category_id, cat_source, cat_confidence, reviewed)
  select 'reclass_2026-11-03', t.id, t.kind, t.category_id, t.cat_source, t.cat_confidence, t.reviewed
    from airton.transactions t
   where t.user_id = v_user and (t.description ~* '(XPI CORRETORA|XP INVESTIMENTOS CORRETORA|BANCO XP S|wise|planettaxfree)' or (t.amount > 0 and t.description ~* 'airbnb'));

  -- 1) a XP pagava salário e PLR por outras empresas do grupo até mar/26
  update airton.employments set payer_terms = array['TED recebida de BANCO XP', 'TED recebida de XPI CORRETORA', 'TED recebida de XP INVESTIMENTOS CORRETORA']
   where user_id = v_user and employer = 'XP';

  -- 2) viagem jul–set/26: recargas na Wise viram gasto de Viagem; tax free volta como reembolso
  update airton.transactions set category_id = 'cat_viagem', kind = 'expense', cat_source = 'manual', cat_confidence = 1, reviewed = true,
         notes = coalesce(notes, 'Recarga Wise para a viagem')
   where user_id = v_user and description ~* 'wise' and amount < 0 and date between '2026-07-01' and '2026-09-30';
  update airton.transactions set category_id = 'cat_viagem', kind = 'refund', cat_source = 'manual', cat_confidence = 1, reviewed = true
   where user_id = v_user and description ~* 'planettaxfree' and amount > 0;

  -- 3) crédito do valor cheio de compra parcelada no cartão (as parcelas já contam): neutraliza
  update airton.transactions p set kind = 'transfer', category_id = v_tr, cat_source = 'manual', reviewed = true,
         notes = 'Valor total de compra parcelada — as parcelas é que contam como gasto'
   where p.user_id = v_user and p.amount > 0 and p.installment_total is null
     and p.description !~* '(estorno|pagamento|cr[eé]dito de)'
     and exists (select 1 from airton.accounts a where a.id = p.account_id and a.type = 'credit')
     and exists (select 1 from airton.transactions q
                  where q.account_id = p.account_id and q.amount < 0 and q.description <> p.description
                    and btrim(regexp_replace(q.description, '\s*(\(\d+\s*de\s*\d+\)|\d+/\d+|- Parcela \d+/\d+)\s*$', '', 'i')) = btrim(p.description)
                    and q.date between p.date - 5 and p.date + 200
                    and abs(abs(q.amount) * coalesce((regexp_match(q.description, '(\d+)\s*de\s*(\d+)'))[2]::int, q.installment_total::int, 1) - p.amount) <= greatest(1, p.amount * 0.01));

  -- 4) PLR de fev/27 estimada pela de fev/26
  update airton.planned_events set amount = 42220.37, notes = 'Estimada pela PLR de fev/26 (R$ 42.220,37). Ajuste quando souber o valor.'
   where user_id = v_user and label = 'PLR 2º semestre 2026 (estimativa)';
end $$;;
