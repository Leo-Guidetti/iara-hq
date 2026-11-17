-- UX-13: painel a favor/contra/neutro. Aditivo e idempotente.
-- core.decisoes: uma decisão por gatilho (conflito entre metas). core.decisao_posicoes: voto de cada agente (UX-13, plano.md §3.5).
-- Abrir a decisão é SQL puro (sem IA); as posições e a síntese vêm da edge iara-plano (ação `painel`) via core.painel_gravar.
-- Decidir (hub_decidir) aplica o `efeito` da opção nas metas e registra 'decisao' em core.plano_eventos. A IARA nunca escolhe (D2).
create table if not exists core.decisoes (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  plano_id    bigint references core.planos (id),
  pergunta    text not null,
  gatilho     text not null,
  opcoes      jsonb not null default '[]'::jsonb,   -- [{id, rotulo, efeito:[{meta_id, campo, valor}]}]
  sintese     jsonb,                                  -- {concordancia, divergencia, recomendacao, fala}
  escolha     text,
  status      text not null default 'aberta' check (status in ('aberta', 'painel', 'decidida', 'expirada')),
  created_at  timestamptz not null default now(),
  decidida_em timestamptz
);
-- "O mesmo gatilho não abre duas decisões": só uma aberta/painel por (usuário, gatilho).
create unique index if not exists decisoes_gatilho_aberto on core.decisoes (user_id, gatilho) where status in ('aberta', 'painel');
create index if not exists decisoes_user on core.decisoes (user_id, status);

create table if not exists core.decisao_posicoes (
  id         bigint generated always as identity primary key,
  decisao_id bigint not null references core.decisoes (id),
  agent      text not null references core.agents (slug),
  posicao    text not null check (posicao in ('favor', 'contra', 'neutro')),
  confianca  int not null check (confianca between 0 and 10),
  argumento  text not null,
  condicao   text,
  created_at timestamptz not null default now(),
  unique (decisao_id, agent)
);

alter table core.decisoes enable row level security;
alter table core.decisao_posicoes enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'decisoes' and policyname = 'decisoes_dono') then
    create policy decisoes_dono on core.decisoes for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'decisao_posicoes' and policyname = 'decisao_posicoes_dono') then
    create policy decisao_posicoes_dono on core.decisao_posicoes for select to authenticated
      using (exists (select 1 from core.decisoes d where d.id = decisao_id and d.user_id = auth.uid()));
  end if;
end $$;
revoke all on core.decisoes, core.decisao_posicoes from public, anon, authenticated;
grant select on core.decisoes, core.decisao_posicoes to authenticated;

-- Conflitos de um usuário SEM depender de auth.uid() (uso interno do servidor/cron). Mesma conta de core.v_conflitos,
-- trocando core.v_recursos por core.recursos_de(p_user). As views existentes não mudam.
create or replace function core.conflitos_de(p_user uuid)
returns table (user_id uuid, recurso text, demanda_total numeric, capacidade numeric, excesso numeric, metas jsonb, gatilho text, precisa_painel boolean)
language sql stable security definer set search_path = '' as $$
with dem as (
  select p.user_id, rec.recurso, m.id as meta_id, p.id as plano_id, p.titulo as plano, m.titulo, p.prioridade,
         (m.demanda ->> rec.chave)::numeric as demanda,
         case rec.recurso when 'dinheiro' then r.poupanca_mes else r.minutos_livres_semana end as capacidade
    from core.plano_metas m
    join core.planos p on p.id = m.plano_id and p.status = 'ativo' and p.user_id = p_user
    join core.recursos_de(p_user) r on r.user_id = p.user_id
   cross join (values ('dinheiro', 'reais_mes'), ('tempo', 'minutos_semana')) rec (recurso, chave)
   where m.status = 'ativa' and jsonb_typeof(m.demanda -> rec.chave) = 'number' and (m.demanda ->> rec.chave)::numeric > 0
), acc as (
  select d.*,
         sum(d.demanda) over w as acum,
         sum(d.demanda) over (partition by d.user_id, d.recurso) as total,
         count(*) over (partition by d.user_id, d.recurso) as n,
         bool_and(d.prioridade is not null) over (partition by d.user_id, d.recurso) as todas_com_prioridade
    from dem d
  window w as (partition by d.user_id, d.recurso order by d.prioridade, d.meta_id)
), env as (
  select * from acc
   where capacidade is not null and total > capacidade and n >= 2
     and (not todas_com_prioridade or acum > capacidade)
)
select e.user_id, e.recurso, max(e.total), max(e.capacidade), max(e.total) - max(e.capacidade),
       jsonb_agg(jsonb_build_object('meta_id', e.meta_id, 'plano_id', e.plano_id, 'plano', e.plano, 'titulo', e.titulo,
                                    'demanda', e.demanda) order by e.meta_id),
       'conflito:' || e.recurso || ':' || string_agg(e.meta_id::text, ',' order by e.meta_id),
       not bool_and(e.todas_com_prioridade)
  from env e
 group by e.user_id, e.recurso
$$;
revoke all on function core.conflitos_de(uuid) from public, anon, authenticated;
grant execute on function core.conflitos_de(uuid) to service_role;

-- Abre UMA decisão por gatilho (conflito com precisa_painel). Idempotente; sem IA. Opções determinísticas por meta (as 3 de maior
-- demanda): reduzir o aporte/tempo, adiar o prazo, pausar; mais "manter como está". Decisão cujo conflito sumiu vira 'expirada'.
-- Não reabre por 30 dias um gatilho já decidido. p_user nulo = todos os membros.
create or replace function core.abrir_decisoes(p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid; c record; m record; v_ops jsonb; v_n int := 0; v_exp int := 0; v_gat text[]; v_chave text; v_unid text; v_cap text;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_novo numeric; v_rest int; v_add int; v_prazo date; v_planos text; v_rows int;
begin
  for u in select x.user_id from core.members x where p_user is null or x.user_id = p_user loop
    v_gat := '{}';
    for c in select * from core.conflitos_de(u) where precisa_painel loop
      v_gat := v_gat || c.gatilho;
      if exists (select 1 from core.decisoes d where d.user_id = u and d.gatilho = c.gatilho
                  and (d.status in ('aberta', 'painel') or (d.status = 'decidida' and d.decidida_em > now() - interval '30 days'))) then
        continue;
      end if;
      v_chave := case c.recurso when 'dinheiro' then 'reais_mes' else 'minutos_semana' end;
      v_unid := case c.recurso when 'dinheiro' then 'R$ por mês' else 'min por semana' end;
      v_ops := '[]'::jsonb;
      for m in select pm.id, pm.titulo, pm.prazo, (pm.demanda ->> v_chave)::numeric as dem
                 from core.plano_metas pm
                where pm.id in (select (x ->> 'meta_id')::bigint from jsonb_array_elements(c.metas) x)
                order by (pm.demanda ->> v_chave)::numeric desc, pm.id limit 3 loop
        v_novo := greatest(round(m.dem - c.excesso), 0);
        v_ops := v_ops || jsonb_build_object('id', 'reduzir:' || m.id,
          'rotulo', (case c.recurso when 'dinheiro' then 'Reduzir o aporte de "' else 'Reduzir o tempo de "' end) || m.titulo || '" de '
                    || round(m.dem)::text || ' para ' || v_novo::text || ' ' || v_unid,
          'efeito', jsonb_build_array(jsonb_build_object('meta_id', m.id, 'campo', 'demanda.' || v_chave, 'valor', v_novo)));
        if m.prazo is not null and m.prazo > v_hoje and m.dem > c.excesso then
          v_rest := greatest((extract(year from age(m.prazo, v_hoje)) * 12 + extract(month from age(m.prazo, v_hoje)))::int, 1);
          v_add := least(ceil(v_rest * c.excesso / (m.dem - c.excesso))::int, 60);
          v_prazo := (m.prazo + make_interval(months => v_add))::date;
          v_ops := v_ops || jsonb_build_object('id', 'adiar:' || m.id,
            'rotulo', 'Adiar o prazo de "' || m.titulo || '" em ' || v_add::text || case when v_add = 1 then ' mês' else ' meses' end,
            'efeito', jsonb_build_array(
              jsonb_build_object('meta_id', m.id, 'campo', 'prazo', 'valor', v_prazo::text),
              jsonb_build_object('meta_id', m.id, 'campo', 'demanda.' || v_chave, 'valor', round(m.dem * v_rest / (v_rest + v_add)))));
        end if;
        v_ops := v_ops || jsonb_build_object('id', 'pausar:' || m.id, 'rotulo', 'Pausar "' || m.titulo || '"',
          'efeito', jsonb_build_array(jsonb_build_object('meta_id', m.id, 'campo', 'status', 'valor', 'pausada')));
      end loop;
      v_ops := v_ops || jsonb_build_object('id', 'manter', 'rotulo', 'Manter como está', 'efeito', '[]'::jsonb);
      select string_agg(distinct x ->> 'plano', '" e "' order by x ->> 'plano') into v_planos from jsonb_array_elements(c.metas) x;
      v_cap := case c.recurso when 'dinheiro' then 'pedem R$ ' || round(c.demanda_total)::text || ' por mês e a poupança prevista é R$ ' || round(c.capacidade)::text
                              else 'pedem ' || round(c.demanda_total)::text || ' min por semana e sobram ' || round(c.capacidade)::text end;
      insert into core.decisoes (user_id, plano_id, pergunta, gatilho, opcoes)
      values (u, (select min((x ->> 'plano_id')::bigint) from jsonb_array_elements(c.metas) x),
              'Os planos "' || v_planos || '" disputam ' || case c.recurso when 'dinheiro' then 'o mesmo dinheiro' else 'o mesmo tempo' end
                || ': ' || v_cap || '. Qual caminho?', c.gatilho, v_ops)
      on conflict (user_id, gatilho) where status in ('aberta', 'painel') do nothing;
      get diagnostics v_rows = row_count;
      v_n := v_n + v_rows;
    end loop;
    -- Conflito resolvido (ou mudou de gatilho): decisão ainda aberta vira 'expirada' (marcação, nunca remoção).
    update core.decisoes d set status = 'expirada'
     where d.user_id = u and d.status in ('aberta', 'painel') and d.gatilho like 'conflito:%' and not (d.gatilho = any(v_gat));
    get diagnostics v_rows = row_count;
    v_exp := v_exp + v_rows;
  end loop;
  return jsonb_build_object('abertas', v_n, 'expiradas', v_exp);
end $$;
revoke all on function core.abrir_decisoes(uuid) from public, anon, authenticated;
grant execute on function core.abrir_decisoes(uuid) to service_role;

-- Contexto para a edge montar o painel: decisão + metas envolvidas (ids do gatilho e dos efeitos) + resumo de cada agente (sem IA).
create or replace function core.decisao_contexto(p_decisao bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d core.decisoes; v_ids bigint[]; v_metas jsonb;
begin
  select * into d from core.decisoes where id = p_decisao;
  if not found then return null; end if;
  select coalesce(array_agg(distinct i), '{}') into v_ids from (
    select x::bigint as i from unnest(string_to_array(nullif(split_part(d.gatilho, ':', 3), ''), ',')) x where x ~ '^\d+$'
    union select (e ->> 'meta_id')::bigint from jsonb_array_elements(d.opcoes) o, jsonb_array_elements(o -> 'efeito') e) t;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'plano', pl.titulo, 'dono', m.dono, 'titulo', m.titulo, 'horizonte', m.horizonte,
           'prazo', m.prazo::text, 'demanda', m.demanda, 'medida', m.medida, 'progresso', m.progresso, 'ritmo', m.ritmo) order by m.id), '[]'::jsonb)
    into v_metas from core.plano_metas m join core.planos pl on pl.id = m.plano_id where m.id = any(v_ids) and pl.user_id = d.user_id;
  return jsonb_build_object('decisao', jsonb_build_object('id', d.id, 'user_id', d.user_id, 'plano_id', d.plano_id, 'pergunta', d.pergunta,
           'gatilho', d.gatilho, 'opcoes', d.opcoes, 'sintese', d.sintese, 'status', d.status, 'escolha', d.escolha),
         'recurso', split_part(d.gatilho, ':', 2), 'metas', v_metas, 'resumo', core.plano_resumo_agentes(d.user_id));
end $$;
revoke all on function core.decisao_contexto(bigint) from public, anon, authenticated;
grant execute on function core.decisao_contexto(bigint) to service_role;

-- Grava as posições (2 a 4, uma por agente) e a síntese; status 'painel'. Idempotente (reaplicar atualiza). Decisão já decidida não muda.
-- p_posicoes: [{agent, posicao, confianca, argumento, condicao?}]; p_sintese: {concordancia, divergencia, recomendacao, fala}.
create or replace function core.painel_gravar(p_decisao bigint, p_posicoes jsonb, p_sintese jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d core.decisoes; x jsonb; n int;
begin
  select * into d from core.decisoes where id = p_decisao for update;
  if not found then raise exception 'decisão não encontrada'; end if;
  if d.status not in ('aberta', 'painel') then raise exception 'decisão %: não aceita painel', d.status; end if;
  select count(distinct e ->> 'agent') into n from jsonb_array_elements(coalesce(p_posicoes, '[]'::jsonb)) e;
  if n < 2 or n > 4 then raise exception 'painel precisa de 2 a 4 posições (veio %)', n; end if;
  for x in select * from jsonb_array_elements(p_posicoes) loop
    insert into core.decisao_posicoes (decisao_id, agent, posicao, confianca, argumento, condicao)
    values (d.id, x ->> 'agent', x ->> 'posicao', (x ->> 'confianca')::int, x ->> 'argumento', nullif(x ->> 'condicao', ''))
    on conflict (decisao_id, agent) do update set posicao = excluded.posicao, confianca = excluded.confianca,
      argumento = excluded.argumento, condicao = excluded.condicao;
  end loop;
  update core.decisoes set sintese = p_sintese, status = 'painel' where id = d.id;
  return jsonb_build_object('id', d.id, 'status', 'painel', 'posicoes', n);
end $$;
revoke all on function core.painel_gravar(bigint, jsonb, jsonb) from public, anon, authenticated;
grant execute on function core.painel_gravar(bigint, jsonb, jsonb) to service_role;

-- Leitura para o hub: decisões abertas/painel do usuário com posições, síntese e opções. null se não for membro.
create or replace function public.hub_decisoes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_u uuid := auth.uid();
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', d.id, 'plano_id', d.plano_id, 'plano', (select pl.titulo from core.planos pl where pl.id = d.plano_id),
        'pergunta', d.pergunta, 'gatilho', d.gatilho, 'status', d.status, 'opcoes', d.opcoes, 'sintese', d.sintese, 'created_at', d.created_at,
        'posicoes', coalesce((select jsonb_agg(jsonb_build_object('agent', p.agent, 'posicao', p.posicao, 'confianca', p.confianca,
                      'argumento', p.argumento, 'condicao', p.condicao) order by p.id) from core.decisao_posicoes p where p.decisao_id = d.id), '[]'::jsonb))
      order by d.created_at, d.id)
      from core.decisoes d where d.user_id = v_u and d.status in ('aberta', 'painel')), '[]'::jsonb);
end $$;

-- Decide: aplica o efeito da opção nas metas (core.meta_salvar), registra 'decisao' em core.plano_eventos e fecha. Só o dono.
-- Repetir NÃO reaplica: decisão já decidida devolve o estado, sem tocar em nada. Campos de efeito aceitos: prazo, status,
-- demanda.reais_mes, demanda.minutos_semana.
create or replace function public.hub_decidir(p_id bigint, p_escolha text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_u uuid := auth.uid(); d core.decisoes; v_op jsonb; e jsonb; v_campo text; v_meta bigint; v_pl bigint; v_dem jsonb;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  select * into d from core.decisoes where id = p_id and user_id = v_u for update;
  if not found then raise exception 'decisão não encontrada'; end if;
  if d.status = 'decidida' then
    return jsonb_build_object('id', d.id, 'status', d.status, 'escolha', d.escolha, 'decidida_em', d.decidida_em, 'ja_decidida', true);
  end if;
  if d.status = 'expirada' then raise exception 'decisão expirada'; end if;
  select o into v_op from jsonb_array_elements(d.opcoes) o where o ->> 'id' = p_escolha;
  if v_op is null then raise exception 'opção inválida: %', p_escolha; end if;
  for e in select * from jsonb_array_elements(coalesce(v_op -> 'efeito', '[]'::jsonb)) loop
    v_campo := e ->> 'campo'; v_meta := (e ->> 'meta_id')::bigint;
    if v_campo = 'prazo' then perform core.meta_salvar(jsonb_build_object('id', v_meta, 'prazo', e ->> 'valor'));
    elsif v_campo = 'status' then perform core.meta_salvar(jsonb_build_object('id', v_meta, 'status', e ->> 'valor'));
    elsif v_campo in ('demanda.reais_mes', 'demanda.minutos_semana') then
      select m.demanda into v_dem from core.plano_metas m join core.planos pl on pl.id = m.plano_id where m.id = v_meta and pl.user_id = v_u;
      if v_dem is null then raise exception 'meta não encontrada'; end if;
      perform core.meta_salvar(jsonb_build_object('id', v_meta, 'demanda', v_dem || jsonb_build_object(split_part(v_campo, '.', 2), e -> 'valor')));
    else raise exception 'campo de efeito inválido: %', v_campo; end if;
  end loop;
  for v_meta, v_pl in select distinct (x ->> 'meta_id')::bigint, m.plano_id
                        from jsonb_array_elements(coalesce(v_op -> 'efeito', '[]'::jsonb)) x
                        join core.plano_metas m on m.id = (x ->> 'meta_id')::bigint loop
    insert into core.plano_eventos (plano_id, meta_id, tipo, origem, dados)
    values (v_pl, v_meta, 'decisao', 'leo', jsonb_build_object('decisao_id', d.id, 'escolha', p_escolha, 'rotulo', v_op ->> 'rotulo',
            'efeito', (select jsonb_agg(x) from jsonb_array_elements(v_op -> 'efeito') x where (x ->> 'meta_id')::bigint = v_meta)));
  end loop;
  if jsonb_array_length(coalesce(v_op -> 'efeito', '[]'::jsonb)) = 0 and d.plano_id is not null then
    insert into core.plano_eventos (plano_id, tipo, origem, dados)
    values (d.plano_id, 'decisao', 'leo', jsonb_build_object('decisao_id', d.id, 'escolha', p_escolha, 'rotulo', v_op ->> 'rotulo', 'efeito', '[]'::jsonb));
  end if;
  update core.decisoes set status = 'decidida', escolha = p_escolha, decidida_em = now() where id = d.id returning * into d;
  return jsonb_build_object('id', d.id, 'status', d.status, 'escolha', d.escolha, 'decidida_em', d.decidida_em, 'rotulo', v_op ->> 'rotulo',
                            'efeito', coalesce(v_op -> 'efeito', '[]'::jsonb), 'ja_decidida', false);
end $$;
revoke all on function public.hub_decisoes(), public.hub_decidir(bigint, text) from public, anon;
grant execute on function public.hub_decisoes(), public.hub_decidir(bigint, text) to authenticated;

insert into core.intencoes (slug, agent, exemplos, rpc, slots, risco, confirmacao, desfazer_rpc) values
 ('decisao.decidir', 'iara',
  array['decide pela opção de adiar o prazo', 'fico com a recomendação da IARA', 'pausa o plano do carro e segue com o apartamento'],
  'public.hub_decidir', '{"p_id":"bigint","p_escolha":"text"}', 'alto', 'sim', null),
 ('decisoes.status', 'iara',
  array['tem alguma decisão pendente', 'o que a IARA quer que eu decida', 'qual o conflito entre os planos'],
  'public.hub_decisoes', '{}', 'baixo', 'nenhuma', null)
on conflict (slug) do update set
  agent = excluded.agent, exemplos = excluded.exemplos, rpc = excluded.rpc, slots = excluded.slots,
  risco = excluded.risco, confirmacao = excluded.confirmacao, desfazer_rpc = excluded.desfazer_rpc;

-- Job diário (09:00 UTC): progresso das metas e depois abre decisões de conflito. Sem IA.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'iara-planos-progresso') then perform cron.unschedule('iara-planos-progresso'); end if;
  perform cron.schedule('iara-planos-progresso', '0 9 * * *', $c$ select core.planos_atualizar(); select core.abrir_decisoes() $c$);
end $$;
