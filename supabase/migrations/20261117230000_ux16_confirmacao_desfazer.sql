-- UX-16: confirmação e desfazer. Aditivo e idempotente. Desfazer é SEMPRE por marcação (flag/status), nunca por remoção.
-- Política (core.intencoes): risco 'alto' ou confirmacao 'sim' => só executa depois de "sim" (linha 'confirmada' em core.acoes_pendentes);
-- baixo/médio => executa e devolve desfazer por 10 minutos. Pendente expira em 10 min; "sim" depois disso não executa nada.

-- 1) Fila de ações: pendentes, executadas (com o que é preciso para desfazer) e o histórico.
create table if not exists core.acoes_pendentes (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  intencao     text not null references core.intencoes(slug),
  rpc          text not null,
  args         jsonb not null default '{}'::jsonb,
  canal        text not null default 'hub' check (canal in ('hub', 'atalho', 'voz')),
  status       text not null default 'pendente'
               check (status in ('pendente', 'confirmada', 'executada', 'cancelada', 'expirada', 'desfeita')),
  pergunta     text,
  criado_em    timestamptz not null default now(),
  expira_em    timestamptz not null default now() + interval '10 minutes',
  confirmada_em timestamptz,
  executada_em timestamptz,
  resultado    jsonb,
  desfazer     jsonb,
  desfazer_ate timestamptz,
  desfeita_em  timestamptz
);
create index if not exists acoes_pendentes_user on core.acoes_pendentes (user_id, id desc);
comment on table core.acoes_pendentes is
  'UX-16. Ação pedida ao hub: pendente (aguarda "sim" até expira_em), executada (desfazer = {rpc,args} válido até desfazer_ate) ou encerrada. Escrita só pelas RPCs hub_acao_*.';
alter table core.acoes_pendentes enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'acoes_pendentes' and policyname = 'acoes_pendentes_dono') then
    create policy acoes_pendentes_dono on core.acoes_pendentes for select to authenticated using (user_id = auth.uid());
  end if;
end $$;
revoke all on core.acoes_pendentes from public, anon, authenticated;
grant select on core.acoes_pendentes to authenticated;
grant all on core.acoes_pendentes to service_role;

-- 2) Toda intenção ativa tem confirmacao definida (a coluna já é NOT NULL); risco alto sempre exige "sim".
update core.intencoes set confirmacao = 'sim' where risco = 'alto' and confirmacao <> 'sim';
update core.intencoes set confirmacao = 'repetir' where risco = 'medio' and confirmacao = 'nenhuma';
update core.intencoes set confirmacao = 'nenhuma' where risco = 'baixo' and confirmacao = 'repetir';

-- 3) Leitura: desfazer por marcação. `desfeita` tira a linha de todo cálculo; `antes` guarda o estado do livro antes dela.
alter table sabia.leituras add column if not exists desfeita boolean not null default false;
alter table sabia.leituras add column if not exists antes jsonb;

create or replace function sabia.tg_leitura_antes() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.antes is null then
    select jsonb_build_object('pagina_atual', l.pagina_atual, 'status', l.status, 'comecou_em', l.comecou_em, 'terminou_em', l.terminou_em)
      into new.antes from sabia.livros l where l.id = new.livro_id;
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'leituras_antes' and tgrelid = 'sabia.leituras'::regclass) then
    create trigger leituras_antes before insert on sabia.leituras for each row execute function sabia.tg_leitura_antes();
  end if;
end $$;

create or replace function sabia.tg_leitura() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.desfeita then return new; end if;
  update sabia.livros l set
    pagina_atual = greatest(coalesce(l.pagina_atual, 0), coalesce(new.pagina_final, 0)),
    comecou_em = coalesce(l.comecou_em, new.data),
    status = case when l.paginas is not null and new.pagina_final >= l.paginas then 'lido'
                  when l.status in ('quero_ler','pausado') then 'lendo' else l.status end,
    terminou_em = case when l.paginas is not null and new.pagina_final >= l.paginas then new.data else l.terminou_em end
  where l.id = new.livro_id;
  return new;
end $$;

-- Marca a leitura como desfeita e recalcula o livro a partir das leituras que sobraram.
-- Sem nenhuma sobrando: volta ao estado de antes da primeira leitura (coluna antes); sem registro, página nula e 'lido' volta a 'lendo'.
create or replace function sabia.leitura_desfazer(p_user uuid, p_leitura bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l sabia.leituras; lv sabia.livros; v_max int; v_antes jsonb; v_volta boolean;
begin
  select * into l from sabia.leituras x where x.id = p_leitura and x.user_id = p_user for update;
  if not found then raise exception 'Leitura não encontrada.'; end if;
  if not l.desfeita then
    update sabia.leituras set desfeita = true where id = l.id;
    select max(x.pagina_final) into v_max from sabia.leituras x where x.livro_id = l.livro_id and not x.desfeita;
    select * into lv from sabia.livros x where x.id = l.livro_id;
    if v_max is not null then
      v_volta := lv.status = 'lido' and lv.paginas is not null and v_max < lv.paginas;
      update sabia.livros set pagina_atual = v_max,
             status = case when v_volta then 'lendo' else status end,
             terminou_em = case when v_volta then null else terminou_em end
       where id = lv.id;
    else
      select x.antes into v_antes from sabia.leituras x where x.livro_id = l.livro_id and x.antes is not null order by x.id limit 1;
      update sabia.livros set
             pagina_atual = nullif(v_antes ->> 'pagina_atual', '')::int,
             status = coalesce(v_antes ->> 'status', case when lv.status = 'lido' then 'lendo' else lv.status end),
             comecou_em = case when v_antes is null then lv.comecou_em else nullif(v_antes ->> 'comecou_em', '')::date end,
             terminou_em = case when v_antes is null then (case when lv.status = 'lido' then null else lv.terminou_em end)
                                else nullif(v_antes ->> 'terminou_em', '')::date end
       where id = lv.id;
    end if;
  end if;
  select * into lv from sabia.livros x where x.id = l.livro_id;
  return jsonb_build_object('ok', true, 'livro', jsonb_build_object('id', lv.id, 'titulo', lv.titulo, 'paginas', lv.paginas,
           'pagina_atual', lv.pagina_atual, 'status', lv.status),
           'fala', case when lv.pagina_atual is null then 'Desfiz a leitura.' else 'Desfiz a leitura. Voltou para a página ' || lv.pagina_atual || '.' end);
end $$;
revoke all on function sabia.leitura_desfazer(uuid, bigint) from public, anon, authenticated;

create or replace function public.hub_leitura_desfazer(p_leitura bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from core.members m where m.user_id = auth.uid()) then raise exception 'sem acesso'; end if;
  return sabia.leitura_desfazer(auth.uid(), p_leitura);
end $$;
revoke all on function public.hub_leitura_desfazer(bigint) from public, anon;
grant execute on function public.hub_leitura_desfazer(bigint) to authenticated;

create or replace function public.hub_livros() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_u uuid := auth.uid(); v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then return null; end if;
  return jsonb_build_object(
    'atual', (select to_jsonb(x) from (select l.id, l.titulo, l.autor, l.paginas, l.pagina_atual, l.status, l.comecou_em,
                (select max(r.data) from sabia.leituras r where r.livro_id = l.id and not r.desfeita) as ultima_leitura
              from sabia.livros l where l.user_id = v_u and l.status = 'lendo' order by l.updated_at desc limit 1) x),
    'fila', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (
              select l.id, l.titulo, l.autor, l.paginas, l.status, l.created_at from sabia.livros l
               where l.user_id = v_u and l.status in ('quero_ler', 'pausado')) x), '[]'::jsonb),
    'lidos', coalesce((select jsonb_agg(to_jsonb(x) order by x.terminou_em desc nulls last) from (
              select l.id, l.titulo, l.autor, l.paginas, l.nota, l.terminou_em from sabia.livros l
               where l.user_id = v_u and l.status = 'lido'
                 and extract(year from coalesce(l.terminou_em, l.updated_at::date)) = extract(year from v_hoje)) x), '[]'::jsonb)
  ) || sabia.livros_meta(v_u, v_hoje);
end $$;

create or replace function public.hub_leitura_registrar(p_pagina int, p_livro bigint default null, p_minutos int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_u uuid := auth.uid(); v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_id bigint; v_lid bigint; l sabia.livros; v_meta jsonb; v_pd int; v_fala text;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  if p_pagina is null or p_pagina < 0 then raise exception 'página inválida'; end if;
  if p_minutos is not null and p_minutos < 0 then raise exception 'minutos inválidos'; end if;
  if p_livro is null then
    select x.id into v_id from sabia.livros x where x.user_id = v_u and x.status = 'lendo' order by x.updated_at desc limit 1;
    if v_id is null then raise exception 'Nenhum livro em leitura. Escolha um livro ou comece um.'; end if;
  else
    select x.id into v_id from sabia.livros x where x.id = p_livro and x.user_id = v_u;
    if v_id is null then raise exception 'Livro não encontrado.'; end if;
  end if;
  insert into sabia.leituras (livro_id, user_id, data, pagina_final, minutos) values (v_id, v_u, v_hoje, p_pagina, p_minutos) returning id into v_lid;
  select * into l from sabia.livros x where x.id = v_id;
  v_meta := sabia.livros_meta(v_u, v_hoje);
  v_pd := (v_meta ->> 'paginas_dia')::int;
  v_fala := case
    when l.status = 'lido' then 'Anotei: terminou "' || l.titulo || '". Parabéns!'
    else 'Anotei: página ' || l.pagina_atual || '.' end
    || case when l.status <> 'lido' and v_pd > 0 then ' Faltam ' || v_pd || ' por dia para fechar a meta.'
            when v_pd = 0 then ' Meta do ano batida.' else '' end;
  return jsonb_build_object('livro', jsonb_build_object('id', l.id, 'titulo', l.titulo, 'autor', l.autor, 'paginas', l.paginas,
           'pagina_atual', l.pagina_atual, 'status', l.status), 'meta', v_meta, 'fala', v_fala, 'leitura_id', v_lid);
end $$;


create or replace function sabia.briefing_hoje(p_user uuid, p_data date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_trilha jsonb; v_livro jsonb; v_seq int := 0; d date := p_data - 1;
begin
  select jsonb_build_object('tipo', t.tipo, 'minutos', t.minutos_total, 'resumo', t.resumo, 'status', t.status,
           'itens', coalesce((select jsonb_agg(jsonb_build_object('tema', i.tema, 'titulo', i.titulo, 'fonte', i.fonte,
               'formato', i.formato, 'minutos', i.minutos, 'status', i.status) order by i.ordem)
             from sabia.itens i where i.trilha_id = t.id), '[]'::jsonb))
  into v_trilha from sabia.trilhas t where t.user_id = p_user and t.data = p_data and t.tipo <> 'hobby'
  order by t.created_at desc limit 1;

  select jsonb_build_object('titulo', l.titulo, 'autor', l.autor, 'pagina_atual', l.pagina_atual, 'paginas', l.paginas,
           'ultima_leitura', (select max(r.data) from sabia.leituras r where r.livro_id = l.id and not r.desfeita))
  into v_livro from sabia.livros l where l.user_id = p_user and l.status = 'lendo' order by l.updated_at desc limit 1;

  while exists (select 1 from sabia.trilhas where user_id = p_user and data = d and status = 'concluida' and tipo <> 'hobby') loop
    v_seq := v_seq + 1; d := d - 1;
  end loop;
  return jsonb_build_object('trilha', v_trilha, 'livro_atual', v_livro, 'sequencia_dias', v_seq) || sabia.livros_meta(p_user, p_data);
end $$;

-- 4) Semana: desconfirmar por marcação. Regra: só enquanto nenhum item publicado foi feito (e, pela ação, dentro de 10 min).
-- Itens publicados em core.itens ficam 'ignorado' e saem do caminho (chave_origem ganha sufixo, então confirmar de novo publica itens novos).
-- plan_sessions (treinos movidos/criados pela confirmação) NÃO são tocadas: não há registro do estado anterior.
create or replace function core.semana_desconfirmar(p_user uuid, p_semana bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if not exists (select 1 from core.planos_semana p where p.id = p_semana and p.user_id = p_user) then raise exception 'Plano da semana não encontrado.'; end if;
  if not exists (select 1 from core.planos_semana p where p.id = p_semana and p.user_id = p_user and p.status = 'confirmado') then
    return jsonb_build_object('ok', true, 'itens', 0, 'fala', 'A semana já está como rascunho.');
  end if;
  if exists (select 1 from core.planos_semana_itens i join core.itens ci on ci.id = i.item_id
              where i.plano_id = p_semana and ci.status = 'feito') then
    raise exception 'Já há itens da semana feitos; não dá para desconfirmar.';
  end if;
  update core.itens ci
     set status = 'ignorado', adiado_para = null,
         chave_origem = left(ci.chave_origem, 150) || ':desconf:' || extract(epoch from clock_timestamp())::bigint,
         retorno = coalesce(ci.retorno, '{}'::jsonb) || jsonb_build_object('desconfirmado', true)
   where ci.user_id = p_user and ci.id in (select i.item_id from core.planos_semana_itens i where i.plano_id = p_semana and i.item_id is not null);
  get diagnostics v_n = row_count;
  update core.planos_semana_itens set item_id = null where plano_id = p_semana;
  update core.planos_semana set status = 'rascunho', confirmado_em = null where id = p_semana and user_id = p_user;
  return jsonb_build_object('ok', true, 'itens', v_n, 'fala', 'Voltei a semana para rascunho.');
end $$;
revoke all on function core.semana_desconfirmar(uuid, bigint) from public, anon, authenticated;

create or replace function public.hub_semana_desconfirmar(p_semana_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from core.members m where m.user_id = auth.uid()) then raise exception 'sem acesso'; end if;
  return core.semana_desconfirmar(auth.uid(), p_semana_id);
end $$;
revoke all on function public.hub_semana_desconfirmar(bigint) from public, anon;
grant execute on function public.hub_semana_desconfirmar(bigint) to authenticated;

-- 5) Intenções: acao.desfazer + desfazer_rpc de leitura e semana.
create or replace function public.hub_acao_desfazer_ultima() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not exists (select 1 from core.members m where m.user_id = auth.uid()) then raise exception 'sem acesso'; end if;
  -- A ÚLTIMA ação executada (dos últimos 10 min). Se ela não tem desfazer, avisa; nunca desfaz uma anterior sem o Leo ver.
  select a.id into v_id from core.acoes_pendentes a
   where a.user_id = auth.uid() and a.status = 'executada' and a.intencao <> 'acao.desfazer'
     and a.executada_em > now() - interval '10 minutes'
   order by a.executada_em desc, a.id desc limit 1;
  if v_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'nada', 'fala', 'Não tem nada para desfazer nos últimos 10 minutos.');
  end if;
  return core.acao_desfazer(auth.uid(), v_id);
end $$;
revoke all on function public.hub_acao_desfazer_ultima() from public, anon;
grant execute on function public.hub_acao_desfazer_ultima() to authenticated;

insert into core.intencoes (slug, agent, exemplos, rpc, slots, risco, confirmacao, desfazer_rpc) values
 ('acao.desfazer', 'iara',
  array['desfaz', 'desfaz isso', 'volta atrás'],
  'public.hub_acao_desfazer_ultima', '{}', 'baixo', 'nenhuma', null)
on conflict (slug) do update set
  agent = excluded.agent, exemplos = excluded.exemplos, rpc = excluded.rpc, slots = excluded.slots,
  risco = excluded.risco, confirmacao = excluded.confirmacao, desfazer_rpc = excluded.desfazer_rpc;
update core.intencoes set desfazer_rpc = 'public.hub_leitura_desfazer' where slug = 'leitura.registrar';
update core.intencoes set desfazer_rpc = 'public.hub_semana_desconfirmar' where slug = 'semana.confirmar';
-- peso.registrar segue SEM desfazer: weight_entries alimenta views e funções da ClaudIA sem coluna de anulação.

-- 6) Despachante: chama uma RPC do catálogo com args nomeados (jsonb), como o usuário já autenticado (auth.uid() vem da requisição).
-- Só RPCs listadas em core.intencoes (rpc ou desfazer_rpc); só security definer, ou do schema airton (todas filtram por airton._uid(null) = auth.uid()).
create or replace function core.acao_chamar(p_rpc text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sch text := split_part(coalesce(p_rpc, ''), '.', 1); v_fn text := split_part(coalesce(p_rpc, ''), '.', 2);
  v_names text[]; v_types oid[]; v_secdef boolean; v_n int; i int; v_args text[] := '{}'; v_tipo text; v_expr text; k text; v_res jsonb;
begin
  if v_fn = '' or p_rpc like 'fn:%' then raise exception 'rpc inválida'; end if;
  if jsonb_typeof(coalesce(p_args, '{}'::jsonb)) <> 'object' then raise exception 'args inválidos'; end if;
  if not exists (select 1 from core.intencoes c where c.ativo and (c.rpc = p_rpc or c.desfazer_rpc = p_rpc)) then
    raise exception 'rpc fora do catálogo: %', p_rpc;
  end if;
  select count(*) into v_n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = v_sch and p.proname = v_fn;
  if v_n <> 1 then raise exception 'rpc não encontrada ou ambígua: %', p_rpc; end if;
  select p.proargnames, string_to_array(p.proargtypes::text, ' ')::oid[], p.prosecdef into v_names, v_types, v_secdef
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = v_sch and p.proname = v_fn;
  if not v_secdef and v_sch <> 'airton' then raise exception 'rpc precisa ser security definer: %', p_rpc; end if;
  for k in select jsonb_object_keys(coalesce(p_args, '{}'::jsonb)) loop
    if k <> all (coalesce(v_names, '{}'::text[])) then raise exception 'argumento desconhecido: %', k; end if;
  end loop;
  for i in 1 .. coalesce(array_length(v_types, 1), 0) loop
    if coalesce(p_args, '{}'::jsonb) ? v_names[i] then
      v_tipo := format_type(v_types[i], null);
      v_expr := case when v_tipo = 'jsonb' then format('($1 -> %L)', v_names[i])
                     when v_tipo like '%[]' then format('array(select jsonb_array_elements_text($1 -> %L))::%s', v_names[i], v_tipo)
                     else format('($1 ->> %L)::%s', v_names[i], v_tipo) end;
      v_args := v_args || format('%I => %s', v_names[i], v_expr);
    end if;
  end loop;
  execute format('select to_jsonb(%I.%I(%s))', v_sch, v_fn, array_to_string(v_args, ', ')) into v_res using coalesce(p_args, '{}'::jsonb);
  return v_res;
end $$;
revoke all on function core.acao_chamar(text, jsonb) from public, anon, authenticated;

-- Visão pública de uma ação. desfazer = {acao_id, ate} só enquanto vale (executada, com desfazer, dentro de 10 min).
create or replace function core.acao_json(a core.acoes_pendentes) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('acao_id', a.id, 'intencao', a.intencao, 'status', a.status, 'args', a.args, 'pergunta', a.pergunta,
           'expira_em', a.expira_em, 'resultado', a.resultado,
           'desfazer', case when a.status = 'executada' and a.desfazer is not null and a.desfazer_ate > now()
                            then jsonb_build_object('acao_id', a.id, 'ate', a.desfazer_ate) end)
$$;
revoke all on function core.acao_json(core.acoes_pendentes) from public, anon, authenticated;

-- Executa a ação (status 'confirmada' ou recém-criada de risco baixo/médio) e guarda como desfazer.
-- Falha da RPC: a ação vira 'cancelada' com resultado.erro (os efeitos da RPC são revertidos) e o retorno traz erro.
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

-- Desfaz uma ação executada (idempotente). Só até desfazer_ate (10 min) e só se houver desfazer.
create or replace function core.acao_desfazer(p_user uuid, p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a core.acoes_pendentes; v_res jsonb; v_msg text;
begin
  select * into a from core.acoes_pendentes where id = p_id and user_id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'nao_encontrada', 'fala', 'Não achei essa ação.'); end if;
  if a.status = 'desfeita' then return jsonb_build_object('ok', true, 'status', 'desfeita', 'acao_id', a.id, 'fala', 'Já estava desfeito.'); end if;
  if a.status <> 'executada' then
    return jsonb_build_object('ok', false, 'motivo', 'nao_executada', 'status', a.status, 'fala', 'Essa ação não chegou a ser feita.');
  end if;
  if a.desfazer is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_desfazer', 'fala', 'Isso não dá para desfazer por aqui.');
  end if;
  if a.desfazer_ate is null or a.desfazer_ate <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'prazo', 'fala', 'Passou dos 10 minutos; não dá mais para desfazer por aqui.');
  end if;
  begin
    v_res := core.acao_chamar(a.desfazer ->> 'rpc', a.desfazer -> 'args');
    if v_res = 'false'::jsonb then
      return jsonb_build_object('ok', false, 'motivo', 'nao_aplicou', 'fala', 'Não consegui desfazer: o item mudou.');
    end if;
  exception when others then
    get stacked diagnostics v_msg = message_text;
    return jsonb_build_object('ok', false, 'motivo', 'erro', 'erro', v_msg, 'fala', 'Não consegui desfazer: ' || v_msg);
  end;
  update core.acoes_pendentes set status = 'desfeita', desfeita_em = now() where id = a.id;
  return jsonb_build_object('ok', true, 'status', 'desfeita', 'acao_id', a.id, 'intencao', a.intencao, 'resultado', v_res,
                            'fala', coalesce(nullif(v_res ->> 'fala', ''), 'Desfeito.'));
end $$;
revoke all on function core.acao_desfazer(uuid, bigint) from public, anon, authenticated;

-- 7) RPCs do hub (security definer, só o dono).
-- hub_acao_pedir: risco alto ou confirmacao 'sim' => grava 'pendente' e devolve a pergunta (NUNCA executa);
--                 senão executa já e devolve desfazer (10 min). Pendentes antigos do usuário são cancelados.
create or replace function public.hub_acao_pedir(p_intencao text, p_args jsonb default '{}'::jsonb, p_canal text default 'hub', p_pergunta text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_u uuid := auth.uid(); i core.intencoes; a core.acoes_pendentes; v_q text;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  select * into i from core.intencoes c where c.slug = p_intencao and c.ativo;
  if not found then raise exception 'intenção desconhecida: %', p_intencao; end if;
  if i.rpc like 'fn:%' then raise exception 'intenção sem RPC: %', p_intencao; end if;
  if jsonb_typeof(coalesce(p_args, '{}'::jsonb)) <> 'object' then raise exception 'args inválidos'; end if;
  update core.acoes_pendentes set status = 'cancelada' where user_id = v_u and status = 'pendente';
  v_q := coalesce(nullif(btrim(p_pergunta), ''), case i.slug
           when 'semana.confirmar' then 'Vou confirmar o plano da semana. Confirma?'
           when 'plano.confirmar' then 'Vou ativar esse plano. Confirma?'
           else 'Vou executar "' || i.slug || '". Confirma?' end);
  insert into core.acoes_pendentes (user_id, intencao, rpc, args, canal, pergunta)
  values (v_u, i.slug, i.rpc, coalesce(p_args, '{}'::jsonb), case when p_canal in ('hub', 'atalho', 'voz') then p_canal else 'hub' end,
          case when i.risco = 'alto' or i.confirmacao = 'sim' then v_q end)
  returning * into a;
  if i.risco = 'alto' or i.confirmacao = 'sim' then
    return core.acao_json(a) || jsonb_build_object('requer_sim', true);
  end if;
  return core.acao_executar(a.id);
end $$;
revoke all on function public.hub_acao_pedir(text, jsonb, text, text) from public, anon;
grant execute on function public.hub_acao_pedir(text, jsonb, text, text) to authenticated;

-- hub_acao_confirmar ("sim"): pendente dentro de expira_em -> confirmada -> executada. Expirada não executa. Idempotente.
create or replace function public.hub_acao_confirmar(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a core.acoes_pendentes;
begin
  if not exists (select 1 from core.members m where m.user_id = auth.uid()) then raise exception 'sem acesso'; end if;
  select * into a from core.acoes_pendentes where id = p_id and user_id = auth.uid() for update;
  if not found then return jsonb_build_object('status', 'nao_encontrada', 'fala', 'Não achei essa confirmação.'); end if;
  if a.status = 'pendente' then
    if a.expira_em <= now() then
      update core.acoes_pendentes set status = 'expirada' where id = a.id returning * into a;
    else
      update core.acoes_pendentes set status = 'confirmada', confirmada_em = now() where id = a.id;
      return core.acao_executar(a.id);
    end if;
  end if;
  return core.acao_json(a) || jsonb_build_object('fala', case a.status
    when 'expirada' then 'Essa confirmação expirou, quer refazer?'
    when 'cancelada' then 'Essa ação foi cancelada.'
    when 'desfeita' then 'Essa ação já foi desfeita.'
    else null end);
end $$;
revoke all on function public.hub_acao_confirmar(bigint) from public, anon;
grant execute on function public.hub_acao_confirmar(bigint) to authenticated;

create or replace function public.hub_acao_cancelar(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a core.acoes_pendentes;
begin
  if not exists (select 1 from core.members m where m.user_id = auth.uid()) then raise exception 'sem acesso'; end if;
  select * into a from core.acoes_pendentes where id = p_id and user_id = auth.uid() for update;
  if not found then return jsonb_build_object('status', 'nao_encontrada', 'fala', 'Não achei essa confirmação.'); end if;
  if a.status = 'pendente' then
    update core.acoes_pendentes set status = case when a.expira_em <= now() then 'expirada' else 'cancelada' end where id = a.id returning * into a;
    return core.acao_json(a) || jsonb_build_object('fala', 'Certo, não fiz nada.');
  end if;
  return core.acao_json(a) || jsonb_build_object('fala', case a.status
    when 'executada' then 'Isso já foi feito. Quer desfazer?'
    when 'cancelada' then 'Certo, não fiz nada.'
    when 'expirada' then 'Essa confirmação já tinha expirado.'
    else null end);
end $$;
revoke all on function public.hub_acao_cancelar(bigint) from public, anon;
grant execute on function public.hub_acao_cancelar(bigint) to authenticated;

create or replace function public.hub_acao_desfazer(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from core.members m where m.user_id = auth.uid()) then raise exception 'sem acesso'; end if;
  return core.acao_desfazer(auth.uid(), p_id);
end $$;
revoke all on function public.hub_acao_desfazer(bigint) from public, anon;
grant execute on function public.hub_acao_desfazer(bigint) to authenticated;

-- Ação pendente mais recente do usuário (pendente ou expirada nos últimos 30 min), para "sim"/"não" por frase.
create or replace function public.hub_acao_pendente() returns jsonb
language sql stable security definer set search_path = '' as $$
  select core.acao_json(a) from core.acoes_pendentes a
   where a.user_id = auth.uid() and a.status in ('pendente', 'expirada') and a.criado_em > now() - interval '30 minutes'
     and exists (select 1 from core.members m where m.user_id = auth.uid())
   order by a.id desc limit 1
$$;
revoke all on function public.hub_acao_pendente() from public, anon;
grant execute on function public.hub_acao_pendente() to authenticated;
