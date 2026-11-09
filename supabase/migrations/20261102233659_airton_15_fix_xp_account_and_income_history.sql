do $$
declare
  v_user uuid := '69706b26-5f72-4dfd-9d81-8ecb8157086c';
  v_acc text := 'acc_mot7m6zk_7f4sge';
  v_tr text; v_inv text; v_rend text;
  e1 text; e2 text; e3 text; e4 text; e5 text;
  TRUE_TRANSFER constant text := '(pagamento de fatura|pagto\.? ?fatura|pagamento para banco xp|pagamento para nu pagamentos|pix enviado para nu pagamentos|guidetti cost|conta invest|transfer[eê]ncia (enviada|recebida)|xp investimentos corre|xpi corretora|\mresgate\M|aplica[cç][aã]o|\mcdb\M|tesouro|wise brasil|mesma titularidade|entre contas|liquidacao credito xp)';
begin
  perform airton.seed_income(v_user);
  select id into v_tr from airton.categories where user_id = v_user and parent_id is null and nature = 'transferencia' order by sort limit 1;
  select id into v_inv from airton.categories where user_id = v_user and parent_id is null and nature = 'investimento' order by sort limit 1;
  v_inv := coalesce(v_inv, v_tr);
  select id into v_rend from airton.categories where user_id = v_user and nature = 'renda' and name ~* '^rendimento' limit 1;
  v_rend := coalesce(v_rend, airton._income_cat(v_user, 'outros'));

  -- 1) backup (reversível)
  insert into airton_private.tx_backup (reason, id, kind, category_id, cat_source, cat_confidence, reviewed, account_type)
  select 'conta_xp_corrente_2026-11-02', t.id, t.kind, t.category_id, t.cat_source, t.cat_confidence, t.reviewed, 'investment_onshore'
    from airton.transactions t where t.account_id = v_acc;

  -- 2) a conta é corrente, não investimento
  update airton.accounts set type = 'checking' where id = v_acc;

  -- 3) TEDs do empregador deixam de ser "decisão manual" para o vínculo classificar
  update airton.transactions set cat_source = null
   where user_id = v_user and description ilike 'TED recebida de BANCO XP%' and amount > 0;

  -- 4) reclassificação da conta corrente XP (só o que não foi decisão sua)
  update airton.transactions t set
      category_id = case when t.description ~* '(resgate|aplica[cç][aã]o|\mcdb\M|tesouro|xp investimentos corre|xpi corretora|conta invest)' then v_inv else v_tr end,
      kind = 'transfer', cat_source = 'structural', cat_confidence = 1, reviewed = true
   where t.account_id = v_acc and t.kind = 'transfer' and coalesce(t.cat_source, '') <> 'manual'
     and t.description ~* TRUE_TRANSFER;

  update airton.transactions t set category_id = v_rend, kind = 'income', cat_source = 'rule', cat_confidence = 1, reviewed = true
   where t.account_id = v_acc and t.kind = 'transfer' and coalesce(t.cat_source, '') <> 'manual' and t.description ~* '^rendimento';

  with h as (
    select airton.merchant_key(coalesce(merchant, description)) mk, category_id, count(*) n
      from airton.transactions where user_id = v_user and reviewed and category_id is not null and kind <> 'transfer'
       and account_id <> v_acc group by 1, 2
  ), best as (
    select distinct on (mk) mk, category_id, n::numeric / sum(n) over (partition by mk) share
      from h where length(mk) >= 4 order by mk, n desc
  )
  update airton.transactions t set
      category_id = b.category_id, kind = airton.kind_for(b.category_id, t.amount, case when t.amount < 0 then 'expense' else 'income' end),
      cat_source = 'history', cat_confidence = 0.8, reviewed = (t.date < airton.today() - 30)
    from best b
   where t.account_id = v_acc and t.kind = 'transfer' and coalesce(t.cat_source, '') not in ('manual', 'structural')
     and t.description !~* '^TED recebida de BANCO XP' and t.description !~* '^rendimento'
     and b.mk = airton.merchant_key(coalesce(t.merchant, t.description)) and b.share >= 0.6;

  update airton.transactions t set category_id = null, kind = case when t.amount < 0 then 'expense' else 'income' end,
      cat_source = null, cat_confidence = null, reviewed = false
   where t.account_id = v_acc and t.kind = 'transfer' and coalesce(t.cat_source, '') not in ('manual', 'structural')
     and t.description !~* '^TED recebida de BANCO XP';

  -- 5) histórico de empregos (bruto informado → líquido estimado: INSS + IRRF, sem dependentes)
  insert into airton.employments (user_id, employer, role, start_date, end_date, payer_terms, base_salary, gross_salary, plr_months, notes)
  values (v_user, 'Alice', null, '2024-03-01', '2024-06-30', '{}', 6399.58, 8500, '{}', 'Líquido estimado a partir de R$ 8.500 bruto (tabelas 2024)')
  returning id into e1;
  insert into airton.employments (user_id, employer, role, start_date, end_date, payer_terms, base_salary, gross_salary, plr_months, notes)
  values (v_user, 'XP', 'Analista Pleno P&A', '2024-07-01', '2026-03-31', '{"TED recebida de BANCO XP"}', 5463.74, 7000, '{2,3,8,9}', 'Bruto R$ 7.000; maior parte da remuneração nos bônus semestrais')
  returning id into e2;
  insert into airton.employments (user_id, employer, role, start_date, end_date, payer_terms, base_salary, gross_salary, plr_months, notes)
  values (v_user, 'XP', 'Analista Sênior P&A', '2026-04-01', '2026-05-31', '{"TED recebida de BANCO XP"}', 6717.36, 9000, '{2,3,8,9}', 'Bruto R$ 9.000')
  returning id into e3;
  insert into airton.employments (user_id, employer, role, start_date, end_date, payer_terms, base_salary, gross_salary, plr_months, notes)
  values (v_user, 'XP', 'Product Manager', '2026-06-01', '2026-09-30', '{"TED recebida de BANCO XP"}', 7442.36, 10000, '{2,3,8,9}', 'Bruto R$ 10.000')
  returning id into e4;
  insert into airton.employments (user_id, employer, role, start_date, end_date, payer_terms, base_salary, gross_salary, plr_months, notes)
  values (v_user, 'XP', 'Product Manager (reajuste +6%)', '2026-10-01', null, '{"TED recebida de BANCO XP"}', 7877.36, 10600, '{2,3,8,9}', 'Bruto R$ 10.600 (+6% desde out/26)')
  returning id into e5;

  -- 6) salário dos meses sem crédito no banco (registro manual, some se o banco mostrar)
  perform airton.register_salary(e1, '2024-03-01', '2024-06-01', 6399.58, 30, v_user);
  perform airton.register_salary(e2, '2024-07-01', '2024-12-01', 5391.86, 25, v_user);
  perform airton.register_salary(e2, '2025-01-01', '2025-04-01', 5398.54, 25, v_user);
  perform airton.register_salary(e2, '2025-05-01', '2025-12-01', 5411.27, 25, v_user);
  perform airton.register_salary(e2, '2026-01-01', '2026-03-01', 5463.74, 25, v_user);
  perform airton.register_salary(e3, '2026-04-01', '2026-05-01', 6717.36, 25, v_user);
  perform airton.register_salary(e4, '2026-06-01', '2026-09-01', 7442.36, 25, v_user);
  perform airton.register_salary(e5, '2026-10-01', '2026-10-01', 7877.36, 25, v_user);
  update airton.accounts set archived = true where user_id = v_user and name = 'Renda registrada à mão';

  -- 7) salário de referência do "disponível"
  update airton.settings set value = jsonb_build_object('enabled', true, 'day', 25, 'amount', 7877.36)
   where user_id = v_user and key = 'salary';

  -- 8) PLR: evento passado (agosto/26) e próximo (fev/27, estimado pela última)
  update airton.planned_events set label = 'PLR 1º semestre 2026', income_type = 'plr', employment_id = e4,
         match_terms = 'TED recebida de BANCO XP'
   where user_id = v_user and label ilike 'Bônus%';
  insert into airton.planned_events (user_id, date, label, amount, income_type, employment_id, match_terms, notes)
  values (v_user, '2027-02-25', 'PLR 2º semestre 2026 (estimativa)', 33825.05, 'plr', e5, 'TED recebida de BANCO XP',
          'Estimada pela PLR de ago/26. Ajuste quando souber o valor.');
end $$;;
