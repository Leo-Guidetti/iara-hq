-- UX-02: livros e registro de leitura. Meta do ano em core.perfil.config.livros_ano (sem coluna nova).
-- Fórmula de paginas_dia: páginas restantes / dias que faltam no ano (contando hoje), onde
--   restantes = (páginas que faltam no livro atual, ou a média se ele não tem total)
--             + (livros que faltam para a meta, menos o atual) x média de páginas
--   média = média de páginas dos livros lidos no ano; senão dos livros da fila; senão 300.
-- Sem meta = null. Meta batida = 0.

create or replace function sabia.livros_meta(p_user uuid, p_hoje date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_meta int; v_lidos int; v_media numeric; v_atual record; v_faltam int; v_rest numeric; v_dias int; v_pd int;
begin
  select nullif(p.config ->> 'livros_ano', '')::int into v_meta from core.perfil p where p.user_id = p_user;
  select count(*) into v_lidos from sabia.livros l
   where l.user_id = p_user and l.status = 'lido' and extract(year from coalesce(l.terminou_em, l.updated_at::date)) = extract(year from p_hoje);
  select coalesce(
    (select avg(l.paginas) from sabia.livros l where l.user_id = p_user and l.status = 'lido' and l.paginas > 0
        and extract(year from coalesce(l.terminou_em, l.updated_at::date)) = extract(year from p_hoje)),
    (select avg(l.paginas) from sabia.livros l where l.user_id = p_user and l.status in ('quero_ler', 'lendo') and l.paginas > 0),
    300) into v_media;
  if v_meta is not null and v_meta > 0 then
    select l.paginas, l.pagina_atual into v_atual from sabia.livros l
     where l.user_id = p_user and l.status = 'lendo' order by l.updated_at desc limit 1;
    v_faltam := greatest(v_meta - v_lidos, 0);
    if v_faltam = 0 then v_pd := 0;
    else
      v_rest := case when found then
                  case when v_atual.paginas is not null then greatest(v_atual.paginas - coalesce(v_atual.pagina_atual, 0), 0) else v_media end
                  + greatest(v_faltam - 1, 0) * v_media
                else v_faltam * v_media end;
      v_dias := greatest((make_date(extract(year from p_hoje)::int, 12, 31) - p_hoje) + 1, 1);
      v_pd := ceil(v_rest / v_dias)::int;
    end if;
  end if;
  return jsonb_build_object('meta_ano', v_meta, 'lidos_ano', v_lidos, 'paginas_dia', v_pd);
end $$;
revoke all on function sabia.livros_meta(uuid, date) from public, anon, authenticated;

create or replace function public.hub_livros() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_u uuid := auth.uid(); v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then return null; end if;
  return jsonb_build_object(
    'atual', (select to_jsonb(x) from (select l.id, l.titulo, l.autor, l.paginas, l.pagina_atual, l.status, l.comecou_em,
                (select max(r.data) from sabia.leituras r where r.livro_id = l.id) as ultima_leitura
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
  v_id bigint; l sabia.livros; v_meta jsonb; v_pd int; v_fala text;
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
  insert into sabia.leituras (livro_id, user_id, data, pagina_final, minutos) values (v_id, v_u, v_hoje, p_pagina, p_minutos);
  select * into l from sabia.livros x where x.id = v_id;
  v_meta := sabia.livros_meta(v_u, v_hoje);
  v_pd := (v_meta ->> 'paginas_dia')::int;
  v_fala := case
    when l.status = 'lido' then 'Anotei: terminou "' || l.titulo || '". Parabéns!'
    else 'Anotei: página ' || l.pagina_atual || '.' end
    || case when l.status <> 'lido' and v_pd > 0 then ' Faltam ' || v_pd || ' por dia para fechar a meta.'
            when v_pd = 0 then ' Meta do ano batida.' else '' end;
  return jsonb_build_object('livro', jsonb_build_object('id', l.id, 'titulo', l.titulo, 'autor', l.autor, 'paginas', l.paginas,
           'pagina_atual', l.pagina_atual, 'status', l.status), 'meta', v_meta, 'fala', v_fala);
end $$;

-- Payload: {id?, titulo, autor?, paginas?, status?, meta_ano?}. A meta do ano vai no mesmo payload
-- (meta_ano sozinha, sem titulo, só grava a meta). Sem id, titulo repetido atualiza o livro existente.
create or replace function public.hub_livro_salvar(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_u uuid := auth.uid(); v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_id bigint := nullif(p ->> 'id', '')::bigint; v_tit text := nullif(btrim(p ->> 'titulo'), '');
  v_st text := nullif(p ->> 'status', ''); v_pag int := nullif(p ->> 'paginas', '')::int; v_meta int;
  l sabia.livros;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  if v_st is not null and v_st not in ('quero_ler', 'lendo', 'pausado', 'lido', 'abandonado') then raise exception 'status inválido: %', v_st; end if;
  if v_pag is not null and v_pag <= 0 then raise exception 'páginas inválidas'; end if;
  if p ? 'meta_ano' then
    v_meta := nullif(p ->> 'meta_ano', '')::int;
    if v_meta is not null and v_meta < 0 then raise exception 'meta inválida'; end if;
    insert into core.perfil (user_id, config) values (v_u, jsonb_build_object('livros_ano', v_meta))
    on conflict (user_id) do update set config = core.perfil.config || jsonb_build_object('livros_ano', v_meta), updated_at = now();
  end if;
  if v_id is null and v_tit is null then
    if p ? 'meta_ano' then return jsonb_build_object('livro', null, 'meta', sabia.livros_meta(v_u, v_hoje)); end if;
    raise exception 'título obrigatório';
  end if;
  if v_id is not null then
    update sabia.livros x set titulo = coalesce(v_tit, x.titulo), autor = case when p ? 'autor' then p ->> 'autor' else x.autor end,
           paginas = coalesce(v_pag, x.paginas), status = coalesce(v_st, x.status),
           comecou_em = case when coalesce(v_st, x.status) = 'lendo' then coalesce(x.comecou_em, v_hoje) else x.comecou_em end,
           terminou_em = case when v_st = 'lido' then coalesce(x.terminou_em, v_hoje) else x.terminou_em end
     where x.id = v_id and x.user_id = v_u returning * into l;
    if l.id is null then raise exception 'Livro não encontrado.'; end if;
  else
    insert into sabia.livros as x (user_id, titulo, autor, paginas, status, comecou_em, terminou_em)
    values (v_u, v_tit, p ->> 'autor', v_pag, coalesce(v_st, 'quero_ler'),
            case when v_st = 'lendo' then v_hoje end, case when v_st = 'lido' then v_hoje end)
    on conflict (user_id, titulo) do update set autor = coalesce(excluded.autor, x.autor), paginas = coalesce(excluded.paginas, x.paginas),
           status = coalesce(v_st, x.status),
           comecou_em = case when coalesce(v_st, x.status) = 'lendo' then coalesce(x.comecou_em, v_hoje) else x.comecou_em end,
           terminou_em = case when v_st = 'lido' then coalesce(x.terminou_em, v_hoje) else x.terminou_em end
    returning * into l;
  end if;
  return jsonb_build_object('livro', jsonb_build_object('id', l.id, 'titulo', l.titulo, 'autor', l.autor, 'paginas', l.paginas,
           'pagina_atual', l.pagina_atual, 'status', l.status), 'meta', sabia.livros_meta(v_u, v_hoje));
end $$;

revoke all on function public.hub_livros() from public, anon;
revoke all on function public.hub_leitura_registrar(int, bigint, int) from public, anon;
revoke all on function public.hub_livro_salvar(jsonb) from public, anon;
grant execute on function public.hub_livros() to authenticated;
grant execute on function public.hub_leitura_registrar(int, bigint, int) to authenticated;
grant execute on function public.hub_livro_salvar(jsonb) to authenticated;

-- Briefing da SabIA: mantém tudo e soma meta e páginas/dia.
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
           'ultima_leitura', (select max(r.data) from sabia.leituras r where r.livro_id = l.id))
  into v_livro from sabia.livros l where l.user_id = p_user and l.status = 'lendo' order by l.updated_at desc limit 1;

  while exists (select 1 from sabia.trilhas where user_id = p_user and data = d and status = 'concluida' and tipo <> 'hobby') loop
    v_seq := v_seq + 1; d := d - 1;
  end loop;
  return jsonb_build_object('trilha', v_trilha, 'livro_atual', v_livro, 'sequencia_dias', v_seq) || sabia.livros_meta(p_user, p_data);
end $$;

insert into core.intencoes (slug, agent, exemplos, rpc, slots, risco, confirmacao, desfazer_rpc) values
 ('leitura.registrar', 'sabia',
  array['li até a página 150', 'parei na 80 do livro X', 'anota que cheguei na página 200'],
  'public.hub_leitura_registrar',
  '{"p_pagina":"int","p_livro":"bigint?","p_minutos":"int?"}',
  'baixo', 'nenhuma', null),
 ('livro.salvar', 'sabia',
  array['adiciona o livro Sapiens na fila', 'minha meta é 12 livros este ano', 'comecei a ler Dom Casmurro'],
  'public.hub_livro_salvar',
  '{"p":"jsonb{id?:bigint,titulo:text,autor?:text,paginas?:int,status?:text(quero_ler|lendo|pausado|lido|abandonado),meta_ano?:int}"}',
  'medio', 'repetir', null)
on conflict (slug) do update set
  agent = excluded.agent, exemplos = excluded.exemplos, rpc = excluded.rpc, slots = excluded.slots,
  risco = excluded.risco, confirmacao = excluded.confirmacao, desfazer_rpc = excluded.desfazer_rpc;
