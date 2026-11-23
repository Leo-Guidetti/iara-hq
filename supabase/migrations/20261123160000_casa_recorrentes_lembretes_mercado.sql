-- Casa (pedido do Leo, 23/11): tarefas recorrentes, lembretes com horário e lista de mercado única com preço estimado. Aditiva.
--
-- Recorrência: core.casa_recorrencias guarda a regra; core.casa_gerar cria as ocorrências em core.itens (origem iara,
--   chave 'rec:<id>:<data>') até 7 dias à frente. Roda no cron diário e a cada tick do airton-notify (via avisos_reservar).
-- Lembrete: tarefa com hora vira aviso (core.avisos, origem 'lembrete', enviar_apos = data + hora em SP). Sai no tick de
--   15 min do airton-notify, FORA do teto diário e do silêncio (foi o Leo que escolheu a hora) e não conta no teto. Tarefa
--   feita, ignorada ou adiada para outro dia descarta o lembrete antigo; a nova data ganha um novo.
-- Mercado: core.mercado (lista única) + core.mercado_precos (último preço por item: o que o Leo corrigiu vale mais que a IA).
--   A estimativa de preço é do iara-mercado (Haiku), só para itens sem preço conhecido.

-- ── 1) Recorrências ───────────────────────────────────────────────────────────────────────────────
create table if not exists core.casa_recorrencias (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  titulo    text not null check (length(titulo) between 1 and 200),
  freq      text not null check (freq in ('diaria', 'semanal', 'mensal', 'intervalo')),
  dias      int[] not null default '{}',                   -- semanal: isodow 1 (seg) a 7 (dom)
  dia_mes   int check (dia_mes between 1 and 31),          -- mensal (31 = último dia em meses curtos)
  intervalo int check (intervalo between 2 and 365),       -- a cada N dias, contando do início
  inicio    date not null,
  hora      time,                                          -- lembrete no dia (opcional)
  ativo     boolean not null default true,
  criado_em timestamptz not null default now(),
  check (freq <> 'semanal' or cardinality(dias) > 0),
  check (freq <> 'mensal' or dia_mes is not null),
  check (freq <> 'intervalo' or intervalo is not null)
);
create index if not exists casa_recorrencias_user on core.casa_recorrencias (user_id) where ativo;
alter table core.casa_recorrencias enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'casa_recorrencias' and policyname = 'casa_recorrencias_dono') then
    create policy casa_recorrencias_dono on core.casa_recorrencias for select to authenticated using (user_id = auth.uid());
  end if;
end $$;
revoke all on core.casa_recorrencias from public, anon, authenticated;

-- PURA: a regra cai nesta data?
create or replace function core.casa_rec_cai(p_freq text, p_dias int[], p_dia_mes int, p_intervalo int, p_inicio date, p_d date)
returns boolean language sql immutable set search_path = '' as $$
  select p_d >= p_inicio and case p_freq
    when 'diaria' then true
    when 'semanal' then extract(isodow from p_d)::int = any (p_dias)
    when 'mensal' then extract(day from p_d)::int
                       = least(p_dia_mes, extract(day from (date_trunc('month', p_d) + interval '1 month - 1 day'))::int)
    when 'intervalo' then (p_d - p_inicio) % p_intervalo = 0
    else false end
$$;

-- Cria as ocorrências de hoje até p_dias à frente (idempotente pela chave). Retorna quantas entraram.
create or replace function core.casa_gerar(p_user uuid, p_dias int default 7) returns int
language plpgsql security definer set search_path = '' as $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; n int;
begin
  insert into core.itens (user_id, origem, tipo, titulo, data, hora, chave_origem)
  select r.user_id, 'iara', 'tarefa', r.titulo, d::date, r.hora, 'rec:' || r.id || ':' || d::date
    from core.casa_recorrencias r
   cross join generate_series(greatest(v_hoje, r.inicio), v_hoje + p_dias, interval '1 day') d
   where r.user_id = p_user and r.ativo
     and core.casa_rec_cai(r.freq, r.dias, r.dia_mes, r.intervalo, r.inicio, d::date)
  on conflict (user_id, origem, chave_origem) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.casa_gerar(uuid, int) from public, anon, authenticated;

-- ── 2) Lembretes ──────────────────────────────────────────────────────────────────────────────────
alter table core.avisos drop constraint if exists avisos_origem_check;
alter table core.avisos add constraint avisos_origem_check
  check (origem in ('plano', 'decisao', 'proposta', 'conta', 'habito', 'resposta', 'lembrete'));

-- Agenda os lembretes das tarefas da casa com hora (hoje em diante) e descarta os que perderam o sentido.
create or replace function core.casa_lembretes_agendar(p_user uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; n int;
begin
  update core.avisos a set status = 'descartado'
   where a.user_id = p_user and a.origem = 'lembrete' and a.status = 'fila'
     and not exists (select 1 from core.itens i
                      where i.id = (a.args ->> 'item_id')::bigint and i.user_id = p_user
                        and i.status in ('pendente', 'adiado') and i.hora is not null
                        and coalesce(i.adiado_para, i.data)::text = a.args ->> 'data'
                        and to_char(i.hora, 'HH24:MI') = a.args ->> 'hora');
  insert into core.avisos (user_id, origem, chave, prioridade, titulo, corpo, pergunta, opcoes, link, args, enviar_apos)
  select i.user_id, 'lembrete',
         'lembrete:' || i.id || ':' || coalesce(i.adiado_para, i.data) || ':' || to_char(i.hora, 'HH24:MI'),
         100, 'Lembrete', i.titulo, '', '["entendi"]'::jsonb, '/casa',
         jsonb_build_object('item_id', i.id, 'data', coalesce(i.adiado_para, i.data)::text, 'hora', to_char(i.hora, 'HH24:MI')),
         (coalesce(i.adiado_para, i.data) + i.hora) at time zone 'America/Sao_Paulo'
    from core.itens i
   where i.user_id = p_user and i.origem = 'iara' and i.tipo in ('tarefa', 'lembrete')
     and i.status in ('pendente', 'adiado') and i.hora is not null
     -- só o que o Leo criou na Casa (itens do plano da semana também têm hora e não viram lembrete)
     and (i.chave_origem like 'manual:%' or i.chave_origem like 'rec:%')
     and coalesce(i.adiado_para, i.data) between v_hoje and v_hoje + 7
     and (coalesce(i.adiado_para, i.data) + i.hora) at time zone 'America/Sao_Paulo' > now() - interval '15 minutes'
  on conflict (user_id, chave) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.casa_lembretes_agendar(uuid) from public, anon, authenticated;

-- Lembrete não conta no teto diário (mesma função de produção, com o filtro de origem).
create or replace function core.avisos_enviados_hoje(p_user uuid, p_agora timestamp with time zone default now())
returns integer language sql stable security definer set search_path = '' as $$
  select (select count(*)::int from core.avisos a
           where a.user_id = p_user and a.enviado_em is not null and a.origem <> 'lembrete'
             and (a.enviado_em at time zone 'America/Sao_Paulo')::date = (p_agora at time zone 'America/Sao_Paulo')::date)
       + (select count(*)::int from airton.notify_log l
           where l.user_id = p_user and l.sent > 0 and l.local_date = (p_agora at time zone 'America/Sao_Paulo')::date)
$$;

-- Reserva do tick (UX-20) + lembretes: gera ocorrências e lembretes, solta os lembretes vencidos (até 6 h de atraso;
-- depois disso expiram) e só então aplica silêncio e teto aos demais avisos, como antes.
create or replace function core.avisos_reservar(p_user uuid, p_agora timestamp with time zone default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cfg jsonb := core.interrupcoes_de(p_user); v_vagas int; v_ids bigint[] := '{}'; v_lemb bigint[];
begin
  -- serializa ticks concorrentes do mesmo usuário
  perform pg_advisory_xact_lock(hashtextextended('avisos:' || p_user::text, 0));
  perform core.casa_gerar(p_user);
  perform core.casa_lembretes_agendar(p_user);
  update core.avisos set status = 'expirado'
   where user_id = p_user and origem = 'lembrete' and status = 'fila' and enviar_apos < p_agora - interval '6 hours';
  select coalesce(array_agg(a.id order by a.enviar_apos, a.id), '{}') into v_lemb from core.avisos a
   where a.user_id = p_user and a.origem = 'lembrete' and a.status = 'fila' and a.enviar_apos <= p_agora;

  if not core.aviso_em_silencio((p_agora at time zone 'America/Sao_Paulo')::time, v_cfg ->> 'silencio_inicio', v_cfg ->> 'silencio_fim') then
    v_vagas := core.aviso_vagas((v_cfg ->> 'max_dia')::int, core.avisos_enviados_hoje(p_user, p_agora));
    if v_vagas > 0 then
      select coalesce(array_agg(x.id order by x.prioridade desc, x.criado_em, x.id), '{}') into v_ids from (
        select a.id, a.prioridade, a.criado_em from core.avisos a
         where a.user_id = p_user and a.status = 'fila' and a.origem <> 'lembrete' and a.enviar_apos <= p_agora
         order by a.prioridade desc, a.criado_em, a.id limit v_vagas) x;
    end if;
  end if;

  v_ids := v_lemb || v_ids;
  if cardinality(v_ids) = 0 then return '[]'::jsonb; end if;
  update core.avisos set status = 'enviado', enviado_em = p_agora where id = any (v_ids);
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'origem', a.origem, 'titulo', a.titulo, 'corpo', a.corpo,
            'pergunta', a.pergunta, 'opcoes', a.opcoes, 'link', a.link, 'prioridade', a.prioridade) order by a.prioridade desc, a.criado_em, a.id)
          from core.avisos a where a.id = any (v_ids)), '[]'::jsonb);
end $$;

-- ── 3) Tarefas da casa no hub ─────────────────────────────────────────────────────────────────────
-- Mesma lista de antes, com hora e a recorrência de origem (rec) para o hub mostrar só a próxima ocorrência.
create or replace function public.hub_casa_tarefas() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select m.user_id from core.members m where m.user_id = auth.uid()),
  hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
  select case when not exists (select 1 from me) then null else coalesce((
    select jsonb_agg(jsonb_build_object('id', i.id, 'tipo', i.tipo, 'titulo', i.titulo, 'detalhe', i.detalhe,
                                        'data', coalesce(i.adiado_para, i.data), 'hora', to_char(i.hora, 'HH24:MI'),
                                        'minutos', i.minutos, 'status', i.status,
                                        'rec', case when i.chave_origem like 'rec:%' then split_part(i.chave_origem, ':', 2)::bigint end)
                     order by i.status = 'feito', coalesce(i.adiado_para, i.data), i.hora nulls last, i.id)
      from core.itens i, me, hoje
     where i.user_id = me.user_id and i.origem = 'iara' and i.tipo in ('tarefa', 'lembrete')
       and ((i.status in ('pendente', 'adiado') and coalesce(i.adiado_para, i.data) between hoje.d - 14 and hoje.d + 7)
         or (i.status = 'feito' and i.updated_at >= (hoje.d::timestamp at time zone 'America/Sao_Paulo')))
  ), '[]'::jsonb) end;
$$;

-- Recorrências ativas (para a lista "Repetem").
create or replace function public.hub_casa_recorrencias() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when not exists (select 1 from core.members m where m.user_id = auth.uid()) then null else coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'titulo', r.titulo, 'freq', r.freq, 'dias', to_jsonb(r.dias), 'dia_mes', r.dia_mes,
                                        'intervalo', r.intervalo, 'inicio', r.inicio, 'hora', to_char(r.hora, 'HH24:MI')) order by r.titulo)
      from core.casa_recorrencias r where r.user_id = auth.uid() and r.ativo), '[]'::jsonb) end
$$;

-- Nova tarefa com opções: p = {titulo, data?, hora?, repetir?: {freq, dias?, dia_mes?, intervalo?}}.
-- Sem repetir = tarefa única (com lembrete se tiver hora). Com repetir = cria a regra e as ocorrências da semana.
create or replace function public.hub_tarefa_salvar(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_u uuid := auth.uid(); v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_tit text := nullif(btrim(p ->> 'titulo'), ''); v_data date := coalesce(nullif(p ->> 'data', '')::date, v_hoje);
  v_hora time := nullif(p ->> 'hora', '')::time; v_rep jsonb := p -> 'repetir'; v_freq text; v_dias int[]; v_id bigint;
  v_quando text;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  if v_tit is null or length(v_tit) > 200 then raise exception 'Escreva a tarefa em até 200 caracteres.'; end if;
  if v_data < v_hoje then raise exception 'A data não pode ser no passado.'; end if;
  v_quando := case when v_hora is null then '' else ' às ' || to_char(v_hora, 'HH24:MI') end;

  if jsonb_typeof(v_rep) = 'object' and coalesce(v_rep ->> 'freq', '') <> '' then
    v_freq := v_rep ->> 'freq';
    if v_freq not in ('diaria', 'semanal', 'mensal', 'intervalo') then raise exception 'Escolha como a tarefa se repete.'; end if;
    select coalesce(array_agg(distinct x::int order by x::int), '{}') into v_dias
      from jsonb_array_elements_text(case when jsonb_typeof(v_rep -> 'dias') = 'array' then v_rep -> 'dias' else '[]'::jsonb end) x
     where x ~ '^[1-7]$';
    if v_freq = 'semanal' and cardinality(v_dias) = 0 then v_dias := array[extract(isodow from v_data)::int]; end if;
    insert into core.casa_recorrencias (user_id, titulo, freq, dias, dia_mes, intervalo, inicio, hora)
    values (v_u, v_tit, v_freq, case when v_freq = 'semanal' then v_dias else '{}' end,
            case when v_freq = 'mensal' then coalesce(nullif(v_rep ->> 'dia_mes', '')::int, extract(day from v_data)::int) end,
            case when v_freq = 'intervalo' then greatest(2, least(365, coalesce(nullif(v_rep ->> 'intervalo', '')::int, 2))) end,
            v_data, v_hora)
    returning id into v_id;
    perform core.casa_gerar(v_u);
    perform core.casa_lembretes_agendar(v_u);
    return jsonb_build_object('recorrencia_id', v_id, 'fala', 'Anotei: ' || v_tit || ', ' || case v_freq
      when 'diaria' then 'todo dia' when 'semanal' then 'toda semana' when 'mensal' then 'todo mês'
      else 'a cada ' || coalesce(nullif(v_rep ->> 'intervalo', ''), '2') || ' dias' end || v_quando || '.');
  end if;

  insert into core.itens (user_id, origem, tipo, titulo, data, hora, chave_origem)
  values (v_u, 'iara', 'tarefa', v_tit, v_data, v_hora, 'manual:' || pg_catalog.gen_random_uuid()::text)
  returning id into v_id;
  perform core.casa_lembretes_agendar(v_u);
  return jsonb_build_object('id', v_id, 'fala', 'Anotei: ' || v_tit
    || case when v_data = v_hoje then ', para hoje' else ', para ' || to_char(v_data, 'DD/MM') end || v_quando
    || case when v_hora is not null then '. Eu te lembro na hora.' else '.' end);
end $$;

-- Parar uma recorrência: a regra fica inativa e as próximas ocorrências pendentes viram "ignorado" (nada é apagado).
create or replace function public.hub_recorrencia_parar(p_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_u uuid := auth.uid(); v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_ok boolean;
begin
  update core.casa_recorrencias set ativo = false where id = p_id and user_id = v_u and ativo returning true into v_ok;
  if not coalesce(v_ok, false) then return false; end if;
  update core.itens set status = 'ignorado'
   where user_id = v_u and origem = 'iara' and chave_origem like 'rec:' || p_id || ':%'
     and status in ('pendente', 'adiado') and coalesce(adiado_para, data) >= v_hoje;
  perform core.casa_lembretes_agendar(v_u);
  return true;
end $$;

-- Lembrete numa tarefa que já existe (ou tirar, com p_hora null).
create or replace function public.hub_tarefa_lembrete(p_id bigint, p_hora text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_u uuid := auth.uid(); v_ok boolean;
begin
  if p_hora is not null and p_hora !~ '^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'Hora inválida.'; end if;
  update core.itens set hora = p_hora::time
   where id = p_id and user_id = v_u and origem = 'iara' and exists (select 1 from core.members m where m.user_id = v_u)
  returning true into v_ok;
  perform core.casa_lembretes_agendar(v_u);
  return coalesce(v_ok, false);
end $$;

-- ── 4) Lista de mercado ───────────────────────────────────────────────────────────────────────────
create table if not exists core.mercado (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  nome        text not null check (length(nome) between 1 and 120),
  quantidade  numeric(10,2) not null default 1 check (quantidade > 0 and quantidade <= 9999),
  unidade     text not null default 'un' check (unidade in ('un', 'kg', 'g', 'L', 'ml', 'pct', 'cx', 'dz')),
  preco_unit  numeric(10,2) check (preco_unit >= 0),
  preco_fonte text check (preco_fonte in ('ia', 'leo', 'historico')),
  comprado    boolean not null default false,
  comprado_em timestamptz,
  arquivado_em timestamptz,
  criado_em   timestamptz not null default now()
);
create index if not exists mercado_user_aberto on core.mercado (user_id) where arquivado_em is null;
alter table core.mercado enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'mercado' and policyname = 'mercado_dono') then
    create policy mercado_dono on core.mercado for select to authenticated using (user_id = auth.uid());
  end if;
end $$;
revoke all on core.mercado from public, anon, authenticated;

-- Último preço conhecido por item + unidade. 'leo' (corrigido à mão) nunca é sobrescrito pela IA.
create table if not exists core.mercado_precos (
  user_id   uuid not null references auth.users(id) on delete cascade,
  chave     text not null,
  preco     numeric(10,2) not null check (preco >= 0),
  fonte     text not null check (fonte in ('ia', 'leo')),
  atualizado_em timestamptz not null default now(),
  primary key (user_id, chave)
);
alter table core.mercado_precos enable row level security;
revoke all on core.mercado_precos from public, anon, authenticated;

create or replace function core.mercado_chave(p_nome text, p_unidade text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(btrim(p_nome), '\s+', ' ', 'g')) || '|' || coalesce(p_unidade, 'un')
$$;

create or replace function public.hub_mercado() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select m.user_id from core.members m where m.user_id = auth.uid()),
  l as (select x.* from core.mercado x, me where x.user_id = me.user_id and x.arquivado_em is null)
  select case when not exists (select 1 from me) then null else jsonb_build_object(
    'itens', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'quantidade', quantidade, 'unidade', unidade,
                          'preco_unit', preco_unit, 'preco_fonte', preco_fonte, 'comprado', comprado,
                          'total', round(quantidade * preco_unit, 2)) order by comprado, criado_em, id) from l), '[]'::jsonb),
    'falta', coalesce((select round(sum(quantidade * preco_unit), 2) from l where not comprado), 0),
    'carrinho', coalesce((select round(sum(quantidade * preco_unit), 2) from l where comprado), 0),
    'sem_preco', (select count(*) from l where preco_unit is null)) end
$$;

-- Adiciona (ou soma a quantidade se o item já está na lista). Preço: o último conhecido; senão fica para o iara-mercado estimar.
create or replace function public.hub_mercado_adicionar(p_nome text, p_quantidade numeric default null, p_unidade text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_u uuid := auth.uid(); v_nome text := nullif(btrim(p_nome), ''); v_q numeric := coalesce(p_quantidade, 1);
  v_un text := coalesce(nullif(btrim(p_unidade), ''), 'un'); v_id bigint; v_preco numeric; v_fonte text;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  if v_nome is null or length(v_nome) > 120 then raise exception 'Escreva o item em até 120 caracteres.'; end if;
  if v_q <= 0 or v_q > 9999 then raise exception 'Quantidade inválida.'; end if;
  if v_un not in ('un', 'kg', 'g', 'L', 'ml', 'pct', 'cx', 'dz') then v_un := 'un'; end if;
  v_nome := upper(left(v_nome, 1)) || substr(v_nome, 2);
  update core.mercado set quantidade = least(9999, quantidade + v_q)
   where user_id = v_u and arquivado_em is null and not comprado and core.mercado_chave(nome, unidade) = core.mercado_chave(v_nome, v_un)
  returning id, quantidade into v_id, v_q;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'estimar', false, 'fala', v_nome || ' já estava na lista; agora são '
      || replace(regexp_replace(to_char(v_q, 'FM9999990.99'), '\.?0*$', ''), '.', ',') || case when v_un = 'un' then '' else ' ' || v_un end || '.');
  end if;
  select pr.preco, pr.fonte into v_preco, v_fonte from core.mercado_precos pr where pr.user_id = v_u and pr.chave = core.mercado_chave(v_nome, v_un);
  insert into core.mercado (user_id, nome, quantidade, unidade, preco_unit, preco_fonte)
  values (v_u, v_nome, v_q, v_un, v_preco, case when v_preco is null then null when v_fonte = 'leo' then 'leo' else 'historico' end)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'estimar', v_preco is null, 'fala', 'Pus ' || v_nome || ' na lista do mercado.');
end $$;

-- Edita um item: p = {quantidade?, unidade?, preco_unit?, comprado?}. Preço digitado vira o preço do Leo para as próximas vezes.
create or replace function public.hub_mercado_atualizar(p_id bigint, p jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_u uuid := auth.uid(); r core.mercado;
begin
  select * into r from core.mercado where id = p_id and user_id = v_u and arquivado_em is null;
  if r.id is null or not exists (select 1 from core.members m where m.user_id = v_u) then return false; end if;
  if p ? 'quantidade' then r.quantidade := greatest(0.01, least(9999, (p ->> 'quantidade')::numeric)); end if;
  if p ? 'unidade' and (p ->> 'unidade') in ('un', 'kg', 'g', 'L', 'ml', 'pct', 'cx', 'dz') then r.unidade := p ->> 'unidade'; end if;
  if p ? 'comprado' then
    r.comprado := (p ->> 'comprado')::boolean;
    r.comprado_em := case when r.comprado then now() end;
  end if;
  if p ? 'preco_unit' then
    if nullif(p ->> 'preco_unit', '') is null then
      r.preco_unit := null; r.preco_fonte := null;
    else
      r.preco_unit := greatest(0, round((p ->> 'preco_unit')::numeric, 2)); r.preco_fonte := 'leo';
      insert into core.mercado_precos (user_id, chave, preco, fonte) values (v_u, core.mercado_chave(r.nome, r.unidade), r.preco_unit, 'leo')
      on conflict (user_id, chave) do update set preco = excluded.preco, fonte = 'leo', atualizado_em = now();
    end if;
  end if;
  update core.mercado set quantidade = r.quantidade, unidade = r.unidade, comprado = r.comprado, comprado_em = r.comprado_em,
         preco_unit = r.preco_unit, preco_fonte = r.preco_fonte
   where id = r.id;
  return true;
end $$;

-- Tira da lista: um item (p_id) ou, sem p_id, todos os comprados. Arquiva; não apaga.
create or replace function public.hub_mercado_arquivar(p_id bigint default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_u uuid := auth.uid(); n int;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  update core.mercado set arquivado_em = now()
   where user_id = v_u and arquivado_em is null and (case when p_id is null then comprado else id = p_id end);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.hub_casa_recorrencias() from public, anon;
revoke all on function public.hub_tarefa_salvar(jsonb) from public, anon;
revoke all on function public.hub_recorrencia_parar(bigint) from public, anon;
revoke all on function public.hub_tarefa_lembrete(bigint, text) from public, anon;
revoke all on function public.hub_mercado() from public, anon;
revoke all on function public.hub_mercado_adicionar(text, numeric, text) from public, anon;
revoke all on function public.hub_mercado_atualizar(bigint, jsonb) from public, anon;
revoke all on function public.hub_mercado_arquivar(bigint) from public, anon;
grant execute on function public.hub_casa_recorrencias() to authenticated;
grant execute on function public.hub_tarefa_salvar(jsonb) to authenticated;
grant execute on function public.hub_recorrencia_parar(bigint) to authenticated;
grant execute on function public.hub_tarefa_lembrete(bigint, text) to authenticated;
grant execute on function public.hub_mercado() to authenticated;
grant execute on function public.hub_mercado_adicionar(text, numeric, text) to authenticated;
grant execute on function public.hub_mercado_atualizar(bigint, jsonb) to authenticated;
grant execute on function public.hub_mercado_arquivar(bigint) to authenticated;

-- Pela voz: "põe leite na lista do mercado", "adiciona 2 kg de arroz no mercado".
insert into core.intencoes (slug, agent, exemplos, rpc, slots, risco, confirmacao, desfazer_rpc) values
 ('mercado.adicionar', 'iara',
  array['põe leite na lista do mercado', 'adiciona 2 kg de arroz na lista de compras', 'coloca detergente no mercado'],
  'public.hub_mercado_adicionar',
  '{"p_nome":"text","p_quantidade":"numeric?","p_unidade":"text?"}',
  'baixo', 'repetir', null)
on conflict (slug) do update set
  agent = excluded.agent, exemplos = excluded.exemplos, rpc = excluded.rpc, slots = excluded.slots,
  risco = excluded.risco, confirmacao = excluded.confirmacao, desfazer_rpc = excluded.desfazer_rpc;

-- Cron: ocorrências e lembretes do dia mesmo se o tick do airton-notify parar (00:05 SP).
do $$ begin
  if exists (select 1 from cron.job where jobname = 'iara-casa-recorrencias') then perform cron.unschedule('iara-casa-recorrencias'); end if;
  perform cron.schedule('iara-casa-recorrencias', '5 3 * * *',
    $c$ select core.casa_gerar(m.user_id), core.casa_lembretes_agendar(m.user_id) from core.members m $c$);
end $$;
