-- Hub · bloco da IARA House na tela Hoje. O schema core não é exposto na Data API, então o app lê por esta
-- função (só leitura, security definer, só para membros de core.members), como public.claudia_is_member().
create or replace function public.hub_resumo_iara() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (
    select m.user_id from core.members m where m.user_id = auth.uid()
  ),
  hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
  select case when not exists (select 1 from me) then null else jsonb_build_object(
    'briefing', (
      select jsonb_build_object('tipo', b.tipo, 'data', b.data, 'texto', left(b.texto, 400), 'lido', b.lido_em is not null)
        from core.briefings b, me
       where b.user_id = me.user_id
       order by b.created_at desc
       limit 1
    ),
    'itens_pendentes', (
      select count(*) from core.itens i, me, hoje
       where i.user_id = me.user_id and i.status = 'pendente'
         and (i.data = hoje.d or (i.janela = 'semana' and i.data between hoje.d - 6 and hoje.d))
    ),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object('origem', x.origem, 'titulo', x.titulo, 'minutos', x.minutos, 'acao', x.acao) order by x.id)
        from (
          select i.* from core.itens i, me, hoje
           where i.user_id = me.user_id and i.status = 'pendente' and i.data = hoje.d
           order by i.id limit 5
        ) x
    ), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.hub_resumo_iara() from public, anon;
grant execute on function public.hub_resumo_iara() to authenticated;
