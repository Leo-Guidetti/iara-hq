-- UX-06 · Alertas da ClaudIA com memória. As regras de apps/hub/lib/alerts.ts viram SQL e publicam em core.itens
-- (origem 'claudia', tipo 'alerta', chave = regra + semana ISO). Idempotente: core.publicar_item nunca desfaz o
-- status escolhido (feito, ignorado, adiado). Sem IA. Só aditiva.

create or replace function core.publicar_alertas_claudia(p_user uuid default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  u uuid;
  v_n int := 0;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  sem text := to_char((now() at time zone 'America/Sao_Paulo')::date, 'IYYY-"W"IW');
  al jsonb;
  a jsonb;
  v_last date; v_now numeric; v_wk numeric; v_two numeric; v_pct numeric; v_pct2 numeric;
  v_lw date;
  v_first record; v_lastc record; v_cn int; v_dl numeric; v_df numeric;
  v_photo date; v_prot numeric; v_days int; v_avg numeric;
  v_fx text; v_plan boolean; v_mat date; v_ck date;
begin
  for u in select m.user_id from core.members m where p_user is null or m.user_id = p_user loop
    al := '[]'::jsonb;

    -- Ritmo de perda de peso (tendência de 7 dias).
    select t.local_date, t.trend_7d into v_last, v_now
      from public.weight_with_trend t where t.user_id = u and t.local_date >= hoje - 21
     order by t.local_date desc limit 1;
    if v_last is not null then
      select t.trend_7d into v_wk from public.weight_with_trend t
       where t.user_id = u and t.local_date >= hoje - 21 and t.local_date <= v_last - 7 order by t.local_date desc limit 1;
      select t.trend_7d into v_two from public.weight_with_trend t
       where t.user_id = u and t.local_date >= hoje - 21 and t.local_date <= v_last - 14 order by t.local_date desc limit 1;
      if v_now is not null and v_wk is not null then
        v_pct := (v_now - v_wk) / v_wk * 100;
        v_pct2 := case when v_two is not null then (v_wk - v_two) / v_two * 100 end;
        if v_pct < -1 and v_pct2 is not null and v_pct2 < -1 then
          al := al || jsonb_build_object('k', 'perda_rapida', 'l', 'alert', 'h', '/saude/peso',
            't', 'Perda acima de 1% por semana há duas semanas (' || round(v_pct, 1)::text || '%): risco maior de perder massa magra. Vale falar com seu médico.');
        elsif v_pct < -1 then
          al := al || jsonb_build_object('k', 'perda_rapida', 'l', 'alert', 'h', '/saude/peso',
            't', 'Ritmo de ' || round(v_pct, 1)::text || '% nesta semana: acima de 1%. Garanta proteína e treino de força.');
        end if;
      end if;
    end if;

    -- Pesagem.
    select e.local_date into v_lw from public.weight_entries e where e.user_id = u order by e.measured_at desc limit 1;
    if v_lw is null or v_lw < hoje - 3 then
      al := al || jsonb_build_object('k', 'sem_pesagem', 'l', 'info', 'h', '/saude/peso',
        't', 'Sem pesagem há 3+ dias: a média de 7 dias fica menos confiável.');
    end if;

    -- Composição corporal.
    select count(*) into v_cn from public.body_comp_estimates c where c.user_id = u;
    if v_cn >= 2 then
      select c.local_date, c.lean_mass_kg, c.fat_mass_kg into v_first from public.body_comp_estimates c where c.user_id = u order by c.local_date asc limit 1;
      select c.local_date, c.lean_mass_kg, c.fat_mass_kg into v_lastc from public.body_comp_estimates c where c.user_id = u order by c.local_date desc limit 1;
      v_dl := v_lastc.lean_mass_kg - v_first.lean_mass_kg;
      v_df := v_lastc.fat_mass_kg - v_first.fat_mass_kg;
      if v_dl + v_df < 0 and v_dl / (v_dl + v_df) > 0.25 then
        al := al || jsonb_build_object('k', 'massa_magra', 'l', 'alert', 'h', '/saude/corpo',
          't', 'Cerca de ' || round(v_dl / (v_dl + v_df) * 100)::text || '% do que saiu desde ' || v_first.local_date::text || ' parece massa magra.');
      end if;
    end if;
    if v_cn = 0 or (select max(c.local_date) from public.body_comp_estimates c where c.user_id = u) < hoje - 14 then
      al := al || jsonb_build_object('k', 'fita', 'l', 'info', 'h', '/saude/corpo',
        't', 'Medidas de fita com mais de 14 dias: meça cintura e pescoço.');
    end if;

    -- Fotos.
    select max(p.local_date) into v_photo from public.progress_photos p where p.user_id = u;
    if v_photo is null or v_photo < hoje - 28 then
      al := al || jsonb_build_object('k', 'fotos', 'l', 'info', 'h', '/saude/corpo', 't', 'Fotos de progresso com mais de 4 semanas.');
    end if;

    -- Proteína (última recomendação de dieta, 7 dias fechados antes de hoje).
    select d.protein_g_target into v_prot from public.diet_recommendations d where d.user_id = u order by d.created_at desc limit 1;
    if coalesce(v_prot, 0) > 0 then
      select count(*), avg(s) into v_days, v_avg from (
        select sum(coalesce(f.protein_g, 0)) s from public.food_logs f
         where f.user_id = u and f.local_date >= hoje - 7 and f.local_date < hoje group by f.local_date) x;
      if v_days >= 3 and v_avg < v_prot * 0.9 then
        al := al || jsonb_build_object('k', 'proteina', 'l', 'alert', 'h', '/saude/dieta',
          't', 'Proteína média de ' || round(v_avg)::text || ' g nos últimos 7 dias, abaixo da meta de ' || trim_scale(v_prot)::text || ' g.');
      end if;
    end if;

    -- Efeitos colaterais (10 dias).
    select string_agg(x.e, ', ' order by x.o) into v_fx from (
      select e, min(o) o from (
        select fx.e, row_number() over (order by m.administered_at desc, fx.n) o
          from public.medication_logs m, unnest(m.side_effects) with ordinality fx(e, n)
         where m.user_id = u and m.local_date >= hoje - 10) y group by e) x;
    if v_fx is not null then
      al := al || jsonb_build_object('k', 'efeitos', 'l', 'alert', 'h', '/saude/dieta',
        't', 'Efeitos colaterais registrados: ' || v_fx || '. Se persistirem, fale com quem prescreveu.');
    end if;

    -- Plano de treino.
    select true, w.materialized_through into v_plan, v_mat from public.workout_plans w where w.user_id = u and w.is_active order by w.id desc limit 1;
    if coalesce(v_plan, false) and (v_mat is null or v_mat < hoje + 3) then
      al := al || jsonb_build_object('k', 'plano_treino', 'l', 'info', 'h', '/saude/treino',
        't', 'O plano de treino acaba em menos de 3 dias: estenda ou gere um novo.');
    end if;

    -- Check-in da semana passada.
    select max(c.week_start) into v_ck from public.weekly_checkins c where c.user_id = u;
    if v_ck is null or v_ck < date_trunc('week', hoje)::date - 7 then
      al := al || jsonb_build_object('k', 'checkin', 'l', 'info', 'h', '/saude/treino', 't', 'Check-in da última semana ainda não feito.');
    end if;

    for a in select * from jsonb_array_elements(al) loop
      perform core.publicar_item(jsonb_build_object(
        'user_id', u, 'origem', 'claudia', 'tipo', 'alerta',
        'titulo', a ->> 't', 'chave_origem', 'alerta:' || (a ->> 'k') || ':' || sem,
        'data', hoje, 'janela', 'semana',
        'prioridade', case a ->> 'l' when 'alert' then 'alta' else 'media' end,
        'acao', jsonb_build_object('url', a ->> 'h', 'rotulo', 'Abrir')));
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end $$;
revoke all on function core.publicar_alertas_claudia(uuid) from public, anon, authenticated;
grant execute on function core.publicar_alertas_claudia(uuid) to service_role;

-- Hub: alertas abertos desta semana (pendentes, ou adiados cuja data chegou). Ignorado/feito saem da contagem.
create or replace function public.hub_alertas() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select m.user_id from core.members m where m.user_id = auth.uid()),
  hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  a as (
    select i.* from core.itens i, me, hoje
     where i.user_id = me.user_id and i.origem = 'claudia' and i.tipo = 'alerta'
       and i.data >= date_trunc('week', hoje.d)::date
       and (i.status = 'pendente' or (i.status = 'adiado' and coalesce(i.adiado_para, i.data) <= hoje.d))
  )
  select case when not exists (select 1 from me) then null else jsonb_build_object(
    'total', (select count(*) from a),
    'itens', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'titulo', a.titulo, 'prioridade', a.prioridade,
                         'acao', a.acao, 'status', a.status, 'data', a.data)
                       order by (a.prioridade = 'alta') desc, a.id) from a), '[]'::jsonb)) end;
$$;
revoke all on function public.hub_alertas() from public, anon;
grant execute on function public.hub_alertas() to authenticated;

-- Cron diário 09:50 UTC (06:50 SP, antes do briefing das 07:00). Sem IA.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'claudia-alertas') then perform cron.unschedule('claudia-alertas'); end if;
  perform cron.schedule('claudia-alertas', '50 9 * * *', $c$ select core.publicar_alertas_claudia() $c$);
end $$;
