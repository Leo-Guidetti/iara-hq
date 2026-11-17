-- UX-01: catálogo de intenções. Aditivo e idempotente.
create table if not exists core.intencoes (
  slug         text primary key,
  agent        text not null references core.agents(slug),
  exemplos     text[] not null default '{}',
  rpc          text not null,
  slots        jsonb not null default '{}'::jsonb,
  risco        text not null check (risco in ('baixo', 'medio', 'alto')),
  confirmacao  text not null check (confirmacao in ('nenhuma', 'repetir', 'sim')),
  desfazer_rpc text,
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now()
);

comment on table core.intencoes is
  'Catálogo do que pode ser pedido ao hub. Regra: ação nova = uma RPC com parâmetros nomeados + uma linha aqui. '
  'Política por risco: baixo = executa e avisa com desfazer (confirmacao nenhuma); medio = repete o entendido e executa (repetir); alto = só executa com "sim" (sim).';
comment on column core.intencoes.slots is 'Parâmetros nomeados da RPC e seus tipos: {"p_id":"bigint", ...}. Sufixo "?" = opcional.';
comment on column core.intencoes.desfazer_rpc is 'RPC que desfaz a ação, quando existir; null = sem desfazer.';

alter table core.intencoes enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'intencoes' and policyname = 'intencoes_leitura') then
    create policy intencoes_leitura on core.intencoes for select to authenticated using (true);
  end if;
end $$;
revoke all on core.intencoes from public, anon, authenticated;
grant select on core.intencoes to authenticated;

-- Garante os agentes referenciados (já existem em produção; no-op lá).
insert into core.agents (slug, nome, dominio, ordem) values
  ('iara', 'IARA', 'Orquestração da rotina + casa', 10), ('claudia', 'ClaudIA', 'Saúde', 20),
  ('airton', 'AIrton', 'Finanças', 30), ('sabia', 'SabIA', 'Estudos', 40)
on conflict (slug) do nothing;

insert into core.intencoes (slug, agent, exemplos, rpc, slots, risco, confirmacao, desfazer_rpc) values
 ('casa.item_status', 'iara',
  array['marca a tarefa da casa como feita', 'adia isso para amanhã', 'ignora esse item da casa'],
  'public.hub_item_status',
  '{"p_id":"bigint","p_status":"text(pendente|feito|adiado|ignorado)","p_adiar_para":"date?"}',
  'baixo', 'nenhuma', 'public.hub_item_status'),
 ('sabia.item', 'sabia',
  array['terminei a leitura de hoje', 'pula esse item da trilha', 'gostei desse conteúdo'],
  'public.hub_sabia_item',
  '{"p_id":"bigint","p_status":"text(pendente|feito|pulado)","p_reacao":"int(-1|0|1)?"}',
  'baixo', 'nenhuma', 'public.hub_sabia_item'),
 ('agenda.compromisso_salvar', 'iara',
  array['marca dentista quinta às 15h', 'cria um compromisso amanhã às 9h', 'muda o horário da reunião'],
  'public.hub_compromisso_salvar',
  '{"p":"jsonb{id?:bigint,titulo:text,data:date,inicio?:time,fim?:time,tipo?:text,local?:text}"}',
  'medio', 'repetir', 'public.hub_compromisso_cancelar'),
 ('agenda.compromisso_cancelar', 'iara',
  array['cancela o dentista', 'desmarca a reunião de quinta'],
  'public.hub_compromisso_cancelar',
  '{"p_id":"bigint"}',
  'medio', 'repetir', null),
 ('semana.item', 'iara',
  array['tira esse item do plano da semana', 'inclui de volta no plano da semana'],
  'public.hub_semana_item',
  '{"p_id":"bigint","p_incluido":"boolean"}',
  'baixo', 'nenhuma', 'public.hub_semana_item'),
 ('semana.item_editar', 'iara',
  array['passa esse item da semana para sexta', 'muda a hora desse item para 18h'],
  'public.hub_semana_item_editar',
  '{"p_id":"bigint","p_data":"date","p_hora":"text(HH:MM)"}',
  'medio', 'repetir', null),
 ('semana.confirmar', 'iara',
  array['confirma a semana', 'fecha o plano da semana'],
  'public.hub_semana_confirmar',
  '{"p_plano":"bigint"}',
  'alto', 'sim', null)
on conflict (slug) do update set
  agent = excluded.agent, exemplos = excluded.exemplos, rpc = excluded.rpc, slots = excluded.slots,
  risco = excluded.risco, confirmacao = excluded.confirmacao, desfazer_rpc = excluded.desfazer_rpc;
