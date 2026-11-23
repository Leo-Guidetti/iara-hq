-- Começo oficial (pedido do Leo, 23/11): IARA e SabIA começam do zero em 23/11/2026. O que veio antes é
-- catalogado e arquivado, não apagado: cópia no schema `arquivo` (com o catálogo em arquivo.catalogo) e, nas
-- tabelas vivas, uma marca `arquivado_em` ou o filtro pela data de início. ClaudIA e AIrton seguem como estão.
-- Para desfazer: tirar a marca (update ... set arquivado_em = null) e o `inicio_oficial` do perfil.

-- 1) Data de início no perfil e a função que as telas usam.
update core.perfil set config = config || jsonb_build_object('inicio_oficial', '2026-11-23'), updated_at = now();

create or replace function core.inicio_oficial(p_user uuid) returns date
language sql stable security definer set search_path = '' as $$
  select coalesce((select nullif(p.config ->> 'inicio_oficial', '')::date from core.perfil p where p.user_id = p_user), '-infinity'::date)
$$;
revoke all on function core.inicio_oficial(uuid) from public, anon, authenticated;

-- 2) Arquivo: cópia de tudo da IARA e da SabIA criado antes de 23/11 (horário de São Paulo).
create schema if not exists arquivo;
revoke all on schema arquivo from public, anon, authenticated;

create table if not exists arquivo.core_planos_semana as
  select ps.*, now() as arquivado_em from core.planos_semana ps where ps.created_at < timestamptz '2026-11-23 00:00 America/Sao_Paulo';
create table if not exists arquivo.core_planos_semana_itens as
  select i.*, now() as arquivado_em from core.planos_semana_itens i where i.plano_id in (select id from arquivo.core_planos_semana);
create table if not exists arquivo.core_itens as
  select i.*, now() as arquivado_em from core.itens i
   where i.origem in ('iara', 'sabia') and i.created_at < timestamptz '2026-11-23 00:00 America/Sao_Paulo';
create table if not exists arquivo.core_briefings as
  select b.*, now() as arquivado_em from core.briefings b where b.data < date '2026-11-23';
create table if not exists arquivo.core_avisos as
  select a.*, now() as arquivado_em from core.avisos a where a.criado_em < timestamptz '2026-11-23 00:00 America/Sao_Paulo';
create table if not exists arquivo.sabia_trilhas as
  select t.*, now() as arquivado_em from sabia.trilhas t where t.data < date '2026-11-23';
create table if not exists arquivo.sabia_itens as
  select i.*, now() as arquivado_em from sabia.itens i where i.trilha_id in (select id from arquivo.sabia_trilhas);
create table if not exists arquivo.sabia_livros as
  select l.*, now() as arquivado_em from sabia.livros l where l.created_at < timestamptz '2026-11-23 00:00 America/Sao_Paulo';
create table if not exists arquivo.sabia_leituras as
  select r.*, now() as arquivado_em from sabia.leituras r where r.livro_id in (select id from arquivo.sabia_livros);

do $$ declare t text; begin
  foreach t in array array['core_planos_semana','core_planos_semana_itens','core_itens','core_briefings','core_avisos',
                           'sabia_trilhas','sabia_itens','sabia_livros','sabia_leituras'] loop
    execute format('alter table arquivo.%I enable row level security', t);
    execute format('revoke all on arquivo.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- Catálogo: o que foi arquivado, de quando a quando.
create table if not exists arquivo.catalogo (
  tabela text primary key, origem text not null, linhas int not null, de date, ate date, arquivado_em timestamptz not null default now()
);
alter table arquivo.catalogo enable row level security;
revoke all on arquivo.catalogo from public, anon, authenticated;
insert into arquivo.catalogo (tabela, origem, linhas, de, ate) values
  ('core_planos_semana', 'core.planos_semana', (select count(*) from arquivo.core_planos_semana), (select min(semana) from arquivo.core_planos_semana), (select max(semana) from arquivo.core_planos_semana)),
  ('core_planos_semana_itens', 'core.planos_semana_itens', (select count(*) from arquivo.core_planos_semana_itens), (select min(data) from arquivo.core_planos_semana_itens), (select max(data) from arquivo.core_planos_semana_itens)),
  ('core_itens', 'core.itens (iara, sabia)', (select count(*) from arquivo.core_itens), (select min(data) from arquivo.core_itens), (select max(data) from arquivo.core_itens)),
  ('core_briefings', 'core.briefings', (select count(*) from arquivo.core_briefings), (select min(data) from arquivo.core_briefings), (select max(data) from arquivo.core_briefings)),
  ('core_avisos', 'core.avisos', (select count(*) from arquivo.core_avisos), (select min(criado_em)::date from arquivo.core_avisos), (select max(criado_em)::date from arquivo.core_avisos)),
  ('sabia_trilhas', 'sabia.trilhas', (select count(*) from arquivo.sabia_trilhas), (select min(data) from arquivo.sabia_trilhas), (select max(data) from arquivo.sabia_trilhas)),
  ('sabia_itens', 'sabia.itens', (select count(*) from arquivo.sabia_itens), null, null),
  ('sabia_livros', 'sabia.livros', (select count(*) from arquivo.sabia_livros), (select min(created_at)::date from arquivo.sabia_livros), (select max(created_at)::date from arquivo.sabia_livros)),
  ('sabia_leituras', 'sabia.leituras', (select count(*) from arquivo.sabia_leituras), (select min(data) from arquivo.sabia_leituras), (select max(data) from arquivo.sabia_leituras))
on conflict (tabela) do nothing;

-- 3) Nas tabelas vivas: marca de arquivado (some das telas, sem apagar).
alter table core.planos_semana add column if not exists arquivado_em timestamptz;
alter table sabia.livros add column if not exists arquivado_em timestamptz;
update core.planos_semana set arquivado_em = now()
 where arquivado_em is null and created_at < timestamptz '2026-11-23 00:00 America/Sao_Paulo' and status = 'rascunho';
update sabia.livros set arquivado_em = now()
 where arquivado_em is null and created_at < timestamptz '2026-11-23 00:00 America/Sao_Paulo';
-- Fila de leituras e tarefas antigas da IARA/SabIA: sai do dia como "ignorado", com a marca no retorno.
update core.itens set status = 'ignorado', retorno = coalesce(retorno, '{}'::jsonb) || jsonb_build_object('arquivado', '2026-11-23'), updated_at = now()
 where origem in ('iara', 'sabia') and status in ('pendente', 'adiado') and created_at < timestamptz '2026-11-23 00:00 America/Sao_Paulo';

-- 4) Funções de leitura com o filtro (corpos conferidos com a produção em 23/11).
create or replace function core.semana_plano_atual(p_user uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select ps.id from core.planos_semana ps
   where ps.user_id = p_user and (ps.arquivado_em is null or ps.created_at > ps.arquivado_em)
     and ps.semana in (date_trunc('week', (now() at time zone 'America/Sao_Paulo')::date)::date,
                       case when extract(dow from (now() at time zone 'America/Sao_Paulo')::date) = 0
                            then (now() at time zone 'America/Sao_Paulo')::date + 1 end)
   order by ps.semana desc limit 1
$$;

create or replace function public.hub_semana() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select m.user_id from core.members m where m.user_id = auth.uid()),
  hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  p as (
    select ps.* from core.planos_semana ps, me, hoje
     where ps.user_id = me.user_id and (ps.arquivado_em is null or ps.created_at > ps.arquivado_em)
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

create or replace function public.hub_sabia() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select m.user_id from core.members m where m.user_id = auth.uid()),
  hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  t as (
    select t.* from sabia.trilhas t, me, hoje
     where t.user_id = me.user_id and t.data <= hoje.d and t.tipo <> 'hobby'
       and t.data >= core.inicio_oficial(me.user_id)
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

create or replace function public.hub_casa() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select m.user_id from core.members m where m.user_id = auth.uid()),
  hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
  select case when not exists (select 1 from me) then null else jsonb_build_object(
    'briefings', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'tipo', b.tipo, 'data', b.data, 'texto', b.texto, 'fala', b.fala, 'lido', b.lido_em is not null)
                       order by b.created_at desc)
        from (select b.* from core.briefings b, me where b.user_id = me.user_id
                and b.data >= core.inicio_oficial(me.user_id) order by b.created_at desc limit 2) b
    ), '[]'::jsonb),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'origem', i.origem, 'tipo', i.tipo, 'titulo', i.titulo,
                                          'detalhe', i.detalhe, 'data', i.data, 'minutos', i.minutos, 'acao', i.acao,
                                          'status', i.status, 'prioridade', i.prioridade)
                       order by i.data, i.id)
        from core.itens i, me, hoje
       where i.user_id = me.user_id
         and (i.status = 'pendente' or (i.status = 'adiado' and coalesce(i.adiado_para, i.data) <= hoje.d))
         and i.data between hoje.d - 6 and hoje.d + 1
    ), '[]'::jsonb)
  ) end;
$$;

create or replace function sabia.livros_meta(p_user uuid, p_hoje date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_meta int; v_lidos int; v_media numeric; v_atual record; v_faltam int; v_rest numeric; v_dias int; v_pd int;
begin
  select nullif(p.config ->> 'livros_ano', '')::int into v_meta from core.perfil p where p.user_id = p_user;
  select count(*) into v_lidos from sabia.livros l
   where l.user_id = p_user and l.arquivado_em is null and l.status = 'lido' and extract(year from coalesce(l.terminou_em, l.updated_at::date)) = extract(year from p_hoje);
  select coalesce(
    (select avg(l.paginas) from sabia.livros l where l.user_id = p_user and l.arquivado_em is null and l.status = 'lido' and l.paginas > 0
        and extract(year from coalesce(l.terminou_em, l.updated_at::date)) = extract(year from p_hoje)),
    (select avg(l.paginas) from sabia.livros l where l.user_id = p_user and l.arquivado_em is null and l.status in ('quero_ler', 'lendo') and l.paginas > 0),
    300) into v_media;
  if v_meta is not null and v_meta > 0 then
    select l.paginas, l.pagina_atual into v_atual from sabia.livros l
     where l.user_id = p_user and l.arquivado_em is null and l.status = 'lendo' order by l.updated_at desc limit 1;
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

create or replace function public.hub_livros() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_u uuid := auth.uid(); v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then return null; end if;
  return jsonb_build_object(
    'atual', (select to_jsonb(x) from (select l.id, l.titulo, l.autor, l.paginas, l.pagina_atual, l.status, l.comecou_em,
                l.formato, l.capa_url,
                (select max(r.data) from sabia.leituras r where r.livro_id = l.id and not r.desfeita) as ultima_leitura
              from sabia.livros l where l.user_id = v_u and l.status = 'lendo' and l.arquivado_em is null order by l.updated_at desc limit 1) x),
    'fila', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (
              select l.id, l.titulo, l.autor, l.paginas, l.status, l.formato, l.capa_url, l.created_at from sabia.livros l
               where l.user_id = v_u and l.status in ('quero_ler', 'pausado') and l.arquivado_em is null) x), '[]'::jsonb),
    'lidos', coalesce((select jsonb_agg(to_jsonb(x) order by x.terminou_em desc nulls last) from (
              select l.id, l.titulo, l.autor, l.paginas, l.nota, l.terminou_em, l.formato, l.capa_url from sabia.livros l
               where l.user_id = v_u and l.status = 'lido' and l.arquivado_em is null
                 and extract(year from coalesce(l.terminou_em, l.updated_at::date)) = extract(year from v_hoje)) x), '[]'::jsonb)
  ) || sabia.livros_meta(v_u, v_hoje);
end $$;

create or replace function public.hub_livro_salvar(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_u uuid := auth.uid(); v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_id bigint := nullif(p ->> 'id', '')::bigint; v_tit text := nullif(btrim(p ->> 'titulo'), '');
  v_st text := nullif(p ->> 'status', ''); v_pag int := nullif(p ->> 'paginas', '')::int; v_meta int;
  v_fmt text := nullif(p ->> 'formato', ''); v_capa text := nullif(btrim(p ->> 'capa_url'), ''); v_gid text := nullif(btrim(p ->> 'google_id'), '');
  l sabia.livros;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  if v_st is not null and v_st not in ('quero_ler', 'lendo', 'pausado', 'lido', 'abandonado') then raise exception 'status inválido: %', v_st; end if;
  if v_fmt is not null and v_fmt not in ('fisico', 'kindle', 'audiobook') then raise exception 'formato inválido: %', v_fmt; end if;
  if v_capa is not null and v_capa !~ '^https://' then raise exception 'capa inválida'; end if;
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
           arquivado_em = null, formato = coalesce(v_fmt, x.formato), capa_url = coalesce(v_capa, x.capa_url), google_id = coalesce(v_gid, x.google_id),
           comecou_em = case when coalesce(v_st, x.status) = 'lendo' then coalesce(x.comecou_em, v_hoje) else x.comecou_em end,
           terminou_em = case when v_st = 'lido' then coalesce(x.terminou_em, v_hoje) else x.terminou_em end
     where x.id = v_id and x.user_id = v_u returning * into l;
    if l.id is null then raise exception 'Livro não encontrado.'; end if;
  else
    insert into sabia.livros as x (user_id, titulo, autor, paginas, status, formato, capa_url, google_id, comecou_em, terminou_em)
    values (v_u, v_tit, p ->> 'autor', v_pag, coalesce(v_st, 'quero_ler'), v_fmt, v_capa, v_gid,
            case when v_st = 'lendo' then v_hoje end, case when v_st = 'lido' then v_hoje end)
    on conflict (user_id, titulo) do update set autor = coalesce(excluded.autor, x.autor), paginas = coalesce(excluded.paginas, x.paginas),
           status = coalesce(v_st, x.status), arquivado_em = null,
           formato = coalesce(excluded.formato, x.formato), capa_url = coalesce(excluded.capa_url, x.capa_url),
           google_id = coalesce(excluded.google_id, x.google_id),
           comecou_em = case when coalesce(v_st, x.status) = 'lendo' then coalesce(x.comecou_em, v_hoje) else x.comecou_em end,
           terminou_em = case when v_st = 'lido' then coalesce(x.terminou_em, v_hoje) else x.terminou_em end
    returning * into l;
  end if;
  return jsonb_build_object('livro', jsonb_build_object('id', l.id, 'titulo', l.titulo, 'autor', l.autor, 'paginas', l.paginas,
           'pagina_atual', l.pagina_atual, 'status', l.status, 'formato', l.formato, 'capa_url', l.capa_url),
           'meta', sabia.livros_meta(v_u, v_hoje));
end $$;

revoke all on function sabia.livros_meta(uuid, date) from public, anon, authenticated;
revoke all on function public.hub_livros() from public, anon;
revoke all on function public.hub_livro_salvar(jsonb) from public, anon;
grant execute on function public.hub_livros() to authenticated;
grant execute on function public.hub_livro_salvar(jsonb) to authenticated;
