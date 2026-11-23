-- Superapp 6 (23/11): Casa com as tarefas da semana e "Nova tarefa". Aditiva: duas funções novas.

-- Tarefas da casa (origem iara) até 7 dias à frente, mais as feitas hoje (para o checklist mostrar marcadas).
create or replace function public.hub_casa_tarefas() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select m.user_id from core.members m where m.user_id = auth.uid()),
  hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
  select case when not exists (select 1 from me) then null else coalesce((
    select jsonb_agg(jsonb_build_object('id', i.id, 'tipo', i.tipo, 'titulo', i.titulo, 'detalhe', i.detalhe,
                                        'data', coalesce(i.adiado_para, i.data), 'minutos', i.minutos, 'status', i.status)
                     order by i.status = 'feito', coalesce(i.adiado_para, i.data), i.id)
      from core.itens i, me, hoje
     where i.user_id = me.user_id and i.origem = 'iara' and i.tipo in ('tarefa', 'lembrete')
       and ((i.status in ('pendente', 'adiado') and coalesce(i.adiado_para, i.data) between hoje.d - 14 and hoje.d + 7)
         or (i.status = 'feito' and i.updated_at >= (hoje.d::timestamp at time zone 'America/Sao_Paulo')))
  ), '[]'::jsonb) end;
$$;

-- Nova tarefa da casa. Data padrão = hoje (São Paulo).
create or replace function public.hub_tarefa_criar(p_titulo text, p_data date default null, p_detalhe text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_u uuid := auth.uid(); v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_tit text := nullif(btrim(p_titulo), ''); v_id bigint;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  if v_tit is null or length(v_tit) > 200 then raise exception 'Escreva a tarefa em até 200 caracteres.'; end if;
  if p_data is not null and p_data < v_hoje then raise exception 'A data não pode ser no passado.'; end if;
  insert into core.itens (user_id, origem, tipo, titulo, detalhe, data, chave_origem)
  values (v_u, 'iara', 'tarefa', v_tit, nullif(btrim(p_detalhe), ''), coalesce(p_data, v_hoje), 'manual:' || pg_catalog.gen_random_uuid()::text)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'fala', 'Anotei: ' || v_tit || case when coalesce(p_data, v_hoje) = v_hoje then ', para hoje.' else ', para ' || to_char(p_data, 'DD/MM') || '.' end);
end $$;

revoke all on function public.hub_casa_tarefas() from public, anon;
revoke all on function public.hub_tarefa_criar(text, date, text) from public, anon;
grant execute on function public.hub_casa_tarefas() to authenticated;
grant execute on function public.hub_tarefa_criar(text, date, text) to authenticated;

-- Pela voz: "anota trocar o filtro de água no sábado".
insert into core.intencoes (slug, agent, exemplos, rpc, slots, risco, confirmacao, desfazer_rpc) values
 ('tarefa.criar', 'iara',
  array['anota trocar o filtro de água', 'lembra de pagar a conta de luz sexta', 'nova tarefa: comprar lâmpada'],
  'public.hub_tarefa_criar',
  '{"p_titulo":"text","p_data":"date?","p_detalhe":"text?"}',
  'baixo', 'repetir', null)
on conflict (slug) do update set
  agent = excluded.agent, exemplos = excluded.exemplos, rpc = excluded.rpc, slots = excluded.slots,
  risco = excluded.risco, confirmacao = excluded.confirmacao, desfazer_rpc = excluded.desfazer_rpc;
