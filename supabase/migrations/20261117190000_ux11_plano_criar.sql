-- UX-11: backend do "plano nasce de uma frase" (edge function iara-plano). Aditivo e idempotente.
-- As funções core.plano_* abaixo recebem p_user e só o service_role as executa (a edge usa SQL direto, sem auth.uid()).
-- core.recursos NÃO muda: core.recursos_de é a mesma conta, sem a trava auth.uid() (para uso interno).

create or replace function core.recursos_de(p_user uuid) returns table (user_id uuid, poupanca_mes numeric, minutos_livres_semana numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cfg jsonb; v_sono numeric; v_exp numeric := 0; v_rot numeric; v_poup numeric; v_ini time; v_fim time;
begin
  if p_user is null or not exists (select 1 from core.members m where m.user_id = p_user) then return; end if;
  select coalesce(p.config, '{}'::jsonb) into v_cfg from core.perfil p where p.user_id = p_user;
  v_cfg := coalesce(v_cfg, '{}'::jsonb);
  v_sono := case when jsonb_typeof(v_cfg -> 'sono_horas') = 'number' then (v_cfg ->> 'sono_horas')::numeric else 8 end;
  if jsonb_typeof(v_cfg -> 'expediente' -> 'dias') = 'array' then
    begin
      v_ini := (v_cfg -> 'expediente' ->> 'inicio')::time; v_fim := (v_cfg -> 'expediente' ->> 'fim')::time;
      v_exp := jsonb_array_length(v_cfg -> 'expediente' -> 'dias') * greatest(extract(epoch from (v_fim - v_ini)) / 60, 0);
    exception when others then v_exp := 0; end;
  end if;
  select coalesce(sum(cardinality(r.dias) * coalesce(r.minutos, 0)), 0) into v_rot
    from core.rotina r where r.user_id = p_user and r.ativo;
  begin v_poup := (airton.goals_status(p_user) ->> 'poupanca_base')::numeric;
  exception when others then v_poup := null; end;
  return query select p_user, v_poup, greatest(7 * 24 * 60 - v_sono * 60 * 7 - coalesce(v_exp, 0) - v_rot, 0);
end $$;

-- Resumo de cada agente para a IARA propor o plano (sem IA). Falha de uma fonte vira null, sem derrubar as outras.
create or replace function core.plano_resumo_agentes(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_fin jsonb; v_liv jsonb; v_peso jsonb; v_rec jsonb;
begin
  begin v_fin := airton.goals_status(p_user); exception when others then v_fin := null; end;
  begin v_liv := sabia.livros_meta(p_user, v_hoje); exception when others then v_liv := null; end;
  begin
    select jsonb_build_object('tendencia_7d', w.trend_7d, 'em', w.local_date) into v_peso
      from public.weight_with_trend w where w.user_id = p_user and w.trend_7d is not null order by w.local_date desc limit 1;
  exception when others then v_peso := null; end;
  begin
    select jsonb_build_object('poupanca_mes', r.poupanca_mes, 'minutos_livres_semana', r.minutos_livres_semana) into v_rec
      from core.recursos_de(p_user) r;
  exception when others then v_rec := null; end;
  return jsonb_build_object(
    'financas', case when v_fin is null then null else jsonb_build_object(
      'poupanca_base', v_fin -> 'poupanca_base', 'poupanca_media_3m', v_fin -> 'poupanca_media_3m',
      'aporte_total_metas', v_fin -> 'aporte_total', 'folga', v_fin -> 'folga', 'metas_ativas', jsonb_array_length(v_fin -> 'metas')) end,
    'leitura', v_liv, 'saude', jsonb_build_object('peso', v_peso), 'recursos', v_rec);
end $$;

-- Grava o rascunho: plano 'rascunho' + metas, idempotente por (usuário, título do plano) e (plano, título da meta).
-- p: {titulo, tipo?, alvo?, porque?, metas:[{horizonte, dono, titulo, medida?, prazo?, cadencia?, demanda?, ref?}]}
-- Plano que já saiu de 'rascunho' não é tocado (devolve existente = true). Nada vai para core.itens.
create or replace function core.plano_rascunho_gravar(p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_titulo text := nullif(btrim(p ->> 'titulo'), ''); v_pl core.planos; m jsonb; v_manter bigint[] := '{}'; v_id bigint; v_novo boolean;
begin
  if not exists (select 1 from core.members x where x.user_id = p_user) then raise exception 'sem acesso'; end if;
  if v_titulo is null then raise exception 'título obrigatório'; end if;
  select * into v_pl from core.planos where user_id = p_user and titulo = v_titulo;
  if found and v_pl.status <> 'rascunho' then return to_jsonb(v_pl) || jsonb_build_object('existente', true); end if;
  insert into core.planos (user_id, titulo, tipo, status, alvo, porque)
  values (p_user, v_titulo, coalesce(p ->> 'tipo', 'outro'), 'rascunho', coalesce(p -> 'alvo', '{}'::jsonb), p ->> 'porque')
  on conflict (user_id, titulo) do update set
    tipo = coalesce(p ->> 'tipo', core.planos.tipo), alvo = coalesce(p -> 'alvo', core.planos.alvo),
    porque = coalesce(p ->> 'porque', core.planos.porque), updated_at = now()
  returning * into v_pl;
  insert into core.plano_eventos (plano_id, tipo, origem, dados)
  select v_pl.id, 'criado', 'agente', jsonb_build_object('titulo', v_pl.titulo, 'rascunho', true)
   where not exists (select 1 from core.plano_eventos e where e.plano_id = v_pl.id and e.tipo = 'criado');
  for m in select * from jsonb_array_elements(coalesce(p -> 'metas', '[]'::jsonb)) loop
    select id into v_id from core.plano_metas where plano_id = v_pl.id and titulo = btrim(m ->> 'titulo') limit 1;
    if v_id is null then
      insert into core.plano_metas (plano_id, horizonte, dono, titulo, medida, prazo, cadencia, demanda, ref)
      values (v_pl.id, m ->> 'horizonte', m ->> 'dono', btrim(m ->> 'titulo'), coalesce(m -> 'medida', '{}'::jsonb),
              nullif(m ->> 'prazo', '')::date, m ->> 'cadencia', coalesce(m -> 'demanda', '{}'::jsonb), m ->> 'ref')
      returning id into v_id;
    else
      update core.plano_metas set horizonte = m ->> 'horizonte', dono = m ->> 'dono', medida = coalesce(m -> 'medida', medida),
        prazo = nullif(m ->> 'prazo', '')::date, cadencia = m ->> 'cadencia', demanda = coalesce(m -> 'demanda', demanda),
        ref = coalesce(m ->> 'ref', ref), status = 'ativa', updated_at = now() where id = v_id;
    end if;
    v_manter := v_manter || v_id;
  end loop;
  -- Rascunho refeito: metas do rascunho anterior que sumiram viram 'cancelada' (nunca delete).
  update core.plano_metas set status = 'cancelada', updated_at = now()
   where plano_id = v_pl.id and status = 'ativa' and not (id = any(v_manter));
  return to_jsonb(v_pl) || jsonb_build_object('existente', false);
end $$;

-- Confirma: plano -> 'ativo'; para cada meta do AIrton com medida.tipo 'valor' e alvo > 0 e sem ref, cria a airton.goals
-- (equivale a airton.goal_salvar) e liga por ref 'airton.goals:<id>'. Idempotente: confirmar de novo não cria nada.
create or replace function core.plano_confirmar(p_user uuid, p_plano bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pl core.planos; m core.plano_metas; v_goal text; v_alvo numeric; v_criadas jsonb := '[]'::jsonb; v_mudou boolean := false;
begin
  select * into v_pl from core.planos where id = p_plano and user_id = p_user for update;
  if not found then raise exception 'plano não encontrado'; end if;
  if v_pl.status = 'abandonado' or v_pl.status = 'concluido' then raise exception 'plano %: não pode ser confirmado', v_pl.status; end if;
  if v_pl.status <> 'ativo' then
    update core.planos set status = 'ativo', proxima_revisao = coalesce(proxima_revisao, (now() at time zone 'America/Sao_Paulo')::date + 30),
      updated_at = now() where id = v_pl.id returning * into v_pl;
    v_mudou := true;
  end if;
  for m in select * from core.plano_metas where plano_id = v_pl.id and status = 'ativa' and dono = 'airton'
              and ref is null and medida ->> 'tipo' = 'valor' order by id loop
    v_alvo := nullif(m.medida ->> 'alvo', '')::numeric;
    if coalesce(v_alvo, 0) <= 0 then continue; end if;
    insert into airton.goals (user_id, name, target_amount, target_currency, target_date, current_amount, kind, status)
    values (p_user, m.titulo, v_alvo, 'BRL', m.prazo, 0,
            case when v_pl.tipo in ('imovel', 'carro') then v_pl.tipo else 'outro' end, 'ativa')
    returning id into v_goal;
    update core.plano_metas set ref = 'airton.goals:' || v_goal, updated_at = now() where id = m.id;
    v_criadas := v_criadas || jsonb_build_object('meta_id', m.id, 'ref', 'airton.goals:' || v_goal);
  end loop;
  if v_mudou or jsonb_array_length(v_criadas) > 0 then
    insert into core.plano_eventos (plano_id, tipo, origem, dados)
    values (v_pl.id, 'ajuste', 'leo', jsonb_build_object('acao', 'confirmado', 'goals_criadas', v_criadas));
  end if;
  return to_jsonb(v_pl) || jsonb_build_object('goals_criadas', v_criadas);
end $$;

-- Descarta: status 'abandonado' (nunca delete). Idempotente.
create or replace function core.plano_descartar(p_user uuid, p_plano bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_pl core.planos;
begin
  select * into v_pl from core.planos where id = p_plano and user_id = p_user for update;
  if not found then raise exception 'plano não encontrado'; end if;
  if v_pl.status <> 'abandonado' then
    update core.planos set status = 'abandonado', updated_at = now() where id = v_pl.id returning * into v_pl;
    insert into core.plano_eventos (plano_id, tipo, origem, dados)
    values (v_pl.id, 'ajuste', 'leo', jsonb_build_object('acao', 'descartado'));
  end if;
  return to_jsonb(v_pl);
end $$;

revoke all on function core.recursos_de(uuid), core.plano_resumo_agentes(uuid), core.plano_rascunho_gravar(uuid, jsonb),
  core.plano_confirmar(uuid, bigint), core.plano_descartar(uuid, bigint) from public, anon, authenticated;
grant execute on function core.recursos_de(uuid), core.plano_resumo_agentes(uuid), core.plano_rascunho_gravar(uuid, jsonb),
  core.plano_confirmar(uuid, bigint), core.plano_descartar(uuid, bigint) to service_role;

-- Parte determinística exposta ao hub e ao catálogo de intenções. `criar` é ação da função iara-plano (IA), não de RPC.
create or replace function public.hub_plano_confirmar(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_u uuid := auth.uid();
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  return core.plano_confirmar(v_u, p_id);
end $$;
revoke all on function public.hub_plano_confirmar(bigint) from public, anon;
grant execute on function public.hub_plano_confirmar(bigint) to authenticated;

insert into core.intencoes (slug, agent, exemplos, rpc, slots, risco, confirmacao, desfazer_rpc) values
 ('plano.confirmar', 'iara',
  array['confirma o plano do apartamento', 'pode ativar esse plano', 'sim, ativa o plano'],
  'public.hub_plano_confirmar', '{"p_id":"bigint"}', 'alto', 'sim', null),
 ('plano.criar', 'iara',
  array['quero comprar um apartamento de 800 mil até 2030', 'cria um plano para trocar de carro em 2027', 'quero aprender violão este ano'],
  'fn:iara-plano/criar', '{"frase":"text","respostas":"jsonb[]?","rascunho_id":"bigint?"}', 'baixo', 'nenhuma', null)
on conflict (slug) do update set
  agent = excluded.agent, exemplos = excluded.exemplos, rpc = excluded.rpc, slots = excluded.slots,
  risco = excluded.risco, confirmacao = excluded.confirmacao, desfazer_rpc = excluded.desfazer_rpc;
comment on column core.intencoes.rpc is
  'RPC pública a chamar. Prefixo "fn:<função>/<ação>" = ação de Edge Function (ex.: fn:iara-plano/criar), não RPC.';
