-- Pedido do Leo (23/11): livro terminado some da tela de Livros. hub_livros passa a devolver também
-- "biblioteca" (todos os lidos, de qualquer ano) para a seção Minha biblioteca, com capa, como no Apple Books.
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
                 and extract(year from coalesce(l.terminou_em, l.updated_at::date)) = extract(year from v_hoje)) x), '[]'::jsonb),
    -- Minha biblioteca (pedido do Leo, 23/11): todos os livros terminados, de qualquer ano, mais recentes primeiro.
    'biblioteca', coalesce((select jsonb_agg(to_jsonb(x) order by x.terminou_em desc nulls last, x.id desc) from (
              select l.id, l.titulo, l.autor, l.paginas, l.nota, l.terminou_em, l.formato, l.capa_url, l.status from sabia.livros l
               where l.user_id = v_u and l.status = 'lido' and l.arquivado_em is null) x), '[]'::jsonb)
  ) || sabia.livros_meta(v_u, v_hoje);
end $$;
revoke all on function public.hub_livros() from public, anon;
grant execute on function public.hub_livros() to authenticated;
