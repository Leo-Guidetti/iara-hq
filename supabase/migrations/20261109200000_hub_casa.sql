-- Hub · módulo IARA House (/casa) dentro do site único. core não é exposto na Data API: leitura e ações
-- passam por funções security definer, só para membros de core.members e só sobre os itens do próprio usuário.

-- Leitura da página /casa: os dois últimos briefings (texto inteiro) e a fila de itens pendentes/adiados.
create or replace function public.hub_casa() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select m.user_id from core.members m where m.user_id = auth.uid()),
  hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
  select case when not exists (select 1 from me) then null else jsonb_build_object(
    'briefings', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'tipo', b.tipo, 'data', b.data, 'texto', b.texto, 'lido', b.lido_em is not null)
                       order by b.created_at desc)
        from (select b.* from core.briefings b, me where b.user_id = me.user_id order by b.created_at desc limit 2) b
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

-- Ação num item da fila: feito, ignorado, adiado (para amanhã, se não vier data) ou pendente (desfazer).
create or replace function public.hub_item_status(p_id bigint, p_status text, p_adiar_para date default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_ok boolean;
begin
  if p_status not in ('pendente', 'feito', 'adiado', 'ignorado') then
    raise exception 'status inválido: %', p_status;
  end if;
  update core.itens i
     set status = p_status,
         adiado_para = case when p_status = 'adiado'
                            then coalesce(p_adiar_para, (now() at time zone 'America/Sao_Paulo')::date + 1)
                            else null end
   where i.id = p_id
     and i.user_id = auth.uid()
     and exists (select 1 from core.members m where m.user_id = auth.uid())
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

revoke all on function public.hub_casa() from public, anon;
revoke all on function public.hub_item_status(bigint, text, date) from public, anon;
grant execute on function public.hub_casa() to authenticated;
grant execute on function public.hub_item_status(bigint, text, date) to authenticated;
