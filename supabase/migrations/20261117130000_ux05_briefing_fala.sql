-- UX-05 · versão falável do briefing: coluna `fala` (até 70 palavras, sem markdown), exposta no /hoje,
-- e RPC para marcar o briefing como lido (o app marca ao terminar/parar o "Ouvir").
alter table core.briefings add column if not exists fala text;

-- Igual à 20261109200000, mais id/fala no briefing (id já existia; fala é nova).
create or replace function public.hub_casa() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select m.user_id from core.members m where m.user_id = auth.uid()),
  hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
  select case when not exists (select 1 from me) then null else jsonb_build_object(
    'briefings', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'tipo', b.tipo, 'data', b.data, 'texto', b.texto, 'fala', b.fala, 'lido', b.lido_em is not null)
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

-- Marca o briefing do próprio usuário como lido. Idempotente: não regrava lido_em se já estiver preenchido.
create or replace function public.hub_briefing_lido(p_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  update core.briefings b
     set lido_em = coalesce(b.lido_em, now())
   where b.id = p_id
     and b.user_id = auth.uid()
     and exists (select 1 from core.members m where m.user_id = auth.uid())
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

revoke all on function public.hub_casa() from public, anon;
revoke all on function public.hub_briefing_lido(bigint) from public, anon;
grant execute on function public.hub_casa() to authenticated;
grant execute on function public.hub_briefing_lido(bigint) to authenticated;
