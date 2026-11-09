alter table airton.categories add column if not exists income_type text
  check (income_type in ('salario','plr','extra','outros'));

create table if not exists airton.employments (
  id text primary key default airton.new_id('emp'),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  employer text not null,
  role text,
  start_date date not null,
  end_date date,
  payer_terms text[] not null default '{}',
  base_salary numeric,
  gross_salary numeric,
  plr_months smallint[] not null default '{}',
  variable_factor numeric not null default 1.8,
  notes text,
  created_at timestamptz not null default now()
);
alter table airton.employments enable row level security;
create policy owner_all on airton.employments for all to authenticated
  using ((user_id = (select auth.uid())) and (select airton.is_member()))
  with check ((user_id = (select auth.uid())) and (select airton.is_member()));
grant select, insert, update, delete on airton.employments to authenticated;
create index if not exists employments_user on airton.employments(user_id);

alter table airton.planned_events
  add column if not exists date_end date,
  add column if not exists match_terms text,
  add column if not exists auto_match boolean not null default true,
  add column if not exists income_type text check (income_type in ('salario','plr','extra','outros')),
  add column if not exists employment_id text references airton.employments(id) on delete set null,
  add column if not exists notes text;

alter table airton.transactions
  add column if not exists planned_event_id text references airton.planned_events(id) on delete set null,
  add column if not exists planned_manual boolean not null default false;
create index if not exists transactions_planned on airton.transactions(planned_event_id) where planned_event_id is not null;

create or replace function airton.seed_income(p_user uuid default null)
returns int language plpgsql set search_path to '' as $$
declare v_user uuid := airton._uid(p_user); v_top text; n int := 0;
begin
  select id into v_top from airton.categories where user_id = v_user and parent_id is null and nature = 'renda' order by sort limit 1;
  if v_top is null then return 0; end if;
  update airton.categories set income_type = 'outros' where user_id = v_user and nature = 'renda' and income_type is null and name ~* '^rendimento';
  if not exists (select 1 from airton.categories where user_id = v_user and income_type = 'salario') then
    insert into airton.categories (user_id, name, parent_id, color, nature, income_type, sort) values (v_user, 'Salário', v_top, '#22c55e', 'renda', 'salario', 1); n := n + 1; end if;
  if not exists (select 1 from airton.categories where user_id = v_user and income_type = 'plr') then
    insert into airton.categories (user_id, name, parent_id, color, nature, income_type, sort) values (v_user, 'PLR e bônus', v_top, '#22c55e', 'renda', 'plr', 2); n := n + 1; end if;
  if not exists (select 1 from airton.categories where user_id = v_user and income_type = 'extra') then
    insert into airton.categories (user_id, name, parent_id, color, nature, income_type, sort) values (v_user, '13º e férias', v_top, '#22c55e', 'renda', 'extra', 3); n := n + 1; end if;
  if not exists (select 1 from airton.categories where user_id = v_user and income_type = 'outros' and name ~* 'reembolso') then
    insert into airton.categories (user_id, name, parent_id, color, nature, income_type, sort) values (v_user, 'Reembolsos e outros', v_top, '#22c55e', 'renda', 'outros', 4); n := n + 1; end if;
  return n;
end $$;
grant execute on function airton.seed_income(uuid) to authenticated;

create or replace function airton._income_cat(p_user uuid, p_type text)
returns text language sql stable set search_path to '' as $$
  select id from airton.categories where user_id = p_user and income_type = p_type and not archived order by parent_id nulls last, sort limit 1
$$;

create or replace function airton._employment_for(p_user uuid, p_date date, p_desc text)
returns airton.employments language sql stable set search_path to '' as $$
  select e.* from airton.employments e
   where e.user_id = p_user
     and p_date >= e.start_date - 10 and (e.end_date is null or p_date <= e.end_date + 45)
     and exists (select 1 from unnest(e.payer_terms) t where length(btrim(t)) >= 3 and p_desc ilike '%' || btrim(t) || '%')
   order by e.start_date desc limit 1
$$;

create or replace function airton._employment_base(p_emp airton.employments, p_before date)
returns numeric language sql stable set search_path to '' as $$
  select coalesce(p_emp.base_salary, (
    select percentile_cont(0.5) within group (order by t.amount_brl)
      from airton.transactions t join airton.categories c on c.id = t.category_id
     where t.user_id = p_emp.user_id and c.income_type = 'salario' and t.kind = 'income'
       and t.date >= p_before - 365 and t.date < p_before
       and t.date >= p_emp.start_date - 10 and (p_emp.end_date is null or t.date <= p_emp.end_date + 45)))
$$;

create or replace function airton._ev_tx_ok(e airton.planned_events, p_date date, p_amount numeric, p_desc text, p_cat text)
returns boolean language plpgsql stable set search_path to '' as $$
declare v_terms boolean; v_cat boolean; v_itype text;
begin
  if p_amount is null or sign(p_amount) <> sign(e.amount) then return false; end if;
  v_terms := e.match_terms is not null and exists (
    select 1 from unnest(string_to_array(e.match_terms, ',')) t where length(btrim(t)) >= 3 and p_desc ilike '%' || btrim(t) || '%');
  v_cat := e.category_id is not null and p_cat is not null and (p_cat = e.category_id
           or exists (select 1 from airton.categories c where c.id = p_cat and c.parent_id = e.category_id));
  if e.date_end is not null then
    return p_date between e.date and e.date_end and (v_terms or v_cat);
  end if;
  if p_date not between e.date - 20 and e.date + 25 then return false; end if;
  if abs(p_amount) not between abs(e.amount) * 0.5 and abs(e.amount) * 1.6 then return false; end if;
  if v_terms or v_cat then return true; end if;
  if e.amount > 0 then
    select c.income_type into v_itype from airton.categories c where c.id = p_cat;
    return v_itype in ('plr','extra') and (e.income_type is null or e.income_type = v_itype);
  end if;
  return false;
end $$;

create or replace function airton.match_event(p_event text)
returns int language plpgsql set search_path to '' as $$
declare e airton.planned_events; n int := 0;
begin
  select * into e from airton.planned_events where id = p_event;
  if not found then return 0; end if;
  update airton.transactions set planned_event_id = null where planned_event_id = e.id and not planned_manual;
  if not e.auto_match then return 0; end if;
  if e.date_end is not null then
    update airton.transactions t set planned_event_id = e.id
     where t.user_id = e.user_id and t.planned_event_id is null and t.kind <> 'transfer'
       and t.date between e.date and e.date_end
       and airton._ev_tx_ok(e, t.date, t.amount_brl, t.description || ' ' || coalesce(t.merchant, ''), t.category_id);
    get diagnostics n = row_count;
  elsif not exists (select 1 from airton.transactions where planned_event_id = e.id) then
    update airton.transactions set planned_event_id = e.id where id = (
      select t.id from airton.transactions t
       where t.user_id = e.user_id and t.planned_event_id is null and t.kind <> 'transfer'
         and t.date between e.date - 20 and e.date + 25
         and airton._ev_tx_ok(e, t.date, t.amount_brl, t.description || ' ' || coalesce(t.merchant, ''), t.category_id)
       order by abs(t.date - e.date), abs(abs(t.amount_brl) - abs(e.amount)) limit 1);
    get diagnostics n = row_count;
  end if;
  return n;
end $$;
grant execute on function airton.match_event(text) to authenticated;

create or replace function airton._pe_after() returns trigger language plpgsql set search_path to '' as $$
begin perform airton.match_event(new.id); return null; end $$;
create trigger pe_match after insert or update of date, date_end, amount, match_terms, category_id, auto_match, income_type
  on airton.planned_events for each row execute function airton._pe_after();

create or replace function airton._tx_before() returns trigger language plpgsql set search_path to '' as $$
declare emp airton.employments; v_base numeric; v_amt numeric; v_ev text;
begin
  if new.amount > 0 and coalesce(new.cat_source, '') <> 'manual' then
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
create trigger tx_a_before before insert or update of kind, category_id, amount, description, date
  on airton.transactions for each row execute function airton._tx_before();

create or replace function airton._tx_after_income() returns trigger language plpgsql set search_path to '' as $$
begin
  if new.kind = 'income' and new.source <> 'manual'
     and exists (select 1 from airton.categories c where c.id = new.category_id and c.income_type = 'salario') then
    delete from airton.transactions t
     where t.user_id = new.user_id and t.source = 'manual' and t.source_ref like 'inc_%'
       and date_trunc('month', t.date) = date_trunc('month', new.date)
       and t.category_id = new.category_id;
  end if;
  return null;
end $$;
create trigger tx_b_after_income after insert or update of category_id on airton.transactions
  for each row execute function airton._tx_after_income();

create or replace function airton.apply_employment(p_emp text)
returns int language plpgsql set search_path to '' as $$
declare e airton.employments; n int;
begin
  select * into e from airton.employments where id = p_emp;
  if not found then return 0; end if;
  update airton.transactions t set description = t.description
   where t.user_id = e.user_id and t.amount > 0 and coalesce(t.cat_source, '') <> 'manual'
     and t.date >= e.start_date - 10 and (e.end_date is null or t.date <= e.end_date + 45)
     and exists (select 1 from unnest(e.payer_terms) x where length(btrim(x)) >= 3 and t.description ilike '%' || btrim(x) || '%');
  get diagnostics n = row_count;
  perform airton.match_event(id) from airton.planned_events where user_id = e.user_id and amount > 0;
  return n;
end $$;
grant execute on function airton.apply_employment(text) to authenticated;

create or replace function airton._emp_after() returns trigger language plpgsql set search_path to '' as $$
begin perform airton.apply_employment(new.id); return null; end $$;
create trigger emp_apply after insert or update of start_date, end_date, payer_terms, base_salary, variable_factor
  on airton.employments for each row execute function airton._emp_after();

create or replace function airton.register_salary(p_emp text, p_from date, p_to date, p_amount numeric, p_day int default 5, p_user uuid default null)
returns int language plpgsql set search_path to '' as $$
declare v_user uuid := airton._uid(p_user); e airton.employments; v_acc text; v_cat text; m date; n int := 0; d date;
begin
  select * into e from airton.employments where id = p_emp and user_id = v_user;
  if not found then raise exception 'vínculo não encontrado'; end if;
  select id into v_acc from airton.accounts where user_id = v_user and name = 'Renda registrada à mão' limit 1;
  if v_acc is null then
    insert into airton.accounts (user_id, name, institution, type) values (v_user, 'Renda registrada à mão', 'outros', 'checking') returning id into v_acc;
  end if;
  v_cat := airton._income_cat(v_user, 'salario');
  m := date_trunc('month', p_from)::date;
  while m <= p_to loop
    d := make_date(extract(year from m)::int, extract(month from m)::int, least(greatest(coalesce(p_day, 5), 1), extract(day from (m + interval '1 month - 1 day'))::int));
    if not exists (select 1 from airton.transactions t join airton.categories c on c.id = t.category_id
                    where t.user_id = v_user and c.income_type = 'salario' and t.source <> 'manual'
                      and date_trunc('month', t.date) = m) then
      insert into airton.transactions (user_id, account_id, date, amount, description, category_id, kind, source, source_ref, cat_source, cat_confidence, reviewed)
      values (v_user, v_acc, d, p_amount, 'Salário — ' || e.employer, v_cat, 'income', 'manual', 'inc_' || e.id || '_' || to_char(m, 'YYYYMM'), 'manual', 1, true)
      on conflict (user_id, source, source_ref) where source_ref is not null
      do update set amount = excluded.amount, date = excluded.date, description = excluded.description;
      n := n + 1;
    end if;
    m := (m + interval '1 month')::date;
  end loop;
  return n;
end $$;
grant execute on function airton.register_salary(text, date, date, numeric, int, uuid) to authenticated;

create or replace view airton.v_planned_events with (security_invoker = true) as
select e.*,
       coalesce(r.realized, 0) as realized, coalesce(r.n, 0)::int as n_tx, r.first_date, r.last_date,
       case when coalesce(r.n, 0) > 0 and (e.date_end is null or e.date_end < airton.today()) then 'realizado'
            when coalesce(r.n, 0) > 0 then 'em_andamento'
            when e.date_end is not null and airton.today() between e.date and e.date_end then 'em_andamento'
            when coalesce(e.date_end, e.date) < airton.today() - 25 then 'nao_ocorreu'
            when coalesce(e.date_end, e.date) < airton.today() then 'aguardando'
            else 'previsto' end as status
  from airton.planned_events e
  left join lateral (select sum(t.amount_brl) realized, count(*) n, min(t.date) first_date, max(t.date) last_date
                       from airton.transactions t where t.planned_event_id = e.id) r on true;
grant select on airton.v_planned_events to authenticated;

create or replace function airton.income_history(p_user uuid default null)
returns jsonb language sql stable set search_path to '' as $$
  with u as (select airton._uid(p_user) id),
  inc as (
    select t.date, t.amount_brl, c.income_type, t.description, t.source,
           (select e.id from airton.employments e where e.user_id = t.user_id
              and t.date >= e.start_date - 10 and (e.end_date is null or t.date <= e.end_date + 45)
            order by (exists (select 1 from unnest(e.payer_terms) x where length(btrim(x)) >= 3 and t.description ilike '%' || btrim(x) || '%')) desc,
                     e.start_date desc limit 1) emp
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
$$;
grant execute on function airton.income_history(uuid) to authenticated;

create or replace function airton.income_payers(p_user uuid default null)
returns jsonb language sql stable set search_path to '' as $$
  with u as (select airton._uid(p_user) id),
  c as (
    select btrim(regexp_replace(t.description, '[0-9./-]{4,}.*$', '')) payer, t.date, t.amount_brl
      from airton.transactions t, u
     where t.user_id = u.id and t.amount > 0 and t.date >= airton.today() - 730
       and t.description !~* '(resgate|rendimento|conta invest|fatura|estorno|cashback|aplica|\mcdb\M|corretora)'
       and not exists (select 1 from airton.employments e where e.user_id = u.id
                        and exists (select 1 from unnest(e.payer_terms) x where length(btrim(x)) >= 3 and t.description ilike '%' || btrim(x) || '%'))
  )
  select coalesce(jsonb_agg(jsonb_build_object('payer', payer, 'months', months, 'first', first, 'last', last, 'median', median) order by months desc), '[]'::jsonb)
    from (select payer, count(distinct date_trunc('month', date)) months, min(date) first, max(date) last,
                 round(percentile_cont(0.5) within group (order by amount_brl)::numeric, 2) median
            from c group by payer
          having count(distinct date_trunc('month', date)) >= 3 and percentile_cont(0.5) within group (order by amount_brl) >= 2500) s
$$;
grant execute on function airton.income_payers(uuid) to authenticated;

create table if not exists airton_private.tx_backup (
  backup_at timestamptz not null default now(), reason text, id text, kind text, category_id text, cat_source text, cat_confidence real, reviewed boolean, account_type text
);;
