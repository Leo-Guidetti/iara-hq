-- Pedido do Leo (10/11): o planejamento da semana parte dele. Ele registra o expediente e os compromissos
-- (trabalho, jantares, bares, dates...), a agenda (Google ou iPhone) entra sozinha, e a IARA devolve uma
-- sugestão inicial e uma crítica para encaixar a semana, contando o deslocamento entre os lugares.
-- Ele ajusta e confirma. Só aditiva.

-- 1) Crítica da semana ao lado da sugestão.
alter table core.planos_semana add column if not exists critica text;

-- 2) Compromissos que o Leo registra no hub (cancelar = marcar cancelado; nada é apagado).
create table if not exists core.compromissos (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  data       date not null,
  inicio     time,
  fim        time,
  titulo     text not null check (length(titulo) between 1 and 120),
  tipo       text not null default 'pessoal' check (tipo in ('pessoal', 'trabalho', 'saude', 'outro')),
  local      text,
  cancelado  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists compromissos_user_data on core.compromissos (user_id, data);
alter table core.compromissos enable row level security;
create policy compromissos_dono on core.compromissos for select to authenticated using (user_id = auth.uid());
revoke all on core.compromissos from anon;

-- 3) Eventos lidos da agenda (Google / iCloud, pelo link iCal secreto) pela função iara-agenda.
create table if not exists core.agenda_eventos (
  id            bigint generated always as identity primary key,
  user_id       uuid not null,
  fonte         text not null,
  uid           text not null,
  inicio        timestamptz not null,
  fim           timestamptz,
  dia_todo      boolean not null default false,
  titulo        text not null,
  local         text,
  ocupado       boolean not null default true,
  atualizado_em timestamptz not null default now(),
  unique (user_id, fonte, uid, inicio)
);
create index if not exists agenda_eventos_user_inicio on core.agenda_eventos (user_id, inicio);
alter table core.agenda_eventos enable row level security;
create policy agenda_eventos_dono on core.agenda_eventos for select to authenticated using (user_id = auth.uid());
revoke all on core.agenda_eventos from anon;

-- 4) Token do feed iCal que o Leo assina no iPhone/Google (plano confirmado + compromissos do hub).
update core.perfil
   set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('agenda_token',
         replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
 where not coalesce(config, '{}'::jsonb) ? 'agenda_token';

-- 5) Blocos fixos de um intervalo: expediente (core.perfil.config.expediente), compromissos do hub e agenda.
create or replace function core.fixos(p_user uuid, p_de date, p_ate date) returns jsonb
language sql stable security definer set search_path = '' as $$
  with exp as (select p.config -> 'expediente' as e from core.perfil p where p.user_id = p_user),
  dias as (select d::date as d from generate_series(p_de, p_ate, interval '1 day') g(d)),
  x as (
    select jsonb_build_object('data', dias.d, 'inicio', exp.e ->> 'inicio', 'fim', exp.e ->> 'fim',
                              'titulo', coalesce(nullif(exp.e ->> 'titulo', ''), 'Trabalho'), 'tipo', 'trabalho',
                              'fonte', 'expediente', 'id', null, 'local', nullif(exp.e ->> 'local', '')) as v
      from dias, exp
     where jsonb_typeof(exp.e -> 'dias') = 'array'
       and extract(isodow from dias.d)::int in (select jsonb_array_elements_text(exp.e -> 'dias')::int)
    union all
    select jsonb_build_object('data', c.data, 'inicio', to_char(c.inicio, 'HH24:MI'), 'fim', to_char(c.fim, 'HH24:MI'),
                              'titulo', c.titulo, 'tipo', c.tipo, 'fonte', 'hub', 'id', c.id, 'local', c.local)
      from core.compromissos c
     where c.user_id = p_user and not c.cancelado and c.data between p_de and p_ate
    union all
    select jsonb_build_object('data', (a.inicio at time zone 'America/Sao_Paulo')::date,
                              'inicio', case when a.dia_todo then null else to_char(a.inicio at time zone 'America/Sao_Paulo', 'HH24:MI') end,
                              'fim', case when a.dia_todo or a.fim is null then null else to_char(a.fim at time zone 'America/Sao_Paulo', 'HH24:MI') end,
                              'titulo', a.titulo, 'tipo', 'agenda', 'fonte', a.fonte, 'id', a.id, 'local', a.local, 'ocupado', a.ocupado)
      from core.agenda_eventos a
     where a.user_id = p_user and (a.inicio at time zone 'America/Sao_Paulo')::date between p_de and p_ate
  )
  select coalesce(jsonb_agg(v order by v ->> 'data', v ->> 'inicio' nulls first), '[]'::jsonb) from x;
$$;
revoke all on function core.fixos(uuid, date, date) from public, anon, authenticated;
grant execute on function core.fixos(uuid, date, date) to service_role;

-- 6) Hub.
-- Painel da semana-alvo (domingo: a que vem; nos outros dias: de hoje até domingo).
create or replace function public.hub_semana_painel() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select m.user_id from core.members m where m.user_id = auth.uid()),
  hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  alvo as (select case when extract(dow from d) = 0 then d + 1 else date_trunc('week', d)::date end as semana,
                  case when extract(dow from d) = 0 then d + 1 else d end as desde from hoje)
  select case when not exists (select 1 from me) then null else (
    select jsonb_build_object(
      'semana', alvo.semana, 'desde', alvo.desde, 'fim', alvo.semana + 6,
      'expediente', (select p.config -> 'expediente' from core.perfil p where p.user_id = me.user_id),
      'lugares', (select coalesce(p.config -> 'lugares', '[]'::jsonb) from core.perfil p where p.user_id = me.user_id),
      'fixos', core.fixos(me.user_id, alvo.desde, alvo.semana + 6),
      'agenda', jsonb_build_object(
        'eventos', (select count(*) from core.agenda_eventos a where a.user_id = me.user_id and a.inicio >= now() - interval '1 day'),
        'ultima_sync', (select max(a.atualizado_em) from core.agenda_eventos a where a.user_id = me.user_id)),
      'feed_token', (select p.config ->> 'agenda_token' from core.perfil p where p.user_id = me.user_id))
      from me, alvo) end;
$$;
revoke all on function public.hub_semana_painel() from public, anon;
grant execute on function public.hub_semana_painel() to authenticated;

-- Salvar compromisso (novo ou edição). Hora no formato HH:MM.
create or replace function public.hub_compromisso_salvar(p jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_id bigint;
begin
  if not exists (select 1 from core.members m where m.user_id = v_user) then raise exception 'sem acesso'; end if;
  if coalesce(trim(p ->> 'titulo'), '') = '' or (p ->> 'data') is null then raise exception 'título e data são obrigatórios'; end if;
  if (p ->> 'id') is not null then
    update core.compromissos c
       set data = (p ->> 'data')::date, inicio = nullif(p ->> 'inicio', '')::time, fim = nullif(p ->> 'fim', '')::time,
           titulo = left(trim(p ->> 'titulo'), 120), tipo = coalesce(nullif(p ->> 'tipo', ''), c.tipo),
           local = nullif(trim(coalesce(p ->> 'local', '')), ''), updated_at = now()
     where c.id = (p ->> 'id')::bigint and c.user_id = v_user
    returning c.id into v_id;
  else
    insert into core.compromissos (user_id, data, inicio, fim, titulo, tipo, local)
    values (v_user, (p ->> 'data')::date, nullif(p ->> 'inicio', '')::time, nullif(p ->> 'fim', '')::time,
            left(trim(p ->> 'titulo'), 120), coalesce(nullif(p ->> 'tipo', ''), 'pessoal'),
            nullif(trim(coalesce(p ->> 'local', '')), ''))
    returning id into v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.hub_compromisso_salvar(jsonb) from public, anon;
grant execute on function public.hub_compromisso_salvar(jsonb) to authenticated;

create or replace function public.hub_compromisso_cancelar(p_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  update core.compromissos set cancelado = true, updated_at = now()
   where id = p_id and user_id = auth.uid() and exists (select 1 from core.members m where m.user_id = auth.uid());
  get diagnostics v_ok = row_count;
  return v_ok;
end $$;
revoke all on function public.hub_compromisso_cancelar(bigint) from public, anon;
grant execute on function public.hub_compromisso_cancelar(bigint) to authenticated;

-- Expediente: {"dias":[1..5 (isodow)],"inicio":"09:00","fim":"18:00","titulo":"Trabalho","local":"Escritório"}; null tira.
create or replace function public.hub_expediente_salvar(p jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  update core.perfil pf
     set config = case when p is null or jsonb_typeof(p) <> 'object' then coalesce(pf.config, '{}'::jsonb) - 'expediente'
                       else coalesce(pf.config, '{}'::jsonb) || jsonb_build_object('expediente', jsonb_build_object(
                              'dias', coalesce(p -> 'dias', '[1,2,3,4,5]'::jsonb),
                              'inicio', coalesce(p ->> 'inicio', '09:00'), 'fim', coalesce(p ->> 'fim', '18:00'),
                              'titulo', coalesce(nullif(p ->> 'titulo', ''), 'Trabalho'),
                              'local', nullif(trim(coalesce(p ->> 'local', '')), ''))) end,
         updated_at = now()
   where pf.user_id = auth.uid() and exists (select 1 from core.members m where m.user_id = auth.uid());
  get diagnostics v_ok = row_count;
  return v_ok;
end $$;
revoke all on function public.hub_expediente_salvar(jsonb) from public, anon;
grant execute on function public.hub_expediente_salvar(jsonb) to authenticated;

-- Lugares frequentes e o deslocamento típico a partir de casa:
-- [{"nome":"Casa","endereco":"..."},{"nome":"Escritório","endereco":"...","min_casa":35}, ...] (até 12).
create or replace function public.hub_lugares_salvar(p jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  if jsonb_typeof(p) <> 'array' then raise exception 'lista de lugares inválida'; end if;
  update core.perfil pf
     set config = coalesce(pf.config, '{}'::jsonb) || jsonb_build_object('lugares', coalesce((
           select jsonb_agg(jsonb_build_object(
                    'nome', left(trim(l ->> 'nome'), 40),
                    'endereco', nullif(left(trim(coalesce(l ->> 'endereco', '')), 200), ''),
                    'min_casa', case when (l ->> 'min_casa') ~ '^[0-9]{1,3}$' then (l ->> 'min_casa')::int end))
             from (select l from jsonb_array_elements(p) l limit 12) t
            where coalesce(trim(l ->> 'nome'), '') <> ''), '[]'::jsonb)),
         updated_at = now()
   where pf.user_id = auth.uid() and exists (select 1 from core.members m where m.user_id = auth.uid());
  get diagnostics v_ok = row_count;
  return v_ok;
end $$;
revoke all on function public.hub_lugares_salvar(jsonb) from public, anon;
grant execute on function public.hub_lugares_salvar(jsonb) to authenticated;

-- Mover um item da sugestão (dia e hora) enquanto o plano é rascunho.
create or replace function public.hub_semana_item_editar(p_id bigint, p_data date, p_hora text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  update core.planos_semana_itens i
     set data = p_data, hora = nullif(p_hora, '')::time
    from core.planos_semana p
   where i.id = p_id and p.id = i.plano_id and p.status = 'rascunho' and i.user_id = auth.uid()
     and p_data between p.semana and p.semana + 6
     and exists (select 1 from core.members m where m.user_id = auth.uid());
  get diagnostics v_ok = row_count;
  return v_ok;
end $$;
revoke all on function public.hub_semana_item_editar(bigint, date, text) from public, anon;
grant execute on function public.hub_semana_item_editar(bigint, date, text) to authenticated;

-- Plano da semana com a crítica.
create or replace function public.hub_semana() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select m.user_id from core.members m where m.user_id = auth.uid()),
  hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  p as (
    select ps.* from core.planos_semana ps, me, hoje
     where ps.user_id = me.user_id
       and ps.semana in (date_trunc('week', hoje.d)::date, case when extract(dow from hoje.d) = 0 then hoje.d + 1 end)
     order by ps.semana desc limit 1
  )
  select case when not exists (select 1 from me) then null else (
    select jsonb_build_object(
      'id', p.id, 'semana', p.semana, 'status', p.status, 'resumo', p.resumo, 'critica', p.critica,
      'criado_em', p.created_at, 'confirmado_em', p.confirmado_em,
      'itens', coalesce((
        select jsonb_agg(jsonb_build_object('id', i.id, 'data', i.data, 'hora', to_char(i.hora, 'HH24:MI'), 'area', i.area,
                                            'titulo', i.titulo, 'detalhe', i.detalhe, 'minutos', i.minutos, 'valor', i.valor,
                                            'incluido', i.incluido, 'status', ci.status)
                         order by i.data, i.hora nulls last, i.ordem)
          from core.planos_semana_itens i left join core.itens ci on ci.id = i.item_id
         where i.plano_id = p.id), '[]'::jsonb))
      from p) end;
$$;

-- Linha do tempo "Seu dia": itens do plano confirmado + expediente, compromissos e agenda de hoje.
create or replace function public.hub_semana_hoje() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select m.user_id from core.members m where m.user_id = auth.uid()),
  hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  plano as (
    select jsonb_build_object('hora', to_char(i.hora, 'HH24:MI'), 'area', i.area, 'titulo', i.titulo,
                              'minutos', i.minutos, 'ref', i.ref, 'feito', ci.status = 'feito') as v,
           i.hora as h, i.ordem as o
      from core.planos_semana_itens i
      join core.planos_semana p on p.id = i.plano_id and p.status = 'confirmado'
      left join core.itens ci on ci.id = i.item_id, me, hoje
     where i.user_id = me.user_id and i.data = hoje.d and i.incluido
  ),
  fixos as (
    select jsonb_build_object('hora', f ->> 'inicio', 'area', f ->> 'tipo', 'titulo', f ->> 'titulo',
                              'minutos', case when f ->> 'inicio' is not null and f ->> 'fim' is not null
                                              then (extract(epoch from ((f ->> 'fim')::time - (f ->> 'inicio')::time)) / 60)::int end,
                              'ref', null, 'feito', false) as v,
           (f ->> 'inicio')::time as h, 0 as o
      from me, hoje, jsonb_array_elements(core.fixos(me.user_id, hoje.d, hoje.d)) f
  )
  select case when not exists (select 1 from me) then null else coalesce((
    select jsonb_agg(v order by h nulls last, o) from (select * from plano union all select * from fixos) t), '[]'::jsonb) end;
$$;

-- 7) Sincronizar a agenda de hora em hora (sem IA).
do $$ begin
  if exists (select 1 from cron.job where jobname = 'iara-agenda-sync') then perform cron.unschedule('iara-agenda-sync'); end if;
  perform cron.schedule('iara-agenda-sync', '7 * * * *', $c$ select core_private.call_function('iara-agenda', '{"action":"sync"}'::jsonb) $c$);
end $$;
