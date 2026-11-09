-- Hub superapp (pedido do Leo, 09/11):
-- 1) SabIA dentro do hub (/aprender): leitura da trilha do dia e ação por item, via funções security definer
--    (sabia não é exposto na Data API), só para membros de core.members e só sobre o próprio usuário.
-- 2) Briefing único do dia: a IARA passa a escrever só o briefing da manhã, cobrindo o dia todo; o job da noite sai.

create or replace function public.hub_sabia() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select m.user_id from core.members m where m.user_id = auth.uid()),
  hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  t as (
    select t.* from sabia.trilhas t, me, hoje
     where t.user_id = me.user_id and t.data <= hoje.d
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

-- Marca um item da trilha (pendente | feito | pulado) e, opcionalmente, a reação (-1, 0, 1), que alimenta
-- sabia.ajustar_pesos. Atualiza o status da trilha (em_andamento / concluida).
create or replace function public.hub_sabia_item(p_id bigint, p_status text, p_reacao int default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_trilha bigint;
begin
  if p_status not in ('pendente', 'feito', 'pulado') then raise exception 'status inválido: %', p_status; end if;
  if p_reacao is not null and p_reacao not in (-1, 0, 1) then raise exception 'reação inválida: %', p_reacao; end if;
  update sabia.itens i
     set status = p_status,
         reacao = coalesce(p_reacao, i.reacao),
         feito_em = case when p_status = 'feito' then coalesce(i.feito_em, now()) else null end
   where i.id = p_id
     and i.user_id = auth.uid()
     and exists (select 1 from core.members m where m.user_id = auth.uid())
  returning i.trilha_id into v_trilha;
  if v_trilha is null then return false; end if;
  update sabia.trilhas t
     set status = case
       when not exists (select 1 from sabia.itens x where x.trilha_id = t.id and x.status = 'pendente') then 'concluida'
       when exists (select 1 from sabia.itens x where x.trilha_id = t.id and x.status <> 'pendente') then 'em_andamento'
       else 'gerada' end
   where t.id = v_trilha;
  return true;
end $$;

revoke all on function public.hub_sabia() from public, anon;
revoke all on function public.hub_sabia_item(bigint, text, int) from public, anon;
grant execute on function public.hub_sabia() to authenticated;
grant execute on function public.hub_sabia_item(bigint, text, int) to authenticated;

-- Briefing único: tira o job da noite (o da manhã, 07:00 SP, continua e passa a cobrir o dia todo).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'iara-noite') then
    perform cron.unschedule('iara-noite');
  end if;
end $$;
