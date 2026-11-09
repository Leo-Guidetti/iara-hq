


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "airton";


ALTER SCHEMA "airton" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "airton_private";


ALTER SCHEMA "airton_private" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "claudia";


ALTER SCHEMA "claudia" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "core";


ALTER SCHEMA "core" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "core_private";


ALTER SCHEMA "core_private" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "sabia";


ALTER SCHEMA "sabia" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "airton"."_emp_after"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin perform airton.apply_employment(new.id); return null; end $$;


ALTER FUNCTION "airton"."_emp_after"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."new_id"("prefix" "text") RETURNS "text"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  select prefix || '_' || replace(gen_random_uuid()::text, '-', '')
$$;


ALTER FUNCTION "airton"."new_id"("prefix" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "airton"."employments" (
    "id" "text" DEFAULT "airton"."new_id"('emp'::"text") NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "employer" "text" NOT NULL,
    "role" "text",
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "payer_terms" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "base_salary" numeric,
    "gross_salary" numeric,
    "plr_months" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    "variable_factor" numeric DEFAULT 1.8 NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "airton"."employments" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."_employment_base"("p_emp" "airton"."employments", "p_before" "date") RETURNS numeric
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select coalesce(p_emp.base_salary, (
    select percentile_cont(0.5) within group (order by t.amount_brl)
      from airton.transactions t join airton.categories c on c.id = t.category_id
     where t.user_id = p_emp.user_id and c.income_type = 'salario' and t.kind = 'income'
       and t.date >= p_before - 365 and t.date < p_before
       and t.date >= p_emp.start_date - 10 and (p_emp.end_date is null or t.date <= p_emp.end_date + 45)))
$$;


ALTER FUNCTION "airton"."_employment_base"("p_emp" "airton"."employments", "p_before" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."_employment_for"("p_user" "uuid", "p_date" "date", "p_desc" "text") RETURNS "airton"."employments"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select e.* from airton.employments e
   where e.user_id = p_user
     and p_date >= e.start_date - 10 and (e.end_date is null or p_date <= e.end_date + 45)
     and exists (select 1 from unnest(e.payer_terms) t where length(btrim(t)) >= 3 and p_desc ilike '%' || btrim(t) || '%')
   order by (p_date between e.start_date and coalesce(e.end_date, '9999-12-31')) desc, e.start_date desc limit 1
$$;


ALTER FUNCTION "airton"."_employment_for"("p_user" "uuid", "p_date" "date", "p_desc" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton"."planned_events" (
    "id" "text" DEFAULT "airton"."new_id"('evt'::"text") NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "date" "date" NOT NULL,
    "label" "text" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "category_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "date_end" "date",
    "match_terms" "text",
    "auto_match" boolean DEFAULT true NOT NULL,
    "income_type" "text",
    "employment_id" "text",
    "notes" "text",
    CONSTRAINT "planned_events_income_type_check" CHECK (("income_type" = ANY (ARRAY['salario'::"text", 'plr'::"text", 'extra'::"text", 'outros'::"text"])))
);


ALTER TABLE "airton"."planned_events" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."_ev_tx_ok"("e" "airton"."planned_events", "p_date" "date", "p_amount" numeric, "p_desc" "text", "p_cat" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "airton"."_ev_tx_ok"("e" "airton"."planned_events", "p_date" "date", "p_amount" numeric, "p_desc" "text", "p_cat" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."_family_match"("p_user" "uuid", "p_desc" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select exists (select 1 from airton.settings s, jsonb_array_elements_text(coalesce(s.value->'terms', '[]'::jsonb)) t
                  where s.user_id = p_user and s.key = 'family_help' and length(btrim(t)) >= 4 and p_desc ilike '%' || btrim(t) || '%')
$$;


ALTER FUNCTION "airton"."_family_match"("p_user" "uuid", "p_desc" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."_income_cat"("p_user" "uuid", "p_type" "text") RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select id from airton.categories where user_id = p_user and income_type = p_type and not archived order by parent_id nulls last, sort limit 1
$$;


ALTER FUNCTION "airton"."_income_cat"("p_user" "uuid", "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."_is_invest_account"("p_acc" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select coalesce((select type like 'investment%' from airton.accounts where id = p_acc), false)
$$;


ALTER FUNCTION "airton"."_is_invest_account"("p_acc" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."_pe_after"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin perform airton.match_event(new.id); return null; end $$;


ALTER FUNCTION "airton"."_pe_after"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."_tx_after_employer"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare emp airton.employments;
begin
  if coalesce(current_setting('airton.reclass', true), 'off') = 'on' then return null; end if;
  if new.amount > 0 and new.source <> 'manual' and not airton._is_invest_account(new.account_id) then
    emp := airton._employment_for(new.user_id, new.date, new.description);
    if emp.id is not null then perform airton.reclass_employer_month(new.user_id, emp.id, new.date); end if;
  end if;
  return null;
end $$;


ALTER FUNCTION "airton"."_tx_after_employer"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."_tx_after_income"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "airton"."_tx_after_income"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."_tx_before"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "airton"."_tx_before"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."_tx_skip_mirror"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "airton"."_tx_skip_mirror"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."_uid"("p_user" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if auth.uid() is not null then
    if p_user is not null and p_user <> auth.uid() then raise exception 'forbidden'; end if;
    if not exists (select 1 from airton.members where user_id = auth.uid()) then raise exception 'not a member'; end if;
    return auth.uid();
  end if;
  if p_user is null then raise exception 'user required'; end if;
  return p_user;
end $$;


ALTER FUNCTION "airton"."_uid"("p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."apply_employment"("p_emp" "text") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "airton"."apply_employment"("p_emp" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."asset_class"("p_produto" "text", "p_estrategia" "text", "p_tipo" "text", "p_classe_info" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
  select case
    when p_classe_info in ('Caixa/Liquidez','Renda Fixa Pós','Renda Fixa Inflação','Renda Fixa Pré','Crédito Privado','Multimercado','Cambial/Ouro','Ações BR','FIIs','Ações Globais','ETFs Globais','Cripto','Outros') then p_classe_info
    when p_tipo = 'Saldo em conta' or p_estrategia = 'Caixa' or p_produto ~* '(24 horas|trend cash|\mbil\M)' then 'Caixa/Liquidez'
    when p_produto ~* '(bitcoin|btc|ethereum|cripto|hashdex)' or p_classe_info = 'Cripto' then 'Cripto'
    when p_produto ~* '(ouro|gold|d[oó]lar|cambial)' or p_classe_info = 'Cambial/Ouro' then 'Cambial/Ouro'
    when p_estrategia = 'Investimentos Offshore' and p_tipo = 'ETF' then 'ETFs Globais'
    when p_estrategia in ('Investimentos Offshore','Renda Variável Global') or p_classe_info = 'Ações Globais' then 'Ações Globais'
    when p_produto ~ '^[A-Z]{4}11$' and p_produto !~ '^(IGTI|ENGI|TAEE|SANB|KLBN|ALUP|BPAC|SAPR|TIET|CPLE)11$' then 'FIIs'
    when p_estrategia = 'Renda Variável Brasil' or p_classe_info = 'Ações BR' then 'Ações BR'
    when p_estrategia = 'Multimercado' or p_classe_info = 'Multimercado' then 'Multimercado'
    when p_produto ~* '(\mcra\M|\mcri\M|deb[eê]nture|cr[eé]dito|credit|fidc)' then 'Crédito Privado'
    when p_estrategia = 'Inflação' or p_produto ~* '(ipca|ntn-b)' then 'Renda Fixa Inflação'
    when p_estrategia = 'Pré Fixado' or p_produto ~* '(prefixad|ltn|ntn-f)' then 'Renda Fixa Pré'
    when p_estrategia = 'Pós Fixado' or p_classe_info = 'Renda Fixa' then 'Renda Fixa Pós'
    else 'Outros' end
$_$;


ALTER FUNCTION "airton"."asset_class"("p_produto" "text", "p_estrategia" "text", "p_tipo" "text", "p_classe_info" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."confirm"("p_ids" "text"[]) RETURNS integer
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  with u as (
    update airton.transactions set reviewed = true,
           cat_source = case when category_id is not null then 'manual' else cat_source end
     where user_id = airton._uid(null) and id = any(p_ids) returning 1)
  select count(*)::int from u
$$;


ALTER FUNCTION "airton"."confirm"("p_ids" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."income_history"("p_user" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "airton"."income_history"("p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."income_payers"("p_user" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $_$
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
$_$;


ALTER FUNCTION "airton"."income_payers"("p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."is_member"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (select 1 from airton.members m where m.user_id = auth.uid())
$$;


ALTER FUNCTION "airton"."is_member"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."kind_for"("p_category" "text", "p_amount" numeric, "p_current" "text") RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "airton"."kind_for"("p_category" "text", "p_amount" numeric, "p_current" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."kv_get"("p_key" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select value from airton_private.kv where key = p_key
$$;


ALTER FUNCTION "airton"."kv_get"("p_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."kv_set"("p_key" "text", "p_value" "jsonb") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  insert into airton_private.kv (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now()
$$;


ALTER FUNCTION "airton"."kv_set"("p_key" "text", "p_value" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."match_event"("p_event" "text") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "airton"."match_event"("p_event" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."merchant_key"("d" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select array_to_string((array(
    select w from unnest(regexp_split_to_array(
      regexp_replace(lower(translate(coalesce(d, ''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')),
                     '[^a-z]+', ' ', 'g'), '\s+')) w
     where length(w) >= 3 and w not in ('pix','enviado','enviada','recebido','recebida','para','pagamento','compra','parcela','ted','doc',
                                        'transferencia','sao','paulo','nupay','ltda','com','bra','dos','das','www','http','https')
     limit 3)), ' ')
$$;


ALTER FUNCTION "airton"."merchant_key"("d" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."month_plan"("p_month" "date" DEFAULT NULL::"date", "p_user" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
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
end $$;


ALTER FUNCTION "airton"."month_plan"("p_month" "date", "p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."reclass_employer_month"("p_user" "uuid", "p_emp" "text", "p_month" "date") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "airton"."reclass_employer_month"("p_user" "uuid", "p_emp" "text", "p_month" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."register_salary"("p_emp" "text", "p_from" "date", "p_to" "date", "p_amount" numeric, "p_day" integer DEFAULT 5, "p_user" "uuid" DEFAULT NULL::"uuid") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "airton"."register_salary"("p_emp" "text", "p_from" "date", "p_to" "date", "p_amount" numeric, "p_day" integer, "p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."review_counts"("p_user" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object(
    'pending', count(*) filter (where category_id is null or (cat_source = 'ai' and coalesce(cat_confidence, 0) < 0.7)),
    'uncategorized', count(*) filter (where category_id is null),
    'unconfirmed', count(*))
  from airton.transactions
  where user_id = airton._uid(p_user) and not reviewed and kind <> 'transfer'
    and date >= airton.today() - 30 and date <= airton.today()
$$;


ALTER FUNCTION "airton"."review_counts"("p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."seed_defaults"() RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare v_user uuid := airton._uid(null); n int;
begin
  if exists (select 1 from airton.categories where user_id = v_user) then return 0; end if;
  insert into airton.categories (id, user_id, name, parent_id, icon, color, nature, sort) values
    ('cat_renda', v_user, 'Renda', null, 'wallet', '#22c55e', 'renda', 1),
    ('cat_moradia', v_user, 'Moradia', null, 'home', '#3b82f6', 'fixo', 2),
    ('cat_alimentacao', v_user, 'Alimentação', null, 'utensils', '#f59e0b', 'variavel', 3),
    ('cat_transporte', v_user, 'Transporte', null, 'car', '#8b5cf6', 'variavel', 4),
    ('cat_saude', v_user, 'Saúde', null, 'heart-pulse', '#ef4444', 'variavel', 5),
    ('cat_assinaturas', v_user, 'Assinaturas', null, 'repeat', '#a855f7', 'fixo', 6),
    ('cat_lazer', v_user, 'Lazer', null, 'gamepad-2', '#ec4899', 'eventual', 7),
    ('cat_compras', v_user, 'Compras', null, 'shopping-bag', '#f97316', 'eventual', 8),
    ('cat_viagem', v_user, 'Viagem', null, 'plane', '#0ea5e9', 'eventual', 9),
    ('cat_educacao', v_user, 'Educação', null, 'graduation-cap', '#06b6d4', 'fixo', 10),
    ('cat_tarifas', v_user, 'Tarifas e impostos', null, 'receipt', '#737373', 'variavel', 11),
    ('cat_outros', v_user, 'Outros', null, 'circle', '#737373', 'variavel', 12),
    ('cat_investimentos', v_user, 'Investimentos', null, 'trending-up', '#10b981', 'investimento', 13),
    ('cat_transferencias', v_user, 'Transferências', null, 'arrow-left-right', '#737373', 'transferencia', 14);
  get diagnostics n = row_count;
  insert into airton.settings (user_id, key, value) values
    (v_user, 'savings_target', '{"pct": 0.2}'),
    (v_user, 'notify', '{"dailyEnabled": true, "dailyTime": "22:00", "weeklyEnabled": true, "weeklyDow": 0, "weeklyTime": "19:00"}')
  on conflict do nothing;
  return n;
end $$;


ALTER FUNCTION "airton"."seed_defaults"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."seed_income"("p_user" "uuid" DEFAULT NULL::"uuid") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "airton"."seed_income"("p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."set_category"("p_ids" "text"[], "p_category" "text", "p_learn" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "airton"."set_category"("p_ids" "text"[], "p_category" "text", "p_learn" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."set_kind"("p_ids" "text"[], "p_kind" "text") RETURNS integer
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  with u as (
    update airton.transactions set kind = p_kind, reviewed = true
     where user_id = airton._uid(null) and id = any(p_ids) returning 1)
  select count(*)::int from u
$$;


ALTER FUNCTION "airton"."set_kind"("p_ids" "text"[], "p_kind" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."today"() RETURNS "date"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$ select (now() at time zone 'America/Sao_Paulo')::date $$;


ALTER FUNCTION "airton"."today"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin new.updated_at := now(); return new; end $$;


ALTER FUNCTION "airton"."touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."week_summary"("p_date" "date" DEFAULT NULL::"date", "p_user" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "airton"."week_summary"("p_date" "date", "p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."year_series"("p_year" integer DEFAULT NULL::integer, "p_user" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "airton"."year_series"("p_year" integer, "p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton"."year_summary"("p_user" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
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
end $$;


ALTER FUNCTION "airton"."year_summary"("p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "airton_private"."call_function"("fn" "text", "body" "jsonb" DEFAULT '{}'::"jsonb") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_secret text := (select value #>> '{}' from airton_private.kv where key = 'cron_secret');
begin
  return net.http_post(
    url := 'https://wrtrhdrohabspbaxpbeu.supabase.co/functions/v1/' || fn,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-airton-cron', v_secret),
    body := body,
    timeout_milliseconds := 150000);
end $$;


ALTER FUNCTION "airton_private"."call_function"("fn" "text", "body" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "core"."briefing_airton"("p_user" "uuid", "p_data" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return jsonb_build_object(
    'disponivel_hoje', null,
    'eventos_7d', coalesce((
      select jsonb_agg(jsonb_build_object('data', e.date, 'descricao', e.label, 'valor', e.amount) order by e.date)
      from airton.planned_events e where e.user_id = p_user and e.date between p_data and p_data + 7), '[]'::jsonb),
    'metas', coalesce((
      select jsonb_agg(jsonb_build_object('meta', g.name, 'alvo', g.target_amount, 'atual', g.current_amount, 'prazo', g.target_date))
      from airton.goals g where g.user_id = p_user), '[]'::jsonb));
end $$;


ALTER FUNCTION "core"."briefing_airton"("p_user" "uuid", "p_data" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "core"."briefing_casa"("p_user" "uuid", "p_data" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare v jsonb;
begin
  if to_regclass('casa.chores') is null then
    return jsonb_build_object('status', 'schema casa ainda não migrado');
  end if;
  execute $q$ select coalesce(jsonb_agg(jsonb_build_object('tarefa', c.title, 'ultima_vez', c.last_done)), '[]'::jsonb)
    from casa.chores c where c.user_id = $1 and (c.last_done is null or c.last_done + c.every_days <= $2) $q$
  into v using p_user, p_data;
  return jsonb_build_object('tarefas_vencidas', v);
end $_$;


ALTER FUNCTION "core"."briefing_casa"("p_user" "uuid", "p_data" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "core"."briefing_claudia"("p_user" "uuid", "p_data" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return jsonb_build_object(
    'treinos_hoje', coalesce((
      select jsonb_agg(jsonb_build_object('titulo', s.title, 'esporte', s.sport, 'intensidade', s.intensity,
               'duracao_min', s.duration_min, 'distancia_km', s.distance_km, 'status', s.status) order by s.id)
      from public.plan_sessions s where s.user_id = p_user and s.local_date = p_data), '[]'::jsonb),
    'treinou_ontem', exists (select 1 from public.workout_logs w where w.user_id = p_user and w.local_date = p_data - 1));
end $$;


ALTER FUNCTION "core"."briefing_claudia"("p_user" "uuid", "p_data" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "core"."coletar_briefings"("p_user" "uuid", "p_data" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare a record; v jsonb; saida jsonb := '[]'::jsonb;
begin
  for a in select slug, nome, briefing_fn from core.agents where ativo and briefing_fn is not null order by ordem loop
    begin
      execute format('select %s($1, $2)', a.briefing_fn) into v using p_user, p_data;
      saida := saida || jsonb_build_object('agent', a.slug, 'nome', a.nome, 'ok', true, 'dados', coalesce(v, '{}'::jsonb));
    exception when others then
      saida := saida || jsonb_build_object('agent', a.slug, 'nome', a.nome, 'ok', false, 'erro', sqlerrm);
    end;
  end loop;
  return saida;
end $_$;


ALTER FUNCTION "core"."coletar_briefings"("p_user" "uuid", "p_data" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "core"."tg_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin new.updated_at := now(); return new; end $$;


ALTER FUNCTION "core"."tg_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "core_private"."call_function"("fn" "text", "body" "jsonb" DEFAULT '{}'::"jsonb") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_secret text := (select value #>> '{}' from core_private.kv where key = 'cron_secret');
begin
  return net.http_post(
    url := 'https://wrtrhdrohabspbaxpbeu.supabase.co/functions/v1/' || fn,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-iara-cron', v_secret),
    body := body, timeout_milliseconds := 150000);
end $$;


ALTER FUNCTION "core_private"."call_function"("fn" "text", "body" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."enforce_signup_allowlist"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not exists (select 1 from private.allowed_emails a where a.email = lower(new.email)) then
    raise exception 'signup not allowed';
  end if;
  return new;
end $$;


ALTER FUNCTION "private"."enforce_signup_allowlist"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claudia_ai_cost"("p_months" integer DEFAULT 3) RETURNS TABLE("mes" "date", "feature" "text", "model" "text", "chamadas" bigint, "input_tokens" bigint, "cache_read_tokens" bigint, "output_tokens" bigint, "custo_usd" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select date_trunc('month', u.at at time zone 'America/Sao_Paulo')::date, u.feature, u.model, count(*),
         sum(u.input_tokens), sum(u.cache_read_tokens), sum(u.output_tokens), round(sum(u.cost_usd), 4)
  from claudia.ai_usage u
  where u.user_id = (select auth.uid())
    and u.at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') - make_interval(months => greatest(0, least(p_months, 24)) - 1)
  group by 1, 2, 3
  order by 1 desc, 8 desc;
$$;


ALTER FUNCTION "public"."claudia_ai_cost"("p_months" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claudia_is_member"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (select 1 from claudia.members m where m.user_id = (select auth.uid()));
$$;


ALTER FUNCTION "public"."claudia_is_member"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_ingest_token"("p_label" "text" DEFAULT 'iPhone'::"text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  uid uuid := auth.uid();
  tok text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  tok := 'cla_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.ingest_tokens (user_id, token_hash, label)
  values (uid, encode(sha256(convert_to(tok, 'UTF8')), 'hex'), coalesce(nullif(p_label, ''), 'iPhone'));
  return tok;
end $$;


ALTER FUNCTION "public"."create_ingest_token"("p_label" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_health"("p_token" "text", "p_activities" "jsonb" DEFAULT '[]'::"jsonb", "p_daily" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  uid uuid; tid bigint; a jsonb; d jsonb; n_act int := 0; n_day int := 0; sp text;
begin
  select t.user_id, t.id into uid, tid from public.ingest_tokens t
  where t.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and t.revoked_at is null;
  if uid is null then raise exception 'invalid token' using errcode = '28000'; end if;
  if jsonb_array_length(coalesce(p_activities, '[]')) > 200 or jsonb_array_length(coalesce(p_daily, '[]')) > 400 then
    raise exception 'batch too large' using errcode = '22003';
  end if;
  update public.ingest_tokens set last_used_at = now() where id = tid;

  for a in select * from jsonb_array_elements(coalesce(p_activities, '[]')) loop
    sp := a ->> 'sport';
    if sp is null or sp not in ('run', 'walk', 'hike', 'swim', 'ride_indoor', 'ride_outdoor', 'strength', 'hiit', 'yoga', 'mobility', 'row', 'other') then sp := 'other'; end if;
    if (a ->> 'duration_min')::numeric is null or (a ->> 'duration_min')::numeric <= 0 or (a ->> 'started_at') is null then continue; end if;
    insert into public.activities (user_id, started_at, sport, title, duration_min, distance_km, elevation_m, avg_hr, max_hr,
                                   avg_power_w, avg_cadence, kcal, source, external_id, details)
    values (uid, (a ->> 'started_at')::timestamptz, sp, left(a ->> 'title', 120),
            least((a ->> 'duration_min')::numeric, 1440), nullif(a ->> 'distance_km', '')::numeric,
            nullif(a ->> 'elevation_m', '')::numeric::int, nullif(a ->> 'avg_hr', '')::numeric::int, nullif(a ->> 'max_hr', '')::numeric::int,
            nullif(a ->> 'avg_power_w', '')::numeric::int, nullif(a ->> 'avg_cadence', '')::numeric::int,
            nullif(a ->> 'kcal', '')::numeric::int, 'apple_health', left(a ->> 'external_id', 200), coalesce(a -> 'details', '{}'))
    on conflict (user_id, source, external_id) where external_id is not null do update set
      sport = excluded.sport, title = excluded.title, duration_min = excluded.duration_min, distance_km = excluded.distance_km,
      elevation_m = excluded.elevation_m, avg_hr = excluded.avg_hr, max_hr = excluded.max_hr, avg_power_w = excluded.avg_power_w,
      avg_cadence = excluded.avg_cadence, kcal = excluded.kcal, details = excluded.details;
    n_act := n_act + 1;
  end loop;

  for d in select * from jsonb_array_elements(coalesce(p_daily, '[]')) loop
    if (d ->> 'local_date') is null then continue; end if;
    insert into public.daily_activity (user_id, local_date, steps, active_kcal, resting_kcal, exercise_min, sleep_min, resting_hr, hrv_ms, source, updated_at)
    values (uid, (d ->> 'local_date')::date, nullif(d ->> 'steps', '')::numeric::int, nullif(d ->> 'active_kcal', '')::numeric::int,
            nullif(d ->> 'resting_kcal', '')::numeric::int, nullif(d ->> 'exercise_min', '')::numeric::int, nullif(d ->> 'sleep_min', '')::numeric::int,
            nullif(d ->> 'resting_hr', '')::numeric::int, nullif(d ->> 'hrv_ms', '')::numeric, 'apple_health', now())
    on conflict (user_id, local_date) do update set
      steps = coalesce(excluded.steps, public.daily_activity.steps),
      active_kcal = coalesce(excluded.active_kcal, public.daily_activity.active_kcal),
      resting_kcal = coalesce(excluded.resting_kcal, public.daily_activity.resting_kcal),
      exercise_min = coalesce(excluded.exercise_min, public.daily_activity.exercise_min),
      sleep_min = coalesce(excluded.sleep_min, public.daily_activity.sleep_min),
      resting_hr = coalesce(excluded.resting_hr, public.daily_activity.resting_hr),
      hrv_ms = coalesce(excluded.hrv_ms, public.daily_activity.hrv_ms),
      updated_at = now();
    n_day := n_day + 1;
  end loop;
  return jsonb_build_object('activities', n_act, 'days', n_day);
end $$;


ALTER FUNCTION "public"."ingest_health"("p_token" "text", "p_activities" "jsonb", "p_daily" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_weight"("p_token" "text", "p_weight_kg" numeric, "p_measured_at" timestamp with time zone DEFAULT "now"(), "p_source" "text" DEFAULT 'shortcut'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  uid uuid;
  tid bigint;
  existing bigint;
  new_id bigint;
  ld date;
begin
  select t.user_id, t.id into uid, tid
  from public.ingest_tokens t
  where t.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and t.revoked_at is null;
  if uid is null then raise exception 'invalid token' using errcode = '28000'; end if;

  if p_weight_kg is null or p_weight_kg < 30 or p_weight_kg > 300 then
    raise exception 'weight out of range' using errcode = '22003';
  end if;

  update public.ingest_tokens set last_used_at = now() where id = tid;

  select e.id into existing from public.weight_entries e
  where e.user_id = uid
    and e.weight_kg = round(p_weight_kg, 2)
    and e.measured_at between p_measured_at - interval '2 minutes' and p_measured_at + interval '2 minutes'
  limit 1;
  if existing is not null then
    return jsonb_build_object('id', existing, 'duplicate', true);
  end if;

  insert into public.weight_entries (user_id, measured_at, weight_kg, source)
  values (uid, coalesce(p_measured_at, now()), round(p_weight_kg, 2),
          case when p_source in ('shortcut', 'apple_health') then p_source else 'shortcut' end)
  returning id, local_date into new_id, ld;

  return jsonb_build_object('id', new_id, 'local_date', ld, 'duplicate', false);
end $$;


ALTER FUNCTION "public"."ingest_weight"("p_token" "text", "p_weight_kg" numeric, "p_measured_at" timestamp with time zone, "p_source" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_local_date"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  ts timestamptz := (to_jsonb(new) ->> tg_argv[0])::timestamptz;
  tz text;
begin
  select p.timezone into tz from public.profiles p where p.id = new.user_id;
  new.local_date := (ts at time zone coalesce(tz, 'America/Sao_Paulo'))::date;
  return new;
end $$;


ALTER FUNCTION "public"."set_local_date"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."strava_disconnect"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  delete from public.activities where user_id = auth.uid() and source = 'strava';
  delete from private.strava_tokens where user_id = auth.uid();
end $$;


ALTER FUNCTION "public"."strava_disconnect"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."strava_get_tokens"() RETURNS TABLE("athlete_id" bigint, "access_token" "text", "refresh_token" "text", "expires_at" timestamp with time zone, "last_sync_at" timestamp with time zone)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select t.athlete_id, t.access_token, t.refresh_token, t.expires_at, t.last_sync_at from private.strava_tokens t where t.user_id = auth.uid();
$$;


ALTER FUNCTION "public"."strava_get_tokens"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."strava_mark_synced"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  update private.strava_tokens set last_sync_at = now() where user_id = auth.uid();
$$;


ALTER FUNCTION "public"."strava_mark_synced"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."strava_save_tokens"("p_athlete_id" bigint, "p_athlete_name" "text", "p_access" "text", "p_refresh" "text", "p_expires_at" timestamp with time zone, "p_scope" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  delete from private.strava_tokens where athlete_id = p_athlete_id and user_id <> auth.uid();
  insert into private.strava_tokens (user_id, athlete_id, athlete_name, access_token, refresh_token, expires_at, scope)
  values (auth.uid(), p_athlete_id, left(p_athlete_name, 120), p_access, p_refresh, p_expires_at, p_scope)
  on conflict (user_id) do update set athlete_id = excluded.athlete_id, athlete_name = excluded.athlete_name,
    access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, scope = excluded.scope;
end $$;


ALTER FUNCTION "public"."strava_save_tokens"("p_athlete_id" bigint, "p_athlete_name" "text", "p_access" "text", "p_refresh" "text", "p_expires_at" timestamp with time zone, "p_scope" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."strava_status"() RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce((select jsonb_build_object('connected', true, 'athlete_id', t.athlete_id, 'athlete_name', t.athlete_name, 'last_sync_at', t.last_sync_at)
                   from private.strava_tokens t where t.user_id = auth.uid()), jsonb_build_object('connected', false));
$$;


ALTER FUNCTION "public"."strava_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."strava_update_tokens"("p_access" "text", "p_refresh" "text", "p_expires_at" timestamp with time zone) RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  update private.strava_tokens set access_token = p_access, refresh_token = p_refresh, expires_at = p_expires_at where user_id = auth.uid();
$$;


ALTER FUNCTION "public"."strava_update_tokens"("p_access" "text", "p_refresh" "text", "p_expires_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin new.updated_at := now(); return new; end $$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "sabia"."ajustar_pesos"("p_user" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare r record; v_total numeric;
begin
  for r in
    select t.slug, t.peso, t.peso_min, t.peso_max, count(i.id) as n,
           avg(case i.status when 'feito' then 1 when 'pulado' then 0 end) as taxa, avg(i.reacao) as reacao
    from sabia.temas t
    left join sabia.itens i on i.tema = t.slug and i.user_id = p_user and i.created_at > now() - interval '14 days'
    where t.ativo group by t.slug, t.peso, t.peso_min, t.peso_max
  loop
    if r.n >= 4 then
      update sabia.temas set peso = least(r.peso_max, greatest(r.peso_min,
          r.peso + 0.03 * sign(coalesce(r.taxa, 0.6) - 0.6 + coalesce(r.reacao, 0) * 0.5))) where slug = r.slug;
    end if;
  end loop;
  select sum(peso) into v_total from sabia.temas where ativo;
  update sabia.temas set peso = round(peso / v_total, 3) where ativo;
  with ord as (select slug, row_number() over (order by prioridade) as rk from sabia.temas where ativo),
       pes as (select peso, row_number() over (order by peso desc) as rk from sabia.temas where ativo)
  update sabia.temas t set peso = pes.peso from ord join pes using (rk) where t.slug = ord.slug;
  return (select jsonb_object_agg(slug, peso) from sabia.temas where ativo);
end $$;


ALTER FUNCTION "sabia"."ajustar_pesos"("p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "sabia"."briefing_hoje"("p_user" "uuid", "p_data" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_trilha jsonb; v_livro jsonb; v_seq int := 0; d date := p_data - 1;
begin
  select jsonb_build_object('tipo', t.tipo, 'minutos', t.minutos_total, 'resumo', t.resumo, 'status', t.status,
           'itens', coalesce((select jsonb_agg(jsonb_build_object('tema', i.tema, 'titulo', i.titulo, 'fonte', i.fonte,
               'formato', i.formato, 'minutos', i.minutos, 'status', i.status) order by i.ordem)
             from sabia.itens i where i.trilha_id = t.id), '[]'::jsonb))
  into v_trilha from sabia.trilhas t where t.user_id = p_user and t.data = p_data and t.tipo <> 'hobby'
  order by t.created_at desc limit 1;

  select jsonb_build_object('titulo', l.titulo, 'autor', l.autor, 'pagina_atual', l.pagina_atual, 'paginas', l.paginas,
           'ultima_leitura', (select max(r.data) from sabia.leituras r where r.livro_id = l.id))
  into v_livro from sabia.livros l where l.user_id = p_user and l.status = 'lendo' order by l.updated_at desc limit 1;

  while exists (select 1 from sabia.trilhas where user_id = p_user and data = d and status = 'concluida' and tipo <> 'hobby') loop
    v_seq := v_seq + 1; d := d - 1;
  end loop;
  return jsonb_build_object('trilha', v_trilha, 'livro_atual', v_livro, 'sequencia_dias', v_seq);
end $$;


ALTER FUNCTION "sabia"."briefing_hoje"("p_user" "uuid", "p_data" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "sabia"."tg_item_feito"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.status = 'feito' and old.status is distinct from 'feito' then new.feito_em := now(); end if;
  return new;
end $$;


ALTER FUNCTION "sabia"."tg_item_feito"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "sabia"."tg_leitura"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update sabia.livros l set
    pagina_atual = greatest(coalesce(l.pagina_atual, 0), coalesce(new.pagina_final, 0)),
    comecou_em = coalesce(l.comecou_em, new.data),
    status = case when l.paginas is not null and new.pagina_final >= l.paginas then 'lido'
                  when l.status in ('quero_ler','pausado') then 'lendo' else l.status end,
    terminou_em = case when l.paginas is not null and new.pagina_final >= l.paginas then new.data else l.terminou_em end
  where l.id = new.livro_id;
  return new;
end $$;


ALTER FUNCTION "sabia"."tg_leitura"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "sabia"."tg_status_trilha"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update sabia.trilhas t set status = case
      when not exists (select 1 from sabia.itens i where i.trilha_id = t.id and i.status = 'pendente') then 'concluida'
      when exists (select 1 from sabia.itens i where i.trilha_id = t.id and i.status <> 'pendente') then 'em_andamento'
      else 'gerada' end
  where t.id = new.trilha_id;
  return new;
end $$;


ALTER FUNCTION "sabia"."tg_status_trilha"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton"."accounts" (
    "id" "text" DEFAULT "airton"."new_id"('acc'::"text") NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "institution" "text" DEFAULT 'outros'::"text" NOT NULL,
    "type" "text" NOT NULL,
    "currency" "text" DEFAULT 'BRL'::"text" NOT NULL,
    "balance" numeric(14,2) DEFAULT 0 NOT NULL,
    "balance_at" timestamp with time zone,
    "credit_limit" numeric(14,2),
    "closing_day" smallint,
    "due_day" smallint,
    "last_four" "text",
    "pluggy_item_id" "text",
    "pluggy_account_id" "text",
    "archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "accounts_currency_check" CHECK (("currency" = ANY (ARRAY['BRL'::"text", 'USD'::"text"]))),
    CONSTRAINT "accounts_institution_check" CHECK (("institution" = ANY (ARRAY['xp'::"text", 'nubank'::"text", 'itau'::"text", 'outros'::"text"]))),
    CONSTRAINT "accounts_type_check" CHECK (("type" = ANY (ARRAY['checking'::"text", 'credit'::"text", 'investment_onshore'::"text", 'investment_offshore'::"text", 'cash'::"text"])))
);


ALTER TABLE "airton"."accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton"."ai_usage" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "feature" "text" NOT NULL,
    "model" "text" NOT NULL,
    "input_tokens" integer DEFAULT 0 NOT NULL,
    "output_tokens" integer DEFAULT 0 NOT NULL,
    "cost_usd" numeric(10,5) DEFAULT 0 NOT NULL,
    "provider" "text" DEFAULT 'anthropic'::"text" NOT NULL,
    "cache_read_tokens" integer DEFAULT 0 NOT NULL,
    "cache_write_tokens" integer DEFAULT 0 NOT NULL,
    "web_searches" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "airton"."ai_usage" OWNER TO "postgres";


ALTER TABLE "airton"."ai_usage" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "airton"."ai_usage_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "airton"."categories" (
    "id" "text" DEFAULT "airton"."new_id"('cat'::"text") NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "parent_id" "text",
    "icon" "text",
    "color" "text",
    "nature" "text" DEFAULT 'variavel'::"text" NOT NULL,
    "budget_monthly" numeric(14,2),
    "valid_from" "date",
    "sort" smallint DEFAULT 0 NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "income_type" "text",
    CONSTRAINT "categories_income_type_check" CHECK (("income_type" = ANY (ARRAY['salario'::"text", 'plr'::"text", 'extra'::"text", 'outros'::"text", 'familia'::"text"]))),
    CONSTRAINT "categories_nature_check" CHECK (("nature" = ANY (ARRAY['variavel'::"text", 'fixo'::"text", 'eventual'::"text", 'renda'::"text", 'transferencia'::"text", 'investimento'::"text"])))
);


ALTER TABLE "airton"."categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton"."chat_messages" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chat_messages_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text"])))
);


ALTER TABLE "airton"."chat_messages" OWNER TO "postgres";


ALTER TABLE "airton"."chat_messages" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "airton"."chat_messages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "airton"."goals" (
    "id" "text" DEFAULT "airton"."new_id"('goal'::"text") NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "target_amount" numeric(14,2) NOT NULL,
    "target_currency" "text" DEFAULT 'BRL'::"text" NOT NULL,
    "target_date" "date",
    "current_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "goals_target_currency_check" CHECK (("target_currency" = ANY (ARRAY['BRL'::"text", 'USD'::"text"])))
);


ALTER TABLE "airton"."goals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton"."installment_plans" (
    "id" "text" DEFAULT "airton"."new_id"('inst'::"text") NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "label" "text" NOT NULL,
    "category_id" "text",
    "total" smallint NOT NULL,
    "installment_amount" numeric(14,2) NOT NULL,
    "first_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "installment_plans_installment_amount_check" CHECK (("installment_amount" > (0)::numeric)),
    CONSTRAINT "installment_plans_total_check" CHECK (("total" > 0))
);


ALTER TABLE "airton"."installment_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton"."inv_alerts" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "ref_date" "date" NOT NULL,
    "ticker" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "severity" "text" DEFAULT 'media'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "pushed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "airton"."inv_alerts" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "airton"."inv_alerts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "airton"."inv_alerts_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "airton"."inv_alerts_id_seq" OWNED BY "airton"."inv_alerts"."id";



CREATE TABLE IF NOT EXISTS "airton"."inv_holdings" (
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "ticker" "text" NOT NULL,
    "name" "text",
    "classe" "text",
    "market" "text" NOT NULL,
    "currency" "text" DEFAULT 'BRL'::"text" NOT NULL,
    "quantity" numeric,
    "qty_source" "text" DEFAULT 'estimado'::"text" NOT NULL,
    "ref_value" numeric,
    "ref_date" "date",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inv_holdings_market_check" CHECK (("market" = ANY (ARRAY['B3'::"text", 'US'::"text"])))
);


ALTER TABLE "airton"."inv_holdings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton"."inv_movements" (
    "user_id" "uuid" NOT NULL,
    "pluggy_id" "text" NOT NULL,
    "investment_id" "text",
    "produto" "text",
    "date" "date" NOT NULL,
    "type" "text",
    "movement_type" "text",
    "amount" numeric,
    "raw" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "airton"."inv_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton"."inv_news" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "ticker" "text" NOT NULL,
    "published" "date",
    "kind" "text" DEFAULT 'noticia'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "summary" "text",
    "url" "text",
    "source" "text",
    "impact" "text" DEFAULT 'baixa'::"text" NOT NULL,
    "sentiment" "text" DEFAULT 'neutro'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "airton"."inv_news" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "airton"."inv_news_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "airton"."inv_news_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "airton"."inv_news_id_seq" OWNED BY "airton"."inv_news"."id";



CREATE TABLE IF NOT EXISTS "airton"."inv_of" (
    "user_id" "uuid" NOT NULL,
    "pluggy_id" "text" NOT NULL,
    "produto" "text",
    "raw" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "airton"."inv_of" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton"."inv_plan" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "content" "jsonb" NOT NULL,
    "context" "jsonb",
    "model" "text"
);


ALTER TABLE "airton"."inv_plan" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "airton"."inv_plan_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "airton"."inv_plan_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "airton"."inv_plan_id_seq" OWNED BY "airton"."inv_plan"."id";



CREATE TABLE IF NOT EXISTS "airton"."inv_position" (
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "mes" "text" NOT NULL,
    "produto" "text" NOT NULL,
    "estrategia" "text",
    "tipo" "text",
    "indexador" "text",
    "saldo" numeric(16,2),
    "aloc" numeric(8,4),
    "rent_mes" numeric(10,4),
    "moeda" "text" DEFAULT 'BRL'::"text" NOT NULL,
    "valor_orig" numeric(16,2),
    "manual" boolean DEFAULT false NOT NULL,
    CONSTRAINT "inv_position_mes_check" CHECK (("mes" ~ '^\d{4}-\d{2}$'::"text"))
);


ALTER TABLE "airton"."inv_position" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton"."inv_prices" (
    "ticker" "text" NOT NULL,
    "date" "date" NOT NULL,
    "close" numeric NOT NULL,
    "currency" "text"
);


ALTER TABLE "airton"."inv_prices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton"."inv_product_info" (
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "produto" "text" NOT NULL,
    "nome_curto" "text",
    "classe" "text",
    "gestora" "text",
    "descricao" "text",
    "risco" "text",
    "fonte" "text",
    "fonte_url" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "airton"."inv_product_info" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton"."inv_snapshot" (
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "mes" "text" NOT NULL,
    "ref" "text",
    "patrimonio" numeric(16,2),
    "source" "text" DEFAULT 'xlsx'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inv_snapshot_mes_check" CHECK (("mes" ~ '^\d{4}-\d{2}$'::"text"))
);


ALTER TABLE "airton"."inv_snapshot" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton"."members" (
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "airton"."members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton"."notify_log" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "local_date" "date" NOT NULL,
    "title" "text",
    "body" "text",
    "sent" integer DEFAULT 0 NOT NULL,
    "failed" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "airton"."notify_log" OWNER TO "postgres";


ALTER TABLE "airton"."notify_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "airton"."notify_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "airton"."of_items" (
    "id" "text" NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "connector_name" "text" DEFAULT 'Open Finance'::"text" NOT NULL,
    "status" "text",
    "execution_status" "text",
    "pluggy_updated_at" timestamp with time zone,
    "last_sync_at" timestamp with time zone,
    "last_error" "text",
    "sync_investments" boolean DEFAULT true NOT NULL,
    "cursors" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "airton"."of_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "label" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_ok_at" timestamp with time zone,
    "failures" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "airton"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton"."rules" (
    "id" "text" DEFAULT "airton"."new_id"('rule'::"text") NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "pattern" "text" NOT NULL,
    "category_id" "text" NOT NULL,
    "kind" "text",
    "priority" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rules_kind_check" CHECK (("kind" = ANY (ARRAY['expense'::"text", 'income'::"text", 'transfer'::"text", 'refund'::"text"])))
);


ALTER TABLE "airton"."rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton"."settings" (
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "key" "text" NOT NULL,
    "value" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "airton"."settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton"."sync_runs" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "kind" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "ok" boolean,
    "summary" "jsonb"
);


ALTER TABLE "airton"."sync_runs" OWNER TO "postgres";


ALTER TABLE "airton"."sync_runs" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "airton"."sync_runs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "airton"."transactions" (
    "id" "text" DEFAULT "airton"."new_id"('tx'::"text") NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "account_id" "text" NOT NULL,
    "date" "date" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "currency" "text" DEFAULT 'BRL'::"text" NOT NULL,
    "fx_rate_brl" numeric(12,6) DEFAULT 1 NOT NULL,
    "share_pct" numeric(5,4) DEFAULT 1 NOT NULL,
    "amount_brl" numeric(14,2) GENERATED ALWAYS AS ("round"((("amount" * "fx_rate_brl") * "share_pct"), 2)) STORED,
    "description" "text" NOT NULL,
    "merchant" "text",
    "category_id" "text",
    "kind" "text" DEFAULT 'expense'::"text" NOT NULL,
    "installment_n" smallint,
    "installment_total" smallint,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "source_ref" "text",
    "cat_source" "text",
    "cat_confidence" real,
    "reviewed" boolean DEFAULT false NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "of_ref" "text",
    "planned_event_id" "text",
    "planned_manual" boolean DEFAULT false NOT NULL,
    CONSTRAINT "transactions_cat_source_check" CHECK (("cat_source" = ANY (ARRAY['rule'::"text", 'history'::"text", 'ai'::"text", 'manual'::"text", 'structural'::"text"]))),
    CONSTRAINT "transactions_currency_check" CHECK (("currency" = ANY (ARRAY['BRL'::"text", 'USD'::"text"]))),
    CONSTRAINT "transactions_kind_check" CHECK (("kind" = ANY (ARRAY['expense'::"text", 'income'::"text", 'transfer'::"text", 'refund'::"text"]))),
    CONSTRAINT "transactions_share_pct_check" CHECK ((("share_pct" >= (0)::numeric) AND ("share_pct" <= (1)::numeric))),
    CONSTRAINT "transactions_source_check" CHECK (("source" = ANY (ARRAY['csv'::"text", 'ofx'::"text", 'pdf'::"text", 'ocr'::"text", 'manual'::"text", 'openfinance'::"text", 'import'::"text"])))
);


ALTER TABLE "airton"."transactions" OWNER TO "postgres";


CREATE OR REPLACE VIEW "airton"."v_ai_cost_month" WITH ("security_invoker"='true') AS
 SELECT ("date_trunc"('month'::"text", ("at" AT TIME ZONE 'America/Sao_Paulo'::"text")))::"date" AS "mes",
    "provider",
    "feature",
    "model",
    "count"(*) AS "chamadas",
    "sum"("input_tokens") AS "input_tokens",
    "sum"("cache_read_tokens") AS "cache_read_tokens",
    "sum"("cache_write_tokens") AS "cache_write_tokens",
    "sum"("output_tokens") AS "output_tokens",
    "sum"("web_searches") AS "buscas",
    "round"("sum"("cost_usd"), 4) AS "custo_usd"
   FROM "airton"."ai_usage"
  GROUP BY (("date_trunc"('month'::"text", ("at" AT TIME ZONE 'America/Sao_Paulo'::"text")))::"date"), "provider", "feature", "model";


ALTER VIEW "airton"."v_ai_cost_month" OWNER TO "postgres";


CREATE OR REPLACE VIEW "airton"."v_tx" WITH ("security_invoker"='true') AS
 SELECT "t"."id",
    "t"."user_id",
    "t"."account_id",
    "t"."date",
    "t"."amount",
    "t"."currency",
    "t"."fx_rate_brl",
    "t"."share_pct",
    "t"."amount_brl",
    "t"."description",
    "t"."merchant",
    "t"."category_id",
    "t"."kind",
    "t"."installment_n",
    "t"."installment_total",
    "t"."source",
    "t"."source_ref",
    "t"."cat_source",
    "t"."cat_confidence",
    "t"."reviewed",
    "t"."notes",
    "t"."created_at",
    "t"."updated_at",
    COALESCE("p"."id", "c"."id") AS "top_category_id",
    COALESCE("p"."name", "c"."name") AS "top_category_name",
    COALESCE("p"."color", "c"."color") AS "top_category_color",
    "c"."name" AS "category_name",
    COALESCE("p"."nature", "c"."nature",
        CASE "t"."kind"
            WHEN 'income'::"text" THEN 'renda'::"text"
            WHEN 'transfer'::"text" THEN 'transferencia'::"text"
            ELSE 'variavel'::"text"
        END) AS "nature",
    (COALESCE(("t"."installment_total")::integer, 0) > 1) AS "is_installment",
        CASE
            WHEN ("t"."kind" = ANY (ARRAY['expense'::"text", 'refund'::"text"])) THEN (- "t"."amount_brl")
            ELSE (0)::numeric
        END AS "spend",
    "t"."planned_event_id",
    "c"."income_type"
   FROM (("airton"."transactions" "t"
     LEFT JOIN "airton"."categories" "c" ON (("c"."id" = "t"."category_id")))
     LEFT JOIN "airton"."categories" "p" ON (("p"."id" = "c"."parent_id")));


ALTER VIEW "airton"."v_tx" OWNER TO "postgres";


CREATE OR REPLACE VIEW "airton"."v_installment_series" WITH ("security_invoker"='on') AS
 WITH "x" AS (
         SELECT "t"."user_id",
            "t"."account_id",
            "t"."top_category_id",
            "t"."installment_total" AS "total",
            "t"."installment_n" AS "n",
            "t"."date",
            "abs"("t"."amount_brl") AS "amount",
            "lower"(TRIM(BOTH FROM "regexp_replace"("t"."description", '\s*(parc(ela)?\.?\s*)?\d{1,2}\s*(/|de)\s*\d{1,2}\s*$'::"text", ''::"text", 'i'::"text"))) AS "base"
           FROM "airton"."v_tx" "t"
          WHERE ("t"."is_installment" AND ("t"."kind" = 'expense'::"text") AND ("t"."installment_n" IS NOT NULL))
        )
 SELECT DISTINCT ON ("user_id", "account_id", "base", "total", ("round"("amount"))) "user_id",
    "account_id",
    "base",
    "total",
    "n" AS "last_n",
    "date" AS "last_date",
    "amount",
    "top_category_id",
    "initcap"("base") AS "label"
   FROM "x"
  ORDER BY "user_id", "account_id", "base", "total", ("round"("amount")), "n" DESC, "date" DESC;


ALTER VIEW "airton"."v_installment_series" OWNER TO "postgres";


CREATE OR REPLACE VIEW "airton"."v_installment_schedule" WITH ("security_invoker"='on') AS
 SELECT "s"."user_id",
    "s"."label",
    "s"."top_category_id" AS "category_id",
    "k"."k" AS "n",
    "s"."total",
    (("s"."last_date" + "make_interval"("months" => ("k"."k" - "s"."last_n"))))::"date" AS "date",
    "s"."amount",
    'auto'::"text" AS "origin"
   FROM ("airton"."v_installment_series" "s"
     CROSS JOIN LATERAL "generate_series"(("s"."last_n" + 1), ("s"."total")::integer) "k"("k"))
  WHERE ("s"."last_n" < "s"."total")
UNION ALL
 SELECT "p"."user_id",
    "p"."label",
    "p"."category_id",
    ("k"."k" + 1) AS "n",
    "p"."total",
    (("p"."first_date" + "make_interval"("months" => "k"."k")))::"date" AS "date",
    "p"."installment_amount" AS "amount",
    'manual'::"text" AS "origin"
   FROM ("airton"."installment_plans" "p"
     CROSS JOIN LATERAL "generate_series"(0, ("p"."total" - 1)) "k"("k"));


ALTER VIEW "airton"."v_installment_schedule" OWNER TO "postgres";


CREATE OR REPLACE VIEW "airton"."v_inv_month" WITH ("security_invoker"='on') AS
 WITH "r" AS (
         SELECT "inv_position"."user_id",
            "inv_position"."mes",
            ("sum"(("inv_position"."saldo" * "inv_position"."rent_mes")) FILTER (WHERE ("inv_position"."rent_mes" IS NOT NULL)) / NULLIF("sum"("inv_position"."saldo") FILTER (WHERE ("inv_position"."rent_mes" IS NOT NULL)), (0)::numeric)) AS "rent_w",
            ("sum"("inv_position"."saldo") FILTER (WHERE ("inv_position"."rent_mes" IS NOT NULL)) / NULLIF("sum"("inv_position"."saldo"), (0)::numeric)) AS "cov"
           FROM "airton"."inv_position"
          GROUP BY "inv_position"."user_id", "inv_position"."mes"
        ), "f" AS (
         SELECT "inv_movements"."user_id",
            "to_char"(("inv_movements"."date")::timestamp with time zone, 'YYYY-MM'::"text") AS "mes",
            "sum"(
                CASE
                    WHEN ("upper"("inv_movements"."type") = 'BUY'::"text") THEN "abs"("inv_movements"."amount")
                    WHEN ("upper"("inv_movements"."type") = 'SELL'::"text") THEN (- "abs"("inv_movements"."amount"))
                    ELSE (0)::numeric
                END) AS "net_flow",
            "sum"(
                CASE
                    WHEN ("upper"("inv_movements"."type") = 'BUY'::"text") THEN "abs"("inv_movements"."amount")
                    ELSE (0)::numeric
                END) AS "aportes",
            "sum"(
                CASE
                    WHEN ("upper"("inv_movements"."type") = 'SELL'::"text") THEN "abs"("inv_movements"."amount")
                    ELSE (0)::numeric
                END) AS "resgates",
            "count"(*) AS "n_mov"
           FROM "airton"."inv_movements"
          GROUP BY "inv_movements"."user_id", ("to_char"(("inv_movements"."date")::timestamp with time zone, 'YYYY-MM'::"text"))
        ), "b" AS (
         SELECT "s"."user_id",
            "s"."mes",
            "s"."patrimonio",
            "s"."source",
            "s"."ref",
            "lag"("s"."patrimonio") OVER (PARTITION BY "s"."user_id" ORDER BY "s"."mes") AS "prev",
            "r"."rent_w",
            "r"."cov",
            "f"."net_flow",
            "f"."aportes",
            "f"."resgates",
            "f"."n_mov"
           FROM (("airton"."inv_snapshot" "s"
             LEFT JOIN "r" ON ((("r"."user_id" = "s"."user_id") AND ("r"."mes" = "s"."mes"))))
             LEFT JOIN "f" ON ((("f"."user_id" = "s"."user_id") AND ("f"."mes" = "s"."mes"))))
        )
 SELECT "user_id",
    "mes",
    "patrimonio",
    "source",
    "ref",
    "prev",
    "rent_w",
    "cov",
    "net_flow",
    "aportes",
    "resgates",
    "n_mov",
        CASE
            WHEN ("cov" >= 0.6) THEN "rent_w"
            ELSE NULL::numeric
        END AS "ret_pct"
   FROM "b";


ALTER VIEW "airton"."v_inv_month" OWNER TO "postgres";


CREATE OR REPLACE VIEW "airton"."v_inv_position" WITH ("security_invoker"='true') AS
 SELECT "p"."user_id",
    "p"."mes",
    "p"."produto",
    "p"."estrategia",
    "p"."tipo",
    "p"."indexador",
    "p"."saldo",
    "p"."aloc",
    "p"."rent_mes",
    "p"."moeda",
    "p"."valor_orig",
    "p"."manual",
    "airton"."asset_class"("p"."produto", "p"."estrategia", "p"."tipo", "i"."classe") AS "classe",
    COALESCE("i"."nome_curto", "p"."produto") AS "nome",
    "i"."risco",
        CASE
            WHEN ("p"."produto" ~ '^[A-Z]{4}\d{1,2}$'::"text") THEN "p"."produto"
            WHEN (("p"."estrategia" = 'Investimentos Offshore'::"text") AND ("p"."produto" ~ '^[A-Z.]{1,6}$'::"text")) THEN "p"."produto"
            ELSE NULL::"text"
        END AS "ticker"
   FROM ("airton"."inv_position" "p"
     LEFT JOIN "airton"."inv_product_info" "i" ON ((("i"."user_id" = "p"."user_id") AND ("i"."produto" = "p"."produto"))));


ALTER VIEW "airton"."v_inv_position" OWNER TO "postgres";


CREATE OR REPLACE VIEW "airton"."v_planned_events" WITH ("security_invoker"='true') AS
 SELECT "e"."id",
    "e"."user_id",
    "e"."date",
    "e"."label",
    "e"."amount",
    "e"."category_id",
    "e"."created_at",
    "e"."date_end",
    "e"."match_terms",
    "e"."auto_match",
    "e"."income_type",
    "e"."employment_id",
    "e"."notes",
    COALESCE("r"."realized", (0)::numeric) AS "realized",
    (COALESCE("r"."n", (0)::bigint))::integer AS "n_tx",
    "r"."first_date",
    "r"."last_date",
        CASE
            WHEN ((COALESCE("r"."n", (0)::bigint) > 0) AND (("e"."date_end" IS NULL) OR ("e"."date_end" < "airton"."today"()))) THEN 'realizado'::"text"
            WHEN (COALESCE("r"."n", (0)::bigint) > 0) THEN 'em_andamento'::"text"
            WHEN (("e"."date_end" IS NOT NULL) AND (("airton"."today"() >= "e"."date") AND ("airton"."today"() <= "e"."date_end"))) THEN 'em_andamento'::"text"
            WHEN (COALESCE("e"."date_end", "e"."date") < ("airton"."today"() - 25)) THEN 'nao_ocorreu'::"text"
            WHEN (COALESCE("e"."date_end", "e"."date") < "airton"."today"()) THEN 'aguardando'::"text"
            ELSE 'previsto'::"text"
        END AS "status"
   FROM ("airton"."planned_events" "e"
     LEFT JOIN LATERAL ( SELECT "sum"("t"."amount_brl") AS "realized",
            "count"(*) AS "n",
            "min"("t"."date") AS "first_date",
            "max"("t"."date") AS "last_date"
           FROM "airton"."transactions" "t"
          WHERE ("t"."planned_event_id" = "e"."id")) "r" ON (true));


ALTER VIEW "airton"."v_planned_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton_private"."kv" (
    "key" "text" NOT NULL,
    "value" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "airton_private"."kv" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton_private"."tx_backup" (
    "backup_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reason" "text",
    "id" "text",
    "kind" "text",
    "category_id" "text",
    "cat_source" "text",
    "cat_confidence" real,
    "reviewed" boolean,
    "account_type" "text"
);


ALTER TABLE "airton_private"."tx_backup" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "airton_private"."tx_deleted" (
    "deleted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reason" "text" NOT NULL,
    "row" "jsonb" NOT NULL
);


ALTER TABLE "airton_private"."tx_deleted" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "claudia"."ai_usage" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"(),
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "feature" "text" NOT NULL,
    "provider" "text" DEFAULT 'anthropic'::"text" NOT NULL,
    "model" "text" NOT NULL,
    "input_tokens" integer DEFAULT 0 NOT NULL,
    "output_tokens" integer DEFAULT 0 NOT NULL,
    "cache_read_tokens" integer DEFAULT 0 NOT NULL,
    "cache_write_tokens" integer DEFAULT 0 NOT NULL,
    "web_searches" integer DEFAULT 0 NOT NULL,
    "cost_usd" numeric DEFAULT 0 NOT NULL
);


ALTER TABLE "claudia"."ai_usage" OWNER TO "postgres";


ALTER TABLE "claudia"."ai_usage" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "claudia"."ai_usage_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "claudia"."members" (
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "claudia"."members" OWNER TO "postgres";


CREATE OR REPLACE VIEW "claudia"."v_ai_cost_month" WITH ("security_invoker"='on') AS
 SELECT ("date_trunc"('month'::"text", ("at" AT TIME ZONE 'America/Sao_Paulo'::"text")))::"date" AS "mes",
    "provider",
    "feature",
    "model",
    "count"(*) AS "chamadas",
    "sum"("input_tokens") AS "input_tokens",
    "sum"("cache_read_tokens") AS "cache_read_tokens",
    "sum"("cache_write_tokens") AS "cache_write_tokens",
    "sum"("output_tokens") AS "output_tokens",
    "sum"("web_searches") AS "buscas",
    "round"("sum"("cost_usd"), 4) AS "custo_usd"
   FROM "claudia"."ai_usage"
  GROUP BY (("date_trunc"('month'::"text", ("at" AT TIME ZONE 'America/Sao_Paulo'::"text")))::"date"), "provider", "feature", "model";


ALTER VIEW "claudia"."v_ai_cost_month" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."agent_runs" (
    "id" bigint NOT NULL,
    "agent" "text" NOT NULL,
    "user_id" "uuid",
    "tipo" "text" NOT NULL,
    "status" "text" DEFAULT 'rodando'::"text" NOT NULL,
    "input" "jsonb",
    "output" "jsonb",
    "uso" "jsonb",
    "custo_usd" numeric(10,4) DEFAULT 0 NOT NULL,
    "chamadas" integer DEFAULT 0 NOT NULL,
    "descartado" boolean DEFAULT false NOT NULL,
    "erro" "text",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    CONSTRAINT "agent_runs_status_check" CHECK (("status" = ANY (ARRAY['rodando'::"text", 'ok'::"text", 'erro'::"text"])))
);


ALTER TABLE "core"."agent_runs" OWNER TO "postgres";


ALTER TABLE "core"."agent_runs" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "core"."agent_runs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "core"."agents" (
    "slug" "text" NOT NULL,
    "nome" "text" NOT NULL,
    "dominio" "text" NOT NULL,
    "briefing_fn" "text",
    "ordem" integer DEFAULT 100 NOT NULL,
    "ativo" boolean DEFAULT true NOT NULL
);


ALTER TABLE "core"."agents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."ai_usage" (
    "id" bigint NOT NULL,
    "user_id" "uuid",
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "agent" "text",
    "feature" "text" NOT NULL,
    "papel" "text",
    "run_id" bigint,
    "provider" "text" NOT NULL,
    "model" "text" NOT NULL,
    "input_tokens" integer DEFAULT 0 NOT NULL,
    "output_tokens" integer DEFAULT 0 NOT NULL,
    "cache_read_tokens" integer DEFAULT 0 NOT NULL,
    "cache_write_tokens" integer DEFAULT 0 NOT NULL,
    "web_searches" integer DEFAULT 0 NOT NULL,
    "cost_usd" numeric(10,5) DEFAULT 0 NOT NULL
);


ALTER TABLE "core"."ai_usage" OWNER TO "postgres";


ALTER TABLE "core"."ai_usage" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "core"."ai_usage_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "core"."briefings" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "data" "date" NOT NULL,
    "tipo" "text" NOT NULL,
    "insumos" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "texto" "text",
    "lido_em" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "briefings_tipo_check" CHECK (("tipo" = ANY (ARRAY['manha'::"text", 'noite'::"text"])))
);


ALTER TABLE "core"."briefings" OWNER TO "postgres";


ALTER TABLE "core"."briefings" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "core"."briefings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "core"."members" (
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "core"."members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."perfil" (
    "user_id" "uuid" NOT NULL,
    "nome" "text" DEFAULT 'Leo'::"text" NOT NULL,
    "timezone" "text" DEFAULT 'America/Sao_Paulo'::"text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "core"."perfil" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."rotina" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "dias" integer[] NOT NULL,
    "hora" time without time zone NOT NULL,
    "minutos" integer,
    "atividade" "text" NOT NULL,
    "agent" "text",
    "ativo" boolean DEFAULT true NOT NULL
);


ALTER TABLE "core"."rotina" OWNER TO "postgres";


ALTER TABLE "core"."rotina" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "core"."rotina_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE OR REPLACE VIEW "core"."v_ai_cost_all" WITH ("security_invoker"='true') AS
 SELECT 'airton'::"text" AS "app",
    ("date_trunc"('month'::"text", ("ai_usage"."at" AT TIME ZONE 'America/Sao_Paulo'::"text")))::"date" AS "mes",
    "ai_usage"."feature",
    "ai_usage"."model",
    "count"(*) AS "chamadas",
    "round"("sum"("ai_usage"."cost_usd"), 4) AS "custo_usd"
   FROM "airton"."ai_usage"
  GROUP BY 'airton'::"text", (("date_trunc"('month'::"text", ("ai_usage"."at" AT TIME ZONE 'America/Sao_Paulo'::"text")))::"date"), "ai_usage"."feature", "ai_usage"."model"
UNION ALL
 SELECT COALESCE("ai_usage"."agent", 'core'::"text") AS "app",
    ("date_trunc"('month'::"text", ("ai_usage"."at" AT TIME ZONE 'America/Sao_Paulo'::"text")))::"date" AS "mes",
    "ai_usage"."feature",
    "ai_usage"."model",
    "count"(*) AS "chamadas",
    "round"("sum"("ai_usage"."cost_usd"), 4) AS "custo_usd"
   FROM "core"."ai_usage"
  GROUP BY COALESCE("ai_usage"."agent", 'core'::"text"), (("date_trunc"('month'::"text", ("ai_usage"."at" AT TIME ZONE 'America/Sao_Paulo'::"text")))::"date"), "ai_usage"."feature", "ai_usage"."model";


ALTER VIEW "core"."v_ai_cost_all" OWNER TO "postgres";


CREATE OR REPLACE VIEW "core"."v_ai_cost_month" WITH ("security_invoker"='true') AS
 SELECT ("date_trunc"('month'::"text", ("at" AT TIME ZONE 'America/Sao_Paulo'::"text")))::"date" AS "mes",
    "agent",
    "feature",
    "papel",
    "provider",
    "model",
    "count"(*) AS "chamadas",
    "sum"("input_tokens") AS "input_tokens",
    "sum"("cache_read_tokens") AS "cache_read_tokens",
    "sum"("output_tokens") AS "output_tokens",
    "sum"("web_searches") AS "buscas",
    "round"("sum"("cost_usd"), 4) AS "custo_usd"
   FROM "core"."ai_usage"
  GROUP BY (("date_trunc"('month'::"text", ("at" AT TIME ZONE 'America/Sao_Paulo'::"text")))::"date"), "agent", "feature", "papel", "provider", "model";


ALTER VIEW "core"."v_ai_cost_month" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core_private"."kv" (
    "key" "text" NOT NULL,
    "value" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "core_private"."kv" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "private"."allowed_emails" (
    "email" "text" NOT NULL
);


ALTER TABLE "private"."allowed_emails" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "private"."strava_tokens" (
    "user_id" "uuid" NOT NULL,
    "athlete_id" bigint NOT NULL,
    "athlete_name" "text",
    "access_token" "text" NOT NULL,
    "refresh_token" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "scope" "text",
    "last_sync_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "private"."strava_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activities" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "local_date" "date" NOT NULL,
    "sport" "text" NOT NULL,
    "title" "text",
    "duration_min" numeric(6,1) NOT NULL,
    "distance_km" numeric(7,3),
    "elevation_m" integer,
    "avg_hr" integer,
    "max_hr" integer,
    "avg_power_w" integer,
    "avg_cadence" integer,
    "kcal" integer,
    "kcal_estimated" boolean DEFAULT false NOT NULL,
    "rpe" numeric(3,1),
    "load" numeric(7,1) GENERATED ALWAYS AS (("rpe" * "duration_min")) STORED,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "external_id" "text",
    "plan_session_id" bigint,
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "activities_avg_cadence_check" CHECK ((("avg_cadence" >= 0) AND ("avg_cadence" <= 300))),
    CONSTRAINT "activities_avg_hr_check" CHECK ((("avg_hr" >= 30) AND ("avg_hr" <= 230))),
    CONSTRAINT "activities_avg_power_w_check" CHECK ((("avg_power_w" >= 0) AND ("avg_power_w" <= 2000))),
    CONSTRAINT "activities_distance_km_check" CHECK (("distance_km" >= (0)::numeric)),
    CONSTRAINT "activities_duration_min_check" CHECK ((("duration_min" > (0)::numeric) AND ("duration_min" <= (1440)::numeric))),
    CONSTRAINT "activities_elevation_m_check" CHECK (("elevation_m" >= 0)),
    CONSTRAINT "activities_kcal_check" CHECK (("kcal" >= 0)),
    CONSTRAINT "activities_max_hr_check" CHECK ((("max_hr" >= 30) AND ("max_hr" <= 240))),
    CONSTRAINT "activities_rpe_check" CHECK ((("rpe" >= (1)::numeric) AND ("rpe" <= (10)::numeric))),
    CONSTRAINT "activities_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'apple_health'::"text", 'strava'::"text", 'shortcut'::"text"]))),
    CONSTRAINT "activities_sport_check" CHECK (("sport" = ANY (ARRAY['run'::"text", 'walk'::"text", 'hike'::"text", 'swim'::"text", 'ride_indoor'::"text", 'ride_outdoor'::"text", 'strength'::"text", 'hiit'::"text", 'yoga'::"text", 'mobility'::"text", 'row'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."activities" OWNER TO "postgres";


ALTER TABLE "public"."activities" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."activities_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ai_usage" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "route" "text" NOT NULL,
    "model" "text" NOT NULL,
    "input_tokens" integer,
    "output_tokens" integer,
    CONSTRAINT "ai_usage_route_check" CHECK (("route" = ANY (ARRAY['photo-review'::"text", 'coach'::"text", 'diet'::"text", 'checkin'::"text", 'coach-chat'::"text", 'coach-session'::"text", 'food-parse'::"text", 'food-photo'::"text", 'coach-review'::"text"])))
);


ALTER TABLE "public"."ai_usage" OWNER TO "postgres";


ALTER TABLE "public"."ai_usage" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ai_usage_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."measurements" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "measured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "local_date" "date" NOT NULL,
    "waist_cm" numeric(5,1),
    "neck_cm" numeric(4,1),
    "hip_cm" numeric(5,1),
    "chest_cm" numeric(5,1),
    "arm_cm" numeric(4,1),
    "thigh_cm" numeric(4,1),
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "measurements_arm_cm_check" CHECK ((("arm_cm" >= (15)::numeric) AND ("arm_cm" <= (70)::numeric))),
    CONSTRAINT "measurements_chest_cm_check" CHECK ((("chest_cm" >= (50)::numeric) AND ("chest_cm" <= (200)::numeric))),
    CONSTRAINT "measurements_hip_cm_check" CHECK ((("hip_cm" >= (50)::numeric) AND ("hip_cm" <= (200)::numeric))),
    CONSTRAINT "measurements_neck_cm_check" CHECK ((("neck_cm" >= (20)::numeric) AND ("neck_cm" <= (70)::numeric))),
    CONSTRAINT "measurements_thigh_cm_check" CHECK ((("thigh_cm" >= (25)::numeric) AND ("thigh_cm" <= (100)::numeric))),
    CONSTRAINT "measurements_waist_cm_check" CHECK ((("waist_cm" >= (40)::numeric) AND ("waist_cm" <= (200)::numeric)))
);


ALTER TABLE "public"."measurements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "display_name" "text",
    "sex" "text",
    "birth_date" "date",
    "height_cm" numeric(5,1),
    "goal" "text",
    "timezone" "text" DEFAULT 'America/Sao_Paulo'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "enc_version" smallint DEFAULT 0 NOT NULL,
    CONSTRAINT "profiles_height_cm_check" CHECK ((("height_cm" >= (120)::numeric) AND ("height_cm" <= (230)::numeric))),
    CONSTRAINT "profiles_sex_check" CHECK (("sex" = ANY (ARRAY['male'::"text", 'female'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weight_entries" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "measured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "local_date" "date" NOT NULL,
    "weight_kg" numeric(5,2) NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "fasted" boolean DEFAULT true NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "weight_entries_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'shortcut'::"text", 'apple_health'::"text"]))),
    CONSTRAINT "weight_entries_weight_kg_check" CHECK ((("weight_kg" >= (30)::numeric) AND ("weight_kg" <= (300)::numeric)))
);


ALTER TABLE "public"."weight_entries" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."weight_daily" WITH ("security_invoker"='true') AS
 SELECT DISTINCT ON ("user_id", "local_date") "user_id",
    "local_date",
    "measured_at",
    "weight_kg",
    "fasted",
    "source"
   FROM "public"."weight_entries"
  ORDER BY "user_id", "local_date", "measured_at";


ALTER VIEW "public"."weight_daily" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."weight_with_trend" WITH ("security_invoker"='true') AS
 SELECT "user_id",
    "local_date",
    "weight_kg",
    "round"("avg"("weight_kg") OVER "w", 2) AS "trend_7d",
    "count"(*) OVER "w" AS "n_7d"
   FROM "public"."weight_daily"
  WINDOW "w" AS (PARTITION BY "user_id" ORDER BY "local_date" RANGE BETWEEN '6 days'::interval PRECEDING AND CURRENT ROW);


ALTER VIEW "public"."weight_with_trend" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."body_comp_estimates" WITH ("security_invoker"='true') AS
 WITH "m" AS (
         SELECT DISTINCT ON ("measurements"."user_id", "measurements"."local_date") "measurements"."id",
            "measurements"."user_id",
            "measurements"."measured_at",
            "measurements"."local_date",
            "measurements"."waist_cm",
            "measurements"."neck_cm",
            "measurements"."hip_cm",
            "measurements"."chest_cm",
            "measurements"."arm_cm",
            "measurements"."thigh_cm",
            "measurements"."note",
            "measurements"."created_at"
           FROM "public"."measurements"
          WHERE ("measurements"."waist_cm" IS NOT NULL)
          ORDER BY "measurements"."user_id", "measurements"."local_date", "measurements"."measured_at" DESC
        ), "calc" AS (
         SELECT "m"."user_id",
            "m"."local_date",
            "m"."waist_cm",
            "m"."neck_cm",
            "m"."hip_cm",
            "p"."height_cm",
            "p"."sex",
            "w"."trend_7d" AS "weight_ref_kg",
                CASE "p"."sex"
                    WHEN 'male'::"text" THEN ((64)::numeric - ((20)::numeric * ("p"."height_cm" / "m"."waist_cm")))
                    WHEN 'female'::"text" THEN ((76)::numeric - ((20)::numeric * ("p"."height_cm" / "m"."waist_cm")))
                    ELSE NULL::numeric
                END AS "bf_rfm",
                CASE
                    WHEN (("p"."sex" = 'male'::"text") AND ("m"."neck_cm" IS NOT NULL) AND ("m"."waist_cm" > "m"."neck_cm")) THEN (((495)::numeric / ((1.0324 - (0.19077 * "log"(("m"."waist_cm" - "m"."neck_cm")))) + (0.15456 * "log"("p"."height_cm")))) - (450)::numeric)
                    WHEN (("p"."sex" = 'female'::"text") AND ("m"."neck_cm" IS NOT NULL) AND ("m"."hip_cm" IS NOT NULL)) THEN (((495)::numeric / ((1.29579 - (0.35004 * "log"((("m"."waist_cm" + "m"."hip_cm") - "m"."neck_cm")))) + (0.22100 * "log"("p"."height_cm")))) - (450)::numeric)
                    ELSE NULL::numeric
                END AS "bf_navy"
           FROM (("m"
             JOIN "public"."profiles" "p" ON (("p"."id" = "m"."user_id")))
             LEFT JOIN LATERAL ( SELECT "t"."trend_7d"
                   FROM "public"."weight_with_trend" "t"
                  WHERE (("t"."user_id" = "m"."user_id") AND (("t"."local_date" >= ("m"."local_date" - 7)) AND ("t"."local_date" <= "m"."local_date")))
                  ORDER BY "t"."local_date" DESC
                 LIMIT 1) "w" ON (true))
          WHERE (("p"."height_cm" IS NOT NULL) AND ("p"."sex" IS NOT NULL))
        )
 SELECT "user_id",
    "local_date",
    "waist_cm",
    "neck_cm",
    "hip_cm",
    "height_cm",
    "sex",
    "weight_ref_kg",
    "round"("bf_rfm", 1) AS "bf_rfm",
    "round"("bf_navy", 1) AS "bf_navy",
    "round"(COALESCE((("bf_rfm" + "bf_navy") / (2)::numeric), "bf_rfm", "bf_navy"), 1) AS "bf_mean",
    "round"((("weight_ref_kg" * COALESCE((("bf_rfm" + "bf_navy") / (2)::numeric), "bf_rfm", "bf_navy")) / (100)::numeric), 1) AS "fat_mass_kg",
    "round"(("weight_ref_kg" * ((1)::numeric - (COALESCE((("bf_rfm" + "bf_navy") / (2)::numeric), "bf_rfm", "bf_navy") / (100)::numeric))), 1) AS "lean_mass_kg",
    "round"(("waist_cm" / "height_cm"), 3) AS "waist_height_ratio"
   FROM "calc";


ALTER VIEW "public"."body_comp_estimates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coach_reviews" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "week_start" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "model" "text",
    "trigger" "text" DEFAULT 'manual'::"text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "decisions" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "coach_reviews_trigger_check" CHECK (("trigger" = ANY (ARRAY['auto'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."coach_reviews" OWNER TO "postgres";


ALTER TABLE "public"."coach_reviews" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."coach_reviews_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."daily_activity" (
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "local_date" "date" NOT NULL,
    "active_kcal" integer,
    "resting_kcal" integer,
    "steps" integer,
    "exercise_min" integer,
    "sleep_min" integer,
    "resting_hr" integer,
    "hrv_ms" numeric(5,1),
    "source" "text" DEFAULT 'apple_health'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "daily_activity_active_kcal_check" CHECK (("active_kcal" >= 0)),
    CONSTRAINT "daily_activity_exercise_min_check" CHECK (("exercise_min" >= 0)),
    CONSTRAINT "daily_activity_resting_hr_check" CHECK ((("resting_hr" >= 25) AND ("resting_hr" <= 150))),
    CONSTRAINT "daily_activity_resting_kcal_check" CHECK (("resting_kcal" >= 0)),
    CONSTRAINT "daily_activity_sleep_min_check" CHECK (("sleep_min" >= 0)),
    CONSTRAINT "daily_activity_steps_check" CHECK (("steps" >= 0))
);


ALTER TABLE "public"."daily_activity" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."diet_recommendations" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tdee_estimate" integer,
    "tdee_method" "text",
    "kcal_target" integer,
    "protein_g_target" integer,
    "rationale" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "model" "text",
    "prompt_version" "text",
    CONSTRAINT "diet_recommendations_tdee_method_check" CHECK (("tdee_method" = ANY (ARRAY['mifflin'::"text", 'adaptive'::"text"])))
);


ALTER TABLE "public"."diet_recommendations" OWNER TO "postgres";


ALTER TABLE "public"."diet_recommendations" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."diet_recommendations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."food_logs" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "eaten_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "local_date" "date" NOT NULL,
    "meal" "text",
    "description" "text" NOT NULL,
    "protein_g" numeric(5,1),
    "kcal" integer,
    "carbs_g" numeric(5,1),
    "fat_g" numeric(5,1),
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "food_logs_carbs_g_check" CHECK (("carbs_g" >= (0)::numeric)),
    CONSTRAINT "food_logs_fat_g_check" CHECK (("fat_g" >= (0)::numeric)),
    CONSTRAINT "food_logs_kcal_check" CHECK (("kcal" >= 0)),
    CONSTRAINT "food_logs_meal_check" CHECK (("meal" = ANY (ARRAY['breakfast'::"text", 'lunch'::"text", 'dinner'::"text", 'snack'::"text", 'shake'::"text"]))),
    CONSTRAINT "food_logs_protein_g_check" CHECK (("protein_g" >= (0)::numeric)),
    CONSTRAINT "food_logs_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'ai_estimate'::"text"])))
);


ALTER TABLE "public"."food_logs" OWNER TO "postgres";


ALTER TABLE "public"."food_logs" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."food_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ingest_tokens" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "token_hash" "text" NOT NULL,
    "label" "text" DEFAULT 'iPhone'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone,
    "revoked_at" timestamp with time zone
);


ALTER TABLE "public"."ingest_tokens" OWNER TO "postgres";


ALTER TABLE "public"."ingest_tokens" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ingest_tokens_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."measurements" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."measurements_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."medication_logs" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "administered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "local_date" "date" NOT NULL,
    "drug" "text" DEFAULT 'tirzepatide'::"text" NOT NULL,
    "dose_mg" numeric(4,1) NOT NULL,
    "injection_site" "text",
    "side_effects" "text"[],
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "medication_logs_dose_mg_check" CHECK ((("dose_mg" > (0)::numeric) AND ("dose_mg" <= (20)::numeric))),
    CONSTRAINT "medication_logs_drug_check" CHECK (("drug" = ANY (ARRAY['tirzepatide'::"text", 'semaglutide'::"text", 'other'::"text"]))),
    CONSTRAINT "medication_logs_injection_site_check" CHECK (("injection_site" = ANY (ARRAY['abdomen'::"text", 'thigh'::"text", 'arm'::"text"])))
);


ALTER TABLE "public"."medication_logs" OWNER TO "postgres";


ALTER TABLE "public"."medication_logs" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."medication_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."photo_reviews" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "baseline_date" "date",
    "current_date_ref" "date" NOT NULL,
    "photo_ids" bigint[] NOT NULL,
    "bf_low" numeric(4,1),
    "bf_high" numeric(4,1),
    "confidence" "text",
    "protocol_consistent" boolean,
    "summary" "text",
    "observations" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "model" "text" NOT NULL,
    "prompt_version" "text" NOT NULL,
    "input_tokens" integer,
    "output_tokens" integer,
    CONSTRAINT "photo_reviews_bf_high_check" CHECK ((("bf_high" >= (3)::numeric) AND ("bf_high" <= (60)::numeric))),
    CONSTRAINT "photo_reviews_bf_low_check" CHECK ((("bf_low" >= (3)::numeric) AND ("bf_low" <= (60)::numeric))),
    CONSTRAINT "photo_reviews_check" CHECK ((("bf_low" IS NULL) OR ("bf_high" IS NULL) OR ("bf_low" <= "bf_high"))),
    CONSTRAINT "photo_reviews_confidence_check" CHECK (("confidence" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"])))
);


ALTER TABLE "public"."photo_reviews" OWNER TO "postgres";


ALTER TABLE "public"."photo_reviews" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."photo_reviews_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."plan_changes" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "plan_id" bigint,
    "session_id" bigint,
    "local_date" "date",
    "source" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "summary" "text" NOT NULL,
    "instruction" "text",
    "before" "jsonb",
    "after" "jsonb",
    CONSTRAINT "plan_changes_instruction_check" CHECK (("char_length"("instruction") <= 4000)),
    CONSTRAINT "plan_changes_scope_check" CHECK (("scope" = ANY (ARRAY['session'::"text", 'template'::"text", 'plan'::"text"]))),
    CONSTRAINT "plan_changes_source_check" CHECK (("source" = ANY (ARRAY['user'::"text", 'ai'::"text"]))),
    CONSTRAINT "plan_changes_summary_check" CHECK (("char_length"("summary") <= 4000))
);


ALTER TABLE "public"."plan_changes" OWNER TO "postgres";


ALTER TABLE "public"."plan_changes" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."plan_changes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."plan_sessions" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "plan_id" bigint,
    "local_date" "date" NOT NULL,
    "sport" "text" NOT NULL,
    "title" "text" NOT NULL,
    "intensity" "text" DEFAULT 'moderate'::"text" NOT NULL,
    "duration_min" integer,
    "distance_km" numeric(6,2),
    "target" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "origin" "text" DEFAULT 'ai'::"text" NOT NULL,
    "edited" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "plan_sessions_distance_km_check" CHECK (("distance_km" >= (0)::numeric)),
    CONSTRAINT "plan_sessions_duration_min_check" CHECK ((("duration_min" >= 5) AND ("duration_min" <= 480))),
    CONSTRAINT "plan_sessions_intensity_check" CHECK (("intensity" = ANY (ARRAY['recovery'::"text", 'easy'::"text", 'moderate'::"text", 'tempo'::"text", 'threshold'::"text", 'intervals'::"text", 'long'::"text", 'strength'::"text"]))),
    CONSTRAINT "plan_sessions_origin_check" CHECK (("origin" = ANY (ARRAY['ai'::"text", 'user'::"text"]))),
    CONSTRAINT "plan_sessions_sport_check" CHECK (("sport" = ANY (ARRAY['run'::"text", 'walk'::"text", 'hike'::"text", 'swim'::"text", 'ride_indoor'::"text", 'ride_outdoor'::"text", 'strength'::"text", 'hiit'::"text", 'yoga'::"text", 'mobility'::"text", 'row'::"text", 'other'::"text"]))),
    CONSTRAINT "plan_sessions_status_check" CHECK (("status" = ANY (ARRAY['planned'::"text", 'done'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."plan_sessions" OWNER TO "postgres";


ALTER TABLE "public"."plan_sessions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."plan_sessions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."progress_photos" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "taken_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "local_date" "date" NOT NULL,
    "pose" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "protocol" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "progress_photos_pose_check" CHECK (("pose" = ANY (ARRAY['front'::"text", 'side'::"text", 'back'::"text"])))
);


ALTER TABLE "public"."progress_photos" OWNER TO "postgres";


ALTER TABLE "public"."progress_photos" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."progress_photos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."training_profiles" (
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "sports" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "goal" "text",
    "event" "jsonb",
    "weekdays" integer[] DEFAULT '{0,2,4}'::integer[] NOT NULL,
    "session_minutes" integer DEFAULT 60 NOT NULL,
    "equipment" "text" DEFAULT 'gym'::"text" NOT NULL,
    "limitations" "text",
    "hr_max" integer,
    "hr_rest" integer,
    "ftp_w" integer,
    "run_threshold_s_km" integer,
    "swim_css_s_100" integer,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "coach_notes" "text",
    CONSTRAINT "training_profiles_coach_notes_check" CHECK (("char_length"("coach_notes") <= 4000)),
    CONSTRAINT "training_profiles_equipment_check" CHECK (("equipment" = ANY (ARRAY['gym'::"text", 'home_dumbbells'::"text", 'bodyweight'::"text"]))),
    CONSTRAINT "training_profiles_ftp_w_check" CHECK ((("ftp_w" >= 50) AND ("ftp_w" <= 600))),
    CONSTRAINT "training_profiles_hr_max_check" CHECK ((("hr_max" >= 120) AND ("hr_max" <= 230))),
    CONSTRAINT "training_profiles_hr_rest_check" CHECK ((("hr_rest" >= 30) AND ("hr_rest" <= 110))),
    CONSTRAINT "training_profiles_run_threshold_s_km_check" CHECK ((("run_threshold_s_km" >= 150) AND ("run_threshold_s_km" <= 900))),
    CONSTRAINT "training_profiles_session_minutes_check" CHECK ((("session_minutes" >= 15) AND ("session_minutes" <= 240))),
    CONSTRAINT "training_profiles_swim_css_s_100_check" CHECK ((("swim_css_s_100" >= 50) AND ("swim_css_s_100" <= 300)))
);


ALTER TABLE "public"."training_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weekly_checkins" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "week_start" "date" NOT NULL,
    "score" integer,
    "payload" "jsonb" NOT NULL,
    "model" "text" NOT NULL,
    "prompt_version" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "weekly_checkins_score_check" CHECK ((("score" >= 0) AND ("score" <= 100)))
);


ALTER TABLE "public"."weekly_checkins" OWNER TO "postgres";


ALTER TABLE "public"."weekly_checkins" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."weekly_checkins_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."weight_entries" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."weight_entries_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."workout_logs" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "performed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "local_date" "date" NOT NULL,
    "plan_id" bigint,
    "exercise" "text" NOT NULL,
    "set_number" smallint NOT NULL,
    "reps" smallint,
    "load_kg" numeric(5,1),
    "rpe" numeric(3,1),
    "duration_min" numeric(5,1),
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "plan_session_id" bigint,
    CONSTRAINT "workout_logs_load_kg_check" CHECK (("load_kg" >= (0)::numeric)),
    CONSTRAINT "workout_logs_reps_check" CHECK ((("reps" >= 0) AND ("reps" <= 100))),
    CONSTRAINT "workout_logs_rpe_check" CHECK ((("rpe" >= (1)::numeric) AND ("rpe" <= (10)::numeric))),
    CONSTRAINT "workout_logs_set_number_check" CHECK ((("set_number" >= 1) AND ("set_number" <= 20)))
);


ALTER TABLE "public"."workout_logs" OWNER TO "postgres";


ALTER TABLE "public"."workout_logs" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."workout_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."workout_plans" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "valid_from" "date" DEFAULT CURRENT_DATE NOT NULL,
    "valid_to" "date",
    "is_active" boolean DEFAULT true NOT NULL,
    "goal" "text",
    "plan" "jsonb" NOT NULL,
    "rationale" "text",
    "model" "text",
    "prompt_version" "text",
    "materialized_through" "date"
);


ALTER TABLE "public"."workout_plans" OWNER TO "postgres";


ALTER TABLE "public"."workout_plans" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."workout_plans_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "sabia"."anotacoes" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "livro_id" bigint,
    "item_id" bigint,
    "tipo" "text" DEFAULT 'ideia'::"text" NOT NULL,
    "texto" "text" NOT NULL,
    "pagina" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "anotacoes_check" CHECK ((("livro_id" IS NOT NULL) OR ("item_id" IS NOT NULL))),
    CONSTRAINT "anotacoes_tipo_check" CHECK (("tipo" = ANY (ARRAY['destaque'::"text", 'ideia'::"text", 'pergunta'::"text"])))
);


ALTER TABLE "sabia"."anotacoes" OWNER TO "postgres";


ALTER TABLE "sabia"."anotacoes" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "sabia"."anotacoes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "sabia"."fontes" (
    "dominio" "text" NOT NULL,
    "nome" "text" NOT NULL,
    "tema" "text" NOT NULL,
    "idioma" "text" NOT NULL,
    "paywall" boolean DEFAULT false NOT NULL,
    "rss_url" "text",
    CONSTRAINT "fontes_idioma_check" CHECK (("idioma" = ANY (ARRAY['pt'::"text", 'en'::"text"])))
);


ALTER TABLE "sabia"."fontes" OWNER TO "postgres";


COMMENT ON COLUMN "sabia"."fontes"."rss_url" IS 'Feed RSS/Atom lido pelo worker da trilha antes de qualquer busca paga.';



CREATE TABLE IF NOT EXISTS "sabia"."itens" (
    "id" bigint NOT NULL,
    "trilha_id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "ordem" integer NOT NULL,
    "tema" "text" NOT NULL,
    "titulo" "text" NOT NULL,
    "fonte" "text",
    "url" "text",
    "formato" "text" NOT NULL,
    "idioma" "text",
    "minutos" integer NOT NULL,
    "por_que" "text",
    "takeaway" "text",
    "corpo" "text",
    "status" "text" DEFAULT 'pendente'::"text" NOT NULL,
    "reacao" smallint,
    "feito_em" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "itens_formato_check" CHECK (("formato" = ANY (ARRAY['artigo'::"text", 'newsletter'::"text", 'podcast'::"text", 'video'::"text", 'paper'::"text", 'recap'::"text", 'livro'::"text"]))),
    CONSTRAINT "itens_idioma_check" CHECK (("idioma" = ANY (ARRAY['pt'::"text", 'en'::"text"]))),
    CONSTRAINT "itens_minutos_check" CHECK ((("minutos" >= 1) AND ("minutos" <= 40))),
    CONSTRAINT "itens_reacao_check" CHECK (("reacao" = ANY (ARRAY['-1'::integer, 0, 1]))),
    CONSTRAINT "itens_status_check" CHECK (("status" = ANY (ARRAY['pendente'::"text", 'feito'::"text", 'pulado'::"text"])))
);


ALTER TABLE "sabia"."itens" OWNER TO "postgres";


ALTER TABLE "sabia"."itens" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "sabia"."itens_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "sabia"."leituras" (
    "id" bigint NOT NULL,
    "livro_id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "data" "date" DEFAULT CURRENT_DATE NOT NULL,
    "pagina_final" integer,
    "minutos" integer,
    "nota" "text"
);


ALTER TABLE "sabia"."leituras" OWNER TO "postgres";


ALTER TABLE "sabia"."leituras" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "sabia"."leituras_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "sabia"."livros" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "titulo" "text" NOT NULL,
    "autor" "text",
    "status" "text" DEFAULT 'quero_ler'::"text" NOT NULL,
    "paginas" integer,
    "pagina_atual" integer,
    "formato" "text",
    "nota" smallint,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "origem" "text",
    "notas" "text",
    "resenha" "text",
    "comecou_em" "date",
    "terminou_em" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "livros_formato_check" CHECK (("formato" = ANY (ARRAY['fisico'::"text", 'kindle'::"text", 'audiobook'::"text"]))),
    CONSTRAINT "livros_nota_check" CHECK ((("nota" >= 1) AND ("nota" <= 5))),
    CONSTRAINT "livros_status_check" CHECK (("status" = ANY (ARRAY['quero_ler'::"text", 'lendo'::"text", 'pausado'::"text", 'lido'::"text", 'abandonado'::"text"])))
);


ALTER TABLE "sabia"."livros" OWNER TO "postgres";


ALTER TABLE "sabia"."livros" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "sabia"."livros_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "sabia"."temas" (
    "slug" "text" NOT NULL,
    "nome" "text" NOT NULL,
    "prioridade" integer NOT NULL,
    "peso" numeric NOT NULL,
    "peso_min" numeric NOT NULL,
    "peso_max" numeric NOT NULL,
    "descricao" "text" NOT NULL,
    "ativo" boolean DEFAULT true NOT NULL
);


ALTER TABLE "sabia"."temas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "sabia"."trilhas" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "data" "date" NOT NULL,
    "tipo" "text" NOT NULL,
    "minutos_total" integer NOT NULL,
    "resumo" "text",
    "status" "text" DEFAULT 'gerada'::"text" NOT NULL,
    "run_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "trilhas_status_check" CHECK (("status" = ANY (ARRAY['gerada'::"text", 'em_andamento'::"text", 'concluida'::"text"]))),
    CONSTRAINT "trilhas_tipo_check" CHECK (("tipo" = ANY (ARRAY['diaria'::"text", 'deep_dive'::"text", 'recap'::"text", 'hobby'::"text"])))
);


ALTER TABLE "sabia"."trilhas" OWNER TO "postgres";


ALTER TABLE "sabia"."trilhas" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "sabia"."trilhas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "airton"."inv_alerts" ALTER COLUMN "id" SET DEFAULT "nextval"('"airton"."inv_alerts_id_seq"'::"regclass");



ALTER TABLE ONLY "airton"."inv_news" ALTER COLUMN "id" SET DEFAULT "nextval"('"airton"."inv_news_id_seq"'::"regclass");



ALTER TABLE ONLY "airton"."inv_plan" ALTER COLUMN "id" SET DEFAULT "nextval"('"airton"."inv_plan_id_seq"'::"regclass");



ALTER TABLE ONLY "airton"."accounts"
    ADD CONSTRAINT "accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "airton"."accounts"
    ADD CONSTRAINT "accounts_user_id_pluggy_account_id_key" UNIQUE ("user_id", "pluggy_account_id");



ALTER TABLE ONLY "airton"."ai_usage"
    ADD CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "airton"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "airton"."chat_messages"
    ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "airton"."employments"
    ADD CONSTRAINT "employments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "airton"."goals"
    ADD CONSTRAINT "goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "airton"."installment_plans"
    ADD CONSTRAINT "installment_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "airton"."inv_alerts"
    ADD CONSTRAINT "inv_alerts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "airton"."inv_alerts"
    ADD CONSTRAINT "inv_alerts_user_id_ref_date_ticker_kind_key" UNIQUE ("user_id", "ref_date", "ticker", "kind");



ALTER TABLE ONLY "airton"."inv_holdings"
    ADD CONSTRAINT "inv_holdings_pkey" PRIMARY KEY ("user_id", "ticker");



ALTER TABLE ONLY "airton"."inv_movements"
    ADD CONSTRAINT "inv_movements_pkey" PRIMARY KEY ("user_id", "pluggy_id");



ALTER TABLE ONLY "airton"."inv_news"
    ADD CONSTRAINT "inv_news_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "airton"."inv_news"
    ADD CONSTRAINT "inv_news_user_id_ticker_title_key" UNIQUE ("user_id", "ticker", "title");



ALTER TABLE ONLY "airton"."inv_of"
    ADD CONSTRAINT "inv_of_pkey" PRIMARY KEY ("user_id", "pluggy_id");



ALTER TABLE ONLY "airton"."inv_plan"
    ADD CONSTRAINT "inv_plan_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "airton"."inv_position"
    ADD CONSTRAINT "inv_position_pkey" PRIMARY KEY ("user_id", "mes", "produto");



ALTER TABLE ONLY "airton"."inv_prices"
    ADD CONSTRAINT "inv_prices_pkey" PRIMARY KEY ("ticker", "date");



ALTER TABLE ONLY "airton"."inv_product_info"
    ADD CONSTRAINT "inv_product_info_pkey" PRIMARY KEY ("user_id", "produto");



ALTER TABLE ONLY "airton"."inv_snapshot"
    ADD CONSTRAINT "inv_snapshot_pkey" PRIMARY KEY ("user_id", "mes");



ALTER TABLE ONLY "airton"."members"
    ADD CONSTRAINT "members_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "airton"."notify_log"
    ADD CONSTRAINT "notify_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "airton"."notify_log"
    ADD CONSTRAINT "notify_log_user_id_kind_local_date_key" UNIQUE ("user_id", "kind", "local_date");



ALTER TABLE ONLY "airton"."of_items"
    ADD CONSTRAINT "of_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "airton"."planned_events"
    ADD CONSTRAINT "planned_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "airton"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint");



ALTER TABLE ONLY "airton"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "airton"."rules"
    ADD CONSTRAINT "rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "airton"."settings"
    ADD CONSTRAINT "settings_pkey" PRIMARY KEY ("user_id", "key");



ALTER TABLE ONLY "airton"."sync_runs"
    ADD CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "airton"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "airton_private"."kv"
    ADD CONSTRAINT "kv_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "claudia"."ai_usage"
    ADD CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "claudia"."members"
    ADD CONSTRAINT "members_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "core"."agent_runs"
    ADD CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."agents"
    ADD CONSTRAINT "agents_pkey" PRIMARY KEY ("slug");



ALTER TABLE ONLY "core"."ai_usage"
    ADD CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."briefings"
    ADD CONSTRAINT "briefings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."briefings"
    ADD CONSTRAINT "briefings_user_id_data_tipo_key" UNIQUE ("user_id", "data", "tipo");



ALTER TABLE ONLY "core"."members"
    ADD CONSTRAINT "members_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "core"."perfil"
    ADD CONSTRAINT "perfil_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "core"."rotina"
    ADD CONSTRAINT "rotina_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core_private"."kv"
    ADD CONSTRAINT "kv_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "private"."allowed_emails"
    ADD CONSTRAINT "allowed_emails_pkey" PRIMARY KEY ("email");



ALTER TABLE ONLY "private"."strava_tokens"
    ADD CONSTRAINT "strava_tokens_athlete_id_key" UNIQUE ("athlete_id");



ALTER TABLE ONLY "private"."strava_tokens"
    ADD CONSTRAINT "strava_tokens_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_usage"
    ADD CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coach_reviews"
    ADD CONSTRAINT "coach_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coach_reviews"
    ADD CONSTRAINT "coach_reviews_user_id_week_start_key" UNIQUE ("user_id", "week_start");



ALTER TABLE ONLY "public"."daily_activity"
    ADD CONSTRAINT "daily_activity_pkey" PRIMARY KEY ("user_id", "local_date");



ALTER TABLE ONLY "public"."diet_recommendations"
    ADD CONSTRAINT "diet_recommendations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."food_logs"
    ADD CONSTRAINT "food_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ingest_tokens"
    ADD CONSTRAINT "ingest_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ingest_tokens"
    ADD CONSTRAINT "ingest_tokens_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."measurements"
    ADD CONSTRAINT "measurements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."medication_logs"
    ADD CONSTRAINT "medication_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photo_reviews"
    ADD CONSTRAINT "photo_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plan_changes"
    ADD CONSTRAINT "plan_changes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plan_sessions"
    ADD CONSTRAINT "plan_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."progress_photos"
    ADD CONSTRAINT "progress_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."progress_photos"
    ADD CONSTRAINT "progress_photos_storage_path_key" UNIQUE ("storage_path");



ALTER TABLE ONLY "public"."training_profiles"
    ADD CONSTRAINT "training_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."weekly_checkins"
    ADD CONSTRAINT "weekly_checkins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weekly_checkins"
    ADD CONSTRAINT "weekly_checkins_user_id_week_start_key" UNIQUE ("user_id", "week_start");



ALTER TABLE ONLY "public"."weight_entries"
    ADD CONSTRAINT "weight_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_logs"
    ADD CONSTRAINT "workout_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_plans"
    ADD CONSTRAINT "workout_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "sabia"."anotacoes"
    ADD CONSTRAINT "anotacoes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "sabia"."fontes"
    ADD CONSTRAINT "fontes_pkey" PRIMARY KEY ("dominio");



ALTER TABLE ONLY "sabia"."itens"
    ADD CONSTRAINT "itens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "sabia"."leituras"
    ADD CONSTRAINT "leituras_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "sabia"."livros"
    ADD CONSTRAINT "livros_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "sabia"."livros"
    ADD CONSTRAINT "livros_user_id_titulo_key" UNIQUE ("user_id", "titulo");



ALTER TABLE ONLY "sabia"."temas"
    ADD CONSTRAINT "temas_pkey" PRIMARY KEY ("slug");



ALTER TABLE ONLY "sabia"."temas"
    ADD CONSTRAINT "temas_prioridade_key" UNIQUE ("prioridade");



ALTER TABLE ONLY "sabia"."trilhas"
    ADD CONSTRAINT "trilhas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "sabia"."trilhas"
    ADD CONSTRAINT "trilhas_user_id_data_tipo_key" UNIQUE ("user_id", "data", "tipo");



CREATE INDEX "ai_usage_at_idx" ON "airton"."ai_usage" USING "btree" ("at");



CREATE INDEX "employments_user" ON "airton"."employments" USING "btree" ("user_id");



CREATE INDEX "inv_movements_user_date" ON "airton"."inv_movements" USING "btree" ("user_id", "date");



CREATE INDEX "inv_news_user_pub" ON "airton"."inv_news" USING "btree" ("user_id", "published" DESC);



CREATE INDEX "inv_plan_user_created" ON "airton"."inv_plan" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "sync_runs_user" ON "airton"."sync_runs" USING "btree" ("user_id", "started_at" DESC);



CREATE INDEX "transactions_account" ON "airton"."transactions" USING "btree" ("account_id");



CREATE INDEX "transactions_category" ON "airton"."transactions" USING "btree" ("category_id");



CREATE UNIQUE INDEX "transactions_of_ref_uq" ON "airton"."transactions" USING "btree" ("user_id", "of_ref") WHERE ("of_ref" IS NOT NULL);



CREATE INDEX "transactions_planned" ON "airton"."transactions" USING "btree" ("planned_event_id") WHERE ("planned_event_id" IS NOT NULL);



CREATE INDEX "transactions_review" ON "airton"."transactions" USING "btree" ("user_id", "reviewed", "date" DESC);



CREATE UNIQUE INDEX "transactions_source_ref_uq" ON "airton"."transactions" USING "btree" ("user_id", "source", "source_ref") WHERE ("source_ref" IS NOT NULL);



CREATE INDEX "transactions_user_date" ON "airton"."transactions" USING "btree" ("user_id", "date" DESC);



CREATE UNIQUE INDEX "transactions_user_source_ref_full" ON "airton"."transactions" USING "btree" ("user_id", "source", "source_ref");



CREATE INDEX "ai_usage_at_idx" ON "claudia"."ai_usage" USING "btree" ("at");



CREATE INDEX "agent_runs_recentes" ON "core"."agent_runs" USING "btree" ("agent", "started_at" DESC);



CREATE INDEX "ai_usage_at" ON "core"."ai_usage" USING "btree" ("at" DESC);



CREATE UNIQUE INDEX "activities_external" ON "public"."activities" USING "btree" ("user_id", "source", "external_id");



CREATE INDEX "activities_plan_session" ON "public"."activities" USING "btree" ("plan_session_id");



CREATE INDEX "activities_user_date" ON "public"."activities" USING "btree" ("user_id", "local_date" DESC);



CREATE INDEX "ai_usage_user_time" ON "public"."ai_usage" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "diet_recommendations_user_time" ON "public"."diet_recommendations" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "food_logs_user_date" ON "public"."food_logs" USING "btree" ("user_id", "local_date" DESC);



CREATE INDEX "food_logs_user_time" ON "public"."food_logs" USING "btree" ("user_id", "eaten_at" DESC);



CREATE INDEX "ingest_tokens_user" ON "public"."ingest_tokens" USING "btree" ("user_id");



CREATE INDEX "measurements_user_time" ON "public"."measurements" USING "btree" ("user_id", "measured_at" DESC);



CREATE INDEX "medication_logs_user_time" ON "public"."medication_logs" USING "btree" ("user_id", "administered_at" DESC);



CREATE INDEX "photo_reviews_user_time" ON "public"."photo_reviews" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "plan_changes_plan" ON "public"."plan_changes" USING "btree" ("plan_id");



CREATE INDEX "plan_changes_session" ON "public"."plan_changes" USING "btree" ("session_id");



CREATE INDEX "plan_changes_user_time" ON "public"."plan_changes" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "plan_sessions_plan" ON "public"."plan_sessions" USING "btree" ("plan_id");



CREATE INDEX "plan_sessions_user_date" ON "public"."plan_sessions" USING "btree" ("user_id", "local_date");



CREATE INDEX "progress_photos_user_date" ON "public"."progress_photos" USING "btree" ("user_id", "local_date" DESC, "pose");



CREATE INDEX "weight_entries_user_time" ON "public"."weight_entries" USING "btree" ("user_id", "measured_at" DESC);



CREATE INDEX "workout_logs_plan" ON "public"."workout_logs" USING "btree" ("plan_id");



CREATE INDEX "workout_logs_session" ON "public"."workout_logs" USING "btree" ("plan_session_id");



CREATE INDEX "workout_logs_user_date" ON "public"."workout_logs" USING "btree" ("user_id", "local_date" DESC);



CREATE INDEX "workout_logs_user_exercise" ON "public"."workout_logs" USING "btree" ("user_id", "exercise", "performed_at" DESC);



CREATE INDEX "workout_logs_user_time" ON "public"."workout_logs" USING "btree" ("user_id", "performed_at" DESC);



CREATE UNIQUE INDEX "workout_plans_one_active" ON "public"."workout_plans" USING "btree" ("user_id") WHERE "is_active";



CREATE INDEX "itens_user_recentes" ON "sabia"."itens" USING "btree" ("user_id", "created_at" DESC);



CREATE OR REPLACE TRIGGER "accounts_touch" BEFORE UPDATE ON "airton"."accounts" FOR EACH ROW EXECUTE FUNCTION "airton"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "emp_apply" AFTER INSERT OR UPDATE OF "start_date", "end_date", "payer_terms", "base_salary", "variable_factor" ON "airton"."employments" FOR EACH ROW EXECUTE FUNCTION "airton"."_emp_after"();



CREATE OR REPLACE TRIGGER "pe_match" AFTER INSERT OR UPDATE OF "date", "date_end", "amount", "match_terms", "category_id", "auto_match", "income_type" ON "airton"."planned_events" FOR EACH ROW EXECUTE FUNCTION "airton"."_pe_after"();



CREATE OR REPLACE TRIGGER "transactions_touch" BEFORE UPDATE ON "airton"."transactions" FOR EACH ROW EXECUTE FUNCTION "airton"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "tx_0_skip_mirror" BEFORE INSERT ON "airton"."transactions" FOR EACH ROW EXECUTE FUNCTION "airton"."_tx_skip_mirror"();



CREATE OR REPLACE TRIGGER "tx_a_before" BEFORE INSERT OR UPDATE OF "kind", "category_id", "amount", "description", "date" ON "airton"."transactions" FOR EACH ROW EXECUTE FUNCTION "airton"."_tx_before"();



CREATE OR REPLACE TRIGGER "tx_b_after_income" AFTER INSERT OR UPDATE OF "category_id" ON "airton"."transactions" FOR EACH ROW EXECUTE FUNCTION "airton"."_tx_after_income"();



CREATE OR REPLACE TRIGGER "tx_c_after_employer" AFTER INSERT OR UPDATE OF "category_id", "amount", "date" ON "airton"."transactions" FOR EACH ROW EXECUTE FUNCTION "airton"."_tx_after_employer"();



CREATE OR REPLACE TRIGGER "perfil_updated" BEFORE UPDATE ON "core"."perfil" FOR EACH ROW EXECUTE FUNCTION "core"."tg_updated_at"();



CREATE OR REPLACE TRIGGER "activities_local_date" BEFORE INSERT OR UPDATE OF "started_at" ON "public"."activities" FOR EACH ROW EXECUTE FUNCTION "public"."set_local_date"('started_at');



CREATE OR REPLACE TRIGGER "food_local_date" BEFORE INSERT OR UPDATE OF "eaten_at" ON "public"."food_logs" FOR EACH ROW EXECUTE FUNCTION "public"."set_local_date"('eaten_at');



CREATE OR REPLACE TRIGGER "measurements_local_date" BEFORE INSERT OR UPDATE OF "measured_at" ON "public"."measurements" FOR EACH ROW EXECUTE FUNCTION "public"."set_local_date"('measured_at');



CREATE OR REPLACE TRIGGER "medication_local_date" BEFORE INSERT OR UPDATE OF "administered_at" ON "public"."medication_logs" FOR EACH ROW EXECUTE FUNCTION "public"."set_local_date"('administered_at');



CREATE OR REPLACE TRIGGER "photos_local_date" BEFORE INSERT OR UPDATE OF "taken_at" ON "public"."progress_photos" FOR EACH ROW EXECUTE FUNCTION "public"."set_local_date"('taken_at');



CREATE OR REPLACE TRIGGER "profiles_touch" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "weight_local_date" BEFORE INSERT OR UPDATE OF "measured_at" ON "public"."weight_entries" FOR EACH ROW EXECUTE FUNCTION "public"."set_local_date"('measured_at');



CREATE OR REPLACE TRIGGER "workout_local_date" BEFORE INSERT OR UPDATE OF "performed_at" ON "public"."workout_logs" FOR EACH ROW EXECUTE FUNCTION "public"."set_local_date"('performed_at');



CREATE OR REPLACE TRIGGER "itens_feito" BEFORE UPDATE OF "status" ON "sabia"."itens" FOR EACH ROW EXECUTE FUNCTION "sabia"."tg_item_feito"();



CREATE OR REPLACE TRIGGER "itens_status" AFTER UPDATE OF "status" ON "sabia"."itens" FOR EACH ROW EXECUTE FUNCTION "sabia"."tg_status_trilha"();



CREATE OR REPLACE TRIGGER "leituras_progresso" AFTER INSERT ON "sabia"."leituras" FOR EACH ROW EXECUTE FUNCTION "sabia"."tg_leitura"();



CREATE OR REPLACE TRIGGER "livros_updated" BEFORE UPDATE ON "sabia"."livros" FOR EACH ROW EXECUTE FUNCTION "core"."tg_updated_at"();



ALTER TABLE ONLY "airton"."accounts"
    ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."ai_usage"
    ADD CONSTRAINT "ai_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."categories"
    ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "airton"."categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "airton"."categories"
    ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."chat_messages"
    ADD CONSTRAINT "chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."employments"
    ADD CONSTRAINT "employments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."goals"
    ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."installment_plans"
    ADD CONSTRAINT "installment_plans_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "airton"."categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "airton"."installment_plans"
    ADD CONSTRAINT "installment_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."inv_alerts"
    ADD CONSTRAINT "inv_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."inv_holdings"
    ADD CONSTRAINT "inv_holdings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."inv_position"
    ADD CONSTRAINT "inv_position_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."inv_product_info"
    ADD CONSTRAINT "inv_product_info_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."inv_snapshot"
    ADD CONSTRAINT "inv_snapshot_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."members"
    ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."notify_log"
    ADD CONSTRAINT "notify_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."of_items"
    ADD CONSTRAINT "of_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."planned_events"
    ADD CONSTRAINT "planned_events_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "airton"."categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "airton"."planned_events"
    ADD CONSTRAINT "planned_events_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "airton"."employments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "airton"."planned_events"
    ADD CONSTRAINT "planned_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."rules"
    ADD CONSTRAINT "rules_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "airton"."categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."rules"
    ADD CONSTRAINT "rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."settings"
    ADD CONSTRAINT "settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."sync_runs"
    ADD CONSTRAINT "sync_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."transactions"
    ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "airton"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "airton"."transactions"
    ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "airton"."categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "airton"."transactions"
    ADD CONSTRAINT "transactions_planned_event_id_fkey" FOREIGN KEY ("planned_event_id") REFERENCES "airton"."planned_events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "airton"."transactions"
    ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "claudia"."members"
    ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."agent_runs"
    ADD CONSTRAINT "agent_runs_agent_fkey" FOREIGN KEY ("agent") REFERENCES "core"."agents"("slug");



ALTER TABLE ONLY "core"."agent_runs"
    ADD CONSTRAINT "agent_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."ai_usage"
    ADD CONSTRAINT "ai_usage_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "core"."agent_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "core"."ai_usage"
    ADD CONSTRAINT "ai_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."briefings"
    ADD CONSTRAINT "briefings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."members"
    ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."perfil"
    ADD CONSTRAINT "perfil_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."rotina"
    ADD CONSTRAINT "rotina_agent_fkey" FOREIGN KEY ("agent") REFERENCES "core"."agents"("slug");



ALTER TABLE ONLY "core"."rotina"
    ADD CONSTRAINT "rotina_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "private"."strava_tokens"
    ADD CONSTRAINT "strava_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_plan_session_id_fkey" FOREIGN KEY ("plan_session_id") REFERENCES "public"."plan_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_usage"
    ADD CONSTRAINT "ai_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_reviews"
    ADD CONSTRAINT "coach_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_activity"
    ADD CONSTRAINT "daily_activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."diet_recommendations"
    ADD CONSTRAINT "diet_recommendations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."food_logs"
    ADD CONSTRAINT "food_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ingest_tokens"
    ADD CONSTRAINT "ingest_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."measurements"
    ADD CONSTRAINT "measurements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."medication_logs"
    ADD CONSTRAINT "medication_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."photo_reviews"
    ADD CONSTRAINT "photo_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plan_changes"
    ADD CONSTRAINT "plan_changes_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."plan_changes"
    ADD CONSTRAINT "plan_changes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."plan_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."plan_changes"
    ADD CONSTRAINT "plan_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plan_sessions"
    ADD CONSTRAINT "plan_sessions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."plan_sessions"
    ADD CONSTRAINT "plan_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."progress_photos"
    ADD CONSTRAINT "progress_photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_profiles"
    ADD CONSTRAINT "training_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_checkins"
    ADD CONSTRAINT "weekly_checkins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weight_entries"
    ADD CONSTRAINT "weight_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_logs"
    ADD CONSTRAINT "workout_logs_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workout_logs"
    ADD CONSTRAINT "workout_logs_plan_session_id_fkey" FOREIGN KEY ("plan_session_id") REFERENCES "public"."plan_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workout_logs"
    ADD CONSTRAINT "workout_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_plans"
    ADD CONSTRAINT "workout_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "sabia"."anotacoes"
    ADD CONSTRAINT "anotacoes_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "sabia"."itens"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "sabia"."anotacoes"
    ADD CONSTRAINT "anotacoes_livro_id_fkey" FOREIGN KEY ("livro_id") REFERENCES "sabia"."livros"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "sabia"."anotacoes"
    ADD CONSTRAINT "anotacoes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "sabia"."fontes"
    ADD CONSTRAINT "fontes_tema_fkey" FOREIGN KEY ("tema") REFERENCES "sabia"."temas"("slug");



ALTER TABLE ONLY "sabia"."itens"
    ADD CONSTRAINT "itens_trilha_id_fkey" FOREIGN KEY ("trilha_id") REFERENCES "sabia"."trilhas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "sabia"."itens"
    ADD CONSTRAINT "itens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "sabia"."leituras"
    ADD CONSTRAINT "leituras_livro_id_fkey" FOREIGN KEY ("livro_id") REFERENCES "sabia"."livros"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "sabia"."leituras"
    ADD CONSTRAINT "leituras_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "sabia"."livros"
    ADD CONSTRAINT "livros_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "sabia"."trilhas"
    ADD CONSTRAINT "trilhas_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "core"."agent_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "sabia"."trilhas"
    ADD CONSTRAINT "trilhas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "airton"."accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."ai_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."chat_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."employments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."goals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."installment_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."inv_alerts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."inv_holdings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."inv_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."inv_news" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."inv_of" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."inv_plan" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."inv_position" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."inv_prices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."inv_product_info" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."inv_snapshot" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "members_read" ON "airton"."inv_prices" FOR SELECT TO "authenticated" USING (( SELECT "airton"."is_member"() AS "is_member"));



ALTER TABLE "airton"."notify_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."of_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "owner_all" ON "airton"."accounts" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



CREATE POLICY "owner_all" ON "airton"."ai_usage" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



CREATE POLICY "owner_all" ON "airton"."categories" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



CREATE POLICY "owner_all" ON "airton"."chat_messages" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



CREATE POLICY "owner_all" ON "airton"."employments" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



CREATE POLICY "owner_all" ON "airton"."goals" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



CREATE POLICY "owner_all" ON "airton"."installment_plans" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



CREATE POLICY "owner_all" ON "airton"."inv_alerts" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



CREATE POLICY "owner_all" ON "airton"."inv_holdings" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



CREATE POLICY "owner_all" ON "airton"."inv_movements" TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND "airton"."is_member"())) WITH CHECK ((("user_id" = "auth"."uid"()) AND "airton"."is_member"()));



CREATE POLICY "owner_all" ON "airton"."inv_news" TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND "airton"."is_member"())) WITH CHECK ((("user_id" = "auth"."uid"()) AND "airton"."is_member"()));



CREATE POLICY "owner_all" ON "airton"."inv_of" TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND "airton"."is_member"())) WITH CHECK ((("user_id" = "auth"."uid"()) AND "airton"."is_member"()));



CREATE POLICY "owner_all" ON "airton"."inv_plan" TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND "airton"."is_member"())) WITH CHECK ((("user_id" = "auth"."uid"()) AND "airton"."is_member"()));



CREATE POLICY "owner_all" ON "airton"."inv_position" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



CREATE POLICY "owner_all" ON "airton"."inv_product_info" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



CREATE POLICY "owner_all" ON "airton"."inv_snapshot" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



CREATE POLICY "owner_all" ON "airton"."notify_log" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



CREATE POLICY "owner_all" ON "airton"."of_items" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



CREATE POLICY "owner_all" ON "airton"."planned_events" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



CREATE POLICY "owner_all" ON "airton"."push_subscriptions" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



CREATE POLICY "owner_all" ON "airton"."rules" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



CREATE POLICY "owner_all" ON "airton"."settings" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



CREATE POLICY "owner_all" ON "airton"."sync_runs" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



CREATE POLICY "owner_all" ON "airton"."transactions" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "airton"."is_member"() AS "is_member")));



ALTER TABLE "airton"."planned_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "self_read" ON "airton"."members" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "airton"."settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."sync_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton"."transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "airton_private"."kv" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "claudia"."ai_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "claudia"."members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "core"."agent_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "core"."agents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agents_leitura" ON "core"."agents" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "core"."ai_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "core"."briefings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "briefings_dono" ON "core"."briefings" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "briefings_lido" ON "core"."briefings" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "core"."members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "members_self" ON "core"."members" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "core"."perfil" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "perfil_dono" ON "core"."perfil" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "core"."rotina" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rotina_dono" ON "core"."rotina" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "runs_leitura" ON "core"."agent_runs" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "uso_leitura" ON "core"."ai_usage" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "core_private"."kv" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."activities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."coach_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_activity" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."diet_recommendations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."food_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ingest_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."measurements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."medication_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "own profile read" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "own profile update" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "own rows" ON "public"."activities" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own rows" ON "public"."coach_reviews" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own rows" ON "public"."daily_activity" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own rows" ON "public"."diet_recommendations" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own rows" ON "public"."food_logs" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own rows" ON "public"."measurements" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own rows" ON "public"."medication_logs" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own rows" ON "public"."photo_reviews" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own rows" ON "public"."plan_changes" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own rows" ON "public"."plan_sessions" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own rows" ON "public"."progress_photos" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own rows" ON "public"."training_profiles" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own rows" ON "public"."weekly_checkins" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own rows" ON "public"."weight_entries" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own rows" ON "public"."workout_logs" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own rows" ON "public"."workout_plans" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own tokens delete" ON "public"."ingest_tokens" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own tokens read" ON "public"."ingest_tokens" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own tokens revoke" ON "public"."ingest_tokens" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own usage insert" ON "public"."ai_usage" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "own usage read" ON "public"."ai_usage" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."photo_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."plan_changes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."plan_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."progress_photos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."training_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."weekly_checkins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."weight_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workout_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workout_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "sabia"."anotacoes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "anotacoes_dono" ON "sabia"."anotacoes" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "sabia"."fontes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fontes_leitura" ON "sabia"."fontes" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "sabia"."itens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "itens_leitura" ON "sabia"."itens" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "itens_marcar" ON "sabia"."itens" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "sabia"."leituras" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leituras_dono" ON "sabia"."leituras" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "sabia"."livros" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "livros_dono" ON "sabia"."livros" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "sabia"."temas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "temas_leitura" ON "sabia"."temas" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "sabia"."trilhas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trilhas_dono" ON "sabia"."trilhas" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "airton" TO "authenticated";
GRANT USAGE ON SCHEMA "airton" TO "service_role";



GRANT USAGE ON SCHEMA "airton_private" TO "service_role";



GRANT USAGE ON SCHEMA "core" TO "authenticated";
GRANT USAGE ON SCHEMA "core" TO "service_role";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






GRANT USAGE ON SCHEMA "sabia" TO "authenticated";
GRANT USAGE ON SCHEMA "sabia" TO "service_role";



GRANT ALL ON FUNCTION "airton"."_emp_after"() TO "authenticated";
GRANT ALL ON FUNCTION "airton"."_emp_after"() TO "service_role";



GRANT ALL ON FUNCTION "airton"."new_id"("prefix" "text") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."new_id"("prefix" "text") TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."employments" TO "authenticated";
GRANT ALL ON TABLE "airton"."employments" TO "service_role";



GRANT ALL ON FUNCTION "airton"."_employment_base"("p_emp" "airton"."employments", "p_before" "date") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."_employment_base"("p_emp" "airton"."employments", "p_before" "date") TO "service_role";



GRANT ALL ON FUNCTION "airton"."_employment_for"("p_user" "uuid", "p_date" "date", "p_desc" "text") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."_employment_for"("p_user" "uuid", "p_date" "date", "p_desc" "text") TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."planned_events" TO "authenticated";
GRANT ALL ON TABLE "airton"."planned_events" TO "service_role";



GRANT ALL ON FUNCTION "airton"."_ev_tx_ok"("e" "airton"."planned_events", "p_date" "date", "p_amount" numeric, "p_desc" "text", "p_cat" "text") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."_ev_tx_ok"("e" "airton"."planned_events", "p_date" "date", "p_amount" numeric, "p_desc" "text", "p_cat" "text") TO "service_role";



GRANT ALL ON FUNCTION "airton"."_family_match"("p_user" "uuid", "p_desc" "text") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."_family_match"("p_user" "uuid", "p_desc" "text") TO "service_role";



GRANT ALL ON FUNCTION "airton"."_income_cat"("p_user" "uuid", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."_income_cat"("p_user" "uuid", "p_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "airton"."_is_invest_account"("p_acc" "text") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."_is_invest_account"("p_acc" "text") TO "service_role";



GRANT ALL ON FUNCTION "airton"."_pe_after"() TO "authenticated";
GRANT ALL ON FUNCTION "airton"."_pe_after"() TO "service_role";



GRANT ALL ON FUNCTION "airton"."_tx_after_employer"() TO "authenticated";
GRANT ALL ON FUNCTION "airton"."_tx_after_employer"() TO "service_role";



GRANT ALL ON FUNCTION "airton"."_tx_after_income"() TO "authenticated";
GRANT ALL ON FUNCTION "airton"."_tx_after_income"() TO "service_role";



GRANT ALL ON FUNCTION "airton"."_tx_before"() TO "authenticated";
GRANT ALL ON FUNCTION "airton"."_tx_before"() TO "service_role";



GRANT ALL ON FUNCTION "airton"."_tx_skip_mirror"() TO "authenticated";
GRANT ALL ON FUNCTION "airton"."_tx_skip_mirror"() TO "service_role";



REVOKE ALL ON FUNCTION "airton"."_uid"("p_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "airton"."_uid"("p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."_uid"("p_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "airton"."apply_employment"("p_emp" "text") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."apply_employment"("p_emp" "text") TO "service_role";



GRANT ALL ON FUNCTION "airton"."asset_class"("p_produto" "text", "p_estrategia" "text", "p_tipo" "text", "p_classe_info" "text") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."asset_class"("p_produto" "text", "p_estrategia" "text", "p_tipo" "text", "p_classe_info" "text") TO "service_role";



GRANT ALL ON FUNCTION "airton"."confirm"("p_ids" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "airton"."confirm"("p_ids" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "airton"."income_history"("p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."income_history"("p_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "airton"."income_payers"("p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."income_payers"("p_user" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "airton"."is_member"() FROM PUBLIC;
GRANT ALL ON FUNCTION "airton"."is_member"() TO "authenticated";
GRANT ALL ON FUNCTION "airton"."is_member"() TO "service_role";



GRANT ALL ON FUNCTION "airton"."kind_for"("p_category" "text", "p_amount" numeric, "p_current" "text") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."kind_for"("p_category" "text", "p_amount" numeric, "p_current" "text") TO "service_role";



REVOKE ALL ON FUNCTION "airton"."kv_get"("p_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "airton"."kv_get"("p_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "airton"."kv_set"("p_key" "text", "p_value" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "airton"."kv_set"("p_key" "text", "p_value" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "airton"."match_event"("p_event" "text") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."match_event"("p_event" "text") TO "service_role";



GRANT ALL ON FUNCTION "airton"."merchant_key"("d" "text") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."merchant_key"("d" "text") TO "service_role";



GRANT ALL ON FUNCTION "airton"."month_plan"("p_month" "date", "p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."month_plan"("p_month" "date", "p_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "airton"."reclass_employer_month"("p_user" "uuid", "p_emp" "text", "p_month" "date") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."reclass_employer_month"("p_user" "uuid", "p_emp" "text", "p_month" "date") TO "service_role";



GRANT ALL ON FUNCTION "airton"."register_salary"("p_emp" "text", "p_from" "date", "p_to" "date", "p_amount" numeric, "p_day" integer, "p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."register_salary"("p_emp" "text", "p_from" "date", "p_to" "date", "p_amount" numeric, "p_day" integer, "p_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "airton"."review_counts"("p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."review_counts"("p_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "airton"."seed_defaults"() TO "authenticated";
GRANT ALL ON FUNCTION "airton"."seed_defaults"() TO "service_role";



GRANT ALL ON FUNCTION "airton"."seed_income"("p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."seed_income"("p_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "airton"."set_category"("p_ids" "text"[], "p_category" "text", "p_learn" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "airton"."set_category"("p_ids" "text"[], "p_category" "text", "p_learn" boolean) TO "service_role";



GRANT ALL ON FUNCTION "airton"."set_kind"("p_ids" "text"[], "p_kind" "text") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."set_kind"("p_ids" "text"[], "p_kind" "text") TO "service_role";



GRANT ALL ON FUNCTION "airton"."today"() TO "authenticated";
GRANT ALL ON FUNCTION "airton"."today"() TO "service_role";



GRANT ALL ON FUNCTION "airton"."touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "airton"."touch_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "airton"."week_summary"("p_date" "date", "p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."week_summary"("p_date" "date", "p_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "airton"."year_series"("p_year" integer, "p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."year_series"("p_year" integer, "p_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "airton"."year_summary"("p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "airton"."year_summary"("p_user" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "airton_private"."call_function"("fn" "text", "body" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "core"."briefing_airton"("p_user" "uuid", "p_data" "date") FROM PUBLIC;



REVOKE ALL ON FUNCTION "core"."briefing_casa"("p_user" "uuid", "p_data" "date") FROM PUBLIC;



REVOKE ALL ON FUNCTION "core"."briefing_claudia"("p_user" "uuid", "p_data" "date") FROM PUBLIC;



REVOKE ALL ON FUNCTION "core"."coletar_briefings"("p_user" "uuid", "p_data" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "core"."coletar_briefings"("p_user" "uuid", "p_data" "date") TO "service_role";



REVOKE ALL ON FUNCTION "core_private"."call_function"("fn" "text", "body" "jsonb") FROM PUBLIC;











































































































































































REVOKE ALL ON FUNCTION "public"."claudia_ai_cost"("p_months" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claudia_ai_cost"("p_months" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claudia_ai_cost"("p_months" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."claudia_is_member"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claudia_is_member"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."claudia_is_member"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_ingest_token"("p_label" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_ingest_token"("p_label" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_ingest_token"("p_label" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_health"("p_token" "text", "p_activities" "jsonb", "p_daily" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_health"("p_token" "text", "p_activities" "jsonb", "p_daily" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."ingest_health"("p_token" "text", "p_activities" "jsonb", "p_daily" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_weight"("p_token" "text", "p_weight_kg" numeric, "p_measured_at" timestamp with time zone, "p_source" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_weight"("p_token" "text", "p_weight_kg" numeric, "p_measured_at" timestamp with time zone, "p_source" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."ingest_weight"("p_token" "text", "p_weight_kg" numeric, "p_measured_at" timestamp with time zone, "p_source" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_local_date"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_local_date"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."strava_disconnect"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."strava_disconnect"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."strava_disconnect"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."strava_get_tokens"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."strava_get_tokens"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."strava_get_tokens"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."strava_mark_synced"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."strava_mark_synced"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."strava_mark_synced"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."strava_save_tokens"("p_athlete_id" bigint, "p_athlete_name" "text", "p_access" "text", "p_refresh" "text", "p_expires_at" timestamp with time zone, "p_scope" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."strava_save_tokens"("p_athlete_id" bigint, "p_athlete_name" "text", "p_access" "text", "p_refresh" "text", "p_expires_at" timestamp with time zone, "p_scope" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strava_save_tokens"("p_athlete_id" bigint, "p_athlete_name" "text", "p_access" "text", "p_refresh" "text", "p_expires_at" timestamp with time zone, "p_scope" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."strava_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."strava_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."strava_status"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."strava_update_tokens"("p_access" "text", "p_refresh" "text", "p_expires_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."strava_update_tokens"("p_access" "text", "p_refresh" "text", "p_expires_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."strava_update_tokens"("p_access" "text", "p_refresh" "text", "p_expires_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."touch_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "sabia"."ajustar_pesos"("p_user" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "sabia"."briefing_hoje"("p_user" "uuid", "p_data" "date") FROM PUBLIC;












GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."accounts" TO "authenticated";
GRANT ALL ON TABLE "airton"."accounts" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."ai_usage" TO "authenticated";
GRANT ALL ON TABLE "airton"."ai_usage" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "airton"."ai_usage_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "airton"."ai_usage_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."categories" TO "authenticated";
GRANT ALL ON TABLE "airton"."categories" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."chat_messages" TO "authenticated";
GRANT ALL ON TABLE "airton"."chat_messages" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "airton"."chat_messages_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "airton"."chat_messages_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."goals" TO "authenticated";
GRANT ALL ON TABLE "airton"."goals" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."installment_plans" TO "authenticated";
GRANT ALL ON TABLE "airton"."installment_plans" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."inv_alerts" TO "authenticated";
GRANT ALL ON TABLE "airton"."inv_alerts" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "airton"."inv_alerts_id_seq" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."inv_holdings" TO "authenticated";
GRANT ALL ON TABLE "airton"."inv_holdings" TO "service_role";



GRANT ALL ON TABLE "airton"."inv_movements" TO "authenticated";
GRANT ALL ON TABLE "airton"."inv_movements" TO "service_role";



GRANT ALL ON TABLE "airton"."inv_news" TO "authenticated";
GRANT ALL ON TABLE "airton"."inv_news" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "airton"."inv_news_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "airton"."inv_news_id_seq" TO "service_role";



GRANT ALL ON TABLE "airton"."inv_of" TO "authenticated";
GRANT ALL ON TABLE "airton"."inv_of" TO "service_role";



GRANT ALL ON TABLE "airton"."inv_plan" TO "authenticated";
GRANT ALL ON TABLE "airton"."inv_plan" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "airton"."inv_plan_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "airton"."inv_plan_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."inv_position" TO "authenticated";
GRANT ALL ON TABLE "airton"."inv_position" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."inv_prices" TO "authenticated";
GRANT ALL ON TABLE "airton"."inv_prices" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."inv_product_info" TO "authenticated";
GRANT ALL ON TABLE "airton"."inv_product_info" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."inv_snapshot" TO "authenticated";
GRANT ALL ON TABLE "airton"."inv_snapshot" TO "service_role";



GRANT SELECT ON TABLE "airton"."members" TO "authenticated";
GRANT ALL ON TABLE "airton"."members" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."notify_log" TO "authenticated";
GRANT ALL ON TABLE "airton"."notify_log" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "airton"."notify_log_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "airton"."notify_log_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."of_items" TO "authenticated";
GRANT ALL ON TABLE "airton"."of_items" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "airton"."push_subscriptions" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."rules" TO "authenticated";
GRANT ALL ON TABLE "airton"."rules" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."settings" TO "authenticated";
GRANT ALL ON TABLE "airton"."settings" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."sync_runs" TO "authenticated";
GRANT ALL ON TABLE "airton"."sync_runs" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "airton"."sync_runs_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "airton"."sync_runs_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."transactions" TO "authenticated";
GRANT ALL ON TABLE "airton"."transactions" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."v_ai_cost_month" TO "authenticated";
GRANT ALL ON TABLE "airton"."v_ai_cost_month" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."v_tx" TO "authenticated";
GRANT ALL ON TABLE "airton"."v_tx" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."v_installment_series" TO "authenticated";
GRANT ALL ON TABLE "airton"."v_installment_series" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."v_installment_schedule" TO "authenticated";
GRANT ALL ON TABLE "airton"."v_installment_schedule" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."v_inv_month" TO "authenticated";
GRANT ALL ON TABLE "airton"."v_inv_month" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."v_inv_position" TO "authenticated";
GRANT ALL ON TABLE "airton"."v_inv_position" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "airton"."v_planned_events" TO "authenticated";
GRANT ALL ON TABLE "airton"."v_planned_events" TO "service_role";



GRANT ALL ON TABLE "airton_private"."kv" TO "service_role";



GRANT ALL ON TABLE "core"."agent_runs" TO "service_role";
GRANT SELECT ON TABLE "core"."agent_runs" TO "authenticated";



GRANT SELECT,USAGE ON SEQUENCE "core"."agent_runs_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "core"."agent_runs_id_seq" TO "service_role";



GRANT ALL ON TABLE "core"."agents" TO "service_role";
GRANT SELECT ON TABLE "core"."agents" TO "authenticated";



GRANT ALL ON TABLE "core"."ai_usage" TO "service_role";
GRANT SELECT ON TABLE "core"."ai_usage" TO "authenticated";



GRANT SELECT,USAGE ON SEQUENCE "core"."ai_usage_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "core"."ai_usage_id_seq" TO "service_role";



GRANT ALL ON TABLE "core"."briefings" TO "service_role";
GRANT SELECT,UPDATE ON TABLE "core"."briefings" TO "authenticated";



GRANT SELECT,USAGE ON SEQUENCE "core"."briefings_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "core"."briefings_id_seq" TO "service_role";



GRANT ALL ON TABLE "core"."members" TO "service_role";
GRANT SELECT ON TABLE "core"."members" TO "authenticated";



GRANT ALL ON TABLE "core"."perfil" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."perfil" TO "authenticated";



GRANT ALL ON TABLE "core"."rotina" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "core"."rotina" TO "authenticated";



GRANT SELECT,USAGE ON SEQUENCE "core"."rotina_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "core"."rotina_id_seq" TO "service_role";



GRANT ALL ON TABLE "core"."v_ai_cost_all" TO "service_role";



GRANT ALL ON TABLE "core"."v_ai_cost_month" TO "service_role";
GRANT SELECT ON TABLE "core"."v_ai_cost_month" TO "authenticated";















GRANT ALL ON TABLE "public"."activities" TO "authenticated";
GRANT ALL ON TABLE "public"."activities" TO "service_role";



GRANT ALL ON SEQUENCE "public"."activities_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."activities_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."activities_id_seq" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ai_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_usage" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ai_usage_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ai_usage_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ai_usage_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."measurements" TO "authenticated";
GRANT ALL ON TABLE "public"."measurements" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."weight_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."weight_entries" TO "service_role";



GRANT ALL ON TABLE "public"."weight_daily" TO "anon";
GRANT ALL ON TABLE "public"."weight_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."weight_daily" TO "service_role";



GRANT ALL ON TABLE "public"."weight_with_trend" TO "anon";
GRANT ALL ON TABLE "public"."weight_with_trend" TO "authenticated";
GRANT ALL ON TABLE "public"."weight_with_trend" TO "service_role";



GRANT ALL ON TABLE "public"."body_comp_estimates" TO "anon";
GRANT ALL ON TABLE "public"."body_comp_estimates" TO "authenticated";
GRANT ALL ON TABLE "public"."body_comp_estimates" TO "service_role";



GRANT ALL ON TABLE "public"."coach_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."coach_reviews" TO "service_role";



GRANT ALL ON SEQUENCE "public"."coach_reviews_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."coach_reviews_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."coach_reviews_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."daily_activity" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_activity" TO "service_role";



GRANT ALL ON TABLE "public"."diet_recommendations" TO "authenticated";
GRANT ALL ON TABLE "public"."diet_recommendations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."diet_recommendations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."diet_recommendations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."diet_recommendations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."food_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."food_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."food_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."food_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."food_logs_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ingest_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."ingest_tokens" TO "service_role";



GRANT UPDATE("label") ON TABLE "public"."ingest_tokens" TO "authenticated";



GRANT UPDATE("revoked_at") ON TABLE "public"."ingest_tokens" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."ingest_tokens_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ingest_tokens_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ingest_tokens_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."measurements_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."measurements_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."measurements_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."medication_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."medication_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."medication_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."medication_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."medication_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."photo_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_reviews" TO "service_role";



GRANT ALL ON SEQUENCE "public"."photo_reviews_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."photo_reviews_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."photo_reviews_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."plan_changes" TO "authenticated";
GRANT ALL ON TABLE "public"."plan_changes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."plan_changes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."plan_changes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."plan_changes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."plan_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."plan_sessions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."plan_sessions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."plan_sessions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."plan_sessions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."progress_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."progress_photos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."progress_photos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."progress_photos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."progress_photos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."training_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."training_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."weekly_checkins" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_checkins" TO "service_role";



GRANT ALL ON SEQUENCE "public"."weekly_checkins_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."weekly_checkins_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."weekly_checkins_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."weight_entries_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."weight_entries_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."weight_entries_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."workout_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."workout_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."workout_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."workout_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."workout_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_plans" TO "service_role";



GRANT ALL ON SEQUENCE "public"."workout_plans_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."workout_plans_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."workout_plans_id_seq" TO "service_role";



GRANT ALL ON TABLE "sabia"."anotacoes" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "sabia"."anotacoes" TO "authenticated";



GRANT SELECT,USAGE ON SEQUENCE "sabia"."anotacoes_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "sabia"."anotacoes_id_seq" TO "service_role";



GRANT ALL ON TABLE "sabia"."fontes" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "sabia"."fontes" TO "authenticated";



GRANT ALL ON TABLE "sabia"."itens" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "sabia"."itens" TO "authenticated";



GRANT SELECT,USAGE ON SEQUENCE "sabia"."itens_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "sabia"."itens_id_seq" TO "service_role";



GRANT ALL ON TABLE "sabia"."leituras" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "sabia"."leituras" TO "authenticated";



GRANT SELECT,USAGE ON SEQUENCE "sabia"."leituras_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "sabia"."leituras_id_seq" TO "service_role";



GRANT ALL ON TABLE "sabia"."livros" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "sabia"."livros" TO "authenticated";



GRANT SELECT,USAGE ON SEQUENCE "sabia"."livros_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "sabia"."livros_id_seq" TO "service_role";



GRANT ALL ON TABLE "sabia"."temas" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "sabia"."temas" TO "authenticated";



GRANT ALL ON TABLE "sabia"."trilhas" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "sabia"."trilhas" TO "authenticated";



GRANT SELECT,USAGE ON SEQUENCE "sabia"."trilhas_id_seq" TO "authenticated";
GRANT SELECT,USAGE ON SEQUENCE "sabia"."trilhas_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "airton" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "airton" GRANT ALL ON FUNCTIONS TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "airton" GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "airton" GRANT ALL ON TABLES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































