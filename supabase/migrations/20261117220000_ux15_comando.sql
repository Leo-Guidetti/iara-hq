-- UX-15: porta única "Peça à IARA". Aditivo e idempotente.
-- 1) core.conversas: turnos do Leo e da IARA (contexto = última meia hora). Leitura do dono; escrita só service role.
create table if not exists core.conversas (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  canal     text not null default 'hub' check (canal in ('hub', 'atalho', 'voz')),
  papel     text not null check (papel in ('leo', 'iara')),
  texto     text not null,
  intencao  text,
  slots     jsonb,
  pendente  jsonb,
  at        timestamptz not null default now()
);
create index if not exists conversas_user_at on core.conversas (user_id, at desc);
alter table core.conversas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'conversas' and policyname = 'conversas_dono') then
    create policy conversas_dono on core.conversas for select to authenticated using (user_id = auth.uid());
  end if;
end $$;
revoke all on core.conversas from public, anon, authenticated;
grant select on core.conversas to authenticated;
grant all on core.conversas to service_role;

-- 2) Peso por frase: mesma tabela que a ClaudIA usa (o gatilho set_local_date preenche local_date).
create or replace function public.hub_peso_registrar(p_kg numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_u uuid := auth.uid(); v_id bigint;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  if p_kg is null or p_kg < 30 or p_kg > 300 then raise exception 'peso fora do intervalo (30 a 300 kg)'; end if;
  insert into public.weight_entries (user_id, measured_at, weight_kg, source)
  values (v_u, now(), round(p_kg, 2), 'manual') returning id into v_id;
  return jsonb_build_object('id', v_id, 'weight_kg', round(p_kg, 2));
end $$;
revoke all on function public.hub_peso_registrar(numeric) from public, anon;
grant execute on function public.hub_peso_registrar(numeric) to authenticated;

-- 3) Candidatos que o roteador pode citar por id (itens, semana, planos, compromissos, lançamentos, categorias).
-- Só service role: a função iara-comando chama com o user_id já autenticado. Poucos itens: entram na mensagem, não no cache.
create or replace function core.comando_contexto(p_user uuid, p_hoje date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'itens', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'origem', i.origem, 'titulo', left(i.titulo, 60)) order by i.data, i.id)
      from (select * from core.itens where user_id = p_user and status = 'pendente' and data between p_hoje - 1 and p_hoje + 1
            order by data, id limit 8) i), '[]'::jsonb),
    'trilha', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'titulo', left(x.titulo, 60)) order by x.ordem)
      from (select i.id, i.titulo, i.ordem from sabia.itens i join sabia.trilhas t on t.id = i.trilha_id
            where i.user_id = p_user and t.data = p_hoje and i.status = 'pendente' order by i.ordem limit 6) x), '[]'::jsonb),
    'semana', (select jsonb_build_object('id', s.id, 'status', s.status) from core.planos_semana s
               where s.user_id = p_user order by s.semana desc limit 1),
    'planos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'titulo', left(p.titulo, 50), 'status', p.status))
      from (select * from core.planos where user_id = p_user and status in ('rascunho', 'ativo') order by created_at desc limit 5) p), '[]'::jsonb),
    'compromissos', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'titulo', left(c.titulo, 50), 'data', c.data))
      from (select * from core.compromissos where user_id = p_user and not cancelado and data >= p_hoje order by data, inicio limit 6) c), '[]'::jsonb),
    'lancamentos', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'descricao', left(coalesce(t.merchant, t.description), 40), 'valor', t.amount))
      from (select * from airton.transactions where user_id = p_user and not reviewed and kind <> 'transfer'
            order by date desc limit 6) t), '[]'::jsonb),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.name))
      from (select * from airton.categories where user_id = p_user and not archived order by name limit 30) c), '[]'::jsonb)
  )
$$;
revoke all on function core.comando_contexto(uuid, date) from public, anon, authenticated;
grant execute on function core.comando_contexto(uuid, date) to service_role;

-- 4) Intenções que faltavam.
insert into core.intencoes (slug, agent, exemplos, rpc, slots, risco, confirmacao, desfazer_rpc) values
 ('peso.registrar', 'claudia',
  array['registra 82,4 quilos', 'pesei 81,9 hoje', 'anota meu peso: 83 kg'],
  'public.hub_peso_registrar', '{"p_kg":"numeric"}', 'baixo', 'nenhuma', null),
 ('financas.quanto_posso_gastar', 'airton',
  array['quanto posso gastar hoje?', 'quanto sobra esse mês?', 'posso gastar 200 num jantar?'],
  'fn:airton-ai/chat', '{"pergunta":"text"}', 'baixo', 'nenhuma', null)
on conflict (slug) do update set
  agent = excluded.agent, exemplos = excluded.exemplos, rpc = excluded.rpc, slots = excluded.slots,
  risco = excluded.risco, confirmacao = excluded.confirmacao, desfazer_rpc = excluded.desfazer_rpc;
