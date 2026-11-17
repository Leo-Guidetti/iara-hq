-- UX-20: avisos proativos com limite. Aditivo e idempotente. Sem IA (custo US$ 0).
-- Um canal só (Web Push do airton-notify), teto diário e silêncio definidos pelo Leo (D3: 3 por dia, silêncio 23:00-07:00).
-- Cadeia: cron iara-planos-progresso (09:00 UTC) -> planos_atualizar -> abrir_decisoes -> core.avisos_enfileirar (fila, idempotente)
--         -> tick airton-notify (a cada 15 min) -> core.avisos_reservar (teto + silêncio + prioridade) -> Web Push -> o Leo responde
--         com uma palavra em public.hub_aviso_responder (que dispara a intenção via hub_acao_pedir, respeitando o risco).
--
-- Escala de prioridade (maior sai primeiro):
--   90 gatilho de plano (meta atrasada, sem registro, renda prevista, tempo livre)   origem 'plano'
--   80 decisão aberta (UX-13)                                                          origem 'decisao'
--   75 proposta de ajuste aberta (UX-14)                                               origem 'proposta'
--   70 conta vencendo em até 2 dias (airton.month_plan -> upcoming)                    origem 'conta'
--   40 hábito: alerta da ClaudIA pendente (UX-06); +10 se prioridade 'alta'            origem 'habito'

create table if not exists core.avisos (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  origem       text not null check (origem in ('plano', 'decisao', 'proposta', 'conta', 'habito')),
  chave        text not null check (length(chave) between 1 and 300),
  prioridade   int not null default 50,
  titulo       text not null,
  corpo        text,
  pergunta     text not null,
  opcoes       jsonb not null default '["sim","depois"]'::jsonb,
  intencao     text references core.intencoes(slug),
  args         jsonb not null default '{}'::jsonb,
  link         text,
  status       text not null default 'fila' check (status in ('fila', 'enviado', 'respondido', 'descartado', 'expirado')),
  criado_em    timestamptz not null default now(),
  enviar_apos  timestamptz not null default now(),
  enviado_em   timestamptz,
  respondido_em timestamptz,
  resposta     text,
  unique (user_id, chave)
);
create index if not exists avisos_user_status on core.avisos (user_id, status, enviar_apos);
create index if not exists avisos_user_enviado on core.avisos (user_id, enviado_em);
comment on table core.avisos is
  'UX-20. Fila de avisos proativos. chave única por usuário = idempotência do publicador. Envio só por core.avisos_reservar (teto diário, silêncio, prioridade).';
comment on column core.avisos.opcoes is 'Respostas de uma palavra; a primeira é a afirmativa (executa a intenção, se houver).';
comment on column core.avisos.intencao is 'Slug de core.intencoes executado via hub_acao_pedir quando a resposta é afirmativa; null = só abre o link.';
comment on column core.avisos.link is 'Rota do hub relacionada ao aviso. O push abre /hoje?pergunta=<id>.';

alter table core.avisos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'avisos' and policyname = 'avisos_dono') then
    create policy avisos_dono on core.avisos for select to authenticated using (user_id = auth.uid());
  end if;
end $$;
revoke all on core.avisos from public, anon, authenticated;
grant select on core.avisos to authenticated;

-- Defaults de core.perfil.config.interrupcoes (não sobrescreve o que já existe).
insert into core.perfil (user_id)
select m.user_id from core.members m on conflict (user_id) do nothing;
update core.perfil
   set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('interrupcoes',
         jsonb_build_object('max_dia', 3, 'silencio_inicio', '23:00', 'silencio_fim', '07:00'))
 where not (coalesce(config, '{}'::jsonb) ? 'interrupcoes');

-- Configuração efetiva (defaults quando ausente ou incompleta).
create or replace function core.interrupcoes_de(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'max_dia', coalesce((c -> 'interrupcoes' ->> 'max_dia')::int, 3),
    'silencio_inicio', coalesce(nullif(c -> 'interrupcoes' ->> 'silencio_inicio', ''), '23:00'),
    'silencio_fim', coalesce(nullif(c -> 'interrupcoes' ->> 'silencio_fim', ''), '07:00'))
  from (select coalesce((select p.config from core.perfil p where p.user_id = p_user), '{}'::jsonb) as c) x
$$;
revoke all on function core.interrupcoes_de(uuid) from public, anon, authenticated;
grant execute on function core.interrupcoes_de(uuid) to service_role;

-- PURA: a hora está no silêncio? Intervalo [início, fim); atravessa a meia-noite quando início > fim. início = fim => sem silêncio.
create or replace function core.aviso_em_silencio(p_hora time, p_inicio text, p_fim text) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when p_inicio::time = p_fim::time then false
    when p_inicio::time > p_fim::time then p_hora >= p_inicio::time or p_hora < p_fim::time
    else p_hora >= p_inicio::time and p_hora < p_fim::time end
$$;

-- PURA: quantos avisos ainda cabem hoje.
create or replace function core.aviso_vagas(p_max int, p_enviados int) returns int
language sql immutable set search_path = '' as $$ select greatest(0, coalesce(p_max, 0) - coalesce(p_enviados, 0)) $$;

-- Quantos pushes já saíram hoje (fuso SP): avisos enviados + os pushes antigos do airton-notify (diário, semanal, custo, semana) com envio ok.
create or replace function core.avisos_enviados_hoje(p_user uuid, p_agora timestamptz default now()) returns int
language sql stable security definer set search_path = '' as $$
  select (select count(*)::int from core.avisos a
           where a.user_id = p_user and a.enviado_em is not null
             and (a.enviado_em at time zone 'America/Sao_Paulo')::date = (p_agora at time zone 'America/Sao_Paulo')::date)
       + (select count(*)::int from airton.notify_log l
           where l.user_id = p_user and l.sent > 0 and l.local_date = (p_agora at time zone 'America/Sao_Paulo')::date)
$$;
revoke all on function core.avisos_enviados_hoje(uuid, timestamptz) from public, anon, authenticated;
grant execute on function core.avisos_enviados_hoje(uuid, timestamptz) to service_role;

-- Seleção e reserva: escolhe na fila os mais prioritários que cabem hoje e os marca 'enviado'. Silêncio => nada. Devolve jsonb [{id,titulo,corpo,pergunta,opcoes,link,prioridade}].
-- Quem chama (edge) manda o push e, se nenhum aparelho recebeu, devolve com core.avisos_devolver (não gasta o teto).
create or replace function core.avisos_reservar(p_user uuid, p_agora timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg jsonb := core.interrupcoes_de(p_user); v_vagas int; v_ids bigint[];
begin
  if core.aviso_em_silencio((p_agora at time zone 'America/Sao_Paulo')::time, v_cfg ->> 'silencio_inicio', v_cfg ->> 'silencio_fim') then
    return '[]'::jsonb;
  end if;
  -- serializa ticks concorrentes do mesmo usuário
  perform pg_advisory_xact_lock(hashtextextended('avisos:' || p_user::text, 0));
  v_vagas := core.aviso_vagas((v_cfg ->> 'max_dia')::int, core.avisos_enviados_hoje(p_user, p_agora));
  if v_vagas <= 0 then return '[]'::jsonb; end if;
  select coalesce(array_agg(x.id order by x.prioridade desc, x.criado_em, x.id), '{}') into v_ids from (
    select a.id, a.prioridade, a.criado_em from core.avisos a
     where a.user_id = p_user and a.status = 'fila' and a.enviar_apos <= p_agora
     order by a.prioridade desc, a.criado_em, a.id limit v_vagas) x;
  update core.avisos set status = 'enviado', enviado_em = p_agora where id = any (v_ids);
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'origem', a.origem, 'titulo', a.titulo, 'corpo', a.corpo,
            'pergunta', a.pergunta, 'opcoes', a.opcoes, 'link', a.link, 'prioridade', a.prioridade) order by a.prioridade desc, a.criado_em, a.id)
          from core.avisos a where a.id = any (v_ids)), '[]'::jsonb);
end $$;
revoke all on function core.avisos_reservar(uuid, timestamptz) from public, anon, authenticated;
grant execute on function core.avisos_reservar(uuid, timestamptz) to service_role;

-- Nenhum aparelho recebeu: volta para a fila (não conta no teto).
create or replace function core.avisos_devolver(p_ids bigint[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update core.avisos set status = 'fila', enviado_em = null where id = any (p_ids) and status = 'enviado' and resposta is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.avisos_devolver(bigint[]) from public, anon, authenticated;
grant execute on function core.avisos_devolver(bigint[]) to service_role;

-- Wrappers para a service role (o airton-notify usa o schema airton; core não é exposto na API).
create or replace function public.avisos_reservar(p_user uuid) returns jsonb
language sql security definer set search_path = '' as $$ select core.avisos_reservar(p_user, now()) $$;
create or replace function public.avisos_devolver(p_ids bigint[]) returns int
language sql security definer set search_path = '' as $$ select core.avisos_devolver(p_ids) $$;
revoke all on function public.avisos_reservar(uuid), public.avisos_devolver(bigint[]) from public, anon, authenticated;
grant execute on function public.avisos_reservar(uuid), public.avisos_devolver(bigint[]) to service_role;

-- Grava um aviso uma única vez por (usuário, chave). Retorna 1 se gravou.
create or replace function core.aviso_gravar(p_user uuid, p_origem text, p_chave text, p_prioridade int, p_titulo text, p_corpo text,
  p_pergunta text, p_opcoes jsonb, p_intencao text, p_args jsonb, p_link text) returns int
language plpgsql security definer set search_path = '' as $$
declare c int;
begin
  insert into core.avisos (user_id, origem, chave, prioridade, titulo, corpo, pergunta, opcoes, intencao, args, link)
  values (p_user, p_origem, p_chave, p_prioridade, left(p_titulo, 140), left(p_corpo, 300), p_pergunta,
          coalesce(p_opcoes, '["sim","depois"]'::jsonb), p_intencao, coalesce(p_args, '{}'::jsonb), p_link)
  on conflict (user_id, chave) do nothing;
  get diagnostics c = row_count;
  return c;
end $$;
revoke all on function core.aviso_gravar(uuid, text, text, int, text, text, text, jsonb, text, jsonb, text) from public, anon, authenticated;

-- Publicador (SQL puro): enfileira avisos das fontes. Idempotente (chave estável). Retorna quantos entraram na fila.
create or replace function core.avisos_enfileirar(p_user uuid default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  u uuid; n int := 0; r record; v_mes date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_up jsonb; x jsonb;
begin
  -- 0) o que não vale mais sai da fila (por marcação): fonte resolvida ou espera de mais de 3 dias
  update core.avisos a set status = 'expirado'
   where a.status = 'fila' and (p_user is null or a.user_id = p_user)
     and (a.enviar_apos < now() - interval '3 days'
          or (a.origem = 'decisao' and not exists (select 1 from core.decisoes d where d.id = split_part(a.chave, ':', 2)::bigint and d.status in ('aberta', 'painel')))
          or (a.origem = 'proposta' and not exists (select 1 from core.plano_propostas p where p.id = split_part(a.chave, ':', 2)::bigint and p.status = 'aberta'))
          or (a.origem = 'habito' and not exists (select 1 from core.itens i where i.id = split_part(a.chave, ':', 2)::bigint and i.status in ('pendente', 'adiado'))));

  for u in select m.user_id from core.members m where p_user is null or m.user_id = p_user loop
    -- 1) gatilhos de plano (UX-14), últimos 3 dias; chave = a do gatilho (um aviso por gatilho e usuário)
    for r in
      select e.id, e.dados, e.at from core.plano_eventos e join core.planos pl on pl.id = e.plano_id
       where pl.user_id = u and e.tipo = 'gatilho' and e.at > now() - interval '3 days'
         and e.dados ->> 'gatilho' in ('meta_atrasada', 'sem_registro', 'renda_prevista', 'fixo_novo')
       order by e.id
    loop
      n := n + case r.dados ->> 'gatilho'
        when 'meta_atrasada' then core.aviso_gravar(u, 'plano', 'gatilho:' || coalesce(r.dados ->> 'chave', r.id::text), 90,
          'Meta atrasada: ' || coalesce(r.dados ->> 'meta', 'sua meta'),
          'Ela está abaixo do ritmo há ' || coalesce(r.dados ->> 'checagens', '2') || ' checagens seguidas.',
          'Quer rever o plano dessa meta?', '["rever","depois"]', null, '{}', '/planos')
        when 'sem_registro' then core.aviso_gravar(u, 'plano', 'gatilho:' || coalesce(r.dados ->> 'chave', r.id::text), 90,
          'Sem registro há ' || coalesce(r.dados ->> 'dias', '14') || ' dias: ' || coalesce(r.dados ->> 'meta', 'sua meta'),
          'O progresso dessa meta não muda faz tempo.',
          'Quer atualizar o progresso agora?', '["atualizar","depois"]', null, '{}', '/planos')
        when 'renda_prevista' then core.aviso_gravar(u, 'plano', 'gatilho:' || coalesce(r.dados ->> 'chave', r.id::text), 90,
          'A renda prevista do mês mudou',
          'Variação de ' || coalesce(r.dados ->> 'variacao_pct', '?') || '% sobre o mês anterior.',
          'Quer rever os planos que dependem de dinheiro?', '["rever","depois"]', null, '{}', '/planos')
        else core.aviso_gravar(u, 'plano', 'gatilho:' || coalesce(r.dados ->> 'chave', r.id::text), 90,
          'Seu tempo livre na semana caiu',
          'Perdeu ' || coalesce(r.dados ->> 'perda_min', '?') || ' min livres por semana.',
          'Quer rever os planos que dependem de tempo?', '["rever","depois"]', null, '{}', '/planos') end;
    end loop;

    -- 2) decisões abertas (UX-13)
    for r in select d.id, d.pergunta from core.decisoes d where d.user_id = u and d.status in ('aberta', 'painel') order by d.id loop
      n := n + core.aviso_gravar(u, 'decisao', 'decisao:' || r.id, 80, 'Uma decisão espera por você', r.pergunta,
        'Quer ver as opções agora?', '["ver","depois"]', null, '{}', '/planos');
    end loop;

    -- 3) propostas de ajuste abertas (UX-14)
    for r in select p.id, p.motivo from core.plano_propostas p where p.user_id = u and p.status = 'aberta' order by p.id loop
      n := n + core.aviso_gravar(u, 'proposta', 'proposta:' || r.id, 75, 'A IARA propôs um ajuste no plano', r.motivo,
        'Quer ver a proposta?', '["ver","depois"]', null, '{}', '/planos');
    end loop;

    -- 4) contas vencendo em até 2 dias (parcelas e eventos de saída do mês)
    begin
      v_up := airton.month_plan(v_mes, u) -> 'upcoming';
      for x in select e from jsonb_array_elements(coalesce(v_up, '[]'::jsonb)) e loop
        if (x ->> 'amount')::numeric < 0 and (x ->> 'date')::date between v_hoje and v_hoje + 2 then
          n := n + core.aviso_gravar(u, 'conta', 'conta:' || (x ->> 'date') || ':' || (x ->> 'label'), 70,
            'Conta vencendo: ' || (x ->> 'label'),
            'R$ ' || to_char(-(x ->> 'amount')::numeric, 'FM999G990D00') || ' em ' || to_char((x ->> 'date')::date, 'DD/MM') || '.',
            'Já está separado?', '["ok","depois"]', null, '{}', '/financas');
        end if;
      end loop;
    exception when others then null; end;

    -- 5) hábitos: alertas da ClaudIA pendentes da semana (UX-06); a resposta afirmativa marca o item como feito (risco baixo)
    for r in
      select i.id, i.titulo, i.detalhe, i.prioridade from core.itens i
       where i.user_id = u and i.origem = 'claudia' and i.tipo = 'alerta' and i.status = 'pendente'
         and i.data >= date_trunc('week', v_hoje)::date
       order by i.id
    loop
      n := n + core.aviso_gravar(u, 'habito', 'habito:' || r.id, case when r.prioridade = 'alta' then 50 else 40 end,
        r.titulo, r.detalhe, 'Já resolveu isso?', '["feito","depois"]', 'casa.item_status',
        jsonb_build_object('p_id', r.id, 'p_status', 'feito'), '/saude');
    end loop;
  end loop;
  return n;
end $$;
revoke all on function core.avisos_enfileirar(uuid) from public, anon, authenticated;
grant execute on function core.avisos_enfileirar(uuid) to service_role;

-- ===== RPCs do hub (security definer, só o dono) =====

-- Fila e enviados (últimos 3 dias), respondidos de hoje e a configuração. Para abrir a pergunta de /hoje?pergunta=<id>, procure o id em itens.
create or replace function public.hub_avisos() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_u uuid := auth.uid(); v_cfg jsonb; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_env int;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then return null; end if;
  v_cfg := core.interrupcoes_de(v_u);
  v_env := core.avisos_enviados_hoje(v_u);
  return jsonb_build_object(
    'max_dia', (v_cfg ->> 'max_dia')::int, 'silencio_inicio', v_cfg ->> 'silencio_inicio', 'silencio_fim', v_cfg ->> 'silencio_fim',
    'enviados_hoje', v_env, 'vagas_hoje', core.aviso_vagas((v_cfg ->> 'max_dia')::int, v_env),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'origem', a.origem, 'titulo', a.titulo, 'corpo', a.corpo, 'pergunta', a.pergunta,
               'opcoes', a.opcoes, 'intencao', a.intencao, 'link', a.link, 'status', a.status, 'prioridade', a.prioridade,
               'criado_em', a.criado_em, 'enviado_em', a.enviado_em, 'respondido_em', a.respondido_em, 'resposta', a.resposta)
             order by (a.status = 'enviado') desc, a.prioridade desc, a.id)
        from core.avisos a
       where a.user_id = v_u
         and (a.status = 'fila'
              or (a.status = 'enviado' and a.enviado_em > now() - interval '3 days')
              or (a.status = 'respondido' and (a.respondido_em at time zone 'America/Sao_Paulo')::date = v_hoje))), '[]'::jsonb));
end $$;
revoke all on function public.hub_avisos() from public, anon;
grant execute on function public.hub_avisos() to authenticated;

-- Responde com uma palavra. Afirmativa = primeira opção do aviso ou sim/s/ok/pode/claro/quero/feito/vamos; qualquer outra palavra é "depois".
-- Afirmativa + intencao => hub_acao_pedir (risco alto vira pendente e exige "sim" de novo: acao.requer_sim). Idempotente.
-- Retorna {ok, fala, acao?, link?, afirmativa}.
create or replace function public.hub_aviso_responder(p_id bigint, p_resposta text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_u uuid := auth.uid(); a core.avisos; r text := lower(btrim(coalesce(p_resposta, ''))); v_sim boolean; v_acao jsonb; v_fala text; v_msg text;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  if r = '' then raise exception 'resposta vazia'; end if;
  select * into a from core.avisos where id = p_id and user_id = v_u for update;
  if not found then return jsonb_build_object('ok', false, 'fala', 'Não achei esse aviso.'); end if;
  if a.status = 'respondido' then
    return jsonb_build_object('ok', true, 'ja_respondido', true, 'resposta', a.resposta, 'fala', 'Você já respondeu esse aviso.');
  end if;
  if a.status in ('descartado', 'expirado') then
    return jsonb_build_object('ok', false, 'fala', 'Esse aviso não vale mais.');
  end if;
  v_sim := r = lower(a.opcoes ->> 0) or r in ('sim', 's', 'ok', 'pode', 'claro', 'quero', 'feito', 'vamos');
  update core.avisos set status = 'respondido', respondido_em = now(), resposta = r, enviado_em = coalesce(enviado_em, now()) where id = a.id;
  if v_sim and a.intencao is not null then
    begin
      v_acao := public.hub_acao_pedir(a.intencao, a.args, 'hub', a.pergunta);
      v_fala := case when (v_acao ->> 'status') = 'erro' then 'Não consegui: ' || coalesce(v_acao ->> 'erro', 'erro')
                     when coalesce((v_acao ->> 'requer_sim')::boolean, false) then coalesce(v_acao ->> 'pergunta', 'Confirma?')
                     else 'Feito.' end;
    exception when others then
      get stacked diagnostics v_msg = message_text;
      v_fala := 'Não consegui: ' || v_msg;
    end;
  elsif v_sim then
    v_fala := 'Certo, vamos olhar.';
  else
    v_fala := 'Certo, não faço nada agora.';
  end if;
  return jsonb_build_object('ok', true, 'afirmativa', v_sim, 'fala', v_fala, 'acao', v_acao, 'link', a.link);
end $$;
revoke all on function public.hub_aviso_responder(bigint, text) from public, anon;
grant execute on function public.hub_aviso_responder(bigint, text) to authenticated;

-- Limites do Leo: {max_dia 0-10, silencio_inicio 'HH:MM', silencio_fim 'HH:MM'}; só as chaves enviadas mudam.
create or replace function public.hub_interrupcoes_salvar(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_u uuid := auth.uid(); v_cfg jsonb; v_max int; v_ini text; v_fim text;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  if jsonb_typeof(coalesce(p, '{}'::jsonb)) <> 'object' then raise exception 'parâmetros inválidos'; end if;
  v_cfg := core.interrupcoes_de(v_u);
  v_max := coalesce((p ->> 'max_dia')::int, (v_cfg ->> 'max_dia')::int);
  v_ini := coalesce(p ->> 'silencio_inicio', v_cfg ->> 'silencio_inicio');
  v_fim := coalesce(p ->> 'silencio_fim', v_cfg ->> 'silencio_fim');
  if v_max not between 0 and 10 then raise exception 'max_dia deve ficar entre 0 e 10'; end if;
  if v_ini !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_fim !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'horário deve ser HH:MM'; end if;
  insert into core.perfil (user_id, config)
  values (v_u, jsonb_build_object('interrupcoes', jsonb_build_object('max_dia', v_max, 'silencio_inicio', v_ini, 'silencio_fim', v_fim)))
  on conflict (user_id) do update set config = jsonb_set(coalesce(core.perfil.config, '{}'::jsonb), '{interrupcoes}',
    jsonb_build_object('max_dia', v_max, 'silencio_inicio', v_ini, 'silencio_fim', v_fim));
  return jsonb_build_object('ok', true, 'interrupcoes', jsonb_build_object('max_dia', v_max, 'silencio_inicio', v_ini, 'silencio_fim', v_fim),
    'fala', case when v_max = 0 then 'Certo, sem avisos.' else 'Certo: até ' || v_max || ' avisos por dia, silêncio das ' || v_ini || ' às ' || v_fim || '.' end);
end $$;
revoke all on function public.hub_interrupcoes_salvar(jsonb) from public, anon;
grant execute on function public.hub_interrupcoes_salvar(jsonb) to authenticated;

-- Catálogo de intenções (UX-01/16). aviso.responder é risco baixo; a ação que o aviso dispara segue o risco dela.
insert into core.intencoes (slug, agent, exemplos, rpc, slots, risco, confirmacao, desfazer_rpc) values
 ('aviso.responder', 'iara',
  array['sim, pode rever a meta', 'depois, agora não', 'feito'],
  'public.hub_aviso_responder', '{"p_id":"bigint","p_resposta":"text"}', 'baixo', 'nenhuma', null),
 ('interrupcoes.salvar', 'iara',
  array['no máximo 2 avisos por dia', 'silêncio das 22h às 8h', 'não me avise mais'],
  'public.hub_interrupcoes_salvar',
  '{"p":"jsonb{max_dia?:int(0-10),silencio_inicio?:text(HH:MM),silencio_fim?:text(HH:MM)}"}', 'medio', 'repetir', null)
on conflict (slug) do update set
  agent = excluded.agent, exemplos = excluded.exemplos, rpc = excluded.rpc, slots = excluded.slots,
  risco = excluded.risco, confirmacao = excluded.confirmacao, desfazer_rpc = excluded.desfazer_rpc;

-- Crons: o enfileiramento roda logo depois dos gatilhos/decisões (09:00 UTC = 06:00 SP) e depois dos alertas da ClaudIA (09:50 UTC).
-- O envio fica com o tick de 15 min do airton-notify; a primeira janela fora do silêncio é 07:00 SP.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'iara-planos-progresso') then perform cron.unschedule('iara-planos-progresso'); end if;
  perform cron.schedule('iara-planos-progresso', '0 9 * * *',
    $c$ select core.planos_atualizar(); select core.abrir_decisoes(); select core.avisos_enfileirar() $c$);
  if exists (select 1 from cron.job where jobname = 'claudia-alertas') then perform cron.unschedule('claudia-alertas'); end if;
  perform cron.schedule('claudia-alertas', '50 9 * * *',
    $c$ select core.publicar_alertas_claudia(); select core.avisos_enfileirar() $c$);
end $$;
