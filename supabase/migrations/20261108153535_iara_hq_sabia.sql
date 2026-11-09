-- IARA HQ · schema sabia — curadoria diária de conhecimento + livros
create schema if not exists sabia;

create table if not exists sabia.temas (
  slug text primary key, nome text not null, prioridade int not null unique,
  peso numeric not null, peso_min numeric not null, peso_max numeric not null,
  descricao text not null, ativo boolean not null default true
);
insert into sabia.temas (slug, nome, prioridade, peso, peso_min, peso_max, descricao) values
  ('ia', 'IA — tendências', 1, 0.40, 0.30, 0.50, 'Lançamentos de modelos e ferramentas, agentes, IA aplicada a produto (sobretudo fintech e PM), pesquisa que muda a prática. Fora: hype sem substância, listas genéricas de ferramentas.'),
  ('negocios', 'Negócios de tecnologia e empreendedorismo', 2, 0.25, 0.18, 0.32, 'Estratégia de big techs e fintechs, startups e venture capital, growth e produto, modelos de negócio, cases de fundadores. Brasil e global.'),
  ('investimentos', 'Investimentos', 3, 0.20, 0.12, 0.25, 'Macro (Selic, inflação, câmbio, Fed), mercados BR e EUA, renda fixa, ações e ETFs, educação de longo prazo. Fora: dica de ativo, day trade, promessa de retorno.'),
  ('politica', 'Política', 4, 0.15, 0.08, 0.20, 'Política brasileira (Congresso, economia política, eleições) e geopolítica com impacto em economia e tecnologia (EUA, China, regulação de IA). Fontes de linhas editoriais diversas, fatos sem opinião.')
on conflict (slug) do nothing;

create table if not exists sabia.fontes (
  dominio text primary key, nome text not null, tema text not null references sabia.temas(slug),
  idioma text not null check (idioma in ('pt','en')), paywall boolean not null default false
);
insert into sabia.fontes (dominio, nome, tema, idioma, paywall) values
  ('anthropic.com','Anthropic News','ia','en',false), ('openai.com','OpenAI News','ia','en',false),
  ('deepmind.google','Google DeepMind Blog','ia','en',false), ('huggingface.co','Hugging Face Blog','ia','en',false),
  ('simonwillison.net','Simon Willison','ia','en',false), ('latent.space','Latent Space','ia','en',false),
  ('importai.substack.com','Import AI','ia','en',false), ('deeplearning.ai','The Batch','ia','en',false),
  ('stratechery.com','Stratechery','negocios','en',true), ('lennysnewsletter.com','Lenny''s Newsletter','negocios','en',true),
  ('notboring.co','Not Boring','negocios','en',false), ('a16z.com','a16z','negocios','en',false),
  ('techcrunch.com','TechCrunch','negocios','en',false), ('neofeed.com.br','NeoFeed','negocios','pt',false),
  ('braziljournal.com','Brazil Journal','negocios','pt',false), ('infomoney.com.br','InfoMoney','investimentos','pt',false),
  ('bloomberglinea.com.br','Bloomberg Línea','investimentos','pt',false), ('valor.globo.com','Valor Econômico','investimentos','pt',true),
  ('bcb.gov.br','Banco Central (Copom)','investimentos','pt',false), ('federalreserve.gov','Federal Reserve','investimentos','en',false),
  ('poder360.com.br','Poder360','politica','pt',false), ('nexojornal.com.br','Nexo','politica','pt',true),
  ('folha.uol.com.br','Folha de S.Paulo','politica','pt',true), ('estadao.com.br','Estadão','politica','pt',true),
  ('gazetadopovo.com.br','Gazeta do Povo','politica','pt',true), ('bbc.com','BBC News Brasil','politica','pt',false),
  ('reuters.com','Reuters','politica','en',false), ('apnews.com','AP News','politica','en',false)
on conflict (dominio) do nothing;

create table if not exists sabia.trilhas (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data date not null,
  tipo text not null check (tipo in ('diaria','deep_dive','recap','hobby')),
  minutos_total int not null, resumo text,
  status text not null default 'gerada' check (status in ('gerada','em_andamento','concluida')),
  run_id bigint references core.agent_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, data, tipo)
);

create table if not exists sabia.itens (
  id bigint generated always as identity primary key,
  trilha_id bigint not null references sabia.trilhas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ordem int not null, tema text not null, titulo text not null, fonte text, url text,
  formato text not null check (formato in ('artigo','newsletter','podcast','video','paper','recap','livro')),
  idioma text check (idioma in ('pt','en')),
  minutos int not null check (minutos between 1 and 40),
  por_que text, takeaway text, corpo text,
  status text not null default 'pendente' check (status in ('pendente','feito','pulado')),
  reacao smallint check (reacao in (-1, 0, 1)),
  feito_em timestamptz, created_at timestamptz not null default now()
);
create index if not exists itens_user_recentes on sabia.itens (user_id, created_at desc);

create or replace function sabia.tg_item_feito() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'feito' and old.status is distinct from 'feito' then new.feito_em := now(); end if;
  return new;
end $$;
drop trigger if exists itens_feito on sabia.itens;
create trigger itens_feito before update of status on sabia.itens for each row execute function sabia.tg_item_feito();

create or replace function sabia.tg_status_trilha() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update sabia.trilhas t set status = case
      when not exists (select 1 from sabia.itens i where i.trilha_id = t.id and i.status = 'pendente') then 'concluida'
      when exists (select 1 from sabia.itens i where i.trilha_id = t.id and i.status <> 'pendente') then 'em_andamento'
      else 'gerada' end
  where t.id = new.trilha_id;
  return new;
end $$;
drop trigger if exists itens_status on sabia.itens;
create trigger itens_status after update of status on sabia.itens for each row execute function sabia.tg_status_trilha();

create table if not exists sabia.livros (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  titulo text not null, autor text,
  status text not null default 'quero_ler' check (status in ('quero_ler','lendo','pausado','lido','abandonado')),
  paginas int, pagina_atual int, formato text check (formato in ('fisico','kindle','audiobook')),
  nota smallint check (nota between 1 and 5), tags text[] not null default '{}', origem text,
  notas text, resenha text, comecou_em date, terminou_em date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (user_id, titulo)
);
drop trigger if exists livros_updated on sabia.livros;
create trigger livros_updated before update on sabia.livros for each row execute function core.tg_updated_at();

create table if not exists sabia.leituras (
  id bigint generated always as identity primary key,
  livro_id bigint not null references sabia.livros(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  data date not null default current_date, pagina_final int, minutos int, nota text
);

create or replace function sabia.tg_leitura() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update sabia.livros l set
    pagina_atual = greatest(coalesce(l.pagina_atual, 0), coalesce(new.pagina_final, 0)),
    comecou_em = coalesce(l.comecou_em, new.data),
    status = case when l.paginas is not null and new.pagina_final >= l.paginas then 'lido'
                  when l.status in ('quero_ler','pausado') then 'lendo' else l.status end,
    terminou_em = case when l.paginas is not null and new.pagina_final >= l.paginas then new.data else l.terminou_em end
  where l.id = new.livro_id;
  return new;
end $$;
drop trigger if exists leituras_progresso on sabia.leituras;
create trigger leituras_progresso after insert on sabia.leituras for each row execute function sabia.tg_leitura();

create table if not exists sabia.anotacoes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  livro_id bigint references sabia.livros(id) on delete cascade,
  item_id bigint references sabia.itens(id) on delete cascade,
  tipo text not null default 'ideia' check (tipo in ('destaque','ideia','pergunta')),
  texto text not null, pagina int, created_at timestamptz not null default now(),
  check (livro_id is not null or item_id is not null)
);

create or replace function sabia.briefing_hoje(p_user uuid, p_data date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_trilha jsonb; v_livro jsonb; v_seq int := 0; d date := p_data - 1;
begin
  select jsonb_build_object('tipo', t.tipo, 'minutos', t.minutos_total, 'resumo', t.resumo, 'status', t.status,
           'itens', coalesce((select jsonb_agg(jsonb_build_object('tema', i.tema, 'titulo', i.titulo, 'fonte', i.fonte,
               'formato', i.formato, 'minutos', i.minutos, 'status', i.status) order by i.ordem)
             from sabia.itens i where i.trilha_id = t.id), '[]'::jsonb))
  into v_trilha from sabia.trilhas t where t.user_id = p_user and t.data = p_data and t.tipo <> 'hobby'
  order by t.created_at desc limit 1;

  select jsonb_build_object('titulo', l.titulo, 'autor', l.autor, 'pagina_atual', l.pagina_atual, 'paginas', l.paginas,
           'ultima_leitura', (select max(r.data) from sabia.leituras r where r.livro_id = l.id))
  into v_livro from sabia.livros l where l.user_id = p_user and l.status = 'lendo' order by l.updated_at desc limit 1;

  while exists (select 1 from sabia.trilhas where user_id = p_user and data = d and status = 'concluida' and tipo <> 'hobby') loop
    v_seq := v_seq + 1; d := d - 1;
  end loop;
  return jsonb_build_object('trilha', v_trilha, 'livro_atual', v_livro, 'sequencia_dias', v_seq);
end $$;

create or replace function sabia.ajustar_pesos(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; v_total numeric;
begin
  for r in
    select t.slug, t.peso, t.peso_min, t.peso_max, count(i.id) as n,
           avg(case i.status when 'feito' then 1 when 'pulado' then 0 end) as taxa, avg(i.reacao) as reacao
    from sabia.temas t
    left join sabia.itens i on i.tema = t.slug and i.user_id = p_user and i.created_at > now() - interval '14 days'
    where t.ativo group by t.slug, t.peso, t.peso_min, t.peso_max
  loop
    if r.n >= 4 then
      update sabia.temas set peso = least(r.peso_max, greatest(r.peso_min,
          r.peso + 0.03 * sign(coalesce(r.taxa, 0.6) - 0.6 + coalesce(r.reacao, 0) * 0.5))) where slug = r.slug;
    end if;
  end loop;
  select sum(peso) into v_total from sabia.temas where ativo;
  update sabia.temas set peso = round(peso / v_total, 3) where ativo;
  with ord as (select slug, row_number() over (order by prioridade) as rk from sabia.temas where ativo),
       pes as (select peso, row_number() over (order by peso desc) as rk from sabia.temas where ativo)
  update sabia.temas t set peso = pes.peso from ord join pes using (rk) where t.slug = ord.slug;
  return (select jsonb_object_agg(slug, peso) from sabia.temas where ativo);
end $$;

alter table sabia.temas enable row level security;  alter table sabia.fontes enable row level security;
alter table sabia.trilhas enable row level security; alter table sabia.itens enable row level security;
alter table sabia.livros enable row level security;  alter table sabia.leituras enable row level security;
alter table sabia.anotacoes enable row level security;

drop policy if exists temas_leitura on sabia.temas;      create policy temas_leitura on sabia.temas for select to authenticated using (true);
drop policy if exists fontes_leitura on sabia.fontes;    create policy fontes_leitura on sabia.fontes for select to authenticated using (true);
drop policy if exists trilhas_dono on sabia.trilhas;     create policy trilhas_dono on sabia.trilhas for select to authenticated using (user_id = auth.uid());
drop policy if exists itens_leitura on sabia.itens;      create policy itens_leitura on sabia.itens for select to authenticated using (user_id = auth.uid());
drop policy if exists itens_marcar on sabia.itens;       create policy itens_marcar on sabia.itens for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists livros_dono on sabia.livros;       create policy livros_dono on sabia.livros for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists leituras_dono on sabia.leituras;   create policy leituras_dono on sabia.leituras for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists anotacoes_dono on sabia.anotacoes; create policy anotacoes_dono on sabia.anotacoes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant usage on schema sabia to authenticated, service_role;
grant all on all tables in schema sabia to service_role;
grant select, insert, update, delete on all tables in schema sabia to authenticated;
grant usage, select on all sequences in schema sabia to authenticated, service_role;
revoke execute on function sabia.briefing_hoje(uuid, date) from public, anon, authenticated;
revoke execute on function sabia.ajustar_pesos(uuid) from public, anon, authenticated;;
