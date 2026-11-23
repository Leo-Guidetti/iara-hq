-- Superapp 5 (23/11): livros com capa e formato. Busca pelo Google Books no navegador (sem chave);
-- aqui só guardamos o que veio da busca. Aditiva: duas colunas novas e as funções com os campos a mais.
alter table sabia.livros add column if not exists capa_url text;
alter table sabia.livros add column if not exists google_id text;

create or replace function public.hub_livros() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_u uuid := auth.uid(); v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then return null; end if;
  return jsonb_build_object(
    'atual', (select to_jsonb(x) from (select l.id, l.titulo, l.autor, l.paginas, l.pagina_atual, l.status, l.comecou_em,
                l.formato, l.capa_url,
                (select max(r.data) from sabia.leituras r where r.livro_id = l.id and not r.desfeita) as ultima_leitura
              from sabia.livros l where l.user_id = v_u and l.status = 'lendo' order by l.updated_at desc limit 1) x),
    'fila', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (
              select l.id, l.titulo, l.autor, l.paginas, l.status, l.formato, l.capa_url, l.created_at from sabia.livros l
               where l.user_id = v_u and l.status in ('quero_ler', 'pausado')) x), '[]'::jsonb),
    'lidos', coalesce((select jsonb_agg(to_jsonb(x) order by x.terminou_em desc nulls last) from (
              select l.id, l.titulo, l.autor, l.paginas, l.nota, l.terminou_em, l.formato, l.capa_url from sabia.livros l
               where l.user_id = v_u and l.status = 'lido'
                 and extract(year from coalesce(l.terminou_em, l.updated_at::date)) = extract(year from v_hoje)) x), '[]'::jsonb)
  ) || sabia.livros_meta(v_u, v_hoje);
end $$;

-- Payload: {id?, titulo, autor?, paginas?, status?, formato?, capa_url?, google_id?, meta_ano?}.
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
           formato = coalesce(v_fmt, x.formato), capa_url = coalesce(v_capa, x.capa_url), google_id = coalesce(v_gid, x.google_id),
           comecou_em = case when coalesce(v_st, x.status) = 'lendo' then coalesce(x.comecou_em, v_hoje) else x.comecou_em end,
           terminou_em = case when v_st = 'lido' then coalesce(x.terminou_em, v_hoje) else x.terminou_em end
     where x.id = v_id and x.user_id = v_u returning * into l;
    if l.id is null then raise exception 'Livro não encontrado.'; end if;
  else
    insert into sabia.livros as x (user_id, titulo, autor, paginas, status, formato, capa_url, google_id, comecou_em, terminou_em)
    values (v_u, v_tit, p ->> 'autor', v_pag, coalesce(v_st, 'quero_ler'), v_fmt, v_capa, v_gid,
            case when v_st = 'lendo' then v_hoje end, case when v_st = 'lido' then v_hoje end)
    on conflict (user_id, titulo) do update set autor = coalesce(excluded.autor, x.autor), paginas = coalesce(excluded.paginas, x.paginas),
           status = coalesce(v_st, x.status),
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

revoke all on function public.hub_livros() from public, anon;
revoke all on function public.hub_livro_salvar(jsonb) from public, anon;
grant execute on function public.hub_livros() to authenticated;
grant execute on function public.hub_livro_salvar(jsonb) to authenticated;

update core.intencoes
   set slots = '{"p":"jsonb{id?:bigint,titulo:text,autor?:text,paginas?:int,status?:text(quero_ler|lendo|pausado|lido|abandonado),formato?:text(fisico|kindle|audiobook),meta_ano?:int}"}',
       exemplos = array['adiciona o livro Sapiens na fila', 'minha meta é 12 livros este ano', 'comecei a ler Dom Casmurro no Kindle']
 where slug = 'livro.salvar';
