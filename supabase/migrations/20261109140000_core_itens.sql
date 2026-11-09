-- Etapa 2 (Fase 2 do ROADMAP) · núcleo de itens: a fila comum onde cada agente e fonte publica cartões.
-- Só aditiva. Escrita só por core.publicar_item() (service role); o app lê e muda status/retorno/adiado_para.

create table if not exists core.itens (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  origem        text not null check (origem in ('airton', 'claudia', 'sabia', 'iara', 'gmail', 'agenda')),
  tipo          text not null check (tipo in ('tarefa', 'recomendacao', 'alerta', 'leitura', 'lembrete')),
  titulo        text not null check (length(titulo) between 1 and 200),
  detalhe       text check (length(detalhe) <= 2000),
  -- "quando": o dia (fuso de São Paulo), com hora opcional; janela 'semana' = qualquer dia da semana de `data`.
  data          date not null,
  hora          time,
  janela        text not null default 'dia' check (janela in ('dia', 'semana')),
  prioridade    text not null default 'media' check (prioridade in ('alta', 'media', 'baixa')),
  minutos       int check (minutos between 1 and 600),
  -- ação principal do cartão, ex.: {"url": "/aprender", "rotulo": "Abrir"}; links externos em "externo".
  acao          jsonb not null default '{}'::jsonb,
  status        text not null default 'pendente' check (status in ('pendente', 'feito', 'adiado', 'ignorado')),
  adiado_para   date,
  retorno       jsonb,
  chave_origem  text not null check (length(chave_origem) between 1 and 200),
  expira_em     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, origem, chave_origem)
);

create index if not exists itens_dia on core.itens (user_id, data, status);

alter table core.itens enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'itens' and policyname = 'itens_dono') then
    create policy itens_dono on core.itens for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'itens' and policyname = 'itens_retorno') then
    create policy itens_retorno on core.itens for update to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

grant select on core.itens to authenticated;
grant update (status, adiado_para, retorno) on core.itens to authenticated;
grant all on core.itens to service_role;

create or replace function core.tg_itens_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'itens_updated_at' and tgrelid = 'core.itens'::regclass) then
    create trigger itens_updated_at before update on core.itens
      for each row execute function core.tg_itens_updated_at();
  end if;
end $$;

-- Publica (ou atualiza) um item. Idempotente por (user_id, origem, chave_origem): rodar de novo atualiza o
-- conteúdo, mas nunca desfaz o que o Leo já decidiu (status, adiado_para, retorno ficam como estão).
-- p = {"user_id", "origem", "tipo", "titulo", "chave_origem", "data"?, "hora"?, "janela"?, "detalhe"?,
--      "prioridade"?, "minutos"?, "acao"?, "expira_em"?}. Devolve o id.
create or replace function core.publicar_item(p jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  if p ->> 'user_id' is null or p ->> 'origem' is null or p ->> 'tipo' is null
     or p ->> 'titulo' is null or p ->> 'chave_origem' is null then
    raise exception 'publicar_item: user_id, origem, tipo, titulo e chave_origem são obrigatórios';
  end if;

  insert into core.itens (user_id, origem, tipo, titulo, detalhe, data, hora, janela, prioridade,
                          minutos, acao, chave_origem, expira_em)
  values (
    (p ->> 'user_id')::uuid,
    p ->> 'origem',
    p ->> 'tipo',
    left(p ->> 'titulo', 200),
    left(p ->> 'detalhe', 2000),
    coalesce((p ->> 'data')::date, (now() at time zone 'America/Sao_Paulo')::date),
    (p ->> 'hora')::time,
    coalesce(p ->> 'janela', 'dia'),
    coalesce(p ->> 'prioridade', 'media'),
    (p ->> 'minutos')::int,
    coalesce(p -> 'acao', '{}'::jsonb),
    p ->> 'chave_origem',
    (p ->> 'expira_em')::timestamptz
  )
  on conflict (user_id, origem, chave_origem) do update set
    tipo       = excluded.tipo,
    titulo     = excluded.titulo,
    detalhe    = excluded.detalhe,
    data       = excluded.data,
    hora       = excluded.hora,
    janela     = excluded.janela,
    prioridade = excluded.prioridade,
    minutos    = excluded.minutos,
    acao       = excluded.acao,
    expira_em  = excluded.expira_em
  returning id into v_id;

  return v_id;
end $$;

revoke all on function core.publicar_item(jsonb) from public, anon, authenticated;
grant execute on function core.publicar_item(jsonb) to service_role;
