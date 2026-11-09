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
      'income', round(coalesce(sum(amount_brl) filter (where kind = 'income'), 0), 2),
      'spend', round(coalesce(sum(spend) filter (where nature not in ('renda','transferencia','investimento')), 0), 2),
      'variavel', round(coalesce(sum(spend) filter (where nature = 'variavel'), 0), 2),
      'fixo', round(coalesce(sum(spend) filter (where nature = 'fixo'), 0), 2),
      'eventual', round(coalesce(sum(spend) filter (where nature = 'eventual'), 0), 2),
      'parcelas', round(coalesce(sum(spend) filter (where is_installment and nature not in ('renda','transferencia','investimento')), 0), 2),
      'investido', round(coalesce(-sum(amount_brl) filter (where nature = 'investimento'), 0), 2))
      into v_real
      from airton.v_tx where user_id = v_user and date >= m and date < m + interval '1 month' and date <= v_today;

    if m < v_cur then
      v_row := v_real || jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'status', 'real',
        'net', round((v_real->>'income')::numeric - (v_real->>'spend')::numeric, 2));
    else
      v_mp := airton.month_plan(m, v_user);
      v_row := jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'status', case when m = v_cur then 'atual' else 'proj' end,
        'real', v_real,
        'income', round(greatest((v_mp->'income'->>'expected')::numeric, (v_real->>'income')::numeric), 2),
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

  -- categorias (top-level) × mês, só realizado
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

  -- acumulado até hoje vs mesmo período do ano anterior
  select jsonb_build_object('income', round(coalesce(sum(amount_brl) filter (where kind = 'income'), 0), 2),
                            'spend', round(coalesce(sum(spend) filter (where nature not in ('renda','transferencia','investimento')), 0), 2))
    into v_ytd from airton.v_tx where user_id = v_user and date >= v_y0 and date <= least(v_today, make_date(v_year, 12, 31));
  select jsonb_build_object('income', round(coalesce(sum(amount_brl) filter (where kind = 'income'), 0), 2),
                            'spend', round(coalesce(sum(spend) filter (where nature not in ('renda','transferencia','investimento')), 0), 2))
    into v_prev from airton.v_tx where user_id = v_user and date >= make_date(v_year - 1, 1, 1)
      and date <= (least(v_today, make_date(v_year, 12, 31)) - interval '1 year');

  return jsonb_build_object('year', v_year, 'today', v_today, 'targetRate', v_pct, 'months', v_months, 'categories', v_cats, 'ytd', v_ytd, 'prevYtd', v_prev);
end $$;
grant execute on function airton.year_series(int, uuid) to authenticated;;
