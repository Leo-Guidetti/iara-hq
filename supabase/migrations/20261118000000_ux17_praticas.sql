-- UX-17: instrumento e habilidade de carreira têm onde morar. Aditivo e idempotente.
-- D1: a IARA é dona dos planos e das metas de carreira/hobby; a SabIA guarda conteúdo (habilidades, plano de prática)
-- e o registro de prática. A meta que a prática alimenta tem dono 'iara' (ou 'sabia') e ref 'sabia.praticas:<habilidade_id>'.
-- Tudo desfeito por marcação (praticas.desfeita), nunca por remoção.

-- 1) Tabelas. Leitura pelo dono; escrita só pelas RPCs abaixo (security definer).
create table if not exists sabia.habilidades (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  tipo text not null default 'outro' check (tipo in ('instrumento', 'carreira', 'idioma', 'outro')),
  nivel text,
  objetivo text,
  curriculo jsonb,
  minutos_semana_alvo int check (minutos_semana_alvo is null or minutos_semana_alvo > 0),
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, nome)
);
-- Nome é único sem diferenciar maiúscula/acento: "Violão" e "violao" são a mesma habilidade.
create or replace function sabia.norm_nome(p text) returns text language sql immutable set search_path = '' as $$
  select translate(lower(btrim(coalesce(p, ''))), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')
$$;
create unique index if not exists habilidades_user_nome_norm on sabia.habilidades (user_id, sabia.norm_nome(nome));

create table if not exists sabia.praticas (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  habilidade_id bigint not null references sabia.habilidades(id) on delete cascade,
  data date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  minutos int not null check (minutos > 0),
  nota text,
  desfeita boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists praticas_user_data on sabia.praticas (user_id, data desc);
create index if not exists praticas_habilidade on sabia.praticas (habilidade_id, data desc);

-- Plano de prática semanal: item da trilha 'hobby' ligado à habilidade (idempotência por usuário/semana/habilidade).
alter table sabia.itens add column if not exists habilidade_id bigint references sabia.habilidades(id) on delete cascade;
create unique index if not exists itens_trilha_habilidade on sabia.itens (trilha_id, habilidade_id) where habilidade_id is not null;

alter table sabia.habilidades enable row level security;
alter table sabia.praticas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'sabia' and tablename = 'habilidades' and policyname = 'habilidades_dono') then
    create policy habilidades_dono on sabia.habilidades for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'sabia' and tablename = 'praticas' and policyname = 'praticas_dono') then
    create policy praticas_dono on sabia.praticas for select to authenticated using (user_id = auth.uid());
  end if;
end $$;
revoke all on sabia.habilidades, sabia.praticas from public, anon, authenticated;
grant select on sabia.habilidades, sabia.praticas to authenticated;
grant all on sabia.habilidades, sabia.praticas to service_role;
grant usage, select on all sequences in schema sabia to authenticated, service_role;

-- 2) Cálculo da semana (segunda a domingo, horário de São Paulo): minutos, sequência de dias e alvo.
create or replace function sabia.pratica_resumo(p_user uuid, p_hab bigint, p_hoje date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_ini date := date_trunc('week', p_hoje)::date; v_min int; v_alvo int; v_seq int := 0; d date;
begin
  select coalesce(sum(p.minutos), 0)::int into v_min from sabia.praticas p
   where p.habilidade_id = p_hab and p.user_id = p_user and not p.desfeita and p.data between v_ini and p_hoje;
  select h.minutos_semana_alvo into v_alvo from sabia.habilidades h where h.id = p_hab and h.user_id = p_user;
  -- Sequência: dias seguidos com prática; hoje ainda sem prática não quebra a sequência (começa em ontem).
  d := case when exists (select 1 from sabia.praticas p where p.habilidade_id = p_hab and p.user_id = p_user and not p.desfeita and p.data = p_hoje)
            then p_hoje else p_hoje - 1 end;
  while exists (select 1 from sabia.praticas p where p.habilidade_id = p_hab and p.user_id = p_user and not p.desfeita and p.data = d) loop
    v_seq := v_seq + 1; d := d - 1;
  end loop;
  return jsonb_build_object('minutos_semana', v_min, 'alvo', v_alvo, 'sequencia_dias', v_seq,
    'semana_inicio', v_ini, 'semana_fim', v_ini + 6);
end $$;
revoke all on function sabia.pratica_resumo(uuid, bigint, date) from public, anon, authenticated;

-- 3) RPCs do hub (security definer, só o dono).
-- hub_pratica_registrar: habilidade por nome (sem diferenciar maiúscula/acento). Sem nome: se só há UMA ativa, é ela;
-- senão pede o nome. Nome que não existe CRIA a habilidade com tipo 'outro' (sem alvo; ajuste depois em hub_habilidade_salvar).
-- Nome de habilidade arquivada a reativa. Retorna {pratica_id, habilidade, habilidade_id, minutos_semana, alvo, fala}.
create or replace function public.hub_pratica_registrar(p_minutos int, p_habilidade text default null, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_u uuid := auth.uid(); v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_nome text := nullif(btrim(p_habilidade), ''); h sabia.habilidades; v_n int; v_id bigint; v_r jsonb; v_falta int; v_fala text;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  if p_minutos is null or p_minutos <= 0 or p_minutos > 1440 then raise exception 'minutos inválidos'; end if;
  if v_nome is not null then
    select * into h from sabia.habilidades x where x.user_id = v_u and sabia.norm_nome(x.nome) = sabia.norm_nome(v_nome);
    if not found then
      insert into sabia.habilidades (user_id, nome, tipo) values (v_u, left(v_nome, 80), 'outro') returning * into h;
    elsif not h.ativa then
      update sabia.habilidades set ativa = true where id = h.id returning * into h;
    end if;
  else
    select count(*) into v_n from sabia.habilidades x where x.user_id = v_u and x.ativa;
    if v_n = 0 then raise exception 'Qual habilidade? Diga, por exemplo, "pratiquei violão 20 minutos".'; end if;
    if v_n > 1 then
      raise exception 'Qual habilidade? %', (select string_agg(x.nome, ', ' order by x.nome) from sabia.habilidades x where x.user_id = v_u and x.ativa);
    end if;
    select * into h from sabia.habilidades x where x.user_id = v_u and x.ativa;
  end if;
  insert into sabia.praticas (user_id, habilidade_id, data, minutos, nota)
  values (v_u, h.id, v_hoje, p_minutos, nullif(btrim(p_nota), '')) returning id into v_id;
  v_r := sabia.pratica_resumo(v_u, h.id, v_hoje);
  v_falta := (v_r ->> 'alvo')::int - (v_r ->> 'minutos_semana')::int;
  v_fala := 'Anotei: ' || p_minutos || ' min de ' || h.nome || '.'
    || case when (v_r ->> 'alvo') is null then ' Esta semana: ' || (v_r ->> 'minutos_semana') || ' min.'
            when v_falta > 0 then ' Faltam ' || v_falta || ' para a meta da semana.'
            else ' Meta da semana batida.' end;
  return jsonb_build_object('pratica_id', v_id, 'habilidade', h.nome, 'habilidade_id', h.id,
    'minutos_semana', (v_r ->> 'minutos_semana')::int, 'alvo', (v_r ->> 'alvo')::int,
    'sequencia_dias', (v_r ->> 'sequencia_dias')::int, 'fala', v_fala);
end $$;
revoke all on function public.hub_pratica_registrar(int, text, text) from public, anon;
grant execute on function public.hub_pratica_registrar(int, text, text) to authenticated;

-- hub_pratica_desfazer: marca desfeita (idempotente). Não remove a habilidade que o registro tenha criado.
create or replace function public.hub_pratica_desfazer(p_pratica bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_u uuid := auth.uid(); v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; p sabia.praticas; h sabia.habilidades; v_r jsonb;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  select * into p from sabia.praticas x where x.id = p_pratica and x.user_id = v_u for update;
  if not found then raise exception 'Prática não encontrada.'; end if;
  select * into h from sabia.habilidades x where x.id = p.habilidade_id;
  update sabia.praticas set desfeita = true where id = p.id;
  v_r := sabia.pratica_resumo(v_u, h.id, v_hoje);
  return jsonb_build_object('ok', true, 'habilidade', h.nome, 'minutos_semana', (v_r ->> 'minutos_semana')::int,
    'fala', 'Desfiz: ' || p.minutos || ' min de ' || h.nome || '.');
end $$;
revoke all on function public.hub_pratica_desfazer(bigint) from public, anon;
grant execute on function public.hub_pratica_desfazer(bigint) to authenticated;

-- hub_habilidade_salvar(p): {id?, nome, tipo?, nivel?, objetivo?, curriculo?, minutos_semana_alvo?, ativa?}. Cria ou atualiza
-- (por id, ou pelo nome sem diferenciar maiúscula/acento). Campo ausente em p não é alterado; null limpa.
create or replace function public.hub_habilidade_salvar(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_u uuid := auth.uid(); v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_id bigint := nullif(p ->> 'id', '')::bigint; v_nome text := nullif(btrim(p ->> 'nome'), '');
  v_tipo text := nullif(p ->> 'tipo', ''); v_alvo int := nullif(p ->> 'minutos_semana_alvo', '')::int; h sabia.habilidades;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  if v_tipo is not null and v_tipo not in ('instrumento', 'carreira', 'idioma', 'outro') then raise exception 'tipo inválido: %', v_tipo; end if;
  if v_alvo is not null and v_alvo <= 0 then raise exception 'meta semanal inválida'; end if;
  if v_id is null and v_nome is not null then
    select x.id into v_id from sabia.habilidades x where x.user_id = v_u and sabia.norm_nome(x.nome) = sabia.norm_nome(v_nome);
  end if;
  if v_id is null then
    if v_nome is null then raise exception 'nome obrigatório'; end if;
    insert into sabia.habilidades (user_id, nome, tipo, nivel, objetivo, curriculo, minutos_semana_alvo, ativa)
    values (v_u, left(v_nome, 80), coalesce(v_tipo, 'outro'), p ->> 'nivel', p ->> 'objetivo', p -> 'curriculo', v_alvo,
            coalesce((p ->> 'ativa')::boolean, true))
    returning * into h;
  else
    update sabia.habilidades x set
           nome = coalesce(left(v_nome, 80), x.nome), tipo = coalesce(v_tipo, x.tipo),
           nivel = case when p ? 'nivel' then p ->> 'nivel' else x.nivel end,
           objetivo = case when p ? 'objetivo' then p ->> 'objetivo' else x.objetivo end,
           curriculo = case when p ? 'curriculo' then p -> 'curriculo' else x.curriculo end,
           minutos_semana_alvo = case when p ? 'minutos_semana_alvo' then v_alvo else x.minutos_semana_alvo end,
           ativa = coalesce((p ->> 'ativa')::boolean, x.ativa)
     where x.id = v_id and x.user_id = v_u returning * into h;
    if h.id is null then raise exception 'Habilidade não encontrada.'; end if;
  end if;
  return jsonb_build_object('id', h.id, 'nome', h.nome, 'tipo', h.tipo, 'nivel', h.nivel, 'objetivo', h.objetivo,
    'minutos_semana_alvo', h.minutos_semana_alvo, 'ativa', h.ativa,
    'fala', 'Salvei a habilidade "' || h.nome || '"' || case when h.minutos_semana_alvo is not null then ' com meta de ' || h.minutos_semana_alvo || ' min por semana' else '' end || '.');
end $$;
revoke all on function public.hub_habilidade_salvar(jsonb) from public, anon;
grant execute on function public.hub_habilidade_salvar(jsonb) to authenticated;

-- hub_praticas(): habilidades ativas com semana, sequência, últimas práticas e o plano de prática mais recente (trilha 'hobby').
create or replace function public.hub_praticas() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_u uuid := auth.uid(); v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then return null; end if;
  return jsonb_build_object(
    'semana', jsonb_build_object('inicio', date_trunc('week', v_hoje)::date, 'fim', date_trunc('week', v_hoje)::date + 6),
    'habilidades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'nome', h.nome, 'tipo', h.tipo, 'nivel', h.nivel, 'objetivo', h.objetivo, 'curriculo', h.curriculo,
        'alvo', h.minutos_semana_alvo,
        'minutos_semana', (sabia.pratica_resumo(v_u, h.id, v_hoje) ->> 'minutos_semana')::int,
        'sequencia_dias', (sabia.pratica_resumo(v_u, h.id, v_hoje) ->> 'sequencia_dias')::int,
        'ultimas', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'data', x.data, 'minutos', x.minutos, 'nota', x.nota) order by x.data desc, x.id desc)
                               from (select * from sabia.praticas p where p.habilidade_id = h.id and p.user_id = v_u and not p.desfeita
                                      order by p.data desc, p.id desc limit 5) x), '[]'::jsonb),
        'plano', (select jsonb_build_object('item_id', i.id, 'trilha_id', t.id, 'data', t.data, 'titulo', i.titulo, 'resumo', i.por_que, 'corpo', i.corpo)
                    from sabia.itens i join sabia.trilhas t on t.id = i.trilha_id
                   where i.habilidade_id = h.id and t.user_id = v_u and t.tipo = 'hobby' and t.data between v_hoje - 8 and v_hoje
                   order by t.data desc limit 1)
      ) order by h.created_at, h.id)
        from sabia.habilidades h where h.user_id = v_u and h.ativa), '[]'::jsonb));
end $$;
revoke all on function public.hub_praticas() from public, anon;
grant execute on function public.hub_praticas() to authenticated;

-- hub_sabia(): igual ao que está no ar, mas a trilha 'hobby' (plano de prática) não vira "trilha do dia" em /aprender.
create or replace function public.hub_sabia() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select m.user_id from core.members m where m.user_id = auth.uid()),
  hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  t as (
    select t.* from sabia.trilhas t, me, hoje
     where t.user_id = me.user_id and t.data <= hoje.d and t.tipo <> 'hobby'
     order by t.data desc, t.id desc limit 1
  )
  select case when not exists (select 1 from me) then null else jsonb_build_object(
    'trilha', (select jsonb_build_object('id', t.id, 'data', t.data, 'tipo', t.tipo, 'minutos', t.minutos_total,
                                         'resumo', t.resumo, 'status', t.status, 'hoje', t.data = (select d from hoje)) from t),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'ordem', i.ordem, 'tema', i.tema, 'titulo', i.titulo, 'fonte', i.fonte,
                                          'url', i.url, 'formato', i.formato, 'minutos', i.minutos, 'por_que', i.por_que,
                                          'takeaway', i.takeaway, 'corpo', i.corpo, 'status', i.status, 'reacao', i.reacao)
                       order by i.ordem)
        from sabia.itens i, t where i.trilha_id = t.id
    ), '[]'::jsonb)
  ) end;
$$;
grant execute on function public.hub_sabia() to authenticated;

-- 4) Recap de domingo (sabia-trilha): o que falta gerar e onde gravar. Só service role (a função chama com o user_id já autenticado).
-- Pendentes: habilidades ativas SEM plano na trilha 'hobby' de p_data (até 4, por ordem de criação). Sem habilidade => lista vazia => zero chamadas de IA.
create or replace function sabia.hobby_pendentes(p_user uuid, p_data date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', h.id, 'nome', h.nome, 'tipo', h.tipo, 'nivel', h.nivel, 'objetivo', left(h.objetivo, 300),
      'curriculo', h.curriculo, 'alvo', h.minutos_semana_alvo,
      'minutos_ultima_semana', (select coalesce(sum(p.minutos), 0)::int from sabia.praticas p
                                 where p.habilidade_id = h.id and p.user_id = p_user and not p.desfeita and p.data between p_data - 6 and p_data),
      'dias_ultima_semana', (select count(distinct p.data)::int from sabia.praticas p
                              where p.habilidade_id = h.id and p.user_id = p_user and not p.desfeita and p.data between p_data - 6 and p_data),
      'notas', coalesce((select jsonb_agg(left(n.nota, 120)) from (select p.nota from sabia.praticas p
                           where p.habilidade_id = h.id and p.user_id = p_user and not p.desfeita and p.nota is not null
                           order by p.data desc, p.id desc limit 3) n), '[]'::jsonb)
    ) order by h.created_at, h.id), '[]'::jsonb)
  from (select * from sabia.habilidades x where x.user_id = p_user and x.ativa
           and not exists (select 1 from sabia.itens i join sabia.trilhas t on t.id = i.trilha_id
                            where i.habilidade_id = x.id and t.user_id = p_user and t.tipo = 'hobby' and t.data = p_data)
         order by x.created_at, x.id limit 4) h
$$;
revoke all on function sabia.hobby_pendentes(uuid, date) from public, anon, authenticated;
grant execute on function sabia.hobby_pendentes(uuid, date) to service_role;

-- Grava o plano da semana de UMA habilidade como item da trilha 'hobby' de p_data (uma trilha por usuário/dia; um item por habilidade).
-- p_plano = {resumo, minutos, corpo}. Idempotente: se a habilidade já tem item nessa trilha, não grava nada e retorna null.
-- O item usa formato 'recap' (o enum de formatos não tem "prática") e minutos limitados a 1..40 pelo check; o total real fica em trilhas.minutos_total.
create or replace function sabia.hobby_plano_gravar(p_user uuid, p_data date, p_hab bigint, p_plano jsonb, p_run bigint default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare h sabia.habilidades; v_t bigint; v_i bigint; v_min int := greatest(1, coalesce(nullif(p_plano ->> 'minutos', '')::int, 1));
begin
  select * into h from sabia.habilidades x where x.id = p_hab and x.user_id = p_user and x.ativa;
  if not found then return null; end if;
  insert into sabia.trilhas (user_id, data, tipo, minutos_total, resumo, run_id)
  values (p_user, p_data, 'hobby', 0, 'Plano de prática da semana', p_run)
  on conflict (user_id, data, tipo) do update set run_id = coalesce(sabia.trilhas.run_id, excluded.run_id)
  returning id into v_t;
  insert into sabia.itens (trilha_id, user_id, ordem, tema, titulo, formato, minutos, por_que, corpo, habilidade_id)
  values (v_t, p_user, (select count(*) + 1 from sabia.itens x where x.trilha_id = v_t), h.nome,
          'Plano de prática da semana · ' || h.nome, 'recap', least(40, v_min), left(p_plano ->> 'resumo', 600), left(p_plano ->> 'corpo', 6000), h.id)
  on conflict (trilha_id, habilidade_id) where habilidade_id is not null do nothing
  returning id into v_i;
  if v_i is not null then
    update sabia.trilhas t set minutos_total = t.minutos_total + v_min where t.id = v_t;
  end if;
  return v_i;
end $$;
revoke all on function sabia.hobby_plano_gravar(uuid, date, bigint, jsonb, bigint) from public, anon, authenticated;
grant execute on function sabia.hobby_plano_gravar(uuid, date, bigint, jsonb, bigint) to service_role;

-- 5) Adapters de progresso (UX-09): mantêm tudo e passam a medir 'sabia.praticas:<habilidade_id>' (dono sabia ou iara).
create or replace function core.progresso_sabia(p_user uuid, p_meta core.plano_metas) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_m jsonb; v_alvo numeric; v_lidos numeric; l sabia.livros; hb sabia.habilidades; v_r jsonb;
begin
  if p_meta.ref = 'sabia.livros:ano' then
    v_m := sabia.livros_meta(p_user, v_hoje);
    v_alvo := coalesce(nullif(p_meta.medida ->> 'alvo', '')::numeric, (v_m ->> 'meta_ano')::numeric);
    v_lidos := (v_m ->> 'lidos_ano')::numeric;
    return jsonb_build_object(
      'progresso', case when v_alvo > 0 then v_lidos / v_alvo end, 'valor_atual', v_lidos, 'alvo', v_alvo, 'unidade', 'livros',
      'inicio', make_date(extract(year from v_hoje)::int, 1, 1), 'prazo', make_date(extract(year from v_hoje)::int, 12, 31),
      'dados', v_m);
  elsif p_meta.ref ~ '^sabia\.livros:[0-9]+$' then
    select * into l from sabia.livros x where x.id = substr(p_meta.ref, length('sabia.livros:') + 1)::bigint and x.user_id = p_user;
    if not found then return jsonb_build_object('progresso', null, 'dados', jsonb_build_object('motivo', 'livro não encontrado')); end if;
    return jsonb_build_object(
      'progresso', case when l.status = 'lido' then 1 when l.paginas > 0 then coalesce(l.pagina_atual, 0)::numeric / l.paginas end,
      'valor_atual', l.pagina_atual, 'alvo', l.paginas, 'unidade', 'páginas', 'inicio', l.comecou_em,
      'dados', jsonb_build_object('livro', l.titulo, 'status', l.status));
  elsif p_meta.ref ~ '^sabia\.praticas:[0-9]+$' then
    -- UX-17: minutos de prática da semana (segunda a hoje) / meta semanal. Alvo: medida.alvo da meta, senão o da habilidade.
    select * into hb from sabia.habilidades x where x.id = substr(p_meta.ref, length('sabia.praticas:') + 1)::bigint and x.user_id = p_user;
    if not found then return jsonb_build_object('progresso', null, 'dados', jsonb_build_object('motivo', 'habilidade não encontrada')); end if;
    v_r := sabia.pratica_resumo(p_user, hb.id, v_hoje);
    v_alvo := coalesce(nullif(p_meta.medida ->> 'alvo', '')::numeric, hb.minutos_semana_alvo);
    if v_alvo is null or v_alvo <= 0 then
      return jsonb_build_object('progresso', null, 'dados', jsonb_build_object('motivo', 'habilidade sem meta semanal', 'habilidade', hb.nome));
    end if;
    return jsonb_build_object(
      'progresso', (v_r ->> 'minutos_semana')::numeric / v_alvo, 'valor_atual', (v_r ->> 'minutos_semana')::numeric, 'alvo', v_alvo,
      'unidade', 'min/semana',
      -- esperado: fração da semana já encerrada (segunda = 0, domingo = 6/7), para não marcar atraso no começo da semana
      'esperado', (v_hoje - (v_r ->> 'semana_inicio')::date)::numeric / 7,
      'dados', jsonb_build_object('habilidade', hb.nome, 'sequencia_dias', (v_r ->> 'sequencia_dias')::int, 'semana_inicio', v_r ->> 'semana_inicio'));
  end if;
  -- demais refs: sem fonte
  return jsonb_build_object('progresso', null, 'dados', jsonb_build_object('motivo', 'ref sem fonte ainda'));
end $$;

create or replace function core.progresso_iara(p_user uuid, p_meta core.plano_metas) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_alvo numeric := nullif(p_meta.medida ->> 'alvo', '')::numeric; v_atual numeric := nullif(p_meta.medida ->> 'atual', '')::numeric;
begin
  -- UX-17 (D1): meta da IARA alimentada pela prática da SabIA é medida pelo adapter da SabIA.
  if p_meta.ref ~ '^sabia\.praticas:[0-9]+$' then return core.progresso_sabia(p_user, p_meta); end if;
  if p_meta.medida ->> 'tipo' = 'marco' then
    return jsonb_build_object('progresso', case when p_meta.status = 'concluida' then 1 else 0 end,
      'esperado', case when p_meta.prazo is not null and p_meta.prazo <= (now() at time zone 'America/Sao_Paulo')::date then 1 else 0 end,
      'dados', jsonb_build_object('tipo', 'marco'));
  elsif v_atual is not null and v_alvo > 0 then
    return jsonb_build_object('progresso', v_atual / v_alvo, 'valor_atual', v_atual, 'alvo', v_alvo,
      'unidade', p_meta.medida ->> 'unidade', 'dados', jsonb_build_object('tipo', 'contagem'));
  end if;
  return jsonb_build_object('progresso', null, 'dados', jsonb_build_object('motivo', 'sem medida'));
end $$;

revoke all on function core.progresso_sabia(uuid, core.plano_metas), core.progresso_iara(uuid, core.plano_metas) from public, anon, authenticated;

-- 6) coletar_semana: igual ao que está no ar (UX-14) + 'habilidades'.
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
    -- UX-17: habilidades ativas (instrumento, carreira, idioma) com a meta semanal e o que foi praticado na semana que passou.
    'habilidades', coalesce((
      select jsonb_agg(jsonb_build_object('nome', h.nome, 'tipo', h.tipo, 'minutos_semana_alvo', h.minutos_semana_alvo,
               'minutos_ultima_semana', (select coalesce(sum(p.minutos), 0)::int from sabia.praticas p
                                          where p.habilidade_id = h.id and p.user_id = p_user and not p.desfeita
                                            and p.data between p_inicio - 7 and p_inicio - 1)) order by h.created_at, h.id)
        from sabia.habilidades h where h.user_id = p_user and h.ativa), '[]'::jsonb),
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


-- 7) Desfazer da prática pelo despachante (UX-16): igual ao que está no ar + pratica.registrar.
create or replace function core.acao_executar(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a core.acoes_pendentes; v_res jsonb; v_des jsonb; v_antes jsonb; v_id bigint; v_st text; v_msg text;
begin
  select * into a from core.acoes_pendentes where id = p_id for update;
  if not found or a.status not in ('pendente', 'confirmada') then raise exception 'ação não executável'; end if;
  begin
    -- Estado de antes (o que o desfazer precisa devolver).
    case a.intencao
      when 'casa.item_status' then
        select jsonb_build_object('p_id', i.id, 'p_status', i.status, 'p_adiar_para', i.adiado_para) into v_antes
          from core.itens i where i.id = (a.args ->> 'p_id')::bigint and i.user_id = a.user_id;
      when 'sabia.item' then
        select jsonb_build_object('p_id', i.id, 'p_status', i.status, 'p_reacao', i.reacao) into v_antes
          from sabia.itens i where i.id = (a.args ->> 'p_id')::bigint and i.user_id = a.user_id;
      when 'semana.item' then
        select jsonb_build_object('p_id', i.id, 'p_incluido', i.incluido) into v_antes
          from core.planos_semana_itens i where i.id = (a.args ->> 'p_id')::bigint and i.user_id = a.user_id;
      when 'agenda.compromisso_salvar' then
        if (a.args -> 'p' ->> 'id') is not null then
          select jsonb_build_object('id', c.id, 'titulo', c.titulo, 'data', c.data, 'inicio', to_char(c.inicio, 'HH24:MI'),
                                    'fim', to_char(c.fim, 'HH24:MI'), 'tipo', c.tipo, 'local', c.local) into v_antes
            from core.compromissos c where c.id = (a.args -> 'p' ->> 'id')::bigint and c.user_id = a.user_id;
        end if;
      when 'semana.confirmar' then
        select p.status into v_st from core.planos_semana p where p.id = (a.args ->> 'p_plano')::bigint and p.user_id = a.user_id;
      else null;
    end case;

    v_res := core.acao_chamar(a.rpc, a.args);

    v_des := case a.intencao
      when 'casa.item_status' then case when v_antes is not null and v_res = 'true'::jsonb
        then jsonb_build_object('rpc', 'public.hub_item_status', 'args', v_antes) end
      when 'sabia.item' then case when v_antes is not null and v_res = 'true'::jsonb
        then jsonb_build_object('rpc', 'public.hub_sabia_item', 'args', v_antes) end
      when 'semana.item' then case when v_antes is not null and v_res = 'true'::jsonb
        then jsonb_build_object('rpc', 'public.hub_semana_item', 'args', v_antes) end
      when 'agenda.compromisso_salvar' then
        case when (a.args -> 'p' ->> 'id') is null then
               case when jsonb_typeof(v_res) = 'number' then jsonb_build_object('rpc', 'public.hub_compromisso_cancelar', 'args', jsonb_build_object('p_id', v_res)) end
             when v_antes is not null then jsonb_build_object('rpc', 'public.hub_compromisso_salvar', 'args', jsonb_build_object('p', v_antes)) end
      when 'leitura.registrar' then case when (v_res ->> 'leitura_id') is not null
        then jsonb_build_object('rpc', 'public.hub_leitura_desfazer', 'args', jsonb_build_object('p_leitura', (v_res ->> 'leitura_id')::bigint)) end
      when 'pratica.registrar' then case when (v_res ->> 'pratica_id') is not null
        then jsonb_build_object('rpc', 'public.hub_pratica_desfazer', 'args', jsonb_build_object('p_pratica', (v_res ->> 'pratica_id')::bigint)) end
      when 'semana.confirmar' then case when v_st = 'rascunho' and (v_res)::text::int > 0
        then jsonb_build_object('rpc', 'public.hub_semana_desconfirmar', 'args', jsonb_build_object('p_semana_id', (a.args ->> 'p_plano')::bigint)) end
      else null end;

    update core.acoes_pendentes set status = 'executada', confirmada_em = coalesce(confirmada_em, now()), executada_em = now(),
           resultado = v_res, desfazer = v_des, desfazer_ate = case when v_des is not null then now() + interval '10 minutes' end
     where id = a.id returning * into a;
    return core.acao_json(a);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    update core.acoes_pendentes set status = 'cancelada', resultado = jsonb_build_object('erro', v_msg) where id = p_id returning * into a;
    return core.acao_json(a) || jsonb_build_object('status', 'erro', 'erro', v_msg);
  end;
end $$;
revoke all on function core.acao_executar(bigint) from public, anon, authenticated;

-- 8) Intenções.
insert into core.intencoes (slug, agent, exemplos, rpc, slots, risco, confirmacao, desfazer_rpc) values
 ('pratica.registrar', 'sabia',
  array['pratiquei violão 20 minutos', 'toquei 30 min hoje', 'estudei inglês por 45 minutos'],
  'public.hub_pratica_registrar',
  '{"p_minutos":"int","p_habilidade":"text?","p_nota":"text?"}',
  'baixo', 'nenhuma', 'public.hub_pratica_desfazer'),
 ('habilidade.salvar', 'sabia',
  array['quero praticar violão 60 minutos por semana', 'cria a habilidade inglês, meta de 90 minutos por semana', 'arquiva a habilidade violão'],
  'public.hub_habilidade_salvar',
  '{"p":"jsonb{id?:bigint,nome:text,tipo?:text(instrumento|carreira|idioma|outro),nivel?:text,objetivo?:text,minutos_semana_alvo?:int}"}',
  'medio', 'repetir', null)
on conflict (slug) do update set
  agent = excluded.agent, exemplos = excluded.exemplos, rpc = excluded.rpc, slots = excluded.slots,
  risco = excluded.risco, confirmacao = excluded.confirmacao, desfazer_rpc = excluded.desfazer_rpc;
