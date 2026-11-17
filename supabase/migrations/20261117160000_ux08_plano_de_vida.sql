-- UX-08: plano de vida em core (planos, metas, eventos). Aditivo e idempotente.
-- Leitura: authenticated só vê o que é seu (RLS). Escrita: só pelas RPCs security definer. Cancelar = status.
create table if not exists core.planos (
  id             bigint generated always as identity primary key,
  user_id        uuid not null,
  titulo         text not null,
  tipo           text not null default 'outro' check (tipo in ('imovel', 'carro', 'carreira', 'habilidade', 'habito', 'outro')),
  status         text not null default 'rascunho' check (status in ('rascunho', 'ativo', 'pausado', 'concluido', 'abandonado')),
  prioridade     int,                                  -- nasce vazia (D2): sem ordem fixa, só se o Leo ditar
  alvo           jsonb not null default '{}'::jsonb,   -- {"valor": number, "data": "AAAA-MM-DD"}
  porque         text,
  proxima_revisao date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, titulo)
);

create table if not exists core.plano_metas (
  id         bigint generated always as identity primary key,
  plano_id   bigint not null references core.planos (id),
  parent_id  bigint references core.plano_metas (id),
  horizonte  text not null check (horizonte in ('curto', 'medio', 'longo')),
  dono       text not null references core.agents (slug),   -- exatamente um dono; carreira e hobbies: iara (D1)
  titulo     text not null,
  medida     jsonb not null default '{}'::jsonb,  -- {"tipo": valor|contagem|habito|marco, "unidade", "alvo", "inicio"}
  prazo      date,
  cadencia   text,
  demanda    jsonb not null default '{}'::jsonb,  -- {"reais_mes", "minutos_semana"}
  ref        text,                                -- ex.: airton.goals:<id>, sabia.livros:ano
  progresso  numeric,
  ritmo      text not null default 'sem_dados' check (ritmo in ('no_ritmo', 'atrasada', 'adiantada', 'sem_dados')),
  status     text not null default 'ativa' check (status in ('ativa', 'pausada', 'concluida', 'cancelada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plano_metas_plano on core.plano_metas (plano_id);

create table if not exists core.plano_eventos (
  id       bigint generated always as identity primary key,
  plano_id bigint not null references core.planos (id),
  meta_id  bigint references core.plano_metas (id),
  tipo     text not null check (tipo in ('criado', 'progresso', 'gatilho', 'ajuste', 'decisao', 'pausa')),
  origem   text not null default 'sistema' check (origem in ('leo', 'agente', 'sistema')),
  dados    jsonb not null default '{}'::jsonb,
  at       timestamptz not null default now()
);
create index if not exists plano_eventos_plano on core.plano_eventos (plano_id, at);

alter table core.planos_semana_itens add column if not exists meta_id bigint references core.plano_metas (id);

alter table core.planos enable row level security;
alter table core.plano_metas enable row level security;
alter table core.plano_eventos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'planos' and policyname = 'planos_dono') then
    create policy planos_dono on core.planos for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'plano_metas' and policyname = 'plano_metas_dono') then
    create policy plano_metas_dono on core.plano_metas for select to authenticated
      using (exists (select 1 from core.planos p where p.id = plano_id and p.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'plano_eventos' and policyname = 'plano_eventos_dono') then
    create policy plano_eventos_dono on core.plano_eventos for select to authenticated
      using (exists (select 1 from core.planos p where p.id = plano_id and p.user_id = auth.uid()));
  end if;
end $$;
revoke all on core.planos, core.plano_metas, core.plano_eventos from public, anon, authenticated;
grant select on core.planos, core.plano_metas, core.plano_eventos to authenticated;

-- Salva (cria ou atualiza) um plano do usuário. Idempotente por (usuário, título): evento 'criado' só na primeira vez.
-- p: {titulo, tipo?, status?, prioridade?, alvo?, porque?, proxima_revisao?}
create or replace function core.plano_salvar(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_u uuid := auth.uid(); v_titulo text := nullif(btrim(p ->> 'titulo'), ''); r core.planos; v_novo int;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  if v_titulo is null then raise exception 'título obrigatório'; end if;
  insert into core.planos (user_id, titulo, tipo, status, prioridade, alvo, porque, proxima_revisao)
  values (v_u, v_titulo, coalesce(p ->> 'tipo', 'outro'), coalesce(p ->> 'status', 'rascunho'),
          (p ->> 'prioridade')::int, coalesce(p -> 'alvo', '{}'::jsonb), p ->> 'porque', (p ->> 'proxima_revisao')::date)
  on conflict (user_id, titulo) do update set
    tipo = coalesce(p ->> 'tipo', core.planos.tipo),
    status = coalesce(p ->> 'status', core.planos.status),
    prioridade = case when p ? 'prioridade' then (p ->> 'prioridade')::int else core.planos.prioridade end,
    alvo = coalesce(p -> 'alvo', core.planos.alvo),
    porque = coalesce(p ->> 'porque', core.planos.porque),
    proxima_revisao = coalesce((p ->> 'proxima_revisao')::date, core.planos.proxima_revisao),
    updated_at = now()
  returning * into r;
  insert into core.plano_eventos (plano_id, tipo, origem, dados)
  select r.id, 'criado', 'leo', jsonb_build_object('titulo', r.titulo)
   where not exists (select 1 from core.plano_eventos e where e.plano_id = r.id and e.tipo = 'criado');
  get diagnostics v_novo = row_count;
  return to_jsonb(r) || jsonb_build_object('criado', v_novo = 1);
end $$;

-- Cria ou edita uma meta de um plano do usuário. p: {id?, plano_id, horizonte, dono, titulo, parent_id?, medida?, prazo?,
-- cadencia?, demanda?, ref?, progresso?, ritmo?, status?}. Cancelar = status 'cancelada'.
create or replace function core.meta_salvar(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_u uuid := auth.uid(); v_id bigint := (p ->> 'id')::bigint; v_plano bigint; v_dono text; v_hor text; r core.plano_metas;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  if v_id is not null then
    select m.plano_id into v_plano from core.plano_metas m join core.planos pl on pl.id = m.plano_id
     where m.id = v_id and pl.user_id = v_u;
    if v_plano is null then raise exception 'meta não encontrada'; end if;
  else
    v_plano := (p ->> 'plano_id')::bigint;
    if not exists (select 1 from core.planos pl where pl.id = v_plano and pl.user_id = v_u) then raise exception 'plano não encontrado'; end if;
    if nullif(btrim(p ->> 'titulo'), '') is null then raise exception 'título obrigatório'; end if;
  end if;
  v_dono := p ->> 'dono'; v_hor := p ->> 'horizonte';
  if v_dono is not null and not exists (select 1 from core.agents a where a.slug = v_dono) then raise exception 'dono inválido: %', v_dono; end if;
  if v_hor is not null and v_hor not in ('curto', 'medio', 'longo') then raise exception 'horizonte inválido: %', v_hor; end if;
  if v_id is null and (v_dono is null or v_hor is null) then raise exception 'dono e horizonte obrigatórios'; end if;
  if (p ->> 'parent_id') is not null and not exists (
       select 1 from core.plano_metas x where x.id = (p ->> 'parent_id')::bigint and x.plano_id = v_plano) then
    raise exception 'meta pai inválida';
  end if;

  if v_id is null then
    insert into core.plano_metas (plano_id, parent_id, horizonte, dono, titulo, medida, prazo, cadencia, demanda, ref, progresso, ritmo, status)
    values (v_plano, (p ->> 'parent_id')::bigint, v_hor, v_dono, btrim(p ->> 'titulo'), coalesce(p -> 'medida', '{}'::jsonb),
            (p ->> 'prazo')::date, p ->> 'cadencia', coalesce(p -> 'demanda', '{}'::jsonb), p ->> 'ref',
            (p ->> 'progresso')::numeric, coalesce(p ->> 'ritmo', 'sem_dados'), coalesce(p ->> 'status', 'ativa'))
    returning * into r;
  else
    update core.plano_metas set
      parent_id = coalesce((p ->> 'parent_id')::bigint, parent_id), horizonte = coalesce(v_hor, horizonte),
      dono = coalesce(v_dono, dono), titulo = coalesce(nullif(btrim(p ->> 'titulo'), ''), titulo),
      medida = coalesce(p -> 'medida', medida), prazo = coalesce((p ->> 'prazo')::date, prazo),
      cadencia = coalesce(p ->> 'cadencia', cadencia), demanda = coalesce(p -> 'demanda', demanda),
      ref = coalesce(p ->> 'ref', ref), progresso = coalesce((p ->> 'progresso')::numeric, progresso),
      ritmo = coalesce(p ->> 'ritmo', ritmo), status = coalesce(p ->> 'status', status), updated_at = now()
    where id = v_id returning * into r;
  end if;
  return to_jsonb(r);
end $$;

revoke all on function core.plano_salvar(jsonb), core.meta_salvar(jsonb) from public, anon, authenticated;

-- Wrappers expostos na Data API (schema core não é exposto).
create or replace function public.hub_plano_salvar(p jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select core.plano_salvar(p) $$;
create or replace function public.hub_meta_salvar(p jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select core.meta_salvar(p) $$;

-- Planos do usuário com metas agrupadas por horizonte. Ativos primeiro, prioridade (nulls last), criação.
create or replace function public.hub_planos() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_u uuid := auth.uid();
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then return null; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(pl) || jsonb_build_object('metas', jsonb_build_object(
      'curto', coalesce((select jsonb_agg(to_jsonb(m) order by m.prazo nulls last, m.id) from core.plano_metas m where m.plano_id = pl.id and m.horizonte = 'curto'), '[]'::jsonb),
      'medio', coalesce((select jsonb_agg(to_jsonb(m) order by m.prazo nulls last, m.id) from core.plano_metas m where m.plano_id = pl.id and m.horizonte = 'medio'), '[]'::jsonb),
      'longo', coalesce((select jsonb_agg(to_jsonb(m) order by m.prazo nulls last, m.id) from core.plano_metas m where m.plano_id = pl.id and m.horizonte = 'longo'), '[]'::jsonb)))
      order by (pl.status = 'ativo') desc, pl.prioridade nulls last, pl.created_at)
    from core.planos pl where pl.user_id = v_u), '[]'::jsonb);
end $$;

revoke all on function public.hub_plano_salvar(jsonb), public.hub_meta_salvar(jsonb), public.hub_planos() from public, anon;
grant execute on function public.hub_plano_salvar(jsonb), public.hub_meta_salvar(jsonb), public.hub_planos() to authenticated;

insert into core.intencoes (slug, agent, exemplos, rpc, slots, risco, confirmacao, desfazer_rpc) values
 ('plano.salvar', 'iara',
  array['quero comprar um apartamento até 2031', 'cria um plano para trocar de carro', 'pausa o plano do carro'],
  'public.hub_plano_salvar',
  '{"p":"jsonb{titulo:text,tipo?:text(imovel|carro|carreira|habilidade|habito|outro),status?:text(rascunho|ativo|pausado|concluido|abandonado),prioridade?:int,alvo?:jsonb{valor?:number,data?:date},porque?:text,proxima_revisao?:date}"}',
  'alto', 'sim', null),
 ('meta.salvar_plano', 'iara',
  array['adiciona a meta de juntar a entrada do apartamento', 'muda o prazo dessa meta', 'cancela essa meta'],
  'public.hub_meta_salvar',
  '{"p":"jsonb{id?:bigint,plano_id:bigint,horizonte:text(curto|medio|longo),dono:text,titulo:text,parent_id?:bigint,medida?:jsonb,prazo?:date,cadencia?:text,demanda?:jsonb,ref?:text,status?:text(ativa|pausada|concluida|cancelada)}"}',
  'alto', 'sim', null),
 ('planos.status', 'iara',
  array['como estão meus planos', 'o que falta para o apartamento', 'quais planos estão atrasados'],
  'public.hub_planos', '{}', 'baixo', 'nenhuma', null)
on conflict (slug) do update set
  agent = excluded.agent, exemplos = excluded.exemplos, rpc = excluded.rpc, slots = excluded.slots,
  risco = excluded.risco, confirmacao = excluded.confirmacao, desfazer_rpc = excluded.desfazer_rpc;
