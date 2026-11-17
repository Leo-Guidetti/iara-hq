-- UX-14: quando algo muda, o plano reage. Aditivo e idempotente.
--  (a) gatilhos determinísticos em core.planos_atualizar -> eventos 'gatilho' em core.plano_eventos (dados.chave estável);
--  (b) core.coletar_semana traz as metas ativas; hub_semana expõe meta_id e plano do item;
--  (c) rascunho da semana preserva o que o Leo moveu ou tirou (planos_semana_itens.editado);
--  (d) revisão mensal: propostas de ajuste em core.plano_propostas (a IARA propõe, o Leo decide).

-- Estado das checagens (contadores/snapshots dos gatilhos). Escopo 'meta:<id>' ou 'usuario'. Sem acesso pela Data API.
create table if not exists core.plano_checagens (
  user_id uuid not null,
  escopo  text not null,
  dados   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, escopo)
);
alter table core.plano_checagens enable row level security;
revoke all on core.plano_checagens from public, anon, authenticated;

alter table core.planos_semana_itens add column if not exists editado boolean not null default false;

-- Grava um gatilho uma única vez por chave (idempotente). Retorna 1 se gravou.
create or replace function core.plano_gatilho_emitir(p_plano bigint, p_meta bigint, p_chave text, p_dados jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare c int;
begin
  insert into core.plano_eventos (plano_id, meta_id, tipo, origem, dados)
  select p_plano, p_meta, 'gatilho', 'sistema', p_dados || jsonb_build_object('chave', p_chave)
   where not exists (select 1 from core.plano_eventos e where e.plano_id = p_plano and e.tipo = 'gatilho' and e.dados ->> 'chave' = p_chave);
  get diagnostics c = row_count;
  return c;
end $$;

-- Gatilhos (sem IA), 1x por dia pelo job iara-planos-progresso, depois de core.planos_atualizar recalcular o ritmo:
--  meta_atrasada   ritmo 'atrasada' em 2 checagens (dias) seguidas; chave meta_atrasada:<meta>:<dia em que o atraso começou>
--  prazo_alterado  prazo da meta diferente do último visto;           chave prazo_alterado:<meta>:<novo prazo>
--  sem_registro    progresso da meta sem mudar há 14 dias;             chave sem_registro:<meta>:<dia em que parou>
--  renda_prevista  renda prevista do mês (airton.month_plan -> income.expected) difere > 10% da do mês anterior;
--                  chave renda_prevista:<AAAA-MM>  (um evento por plano ativo)
--  fixo_novo       core.recursos_de.minutos_livres_semana caiu > 120 vs. o último snapshot; chave fixo_novo:<dia> (por plano ativo)
-- Retorna quantos eventos novos gravou. Rodar de novo no mesmo dia não duplica nada.
create or replace function core.planos_gatilhos(p_user uuid default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_mes date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  m record; u record; st jsonb; n int := 0; v_seg int; v_atr date; v_prazo text; v_pv numeric; v_pdesde date; v_novo boolean;
  v_min numeric; v_snap numeric; v_cur numeric; v_prev numeric;
begin
  for m in
    select pm.*, pl.user_id as uid from core.plano_metas pm
      join core.planos pl on pl.id = pm.plano_id and pl.status = 'ativo'
     where pm.status = 'ativa' and (p_user is null or pl.user_id = p_user) order by pm.id
  loop
    select c.dados into st from core.plano_checagens c where c.user_id = m.uid and c.escopo = 'meta:' || m.id;
    v_novo := st is null; st := coalesce(st, '{}'::jsonb);
    -- atraso: o contador só anda uma vez por dia
    v_seg := coalesce((st ->> 'atrasadas_seguidas')::int, 0); v_atr := (st ->> 'atrasada_desde')::date;
    if v_novo or coalesce((st ->> 'dia')::date, '1970-01-01') < v_hoje then
      if m.ritmo = 'atrasada' then v_atr := case when v_seg > 0 then coalesce(v_atr, v_hoje) else v_hoje end; v_seg := v_seg + 1;
      else v_seg := 0; v_atr := null; end if;
    end if;
    if v_seg >= 2 then
      n := n + core.plano_gatilho_emitir(m.plano_id, m.id, 'meta_atrasada:' || m.id || ':' || coalesce(v_atr, v_hoje),
        jsonb_build_object('gatilho', 'meta_atrasada', 'meta', m.titulo, 'checagens', v_seg, 'desde', v_atr, 'progresso', m.progresso));
    end if;
    -- prazo alterado (compara com o último valor registrado; a primeira checagem só registra)
    v_prazo := coalesce(m.prazo::text, '');
    if st ? 'prazo_visto' and (st ->> 'prazo_visto') is distinct from v_prazo then
      n := n + core.plano_gatilho_emitir(m.plano_id, m.id, 'prazo_alterado:' || m.id || ':' || coalesce(nullif(v_prazo, ''), 'sem'),
        jsonb_build_object('gatilho', 'prazo_alterado', 'meta', m.titulo, 'anterior', nullif(st ->> 'prazo_visto', ''), 'novo', nullif(v_prazo, '')));
    end if;
    -- 14 dias sem registro: progresso parado
    v_pv := (st ->> 'progresso_visto')::numeric; v_pdesde := (st ->> 'progresso_desde')::date;
    if not (st ? 'progresso_visto') or v_pdesde is null or m.progresso is distinct from v_pv then v_pdesde := v_hoje; end if;
    if m.progresso is not null and v_hoje - v_pdesde >= 14 then
      n := n + core.plano_gatilho_emitir(m.plano_id, m.id, 'sem_registro:' || m.id || ':' || v_pdesde,
        jsonb_build_object('gatilho', 'sem_registro', 'meta', m.titulo, 'dias', v_hoje - v_pdesde, 'progresso', m.progresso));
    end if;
    insert into core.plano_checagens (user_id, escopo, dados, updated_at)
    values (m.uid, 'meta:' || m.id, jsonb_build_object('dia', v_hoje, 'atrasadas_seguidas', v_seg, 'atrasada_desde', v_atr,
            'prazo_visto', v_prazo, 'progresso_visto', m.progresso, 'progresso_desde', v_pdesde), now())
    on conflict (user_id, escopo) do update set dados = excluded.dados, updated_at = now();
  end loop;

  -- por usuário: renda prevista e tempo livre
  for u in
    select distinct pl.user_id as uid from core.planos pl
     where pl.status = 'ativo' and (p_user is null or pl.user_id = p_user)
  loop
    begin
      v_cur := (airton.month_plan(v_mes, u.uid) -> 'income' ->> 'expected')::numeric;
      v_prev := (airton.month_plan((v_mes - interval '1 month')::date, u.uid) -> 'income' ->> 'expected')::numeric;
      if coalesce(v_prev, 0) > 0 and v_cur is not null and abs(v_cur - v_prev) / v_prev > 0.10 then
        n := n + coalesce((select sum(core.plano_gatilho_emitir(pl.id, null, 'renda_prevista:' || to_char(v_mes, 'YYYY-MM'),
              jsonb_build_object('gatilho', 'renda_prevista', 'atual', v_cur, 'anterior', v_prev, 'variacao_pct', round((v_cur - v_prev) / v_prev * 100, 1))))
              from core.planos pl where pl.user_id = u.uid and pl.status = 'ativo'), 0);
      end if;
    exception when others then null; end;
    begin
      select r.minutos_livres_semana into v_min from core.recursos_de(u.uid) r;
      select (c.dados ->> 'minutos_livres_semana')::numeric into v_snap from core.plano_checagens c where c.user_id = u.uid and c.escopo = 'usuario';
      if v_min is not null then
        if v_snap is not null and v_snap - v_min > 120 then
          n := n + coalesce((select sum(core.plano_gatilho_emitir(pl.id, null, 'fixo_novo:' || v_hoje,
                jsonb_build_object('gatilho', 'fixo_novo', 'minutos_antes', v_snap, 'minutos_agora', v_min, 'perda_min', v_snap - v_min)))
                from core.planos pl where pl.user_id = u.uid and pl.status = 'ativo'), 0);
        end if;
        -- a base só sobe ou se renova depois de disparar (queda pequena não vira base: queda lenta ainda dispara)
        if v_snap is null or v_min > v_snap or v_snap - v_min > 120 then
          insert into core.plano_checagens (user_id, escopo, dados, updated_at)
          values (u.uid, 'usuario', jsonb_build_object('minutos_livres_semana', v_min, 'em', v_hoje), now())
          on conflict (user_id, escopo) do update set dados = excluded.dados, updated_at = now();
        end if;
      end if;
    exception when others then null; end;
  end loop;
  return n;
end $$;
revoke all on function core.plano_gatilho_emitir(bigint, bigint, text, jsonb), core.planos_gatilhos(uuid) from public, anon, authenticated;
grant execute on function core.plano_gatilho_emitir(bigint, bigint, text, jsonb), core.planos_gatilhos(uuid) to service_role;

-- planos_atualizar: igual ao UX-09 + chama os gatilhos no fim (retorna também 'gatilhos').
create or replace function core.planos_atualizar(p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  m core.plano_metas; x record; v_uid uuid; v_fn text; r jsonb; v_prog numeric; v_esp numeric; v_ini date; v_prazo date;
  v_ritmo text; v_erro text; n int := 0; mud int := 0; err int := 0; v_g int := 0;
begin
  for x in
    select pm as meta, pl.user_id as uid, a.progresso_fn as fn from core.plano_metas pm
      join core.planos pl on pl.id = pm.plano_id and pl.status = 'ativo'
      left join core.agents a on a.slug = pm.dono
     where pm.status in ('ativa', 'concluida') and (p_user is null or pl.user_id = p_user)
     order by pm.id
  loop
    m := x.meta; v_uid := x.uid; v_fn := x.fn;
    n := n + 1; v_erro := null; v_prog := null; v_esp := null; v_ritmo := 'sem_dados'; r := null;
    begin
      if v_fn is null then raise exception 'agente sem progresso_fn'; end if;
      execute format('select %s($1, $2)', v_fn) into r using v_uid, m;
      v_prog := (r ->> 'progresso')::numeric;
      if v_prog is not null then v_prog := least(greatest(v_prog, 0), 1); end if;
      if v_prog is not null then
        v_esp := (r ->> 'esperado')::numeric;
        if v_esp is null then
          v_ini := coalesce(nullif(m.medida ->> 'inicio', '')::date, (r ->> 'inicio')::date, m.created_at::date);
          v_prazo := coalesce(m.prazo, (r ->> 'prazo')::date);
          if v_prazo is not null then
            v_esp := case when v_prazo <= v_ini then (case when v_hoje >= v_prazo then 1 else 0 end)
                          else least(greatest((v_hoje - v_ini)::numeric / (v_prazo - v_ini), 0), 1) end;
          end if;
        end if;
        if v_esp is not null then
          v_ritmo := case when v_prog < v_esp - 0.10 then 'atrasada' when v_prog > v_esp + 0.10 then 'adiantada' else 'no_ritmo' end;
        end if;
      end if;
    exception when others then
      v_erro := sqlerrm; v_prog := null; v_ritmo := 'sem_dados'; err := err + 1;
    end;

    if m.ritmo is distinct from v_ritmo then
      insert into core.plano_eventos (plano_id, meta_id, tipo, origem, dados)
      values (m.plano_id, m.id, 'progresso', 'sistema', jsonb_build_object(
        'ritmo_anterior', m.ritmo, 'ritmo', v_ritmo, 'progresso', round(v_prog, 4), 'esperado', round(v_esp, 4),
        'valor_atual', r -> 'valor_atual', 'alvo', r -> 'alvo', 'erro', v_erro));
      mud := mud + 1;
    end if;
    update core.plano_metas pm set progresso = coalesce(round(v_prog, 4), pm.progresso), ritmo = v_ritmo, updated_at = now()
     where pm.id = m.id and (pm.progresso is distinct from coalesce(round(v_prog, 4), pm.progresso) or pm.ritmo is distinct from v_ritmo);
  end loop;
  -- UX-14: gatilhos determinísticos (idempotentes). Falha deles não derruba o progresso.
  begin v_g := core.planos_gatilhos(p_user); exception when others then v_g := -1; end;
  return jsonb_build_object('metas', n, 'mudaram', mud, 'erros', err, 'gatilhos', v_g);
end $$;
grant execute on function core.planos_atualizar(uuid) to service_role;

-- (b) coletar_semana: igual ao original + 'metas' (metas ativas dos planos ativos).
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
    -- UX-14: metas ativas dos planos ativos (até 20), para a IARA ligar itens da semana a uma meta (meta_id).
    'metas', coalesce((
      select jsonb_agg(x.j order by x.o1 nulls last, x.o2 nulls last, x.o3)
        from (select jsonb_build_object('id', pm.id, 'plano', pl.titulo, 'titulo', pm.titulo, 'dono', pm.dono,
                       'demanda', pm.demanda, 'ritmo', pm.ritmo, 'prazo', pm.prazo, 'progresso', pm.progresso) as j,
                     pl.prioridade as o1, pm.prazo as o2, pm.id as o3
                from core.plano_metas pm join core.planos pl on pl.id = pm.plano_id and pl.status = 'ativo'
               where pl.user_id = p_user and pm.status = 'ativa'
               order by pl.prioridade nulls last, pm.prazo nulls last, pm.id limit 20) x), '[]'::jsonb),
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

-- (b) hub_semana: igual ao que está no ar + em cada item meta_id, plano (título do plano da meta) e editado.
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
      'id', p.id, 'semana', p.semana, 'status', p.status, 'resumo', p.resumo, 'critica', p.critica,
      'criado_em', p.created_at, 'confirmado_em', p.confirmado_em,
      'itens', coalesce((
        select jsonb_agg(jsonb_build_object('id', i.id, 'data', i.data, 'hora', to_char(i.hora, 'HH24:MI'), 'area', i.area,
                                            'titulo', i.titulo, 'detalhe', i.detalhe, 'minutos', i.minutos, 'valor', i.valor,
                                            'incluido', i.incluido, 'status', ci.status,
                                            'meta_id', i.meta_id, 'plano', pl.titulo, 'editado', i.editado)
                         order by i.data, i.hora nulls last, i.ordem)
          from core.planos_semana_itens i left join core.itens ci on ci.id = i.item_id
          left join core.plano_metas pm on pm.id = i.meta_id left join core.planos pl on pl.id = pm.plano_id
         where i.plano_id = p.id), '[]'::jsonb))
      from p) end;
$$;
revoke all on function public.hub_semana() from public, anon;
grant execute on function public.hub_semana() to authenticated;

-- (c) mover ou tirar um item marca editado = true (o rascunho refeito não o apaga).
create or replace function public.hub_semana_item_editar(p_id bigint, p_data date, p_hora text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  update core.planos_semana_itens i
     set data = p_data, hora = nullif(p_hora, '')::time, editado = true
    from core.planos_semana p
   where i.id = p_id and p.id = i.plano_id and p.status = 'rascunho' and i.user_id = auth.uid()
     and p_data between p.semana and p.semana + 6
     and exists (select 1 from core.members m where m.user_id = auth.uid());
  get diagnostics v_ok = row_count;
  return v_ok;
end $$;
revoke all on function public.hub_semana_item_editar(bigint, date, text) from public, anon;
grant execute on function public.hub_semana_item_editar(bigint, date, text) to authenticated;

create or replace function public.hub_semana_item(p_id bigint, p_incluido boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  update core.planos_semana_itens i set incluido = p_incluido, editado = true
    from core.planos_semana p
   where i.id = p_id and p.id = i.plano_id and p.status = 'rascunho'
     and i.user_id = auth.uid() and exists (select 1 from core.members m where m.user_id = auth.uid());
  get diagnostics v_ok = row_count;
  return v_ok;
end $$;
revoke all on function public.hub_semana_item(bigint, boolean) from public, anon;
grant execute on function public.hub_semana_item(bigint, boolean) to authenticated;

-- (d) Propostas de ajuste da revisão mensal. A IARA propõe; só o Leo aplica (public.hub_proposta_decidir).
-- valor por campo: prazo -> "AAAA-MM-DD"; demanda -> {"reais_mes"?, "minutos_semana"?}; medida -> {"alvo"?}; status -> "pausada|concluida|cancelada".
create table if not exists core.plano_propostas (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  plano_id    bigint not null references core.planos (id),
  meta_id     bigint not null references core.plano_metas (id),
  campo       text not null check (campo in ('prazo', 'demanda', 'medida', 'status')),
  valor       jsonb not null,
  motivo      text not null,
  status      text not null default 'aberta' check (status in ('aberta', 'aceita', 'recusada')),
  origem      text not null default 'revisao_mensal',
  created_at  timestamptz not null default now(),
  decidida_em timestamptz
);
create index if not exists plano_propostas_user on core.plano_propostas (user_id, status);
-- Uma proposta aberta por (meta, campo).
create unique index if not exists plano_propostas_aberta on core.plano_propostas (meta_id, campo) where status = 'aberta';
alter table core.plano_propostas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'plano_propostas' and policyname = 'plano_propostas_dono') then
    create policy plano_propostas_dono on core.plano_propostas for select to authenticated using (user_id = auth.uid());
  end if;
end $$;
revoke all on core.plano_propostas from public, anon, authenticated;
grant select on core.plano_propostas to authenticated;

-- Contexto da revisão (sem IA) para a edge function: planos ativos, metas, gatilhos dos últimos 60 dias, decisões abertas,
-- propostas já abertas. p_longo = true inclui metas de horizonte longo (revisão trimestral).
create or replace function core.revisao_contexto(p_user uuid, p_longo boolean default false) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'planos', coalesce((select jsonb_agg(jsonb_build_object('id', pl.id, 'titulo', pl.titulo, 'tipo', pl.tipo, 'prioridade', pl.prioridade,
        'alvo', pl.alvo, 'porque', pl.porque) order by pl.prioridade nulls last, pl.id)
        from core.planos pl where pl.user_id = p_user and pl.status = 'ativo'), '[]'::jsonb),
    'metas', coalesce((select jsonb_agg(jsonb_build_object('id', pm.id, 'plano_id', pm.plano_id, 'horizonte', pm.horizonte, 'dono', pm.dono,
        'titulo', pm.titulo, 'medida', pm.medida, 'prazo', pm.prazo, 'demanda', pm.demanda, 'progresso', pm.progresso, 'ritmo', pm.ritmo,
        'status', pm.status) order by pm.plano_id, pm.prazo nulls last, pm.id)
        from core.plano_metas pm join core.planos pl on pl.id = pm.plano_id and pl.status = 'ativo'
       where pl.user_id = p_user and pm.status in ('ativa', 'pausada') and (p_longo or pm.horizonte <> 'longo')), '[]'::jsonb),
    'gatilhos', coalesce((select jsonb_agg(jsonb_build_object('plano_id', e.plano_id, 'meta_id', e.meta_id, 'em', e.at::date, 'dados', e.dados - 'chave') order by e.at desc)
        from (select e.* from core.plano_eventos e join core.planos pl on pl.id = e.plano_id
               where pl.user_id = p_user and e.tipo = 'gatilho' and e.at > now() - interval '60 days' order by e.at desc limit 30) e), '[]'::jsonb),
    'conflitos', coalesce((select jsonb_agg(jsonb_build_object('plano_id', d.plano_id, 'pergunta', d.pergunta, 'gatilho', d.gatilho))
        from core.decisoes d where d.user_id = p_user and d.status in ('aberta', 'painel')), '[]'::jsonb),
    'propostas_abertas', coalesce((select jsonb_agg(jsonb_build_object('meta_id', x.meta_id, 'campo', x.campo))
        from core.plano_propostas x where x.user_id = p_user and x.status = 'aberta'), '[]'::jsonb));
$$;

-- Grava as propostas já normalizadas pela edge (confere de novo que a meta é do usuário e de plano ativo). Até 5.
-- p: [{meta_id, campo, valor, motivo}]. Retorna quantas gravou (proposta aberta igual para a mesma meta/campo não duplica).
create or replace function core.propostas_gravar(p_user uuid, p_origem text, p jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare x jsonb; v_pl bigint; n int := 0; c int;
begin
  for x in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) limit 5 loop
    select pm.plano_id into v_pl from core.plano_metas pm join core.planos pl on pl.id = pm.plano_id
     where pm.id = (x ->> 'meta_id')::bigint and pl.user_id = p_user and pl.status = 'ativo';
    if v_pl is null then continue; end if;
    insert into core.plano_propostas (user_id, plano_id, meta_id, campo, valor, motivo, origem)
    values (p_user, v_pl, (x ->> 'meta_id')::bigint, x ->> 'campo', x -> 'valor', left(x ->> 'motivo', 300), coalesce(p_origem, 'revisao_mensal'))
    on conflict (meta_id, campo) where status = 'aberta' do nothing;
    get diagnostics c = row_count; n := n + c;
  end loop;
  return n;
end $$;
revoke all on function core.revisao_contexto(uuid, boolean), core.propostas_gravar(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function core.revisao_contexto(uuid, boolean), core.propostas_gravar(uuid, text, jsonb) to service_role;

-- Propostas abertas do usuário. null se não for membro. 'atual' = valor corrente do campo na meta.
create or replace function public.hub_propostas() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_u uuid := auth.uid();
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'plano_id', x.plano_id, 'plano', pl.titulo, 'meta_id', x.meta_id, 'meta', pm.titulo,
        'campo', x.campo, 'atual', case x.campo when 'prazo' then to_jsonb(pm.prazo) when 'demanda' then pm.demanda
                                                when 'medida' then pm.medida else to_jsonb(pm.status) end,
        'valor', x.valor, 'motivo', x.motivo, 'status', x.status, 'origem', x.origem, 'created_at', x.created_at)
      order by x.created_at, x.id)
      from core.plano_propostas x join core.plano_metas pm on pm.id = x.meta_id join core.planos pl on pl.id = x.plano_id
     where x.user_id = v_u and x.status = 'aberta'), '[]'::jsonb);
end $$;

-- Decide uma proposta. Aceitar aplica na meta (core.meta_salvar) e grava o evento 'ajuste'; recusar só marca.
-- Repetir NÃO reaplica: proposta já decidida devolve o estado com ja_decidida = true.
create or replace function public.hub_proposta_decidir(p_id bigint, p_aceitar boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_u uuid := auth.uid(); x core.plano_propostas; m core.plano_metas; v_ant jsonb; v_arg jsonb;
begin
  if not exists (select 1 from core.members mm where mm.user_id = v_u) then raise exception 'sem acesso'; end if;
  select * into x from core.plano_propostas where id = p_id and user_id = v_u for update;
  if not found then raise exception 'proposta não encontrada'; end if;
  if x.status <> 'aberta' then
    return jsonb_build_object('id', x.id, 'status', x.status, 'decidida_em', x.decidida_em, 'ja_decidida', true);
  end if;
  if p_aceitar then
    select * into m from core.plano_metas where id = x.meta_id;
    if x.campo = 'prazo' then
      v_ant := to_jsonb(m.prazo); v_arg := jsonb_build_object('prazo', x.valor #>> '{}');
    elsif x.campo = 'status' then
      if (x.valor #>> '{}') not in ('ativa', 'pausada', 'concluida', 'cancelada') then raise exception 'status inválido'; end if;
      v_ant := to_jsonb(m.status); v_arg := jsonb_build_object('status', x.valor #>> '{}');
    elsif x.campo = 'demanda' then
      v_ant := m.demanda; v_arg := jsonb_build_object('demanda', m.demanda || x.valor);
    elsif x.campo = 'medida' then
      v_ant := m.medida; v_arg := jsonb_build_object('medida', m.medida || x.valor);
    else raise exception 'campo inválido: %', x.campo; end if;
    perform core.meta_salvar(v_arg || jsonb_build_object('id', x.meta_id));
    insert into core.plano_eventos (plano_id, meta_id, tipo, origem, dados)
    values (x.plano_id, x.meta_id, 'ajuste', 'leo', jsonb_build_object('proposta_id', x.id, 'campo', x.campo, 'anterior', v_ant,
            'valor', x.valor, 'motivo', x.motivo));
    -- o prazo que o próprio Leo aceitou não conta como "prazo alterado" no gatilho
    if x.campo = 'prazo' then
      update core.plano_checagens c set dados = c.dados || jsonb_build_object('prazo_visto', x.valor #>> '{}')
       where c.user_id = v_u and c.escopo = 'meta:' || x.meta_id;
    end if;
  end if;
  update core.plano_propostas set status = case when p_aceitar then 'aceita' else 'recusada' end, decidida_em = now()
   where id = x.id returning * into x;
  return jsonb_build_object('id', x.id, 'status', x.status, 'campo', x.campo, 'valor', x.valor, 'decidida_em', x.decidida_em, 'ja_decidida', false);
end $$;
revoke all on function public.hub_propostas(), public.hub_proposta_decidir(bigint, boolean) from public, anon;
grant execute on function public.hub_propostas(), public.hub_proposta_decidir(bigint, boolean) to authenticated;

insert into core.intencoes (slug, agent, exemplos, rpc, slots, risco, confirmacao, desfazer_rpc) values
 ('proposta.decidir', 'iara',
  array['aceita a proposta de adiar o prazo', 'recusa essa sugestão da revisão', 'pode aplicar o ajuste que a IARA propôs'],
  'public.hub_proposta_decidir', '{"p_id":"bigint","p_aceitar":"boolean"}', 'alto', 'sim', null),
 ('propostas.status', 'iara',
  array['tem proposta de ajuste nos meus planos', 'o que a IARA sugeriu na revisão do mês', 'quais ajustes estão pendentes'],
  'public.hub_propostas', '{}', 'baixo', 'nenhuma', null)
on conflict (slug) do update set
  agent = excluded.agent, exemplos = excluded.exemplos, rpc = excluded.rpc, slots = excluded.slots,
  risco = excluded.risco, confirmacao = excluded.confirmacao, desfazer_rpc = excluded.desfazer_rpc;

-- Revisão mensal: domingo 13:00 UTC (10:00 SP). A função iara-plano só age no 1º domingo do mês (dia <= 7).
do $$ begin
  if exists (select 1 from cron.job where jobname = 'iara-planos-revisao') then perform cron.unschedule('iara-planos-revisao'); end if;
  perform cron.schedule('iara-planos-revisao', '0 13 * * 0', $c$ select core_private.call_function('iara-plano', '{"acao":"revisar"}'::jsonb) $c$);
end $$;
