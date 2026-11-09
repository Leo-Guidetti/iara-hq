-- Pedido do Leo (09/11): mostrar a ordem do dia de forma clara no briefing e o AIrton com dados de verdade.

-- 1) Rotina de hoje para a linha do tempo "Seu dia" no topo da Hoje (core não é exposto na Data API).
create or replace function public.hub_dia() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select m.user_id from core.members m where m.user_id = auth.uid()),
  agora as (select (now() at time zone 'America/Sao_Paulo') as t)
  select case when not exists (select 1 from me) then null else coalesce((
    select jsonb_agg(jsonb_build_object('hora', to_char(r.hora, 'HH24:MI'), 'minutos', r.minutos,
                                        'atividade', r.atividade, 'agent', r.agent) order by r.hora)
      from core.rotina r, me, agora
     where r.user_id = me.user_id and r.ativo and extract(dow from agora.t)::int = any(r.dias)
  ), '[]'::jsonb) end;
$$;
revoke all on function public.hub_dia() from public, anon;
grant execute on function public.hub_dia() to authenticated;

-- 2) Insumo do AIrton para o briefing: antes só lia planned_events/goals (vazios) e o "disponível" vinha nulo.
--    Agora usa o plano do mês do próprio AIrton (livre, por dia, contas dos próximos 7 dias) e o que falta revisar.
create or replace function core.briefing_airton(p_user uuid, p_data date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  mp jsonb;
  rc jsonb;
begin
  begin mp := airton.month_plan(p_user => p_user); exception when others then mp := null; end;
  begin rc := airton.review_counts(p_user); exception when others then rc := null; end;
  return jsonb_build_object(
    'livre_mes', mp -> 'available',
    'por_dia', mp -> 'perDay',
    'dias_restantes', mp -> 'daysLeft',
    'entradas_previstas', mp -> 'income' -> 'expected',
    'comprometido', mp -> 'committed' -> 'total',
    'proximos_7d', coalesce((
      select jsonb_agg(u order by u ->> 'date')
        from jsonb_array_elements(coalesce(mp -> 'upcoming', '[]'::jsonb)) u
       where (u ->> 'date')::date between p_data and p_data + 7
    ), '[]'::jsonb),
    'para_revisar', coalesce((rc ->> 'pending')::int, 0) + coalesce((rc ->> 'unconfirmed')::int, 0),
    'eventos_7d', coalesce((
      select jsonb_agg(jsonb_build_object('data', e.date, 'descricao', e.label, 'valor', e.amount) order by e.date)
        from airton.planned_events e where e.user_id = p_user and e.date between p_data and p_data + 7), '[]'::jsonb),
    'metas', coalesce((
      select jsonb_agg(jsonb_build_object('meta', g.name, 'alvo', g.target_amount, 'atual', g.current_amount, 'prazo', g.target_date))
        from airton.goals g where g.user_id = p_user), '[]'::jsonb));
end $$;

-- 3) Rotina alinhada às decisões de 09/11: sem fechamento da noite (briefing único), trilha de 40 min,
--    imersão de 60 min no sábado e o planejamento da semana no domingo à noite.
update core.rotina set ativo = false where atividade = 'Fechamento do dia' and ativo;
update core.rotina set minutos = 40 where atividade = 'Trilha SabIA do dia' and minutos < 40;
update core.rotina set atividade = 'Imersão do fim de semana (SabIA)', minutos = 60 where atividade = 'Deep dive da semana';
insert into core.rotina (user_id, dias, hora, minutos, atividade, agent, ativo)
select m.user_id, array[0], time '20:00', 30, 'Planejamento da semana (IARA)', 'iara', true
  from core.members m
 where not exists (select 1 from core.rotina r where r.user_id = m.user_id and r.atividade = 'Planejamento da semana (IARA)');
