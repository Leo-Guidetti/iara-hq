-- UX-22: revisar a semana falando. Aditivo e idempotente.
--  (a) core.planos_semana.fala (até 60 palavras) e .decisoes (até 3 decisões fechadas), geradas na MESMA chamada do iara-semana;
--  (b) public.hub_semana_ouvir() e public.hub_semana_responder(): o Leo responde uma decisão por vez; a resposta aplica a escolha
--      por marcação (editado = true) pela mesma lógica de hub_semana_item / hub_semana_item_editar; confirmar segue pelo UX-16;
--  (c) intenções semana.ouvir (baixo) e semana.responder (médio, repetir); semana.confirmar já existe (alto, sim);
--  (d) revisão mensal (UX-14): core.plano_propostas.fala, uma frase curta falada por proposta (mesma chamada, sem chamada nova).
--
-- decisoes: [{id:'d1', pergunta, opcoes:[<=3 rótulos curtos], padrao, escolha:null|rótulo,
--             efeito:{tipo:'mover'|'tirar'|'manter', item_ids:[bigint], data?:'AAAA-MM-DD', hora?:'HH:MM', opcao?:rótulo}}]
-- efeito.opcao = o rótulo que DISPARA o efeito (mover/tirar); qualquer outra opção equivale a manter (nada muda).

alter table core.planos_semana add column if not exists fala text;
alter table core.planos_semana add column if not exists decisoes jsonb not null default '[]'::jsonb;
alter table core.plano_propostas add column if not exists fala text;

-- Texto sem acento, minúsculo e sem pontuação (para casar a resposta falada com o rótulo da opção).
create or replace function core.semana_norm(p text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(translate(lower(coalesce(p, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9 ]+', ' ', 'g'))
$$;
revoke all on function core.semana_norm(text) from public, anon, authenticated;

-- Qual opção o Leo escolheu: rótulo exato, número ("1", "2"), ordinal ("primeira"), um contido no outro, ou "o padrão/isso/pode ser".
-- Retorna o rótulo da lista ou null (não entendeu / ambíguo).
create or replace function core.semana_opcao(p_opcoes jsonb, p_padrao text, p_texto text) returns text
language plpgsql immutable set search_path = '' as $$
declare t text := core.semana_norm(p_texto); o record; n int; v_hit text; v_cnt int := 0;
begin
  if t = '' or jsonb_typeof(coalesce(p_opcoes, '[]'::jsonb)) <> 'array' then return null; end if;
  for o in select value #>> '{}' as r from jsonb_array_elements(p_opcoes) loop
    if core.semana_norm(o.r) = t then return o.r; end if;
  end loop;
  n := case when t ~ '^[1-3]$' then t::int
            when t ~ '^(a )?(primeira|primeiro|um)( opcao)?$' then 1
            when t ~ '^(a )?(segunda|segundo|dois)( opcao)?$' then 2
            when t ~ '^(a )?(terceira|terceiro|tres)( opcao)?$' then 3 end;
  if n is not null then return p_opcoes ->> (n - 1); end if;
  if t ~ '^(o )?(padrao|isso|pode ser|pode|ok|isso mesmo|do jeito que esta|como sugeriu)$' and p_padrao is not null then return p_padrao; end if;
  for o in select value #>> '{}' as r from jsonb_array_elements(p_opcoes) loop
    if length(core.semana_norm(o.r)) >= 3 and (t like '%' || core.semana_norm(o.r) || '%' or core.semana_norm(o.r) like '%' || t || '%') then
      v_cnt := v_cnt + 1; v_hit := o.r;
    end if;
  end loop;
  return case when v_cnt = 1 then v_hit end;
end $$;
revoke all on function core.semana_opcao(jsonb, text, text) from public, anon, authenticated;

-- Plano da semana "atual" do usuário (mesma regra de public.hub_semana: semana corrente; no domingo, a que vem se já existir).
create or replace function core.semana_plano_atual(p_user uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select ps.id from core.planos_semana ps
   where ps.user_id = p_user
     and ps.semana in (date_trunc('week', (now() at time zone 'America/Sao_Paulo')::date)::date,
                       case when extract(dow from (now() at time zone 'America/Sao_Paulo')::date) = 0
                            then (now() at time zone 'America/Sao_Paulo')::date + 1 end)
   order by ps.semana desc limit 1
$$;
revoke all on function core.semana_plano_atual(uuid) from public, anon, authenticated;

-- Próxima decisão sem escolha de um plano (ou null).
create or replace function core.semana_proxima(p_decisoes jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select d from jsonb_array_elements(coalesce(p_decisoes, '[]'::jsonb)) with ordinality as t(d, n)
   where d -> 'escolha' is null or d -> 'escolha' = 'null'::jsonb order by n limit 1
$$;
revoke all on function core.semana_proxima(jsonb) from public, anon, authenticated;

-- Ouvir: fala do plano + decisões. Sem plano: plano_id null. pendentes = decisões sem escolha.
create or replace function public.hub_semana_ouvir() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_u uuid := auth.uid(); p core.planos_semana; v_prox jsonb; v_pend int;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then return null; end if;
  select * into p from core.planos_semana x where x.id = core.semana_plano_atual(v_u);
  if not found then
    return jsonb_build_object('plano_id', null, 'status', null, 'fala', null, 'decisoes', '[]'::jsonb, 'pendentes', 0, 'proxima', null);
  end if;
  select count(*)::int into v_pend from jsonb_array_elements(p.decisoes) d where d -> 'escolha' is null or d -> 'escolha' = 'null'::jsonb;
  v_prox := core.semana_proxima(p.decisoes);
  return jsonb_build_object('plano_id', p.id, 'semana', p.semana, 'status', p.status, 'fala', p.fala, 'decisoes', p.decisoes,
           'pendentes', v_pend, 'proxima', v_prox, 'pronto_para_confirmar', p.status = 'rascunho' and v_pend = 0);
end $$;
revoke all on function public.hub_semana_ouvir() from public, anon;
grant execute on function public.hub_semana_ouvir() to authenticated;

-- Responder uma decisão: p_decisao = id ('d1'; nulo = a próxima sem escolha); p_escolha = rótulo, número ou "o padrão".
-- Aplica o efeito (mover/tirar) por marcação nos itens do rascunho, grava a escolha e devolve a próxima decisão
-- ou "pronto para confirmar" (a confirmação é sempre por hub_acao_pedir('semana.confirmar') + "sim").
-- Resposta que não casa com nenhuma opção NÃO grava nada: ok = false e a fala repete as opções.
create or replace function public.hub_semana_responder(p_plano bigint, p_escolha text, p_decisao text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_u uuid := auth.uid(); p core.planos_semana; v_d jsonb; v_opc text; v_ef jsonb; v_id bigint; v_apl int := 0; v_ok boolean;
  v_novo jsonb; v_prox jsonb; v_pend int; v_hora text; v_data date; v_fala text;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  select * into p from core.planos_semana x where x.id = p_plano and x.user_id = v_u for update;
  if not found then raise exception 'Plano da semana não encontrado.'; end if;
  if p.status <> 'rascunho' then
    return jsonb_build_object('ok', false, 'motivo', 'confirmado', 'pendentes', 0, 'fala', 'A semana já está confirmada.');
  end if;
  if nullif(btrim(p_decisao), '') is null then
    v_d := core.semana_proxima(p.decisoes);
    if v_d is null then
      return jsonb_build_object('ok', true, 'plano_id', p.id, 'pendentes', 0, 'pronto_para_confirmar', true,
               'fala', 'Pronto para confirmar. Confirma a semana?');
    end if;
  else
    select x.d into v_d from jsonb_array_elements(p.decisoes) as x(d) where x.d ->> 'id' = btrim(p_decisao);
    if v_d is null then
      return jsonb_build_object('ok', false, 'motivo', 'decisao', 'pendentes', (select count(*)::int from jsonb_array_elements(p.decisoes) q
               where q -> 'escolha' is null or q -> 'escolha' = 'null'::jsonb), 'fala', 'Não achei essa decisão.');
    end if;
    if v_d -> 'escolha' is not null and v_d -> 'escolha' <> 'null'::jsonb then
      v_prox := core.semana_proxima(p.decisoes);
      return jsonb_build_object('ok', true, 'ja_respondida', true, 'plano_id', p.id, 'decisao', v_d ->> 'id', 'escolha', v_d ->> 'escolha',
               'proxima', v_prox, 'pendentes', (select count(*)::int from jsonb_array_elements(p.decisoes) q
                 where q -> 'escolha' is null or q -> 'escolha' = 'null'::jsonb),
               'fala', coalesce(v_prox ->> 'pergunta', 'Pronto para confirmar. Confirma a semana?'));
    end if;
  end if;

  v_opc := core.semana_opcao(v_d -> 'opcoes', v_d ->> 'padrao', p_escolha);
  if v_opc is null then
    return jsonb_build_object('ok', false, 'motivo', 'opcao', 'decisao', v_d ->> 'id', 'proxima', v_d,
             'pendentes', (select count(*)::int from jsonb_array_elements(p.decisoes) q where q -> 'escolha' is null or q -> 'escolha' = 'null'::jsonb),
             'fala', 'Não entendi. ' || (v_d ->> 'pergunta'));
  end if;

  -- Efeito: só a opção que o dispara muda itens (mesma lógica de hub_semana_item / hub_semana_item_editar, que marcam editado).
  v_ef := coalesce(v_d -> 'efeito', '{}'::jsonb);
  if v_ef ->> 'opcao' = v_opc and v_ef ->> 'tipo' in ('mover', 'tirar') then
    for v_id in select (value #>> '{}')::bigint from jsonb_array_elements(coalesce(v_ef -> 'item_ids', '[]'::jsonb)) loop
      if v_ef ->> 'tipo' = 'tirar' then
        v_ok := public.hub_semana_item(v_id, false);
      else
        v_data := nullif(v_ef ->> 'data', '')::date;
        select coalesce(nullif(v_ef ->> 'hora', ''), to_char(i.hora, 'HH24:MI')) into v_hora from core.planos_semana_itens i where i.id = v_id and i.plano_id = p.id;
        v_ok := case when v_data is null then false else public.hub_semana_item_editar(v_id, v_data, v_hora) end;
      end if;
      if v_ok then v_apl := v_apl + 1; end if;
    end loop;
  end if;

  select coalesce(jsonb_agg(case when x.d ->> 'id' = v_d ->> 'id' then x.d || jsonb_build_object('escolha', v_opc) else x.d end order by x.n), '[]'::jsonb)
    into v_novo from jsonb_array_elements(p.decisoes) with ordinality as x(d, n);
  update core.planos_semana set decisoes = v_novo where id = p.id;

  v_prox := core.semana_proxima(v_novo);
  select count(*)::int into v_pend from jsonb_array_elements(v_novo) q where q -> 'escolha' is null or q -> 'escolha' = 'null'::jsonb;
  v_fala := 'Certo. ' || coalesce(v_prox ->> 'pergunta', 'Pronto para confirmar. Confirma a semana?');
  return jsonb_build_object('ok', true, 'plano_id', p.id, 'decisao', v_d ->> 'id', 'escolha', v_opc, 'aplicados', v_apl,
           'proxima', v_prox, 'pendentes', v_pend, 'pronto_para_confirmar', v_pend = 0, 'fala', v_fala);
end $$;
revoke all on function public.hub_semana_responder(bigint, text, text) from public, anon;
grant execute on function public.hub_semana_responder(bigint, text, text) to authenticated;

-- (c) Intenções. semana.responder: médio/repetir, sem desfazer próprio (a escolha pode ser trocada pelo plano em tela ou pelos itens).
insert into core.intencoes (slug, agent, exemplos, rpc, slots, risco, confirmacao, desfazer_rpc) values
 ('semana.ouvir', 'iara',
  array['revisa a semana comigo', 'o que tem para decidir na semana', 'me fala o plano da semana'],
  'public.hub_semana_ouvir', '{}', 'baixo', 'nenhuma', null),
 ('semana.responder', 'iara',
  array['mantém na quarta', 'a primeira opção', 'pode ser o padrão', 'tira esse item da semana'],
  'public.hub_semana_responder', '{"p_plano":"bigint","p_escolha":"text","p_decisao":"text?"}', 'medio', 'repetir', null)
on conflict (slug) do update set
  agent = excluded.agent, exemplos = excluded.exemplos, rpc = excluded.rpc, slots = excluded.slots,
  risco = excluded.risco, confirmacao = excluded.confirmacao, desfazer_rpc = excluded.desfazer_rpc;

-- (d) Revisão mensal: fala curta por proposta. propostas_gravar passa a gravar `fala`; hub_propostas passa a devolvê-la.
create or replace function core.propostas_gravar(p_user uuid, p_origem text, p jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare x jsonb; v_pl bigint; n int := 0; c int;
begin
  for x in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) limit 5 loop
    select pm.plano_id into v_pl from core.plano_metas pm join core.planos pl on pl.id = pm.plano_id
     where pm.id = (x ->> 'meta_id')::bigint and pl.user_id = p_user and pl.status = 'ativo';
    if v_pl is null then continue; end if;
    insert into core.plano_propostas (user_id, plano_id, meta_id, campo, valor, motivo, origem, fala)
    values (p_user, v_pl, (x ->> 'meta_id')::bigint, x ->> 'campo', x -> 'valor', left(x ->> 'motivo', 300), coalesce(p_origem, 'revisao_mensal'),
            nullif(left(x ->> 'fala', 300), ''))
    on conflict (meta_id, campo) where status = 'aberta' do nothing;
    get diagnostics c = row_count; n := n + c;
  end loop;
  return n;
end $$;
revoke all on function core.propostas_gravar(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function core.propostas_gravar(uuid, text, jsonb) to service_role;

create or replace function public.hub_propostas() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_u uuid := auth.uid();
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'plano_id', x.plano_id, 'plano', pl.titulo, 'meta_id', x.meta_id, 'meta', pm.titulo,
        'campo', x.campo, 'atual', case x.campo when 'prazo' then to_jsonb(pm.prazo) when 'demanda' then pm.demanda
                                                when 'medida' then pm.medida else to_jsonb(pm.status) end,
        'valor', x.valor, 'motivo', x.motivo, 'fala', x.fala, 'status', x.status, 'origem', x.origem, 'created_at', x.created_at)
      order by x.created_at, x.id)
      from core.plano_propostas x join core.plano_metas pm on pm.id = x.meta_id join core.planos pl on pl.id = x.plano_id
     where x.user_id = v_u and x.status = 'aberta'), '[]'::jsonb);
end $$;
revoke all on function public.hub_propostas() from public, anon;
grant execute on function public.hub_propostas() to authenticated;

-- Medição do critério 3 (revisão completa em até 3 min): tempo entre a 1ª pergunta (semana.ouvir) e a confirmação executada,
-- por semana. As intenções passam pelo iara-comando, que grava os turnos em core.conversas e as ações em core.acoes_pendentes.
--   with ini as (
--     select user_id, min(at) as t0 from core.conversas where papel = 'iara' and intencao = 'semana.ouvir' group by user_id, date_trunc('day', at)),
--   fim as (
--     select user_id, executada_em as t1 from core.acoes_pendentes where intencao = 'semana.confirmar' and status in ('executada', 'desfeita'))
--   select i.user_id, i.t0, min(f.t1) as t1, min(f.t1) - i.t0 as duracao, (min(f.t1) - i.t0) <= interval '3 minutes' as dentro_de_3min
--     from ini i join fim f on f.user_id = i.user_id and f.t1 >= i.t0 and f.t1 < i.t0 + interval '1 hour'
--    group by i.user_id, i.t0 order by i.t0 desc;
