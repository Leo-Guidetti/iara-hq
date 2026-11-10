-- Etapa 5 · Planejamento da semana (pedido do Leo, 09/11): domingo à noite a IARA monta a semana inteira
-- (treinos, estudos, dieta, contas, casa) tudo junto: a carga de treino da semana manda na dieta de cada dia,
-- e o estudo e a casa se encaixam no que sobra. O Leo revisa em /semana e confirma; ao confirmar, as adaptações
-- de treino vão para a ClaudIA (public.plan_sessions). Só aditiva.

-- 1) Plano e itens. Escrita só pela Edge Function (service role) e pelas RPCs abaixo.
create table if not exists core.planos_semana (
  id            bigint generated always as identity primary key,
  user_id       uuid not null,
  semana        date not null,                       -- segunda-feira da semana
  status        text not null default 'rascunho' check (status in ('rascunho', 'confirmado')),
  resumo        text,
  insumos       jsonb,
  run_id        bigint,
  created_at    timestamptz not null default now(),
  confirmado_em timestamptz,
  unique (user_id, semana)
);

create table if not exists core.planos_semana_itens (
  id        bigint generated always as identity primary key,
  plano_id  bigint not null references core.planos_semana (id) on delete cascade,
  user_id   uuid not null,
  data      date not null,
  hora      time,
  area      text not null check (area in ('saude', 'financas', 'aprender', 'casa')),
  titulo    text not null,
  detalhe   text,
  minutos   int,
  valor     numeric(12, 2),
  ref       text,                                     -- treino:<id> | conta:<data>:<n> (evita duplicar na Hoje)
  treino    jsonb,                                    -- sessão nova proposta: {"esporte", "intensidade"}
  ordem     int not null default 0,
  incluido  boolean not null default true,
  item_id   bigint                                    -- core.itens publicado ao confirmar
);
create index if not exists planos_semana_itens_plano on core.planos_semana_itens (plano_id, data);

alter table core.planos_semana enable row level security;
alter table core.planos_semana_itens enable row level security;
create policy planos_semana_dono on core.planos_semana for select to authenticated using (user_id = auth.uid());
create policy planos_semana_itens_dono on core.planos_semana_itens for select to authenticated using (user_id = auth.uid());
revoke all on core.planos_semana, core.planos_semana_itens from anon;

-- 2) Insumos da semana (segunda p_inicio a domingo p_inicio + 6), para a função iara-semana.
create or replace function core.coletar_semana(p_user uuid, p_inicio date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_fim date := p_inicio + 6;
  v_contas jsonb := '[]'::jsonb;
  v_fin jsonb;
  v_mp jsonb;
  v_mes date;
begin
  -- AIrton: contas e entradas previstas na semana (pode cruzar dois meses) + folga do mês.
  for v_mes in select distinct date_trunc('month', d)::date from (values (p_inicio), (v_fim)) t(d) loop
    begin
      v_mp := airton.month_plan(p_month => v_mes, p_user => p_user);
      v_contas := v_contas || coalesce((
        select jsonb_agg(u order by u ->> 'date')
          from jsonb_array_elements(v_mp -> 'upcoming') u
         where (u ->> 'date')::date between p_inicio and v_fim), '[]'::jsonb);
      if v_fin is null then
        v_fin := jsonb_build_object('livre_mes', v_mp -> 'available', 'por_dia', v_mp -> 'perDay',
                                    'dias_restantes', v_mp -> 'daysLeft', 'gasto_mes', v_mp -> 'spentTotal',
                                    'categorias_apertadas', coalesce((
                                      select jsonb_agg(jsonb_build_object('nome', c ->> 'name', 'gasto', c -> 'spent', 'orcamento', c -> 'budget'))
                                        from jsonb_array_elements(v_mp -> 'categories') c
                                       where (c ->> 'budget') is not null and (c ->> 'spent')::numeric >= 0.8 * (c ->> 'budget')::numeric), '[]'::jsonb));
      end if;
    exception when others then
      v_fin := coalesce(v_fin, jsonb_build_object('erro', sqlerrm));
    end;
  end loop;

  return jsonb_build_object(
    'semana', jsonb_build_object('inicio', p_inicio, 'fim', v_fim),
    'rotina', coalesce((
      select jsonb_agg(jsonb_build_object('dias', r.dias, 'hora', to_char(r.hora, 'HH24:MI'), 'minutos', r.minutos,
                                          'atividade', r.atividade, 'agent', r.agent) order by r.hora)
        from core.rotina r where r.user_id = p_user and r.ativo), '[]'::jsonb),
    'saude', jsonb_build_object(
      'treinos', coalesce((
        select jsonb_agg(jsonb_build_object('ref', 'treino:' || s.id, 'data', s.local_date, 'esporte', s.sport, 'titulo', s.title,
                                            'intensidade', s.intensity, 'minutos', s.duration_min, 'km', s.distance_km, 'status', s.status)
                         order by s.local_date)
          from public.plan_sessions s
         where s.user_id = p_user and s.local_date between p_inicio and v_fim), '[]'::jsonb),
      'plano_treino_ate', (select max(s.local_date) from public.plan_sessions s where s.user_id = p_user),
      'plano_treino', (select jsonb_build_object('objetivo', w.goal, 'racional', left(w.rationale, 400))
                         from public.workout_plans w where w.user_id = p_user and w.is_active order by w.id desc limit 1),
      -- Para adaptar: o que foi feito na semana que passou e o padrão recente (se o plano acabar, repete o padrão).
      'semana_passada', (select jsonb_build_object('previstos', count(*), 'feitos', count(*) filter (where s.status = 'done'),
                                                   'pulados', count(*) filter (where s.status = 'skipped'))
                           from public.plan_sessions s where s.user_id = p_user and s.local_date between p_inicio - 7 and p_inicio - 1),
      'padrao_recente', coalesce((
        select jsonb_agg(jsonb_build_object('dia_semana', extract(isodow from x.local_date)::int, 'esporte', x.sport, 'titulo', x.title,
                                            'intensidade', x.intensity, 'minutos', x.duration_min) order by x.local_date)
          from (select * from public.plan_sessions s where s.user_id = p_user and s.local_date < p_inicio
                 order by s.local_date desc limit 8) x), '[]'::jsonb),
      'comida_7d', (select jsonb_build_object('dias_registrados', count(distinct f.local_date),
                                              'kcal_media', round(sum(f.kcal)::numeric / nullif(count(distinct f.local_date), 0)),
                                              'proteina_media_g', round(sum(f.protein_g) / nullif(count(distinct f.local_date), 0)))
                      from public.food_logs f where f.user_id = p_user and f.local_date between p_inicio - 7 and p_inicio - 1),
      'peso', (select jsonb_build_object('tendencia_7d', w.trend_7d, 'em', w.local_date,
                                         'tendencia_14d_atras', (select w2.trend_7d from public.weight_with_trend w2
                                                                  where w2.user_id = p_user and w2.local_date <= w.local_date - 14
                                                                  order by w2.local_date desc limit 1))
                 from public.weight_with_trend w where w.user_id = p_user and w.trend_7d is not null order by w.local_date desc limit 1),
      'dieta', (select jsonb_build_object('kcal', d.kcal_target, 'proteina_g', d.protein_g_target, 'racional', left(d.rationale, 400), 'em', d.created_at::date)
                  from public.diet_recommendations d where d.user_id = p_user order by d.created_at desc limit 1),
      'checkin', (select jsonb_build_object('semana', w.week_start, 'nota', w.score, 'foco', w.payload -> 'focus_of_week',
                                            'proximos_passos', w.payload -> 'next_steps')
                    from public.weekly_checkins w where w.user_id = p_user order by w.week_start desc limit 1)
    ),
    'financas', coalesce(v_fin, '{}'::jsonb) || jsonb_build_object('contas_semana',
      (select coalesce(jsonb_agg(c || jsonb_build_object('ref', 'conta:' || (c ->> 'date') || ':' || n)), '[]'::jsonb)
         from jsonb_array_elements(v_contas) with ordinality as x(c, n))),
    'aprender', jsonb_build_object(
      'minutos_trilha', (select p.config -> 'minutos_trilha' from core.perfil p where p.user_id = p_user),
      'temas', coalesce((select jsonb_agg(jsonb_build_object('nome', t.nome, 'peso', t.peso) order by t.peso desc)
                           from sabia.temas t where t.ativo), '[]'::jsonb),
      'livros', coalesce((select jsonb_agg(jsonb_build_object('titulo', l.titulo, 'autor', l.autor, 'paginas', l.paginas, 'pagina_atual', l.pagina_atual))
                            from sabia.livros l where l.user_id = p_user and l.status = 'lendo'), '[]'::jsonb),
      'trilhas_ultima_semana', (select jsonb_build_object('feitas', count(*) filter (where t.status = 'concluida'), 'total', count(*))
                                  from sabia.trilhas t where t.user_id = p_user and t.data between p_inicio - 7 and p_inicio - 1)
    ),
    'casa', coalesce((
      select jsonb_agg(jsonb_build_object('titulo', i.titulo, 'data', i.data, 'tipo', i.tipo) order by i.data)
        from core.itens i
       where i.user_id = p_user and i.origem = 'iara' and i.status in ('pendente', 'adiado')
         and coalesce(i.chave_origem, '') not like 'semana:%'), '[]'::jsonb)
  );
end $$;
revoke all on function core.coletar_semana(uuid, date) from public, anon, authenticated;
grant execute on function core.coletar_semana(uuid, date) to service_role;

-- 3) Hub: plano da semana. Domingo mostra o da semana que vem (se já existir); nos outros dias, o da semana atual.
create or replace function public.hub_semana() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select m.user_id from core.members m where m.user_id = auth.uid()),
  hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  p as (
    select ps.* from core.planos_semana ps, me, hoje
     where ps.user_id = me.user_id
       and ps.semana in (date_trunc('week', hoje.d)::date, case when extract(dow from hoje.d) = 0 then hoje.d + 1 end)
     order by ps.semana desc limit 1
  )
  select case when not exists (select 1 from me) then null else (
    select jsonb_build_object(
      'id', p.id, 'semana', p.semana, 'status', p.status, 'resumo', p.resumo,
      'criado_em', p.created_at, 'confirmado_em', p.confirmado_em,
      'itens', coalesce((
        select jsonb_agg(jsonb_build_object('id', i.id, 'data', i.data, 'hora', to_char(i.hora, 'HH24:MI'), 'area', i.area,
                                            'titulo', i.titulo, 'detalhe', i.detalhe, 'minutos', i.minutos, 'valor', i.valor,
                                            'incluido', i.incluido, 'status', ci.status)
                         order by i.data, i.hora nulls last, i.ordem)
          from core.planos_semana_itens i left join core.itens ci on ci.id = i.item_id
         where i.plano_id = p.id), '[]'::jsonb))
      from p) end;
$$;
revoke all on function public.hub_semana() from public, anon;
grant execute on function public.hub_semana() to authenticated;

-- Itens de hoje do plano confirmado, para a linha do tempo "Seu dia" (ref evita repetir treino/conta).
create or replace function public.hub_semana_hoje() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select m.user_id from core.members m where m.user_id = auth.uid()),
  hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
  select case when not exists (select 1 from me) then null else coalesce((
    select jsonb_agg(jsonb_build_object('hora', to_char(i.hora, 'HH24:MI'), 'area', i.area, 'titulo', i.titulo,
                                        'minutos', i.minutos, 'ref', i.ref, 'feito', ci.status = 'feito')
                     order by i.hora nulls last, i.ordem)
      from core.planos_semana_itens i
      join core.planos_semana p on p.id = i.plano_id and p.status = 'confirmado'
      left join core.itens ci on ci.id = i.item_id, me, hoje
     where i.user_id = me.user_id and i.data = hoje.d and i.incluido), '[]'::jsonb) end;
$$;
revoke all on function public.hub_semana_hoje() from public, anon;
grant execute on function public.hub_semana_hoje() to authenticated;

-- Tirar/voltar um item do rascunho.
create or replace function public.hub_semana_item(p_id bigint, p_incluido boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  update core.planos_semana_itens i set incluido = p_incluido
    from core.planos_semana p
   where i.id = p_id and p.id = i.plano_id and p.status = 'rascunho'
     and i.user_id = auth.uid() and exists (select 1 from core.members m where m.user_id = auth.uid());
  get diagnostics v_ok = row_count;
  return v_ok;
end $$;
revoke all on function public.hub_semana_item(bigint, boolean) from public, anon;
grant execute on function public.hub_semana_item(bigint, boolean) to authenticated;

-- Confirmar: publica cada item incluído em core.itens (chave semana:<data>:<id>) e trava o plano.
create or replace function public.hub_semana_confirmar(p_plano bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  r record;
  n int := 0;
  v_ref text;
begin
  if not exists (select 1 from core.members m where m.user_id = v_user) then return 0; end if;
  if not exists (select 1 from core.planos_semana p where p.id = p_plano and p.user_id = v_user and p.status = 'rascunho') then
    return 0;
  end if;
  for r in select * from core.planos_semana_itens i where i.plano_id = p_plano and i.incluido order by i.data, i.ordem loop
    -- Treino: a adaptação vai para a ClaudIA. Sessão existente muda de dia/duração; sessão nova entra no plano ativo.
    if r.area = 'saude' and r.ref like 'treino:%' then
      update public.plan_sessions s
         set local_date = r.data,
             duration_min = coalesce(least(greatest(r.minutos, 5), 480), s.duration_min),
             edited = true, updated_at = now()
       where s.id = substring(r.ref from 8)::bigint and s.user_id = v_user and s.status = 'planned'
         and (s.local_date <> r.data or s.duration_min is distinct from coalesce(least(greatest(r.minutos, 5), 480), s.duration_min));
    elsif r.area = 'saude' and r.ref is null and r.treino is not null then
      insert into public.plan_sessions (user_id, plan_id, local_date, sport, title, intensity, duration_min, status, origin)
      values (v_user,
              (select w.id from public.workout_plans w where w.user_id = v_user and w.is_active order by w.id desc limit 1),
              r.data, r.treino ->> 'esporte', left(r.titulo, 120), coalesce(r.treino ->> 'intensidade', 'moderate'),
              least(greatest(coalesce(r.minutos, 45), 5), 480), 'planned', 'ai')
      returning 'treino:' || id into v_ref;
      update core.planos_semana_itens set ref = v_ref where id = r.id;
    end if;
    update core.planos_semana_itens set item_id = core.publicar_item(jsonb_build_object(
      'user_id', v_user,
      'origem', case r.area when 'saude' then 'claudia' when 'financas' then 'airton' when 'aprender' then 'sabia' else 'iara' end,
      'tipo', 'tarefa',
      'titulo', r.titulo,
      'detalhe', r.detalhe,
      'data', r.data,
      'hora', r.hora,
      'janela', 'dia',
      'minutos', r.minutos,
      'acao', jsonb_build_object('url', case r.area when 'saude' then '/saude' when 'financas' then '/financas'
                                                    when 'aprender' then '/aprender' else '/casa' end),
      'chave_origem', 'semana:' || r.data || ':' || r.id))
     where id = r.id;
    n := n + 1;
  end loop;
  update core.planos_semana set status = 'confirmado', confirmado_em = now() where id = p_plano;
  return n;
end $$;
revoke all on function public.hub_semana_confirmar(bigint) from public, anon;
grant execute on function public.hub_semana_confirmar(bigint) to authenticated;

-- 4) Resumo para o push de domingo (airton-notify, tipo 'semana').
create or replace function airton.semana_push(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('semana', p.semana, 'status', p.status,
           'itens', (select count(*) from core.planos_semana_itens i where i.plano_id = p.id),
           'por_area', (select jsonb_object_agg(area, n) from (select i.area, count(*) n from core.planos_semana_itens i
                                                                 where i.plano_id = p.id group by 1) a))
    from core.planos_semana p
   where p.user_id = p_user and p.semana = ((now() at time zone 'America/Sao_Paulo')::date + 1)
$$;
revoke all on function airton.semana_push(uuid) from public, anon, authenticated;
grant execute on function airton.semana_push(uuid) to service_role;

-- 5) Cron: domingo 21:00 UTC (18:00 SP); o push sai 19:30 SP e o Leo revisa às 20:00 (rotina).
do $$ begin
  if exists (select 1 from cron.job where jobname = 'iara-semana') then perform cron.unschedule('iara-semana'); end if;
  perform cron.schedule('iara-semana', '0 21 * * 0', $c$ select core_private.call_function('iara-semana') $c$);
end $$;
