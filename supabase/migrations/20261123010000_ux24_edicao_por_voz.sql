-- UX-24: editar 100% dos planos por voz. Aditivo e idempotente.
-- Levantamento das ações de tela (/planos, Novo plano, /semana e metas de /financas): docs/ux-audit/acoes-por-voz.md.
-- Cada ação que ainda não tinha intenção ganha uma RPC com parâmetros nomeados (o despachante do UX-16 passa só os que vierem)
-- e uma linha em core.intencoes. Mexer em plano ou meta é risco alto: só executa depois do "sim" (D3).

-- 1) Plano: renomear, pausar, retomar, arquivar/concluir, trocar alvo, prazo, porquê e tipo. Só o que vier muda.
create or replace function public.hub_plano_editar(
  p_id bigint, p_titulo text default null, p_status text default null, p_alvo_valor numeric default null,
  p_alvo_data date default null, p_porque text default null, p_tipo text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_u uuid := auth.uid(); r core.planos; v_titulo text := nullif(btrim(p_titulo), ''); v_porque text := nullif(btrim(p_porque), '');
  v_mud jsonb;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  select * into r from core.planos pl where pl.id = p_id and pl.user_id = v_u for update;
  if not found then raise exception 'plano não encontrado'; end if;
  if p_status is not null and p_status not in ('ativo', 'pausado', 'concluido', 'abandonado') then raise exception 'status inválido: %', p_status; end if;
  -- rascunho só sai do rascunho pelo hub_plano_confirmar (que cria a meta do AIrton ligada por ref) ou descartado;
  -- arquivado ou concluído não volta (mesma regra do core.plano_confirmar), senão um rascunho viraria ativo sem as metas do AIrton
  if p_status is not null and r.status = 'rascunho' and p_status <> 'abandonado' then
    raise exception 'rascunho se ativa confirmando o plano';
  end if;
  if p_status in ('ativo', 'pausado') and r.status in ('abandonado', 'concluido') then
    raise exception 'plano %: não volta, crie um plano novo', r.status;
  end if;
  if p_tipo is not null and p_tipo not in ('imovel', 'carro', 'carreira', 'habilidade', 'habito', 'outro') then raise exception 'tipo inválido: %', p_tipo; end if;
  if p_alvo_valor is not null and p_alvo_valor <= 0 then raise exception 'valor precisa ser maior que zero'; end if;
  if v_titulo is not null and exists (select 1 from core.planos x where x.user_id = v_u and x.titulo = v_titulo and x.id <> p_id) then
    raise exception 'já existe um plano com esse nome';
  end if;
  v_mud := jsonb_strip_nulls(jsonb_build_object('titulo', v_titulo, 'status', p_status, 'alvo_valor', p_alvo_valor,
             'alvo_data', p_alvo_data, 'porque', v_porque, 'tipo', p_tipo));
  if v_mud = '{}'::jsonb then return to_jsonb(r) || jsonb_build_object('mudou', false); end if;
  update core.planos pl set
    titulo = coalesce(v_titulo, pl.titulo), status = coalesce(p_status, pl.status), tipo = coalesce(p_tipo, pl.tipo),
    alvo = pl.alvo || jsonb_strip_nulls(jsonb_build_object('valor', p_alvo_valor, 'data', p_alvo_data)),
    porque = coalesce(v_porque, pl.porque), updated_at = now()
  where pl.id = p_id returning * into r;
  insert into core.plano_eventos (plano_id, tipo, origem, dados)
  values (r.id, case when p_status = 'pausado' then 'pausa' else 'ajuste' end, 'leo', v_mud || jsonb_build_object('via', 'edicao'));
  return to_jsonb(r) || jsonb_build_object('mudou', true);
end $$;

-- 2) Descartar o rascunho do "Novo plano" (mesma regra do botão Descartar: status abandonado).
create or replace function public.hub_plano_descartar(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_u uuid := auth.uid(); v_st text;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  select pl.status into v_st from core.planos pl where pl.id = p_id and pl.user_id = v_u;
  if not found then raise exception 'plano não encontrado'; end if;
  -- só rascunho; plano ativo se arquiva por plano.editar (status abandonado)
  if v_st not in ('rascunho', 'abandonado') then raise exception 'só rascunho se descarta (este plano está %)', v_st; end if;
  return core.plano_descartar(v_u, p_id);
end $$;

-- 3) Meta de plano: renomear, prazo, horizonte, dono, status (pausar/retomar/concluir/arquivar = cancelada), valor-alvo, cadência.
--    Meta ligada a uma meta do AIrton (ref airton.goals:<id>) leva valor e prazo também para lá, para o progresso não divergir.
create or replace function public.hub_meta_editar(
  p_id bigint, p_titulo text default null, p_prazo date default null, p_horizonte text default null, p_dono text default null,
  p_status text default null, p_alvo numeric default null, p_cadencia text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_u uuid := auth.uid(); m core.plano_metas; v_res jsonb; v_mud jsonb; v_goal text; v_pl_status text;
begin
  if not exists (select 1 from core.members x where x.user_id = v_u) then raise exception 'sem acesso'; end if;
  select pm.* into m from core.plano_metas pm join core.planos pl on pl.id = pm.plano_id where pm.id = p_id and pl.user_id = v_u;
  if not found then raise exception 'meta não encontrada'; end if;
  select pl.status into v_pl_status from core.planos pl where pl.id = m.plano_id;
  if p_alvo is not null and p_alvo <= 0 then raise exception 'valor precisa ser maior que zero'; end if;
  v_mud := jsonb_strip_nulls(jsonb_build_object('titulo', nullif(btrim(p_titulo), ''), 'prazo', p_prazo, 'horizonte', p_horizonte,
             'dono', p_dono, 'status', p_status, 'alvo', p_alvo, 'cadencia', nullif(btrim(p_cadencia), '')));
  if v_mud = '{}'::jsonb then return to_jsonb(m) || jsonb_build_object('mudou', false); end if;
  -- core.meta_salvar valida dono, horizonte e posse e mantém o que não veio (coalesce)
  v_res := core.meta_salvar(jsonb_strip_nulls(jsonb_build_object('id', p_id, 'titulo', nullif(btrim(p_titulo), ''), 'prazo', p_prazo,
             'horizonte', p_horizonte, 'dono', p_dono, 'status', p_status, 'cadencia', nullif(btrim(p_cadencia), ''),
             'medida', case when p_alvo is not null then case when coalesce(m.medida ->> 'tipo', '') = '' then '{"tipo":"valor","unidade":"BRL"}'::jsonb || coalesce(m.medida, '{}'::jsonb) else m.medida end
               || jsonb_build_object('alvo', p_alvo) end)));
  v_goal := case when m.ref like 'airton.goals:%' then substr(m.ref, 14) end;
  -- meta ligada: nome, valor, prazo e status (concluida/cancelada/ativa; pausada não existe no AIrton) vão para airton.goals
  if v_goal is not null
     and (nullif(btrim(p_titulo), '') is not null or p_alvo is not null or p_prazo is not null or p_status in ('ativa', 'concluida', 'cancelada'))
     and exists (select 1 from airton.goals g where g.id::text = v_goal and g.user_id = v_u)
     and exists (select 1 from airton.members am where am.user_id = v_u) then
    perform airton.goal_salvar(jsonb_strip_nulls(jsonb_build_object('id', v_goal, 'name', nullif(btrim(p_titulo), ''), 'target_amount', p_alvo,
              'target_date', p_prazo, 'status', case when p_status in ('ativa', 'concluida', 'cancelada') then p_status end)));
  end if;
  -- meta que passou a ser do AIrton (ou ganhou valor) num plano ativo: cria a meta financeira como o confirmar faria
  if v_goal is null and v_pl_status = 'ativo' then
    v_res := v_res || jsonb_build_object('goals_criadas', core.plano_confirmar(v_u, m.plano_id) -> 'goals_criadas');
  end if;
  insert into core.plano_eventos (plano_id, meta_id, tipo, origem, dados)
  values (m.plano_id, p_id, case when p_status = 'pausada' then 'pausa' else 'ajuste' end, 'leo', v_mud || jsonb_build_object('via', 'edicao'));
  return v_res || jsonb_build_object('mudou', true);
end $$;

-- 4) Adicionar meta a um plano (também no rascunho). Dono padrão = IARA (D1); valor vira medida {tipo valor, BRL}.
create or replace function public.hub_meta_adicionar(
  p_plano bigint, p_titulo text, p_horizonte text, p_dono text default 'iara', p_prazo date default null,
  p_alvo numeric default null, p_cadencia text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_res jsonb; v_pl_status text;
begin
  if not exists (select 1 from core.members x where x.user_id = auth.uid()) then raise exception 'sem acesso'; end if;
  if p_alvo is not null and p_alvo <= 0 then raise exception 'valor precisa ser maior que zero'; end if;
  select pl.status into v_pl_status from core.planos pl where pl.id = p_plano and pl.user_id = auth.uid();
  if not found then raise exception 'plano não encontrado'; end if;
  if v_pl_status in ('abandonado', 'concluido') then raise exception 'plano %: não recebe meta nova', v_pl_status; end if;
  -- mesma meta (título) no mesmo plano: não duplica
  select to_jsonb(pm) || jsonb_build_object('ja_existia', true) into v_res
    from core.plano_metas pm join core.planos pl on pl.id = pm.plano_id
   where pm.plano_id = p_plano and pl.user_id = auth.uid() and lower(pm.titulo) = lower(btrim(p_titulo)) and pm.status <> 'cancelada';
  if v_res is not null then return v_res; end if;
  v_res := core.meta_salvar(jsonb_strip_nulls(jsonb_build_object('plano_id', p_plano, 'titulo', p_titulo, 'horizonte', p_horizonte,
             'dono', coalesce(p_dono, 'iara'), 'prazo', p_prazo, 'cadencia', nullif(btrim(p_cadencia), ''),
             'medida', case when p_alvo is not null then jsonb_build_object('tipo', 'valor', 'unidade', 'BRL', 'alvo', p_alvo) end)));
  insert into core.plano_eventos (plano_id, meta_id, tipo, origem, dados)
  values (p_plano, (v_res ->> 'id')::bigint, 'ajuste', 'leo', jsonb_build_object('acao', 'meta_adicionada', 'titulo', v_res ->> 'titulo'));
  -- plano já ativo: meta do AIrton com valor ganha a meta financeira agora (no rascunho, o confirmar cria)
  if v_pl_status = 'ativo' then
    v_res := v_res || jsonb_build_object('goals_criadas', core.plano_confirmar(auth.uid(), p_plano) -> 'goals_criadas');
  end if;
  return v_res;
end $$;

-- 5) Expediente e lugares por partes (as RPCs da tela regravam tudo; por voz muda só o que foi dito).
create or replace function public.hub_expediente_definir(
  p_inicio text default null, p_fim text default null, p_dias int[] default null, p_local text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_atual jsonb; v_novo jsonb;
begin
  if not exists (select 1 from core.members x where x.user_id = auth.uid()) then raise exception 'sem acesso'; end if;
  if p_inicio is not null and p_inicio !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'hora inválida: %', p_inicio; end if;
  if p_fim is not null and p_fim !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'hora inválida: %', p_fim; end if;
  -- mesma numeração da tela e do core.fixos: isodow, 1 = segunda ... 7 = domingo
  if p_dias is not null and (cardinality(p_dias) = 0 or exists (select 1 from unnest(p_dias) d where d not between 1 and 7)) then
    raise exception 'dias inválidos (1 = segunda a 7 = domingo)';
  end if;
  select pf.config -> 'expediente' into v_atual from core.perfil pf where pf.user_id = auth.uid();
  v_novo := coalesce(v_atual, jsonb_build_object('dias', '[1,2,3,4,5]'::jsonb, 'inicio', '09:00', 'fim', '18:00', 'titulo', 'Trabalho'))
            || jsonb_strip_nulls(jsonb_build_object('inicio', p_inicio, 'fim', p_fim, 'dias', to_jsonb(p_dias), 'local', nullif(btrim(p_local), '')));
  if (v_novo ->> 'inicio') >= (v_novo ->> 'fim') then raise exception 'a entrada precisa ser antes da saída'; end if;
  select coalesce(jsonb_agg(distinct d order by d), '[]'::jsonb) into v_atual from jsonb_array_elements(v_novo -> 'dias') d;
  v_novo := v_novo || jsonb_build_object('dias', v_atual);
  if public.hub_expediente_salvar(v_novo) is not true then raise exception 'perfil não encontrado'; end if;
  return v_novo;
end $$;

create or replace function public.hub_lugar_salvar(p_nome text, p_endereco text default null, p_min_casa int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_lista jsonb; v_nome text := left(btrim(coalesce(p_nome, '')), 40);
begin
  if not exists (select 1 from core.members x where x.user_id = auth.uid()) then raise exception 'sem acesso'; end if;
  if v_nome = '' then raise exception 'nome obrigatório'; end if;
  if p_min_casa is not null and p_min_casa not between 0 and 999 then raise exception 'minutos inválidos'; end if;
  select coalesce(pf.config -> 'lugares', '[]'::jsonb) into v_lista from core.perfil pf where pf.user_id = auth.uid();
  v_lista := coalesce((select jsonb_agg(case when lower(l ->> 'nome') = lower(v_nome)
                 then l || jsonb_strip_nulls(jsonb_build_object('endereco', nullif(btrim(p_endereco), ''), 'min_casa', p_min_casa)) else l end)
               from jsonb_array_elements(coalesce(v_lista, '[]'::jsonb)) l), '[]'::jsonb);
  if not exists (select 1 from jsonb_array_elements(v_lista) l where lower(l ->> 'nome') = lower(v_nome)) then
    -- hub_lugares_salvar guarda no máximo 12: recusa em vez de perder o novo em silêncio
    if jsonb_array_length(v_lista) >= 12 then raise exception 'já tem 12 lugares: tire um antes'; end if;
    v_lista := v_lista || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('nome', v_nome, 'endereco', nullif(btrim(p_endereco), ''), 'min_casa', p_min_casa)));
  end if;
  if public.hub_lugares_salvar(v_lista) is not true then raise exception 'perfil não encontrado'; end if;
  return v_lista;
end $$;

-- Tirar um lugar da lista (o ✕ da tela). Regrava a lista sem ele; nome que não existe = false.
create or replace function public.hub_lugar_remover(p_nome text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_lista jsonb; v_nova jsonb;
begin
  if not exists (select 1 from core.members x where x.user_id = auth.uid()) then raise exception 'sem acesso'; end if;
  select coalesce(pf.config -> 'lugares', '[]'::jsonb) into v_lista from core.perfil pf where pf.user_id = auth.uid();
  v_nova := coalesce((select jsonb_agg(l) from jsonb_array_elements(coalesce(v_lista, '[]'::jsonb)) l
                       where lower(l ->> 'nome') <> lower(btrim(coalesce(p_nome, '')))), '[]'::jsonb);
  if jsonb_array_length(v_nova) = jsonb_array_length(coalesce(v_lista, '[]'::jsonb)) then return false; end if;
  return public.hub_lugares_salvar(v_nova);
end $$;

revoke all on function public.hub_lugar_remover(text) from public, anon;
grant execute on function public.hub_lugar_remover(text) to authenticated;

revoke all on function public.hub_plano_editar(bigint, text, text, numeric, date, text, text), public.hub_plano_descartar(bigint),
  public.hub_meta_editar(bigint, text, date, text, text, text, numeric, text), public.hub_meta_adicionar(bigint, text, text, text, date, numeric, text),
  public.hub_expediente_definir(text, text, int[], text), public.hub_lugar_salvar(text, text, int) from public, anon;
grant execute on function public.hub_plano_editar(bigint, text, text, numeric, date, text, text), public.hub_plano_descartar(bigint),
  public.hub_meta_editar(bigint, text, date, text, text, text, numeric, text), public.hub_meta_adicionar(bigint, text, text, text, date, numeric, text),
  public.hub_expediente_definir(text, text, int[], text), public.hub_lugar_salvar(text, text, int) to authenticated;

-- 6) Catálogo. Ações de Edge Function usam o prefixo fn: (o iara-comando chama a função com o JWT do usuário).
insert into core.intencoes (slug, agent, exemplos, rpc, slots, risco, confirmacao, desfazer_rpc) values
 ('plano.editar', 'iara',
  array['renomeia o plano do carro para Troca do carro 2027', 'pausa o plano do violão', 'retoma o plano do violão', 'arquiva esse plano', 'muda o alvo do plano do apartamento para 900 mil'],
  'public.hub_plano_editar',
  '{"p_id":"bigint","p_titulo":"text?","p_status":"text(ativo|pausado|concluido|abandonado)?","p_alvo_valor":"numeric?","p_alvo_data":"date?","p_porque":"text?","p_tipo":"text(imovel|carro|carreira|habilidade|habito|outro)?"}',
  'alto', 'sim', null),
 ('plano.descartar', 'iara',
  array['descarta esse rascunho', 'joga fora o rascunho do plano'],
  'public.hub_plano_descartar', '{"p_id":"bigint"}', 'alto', 'sim', null),
 ('meta.editar', 'iara',
  array['muda o prazo dessa meta para 2028', 'arquiva essa meta', 'passa essa meta para médio prazo', 'essa meta é da SabIA', 'muda o valor da entrada para 180 mil', 'pausa essa meta', 'no rascunho, tira a meta de curto prazo'],
  'public.hub_meta_editar',
  '{"p_id":"bigint","p_titulo":"text?","p_prazo":"date?","p_horizonte":"text(curto|medio|longo)?","p_dono":"text(iara|claudia|airton|sabia)?","p_status":"text(ativa|pausada|concluida|cancelada)?","p_alvo":"numeric?","p_cadencia":"text?"}',
  'alto', 'sim', null),
 ('meta.adicionar', 'iara',
  array['adiciona uma meta de juntar 10 mil até março', 'põe no plano do carro uma meta de vender o carro antigo', 'adiciona a meta de juntar a entrada do apartamento'],
  'public.hub_meta_adicionar',
  '{"p_plano":"bigint","p_titulo":"text","p_horizonte":"text(curto|medio|longo)","p_dono":"text(iara|claudia|airton|sabia)?","p_prazo":"date?","p_alvo":"numeric?","p_cadencia":"text?"}',
  'alto', 'sim', null),
 ('decisao.painel', 'iara',
  array['pede a opinião dos agentes sobre essa decisão', 'abre o painel dessa decisão'],
  'fn:iara-plano/painel', '{"decisao_id":"bigint"}', 'baixo', 'nenhuma', null),
 ('semana.gerar', 'iara',
  array['refaz o plano da semana', 'monta o plano da próxima semana', 'gera de novo a semana'],
  'fn:iara-semana/gerar', '{"semana":"text(atual|proxima)?"}', 'baixo', 'nenhuma', null),
 ('agenda.sincronizar', 'iara',
  array['sincroniza minha agenda', 'puxa os eventos do calendário'],
  'fn:iara-agenda/sync', '{}', 'baixo', 'nenhuma', null),
 ('expediente.definir', 'iara',
  array['meu expediente é das 9 às 18', 'trabalho de segunda a quinta', 'meu trabalho agora é no escritório da Paulista'],
  'public.hub_expediente_definir', '{"p_inicio":"text(HH:MM)?","p_fim":"text(HH:MM)?","p_dias":"int[]?","p_local":"text?"}', 'medio', 'repetir', null),
 ('lugar.salvar', 'iara',
  array['a academia fica a 15 minutos de casa', 'salva o escritório na Avenida Paulista, 1000'],
  'public.hub_lugar_salvar', '{"p_nome":"text","p_endereco":"text?","p_min_casa":"int?"}', 'medio', 'repetir', null),
 ('lugar.remover', 'iara',
  array['tira a academia dos meus lugares', 'apaga o lugar escritório antigo'],
  'public.hub_lugar_remover', '{"p_nome":"text"}', 'medio', 'repetir', null)
on conflict (slug) do update set
  agent = excluded.agent, exemplos = excluded.exemplos, rpc = excluded.rpc, slots = excluded.slots,
  risco = excluded.risco, confirmacao = excluded.confirmacao, desfazer_rpc = excluded.desfazer_rpc, ativo = true;

-- meta.salvar_plano (jsonb inteiro) sai do roteador: meta.editar e meta.adicionar cobrem tudo com parâmetros nomeados
-- e evitam duas intenções para a mesma frase. A RPC hub_meta_salvar continua (a tela do Novo plano usa).
update core.intencoes set ativo = false where slug = 'meta.salvar_plano' and ativo;
-- plano.salvar (upsert por título com status) disputava "pausa o plano X" com plano.editar e ativava rascunho sem criar a meta do
-- AIrton. Criar é plano.criar (iara-plano); editar é plano.editar. A RPC hub_plano_salvar continua para quem já a chama.
update core.intencoes set ativo = false where slug = 'plano.salvar' and ativo;

-- 7) Candidatos do roteador (core.comando_contexto, versão do ar conferida = repo em 23/11): planos pausados também (para "retoma"),
--    metas, decisões e propostas abertas. Só ids; o texto é cortado. Mesma assinatura e grants.
create or replace function core.comando_contexto(p_user uuid, p_hoje date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'itens', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'origem', i.origem, 'titulo', left(i.titulo, 60)) order by i.data, i.id)
      from (select * from core.itens where user_id = p_user and status = 'pendente' and data between p_hoje - 1 and p_hoje + 1
            order by data, id limit 8) i), '[]'::jsonb),
    'trilha', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'titulo', left(x.titulo, 60)) order by x.ordem)
      from (select i.id, i.titulo, i.ordem from sabia.itens i join sabia.trilhas t on t.id = i.trilha_id
            where i.user_id = p_user and t.data = p_hoje and i.status = 'pendente' order by i.ordem limit 6) x), '[]'::jsonb),
    'semana', (select jsonb_build_object('id', s.id, 'status', s.status) from core.planos_semana s
               where s.user_id = p_user order by s.semana desc limit 1),
    'planos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'titulo', left(p.titulo, 50), 'status', p.status))
      from (select * from core.planos where user_id = p_user and status in ('rascunho', 'ativo', 'pausado') order by (status = 'pausado'), created_at desc limit 6) p), '[]'::jsonb),
    -- UX-24: metas, decisões e propostas abertas como candidatos (Atalho e telas sem as marcas do UX-23)
    'metas', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'titulo', left(m.titulo, 50), 'plano', left(m.plano, 30), 'horizonte', m.horizonte, 'status', m.status))
      from (select pm.id, pm.titulo, pl.titulo as plano, pm.horizonte, pm.status from core.plano_metas pm join core.planos pl on pl.id = pm.plano_id
            where pl.user_id = p_user and pl.status in ('rascunho', 'ativo', 'pausado') and pm.status in ('ativa', 'pausada')
            order by (pl.status = 'pausado'), pl.created_at desc, pm.id limit 12) m), '[]'::jsonb),
    'decisoes', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'pergunta', left(d.pergunta, 60), 'opcoes', d.opcoes))
      from (select * from core.decisoes where user_id = p_user and status in ('aberta', 'painel') order by created_at desc limit 3) d), '[]'::jsonb),
    'propostas', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'campo', x.campo, 'motivo', left(x.motivo, 60)))
      from (select * from core.plano_propostas where user_id = p_user and status = 'aberta' order by created_at desc limit 3) x), '[]'::jsonb),
    'compromissos', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'titulo', left(c.titulo, 50), 'data', c.data))
      from (select * from core.compromissos where user_id = p_user and not cancelado and data >= p_hoje order by data, inicio limit 6) c), '[]'::jsonb),
    'lancamentos', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'descricao', left(coalesce(t.merchant, t.description), 40), 'valor', t.amount))
      from (select * from airton.transactions where user_id = p_user and not reviewed and kind <> 'transfer'
            order by date desc limit 6) t), '[]'::jsonb),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.name))
      from (select * from airton.categories where user_id = p_user and not archived order by name limit 30) c), '[]'::jsonb)
  )
$$;
revoke all on function core.comando_contexto(uuid, date) from public, anon, authenticated;
grant execute on function core.comando_contexto(uuid, date) to service_role;
