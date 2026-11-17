-- UX-19 · Falar com a IARA pela Siri. Token de ingestão com escopo + entrada do iara-comando por token. Só aditivo.
-- Escopo: tokens existentes continuam só com {peso}. Token que fala com a IARA tem escopo {iara} e prefixo iar_
-- (o claudia-ingest só aceita cla_..., então ele não serve para gravar peso).
alter table public.ingest_tokens add column if not exists escopos text[] not null default '{peso}';

-- Cria o token do Atalho da Siri (mostrado uma vez; no banco só o hash sha-256, como o cla_).
create or replace function public.create_ingest_token_iara(p_label text default 'Siri')
returns text language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  tok text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from core.members m where m.user_id = uid) then raise exception 'sem acesso'; end if;
  tok := 'iar_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.ingest_tokens (user_id, token_hash, label, escopos)
  values (uid, encode(sha256(convert_to(tok, 'UTF8')), 'hex'), coalesce(nullif(left(p_label, 40), ''), 'Siri'), '{iara}');
  return tok;
end $$;
revoke all on function public.create_ingest_token_iara(text) from public, anon;
grant execute on function public.create_ingest_token_iara(text) to authenticated;

-- Porta do iara-comando por token: valida (hash, não revogado, escopo iara, membro), aplica o limite de 10 comandos por
-- minuto por usuário (conta core.agent_runs tipo comando com via=token) e marca last_used_at.
-- Devolve {user_id, token_id, status: 'ok'|'limite'}, ou null se o token não vale. Só o backend (role postgres) chama.
create or replace function core.iara_token_entrar(p_token text, p_limite int default 10)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.ingest_tokens; n int;
begin
  if p_token is null or p_token !~ '^iar_[0-9a-f]{48}$' then return null; end if;
  select * into t from public.ingest_tokens x
   where x.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and x.revoked_at is null and 'iara' = any (x.escopos);
  if not found then return null; end if;
  if not exists (select 1 from core.members m where m.user_id = t.user_id) then return null; end if;
  select count(*) into n from core.agent_runs r
   where r.user_id = t.user_id and r.tipo = 'comando' and r.input ->> 'via' = 'token' and r.started_at > now() - interval '1 minute';
  if n >= p_limite then
    return jsonb_build_object('user_id', t.user_id, 'token_id', t.id, 'status', 'limite');
  end if;
  update public.ingest_tokens set last_used_at = now() where id = t.id;
  return jsonb_build_object('user_id', t.user_id, 'token_id', t.id, 'status', 'ok');
end $$;
revoke all on function core.iara_token_entrar(text, int) from public, anon, authenticated;

-- Escopo 'peso' obrigatório nas entradas por token (iar_ não grava peso/saúde). Corpo idêntico ao de produção + a cláusula de escopo.
create or replace function public.ingest_health(p_token text, p_activities jsonb default '[]', p_daily jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid; tid bigint; a jsonb; d jsonb; n_act int := 0; n_day int := 0; sp text;
begin
  select t.user_id, t.id into uid, tid from public.ingest_tokens t
  where t.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and t.revoked_at is null and 'peso' = any (t.escopos);
  if uid is null then raise exception 'invalid token' using errcode = '28000'; end if;
  if jsonb_array_length(coalesce(p_activities, '[]')) > 200 or jsonb_array_length(coalesce(p_daily, '[]')) > 400 then
    raise exception 'batch too large' using errcode = '22003';
  end if;
  update public.ingest_tokens set last_used_at = now() where id = tid;

  for a in select * from jsonb_array_elements(coalesce(p_activities, '[]')) loop
    sp := a ->> 'sport';
    if sp is null or sp not in ('run', 'walk', 'hike', 'swim', 'ride_indoor', 'ride_outdoor', 'strength', 'hiit', 'yoga', 'mobility', 'row', 'other') then sp := 'other'; end if;
    if (a ->> 'duration_min')::numeric is null or (a ->> 'duration_min')::numeric <= 0 or (a ->> 'started_at') is null then continue; end if;
    insert into public.activities (user_id, started_at, sport, title, duration_min, distance_km, elevation_m, avg_hr, max_hr,
                                   avg_power_w, avg_cadence, kcal, source, external_id, details)
    values (uid, (a ->> 'started_at')::timestamptz, sp, left(a ->> 'title', 120),
            least((a ->> 'duration_min')::numeric, 1440), nullif(a ->> 'distance_km', '')::numeric,
            nullif(a ->> 'elevation_m', '')::numeric::int, nullif(a ->> 'avg_hr', '')::numeric::int, nullif(a ->> 'max_hr', '')::numeric::int,
            nullif(a ->> 'avg_power_w', '')::numeric::int, nullif(a ->> 'avg_cadence', '')::numeric::int,
            nullif(a ->> 'kcal', '')::numeric::int, 'apple_health', left(a ->> 'external_id', 200), coalesce(a -> 'details', '{}'))
    on conflict (user_id, source, external_id) where external_id is not null do update set
      sport = excluded.sport, title = excluded.title, duration_min = excluded.duration_min, distance_km = excluded.distance_km,
      elevation_m = excluded.elevation_m, avg_hr = excluded.avg_hr, max_hr = excluded.max_hr, avg_power_w = excluded.avg_power_w,
      avg_cadence = excluded.avg_cadence, kcal = excluded.kcal, details = excluded.details;
    n_act := n_act + 1;
  end loop;

  for d in select * from jsonb_array_elements(coalesce(p_daily, '[]')) loop
    if (d ->> 'local_date') is null then continue; end if;
    insert into public.daily_activity (user_id, local_date, steps, active_kcal, resting_kcal, exercise_min, sleep_min, resting_hr, hrv_ms, source, updated_at)
    values (uid, (d ->> 'local_date')::date, nullif(d ->> 'steps', '')::numeric::int, nullif(d ->> 'active_kcal', '')::numeric::int,
            nullif(d ->> 'resting_kcal', '')::numeric::int, nullif(d ->> 'exercise_min', '')::numeric::int, nullif(d ->> 'sleep_min', '')::numeric::int,
            nullif(d ->> 'resting_hr', '')::numeric::int, nullif(d ->> 'hrv_ms', '')::numeric, 'apple_health', now())
    on conflict (user_id, local_date) do update set
      steps = coalesce(excluded.steps, public.daily_activity.steps),
      active_kcal = coalesce(excluded.active_kcal, public.daily_activity.active_kcal),
      resting_kcal = coalesce(excluded.resting_kcal, public.daily_activity.resting_kcal),
      exercise_min = coalesce(excluded.exercise_min, public.daily_activity.exercise_min),
      sleep_min = coalesce(excluded.sleep_min, public.daily_activity.sleep_min),
      resting_hr = coalesce(excluded.resting_hr, public.daily_activity.resting_hr),
      hrv_ms = coalesce(excluded.hrv_ms, public.daily_activity.hrv_ms),
      updated_at = now();
    n_day := n_day + 1;
  end loop;
  return jsonb_build_object('activities', n_act, 'days', n_day);
end $$;
revoke execute on function public.ingest_health(text, jsonb, jsonb) from public, authenticated;
grant execute on function public.ingest_health(text, jsonb, jsonb) to anon;

create or replace function public.ingest_weight(
  p_token        text,
  p_weight_kg    numeric,
  p_measured_at  timestamptz default now(),
  p_source       text default 'shortcut'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
  tid bigint;
  existing bigint;
  new_id bigint;
  ld date;
begin
  select t.user_id, t.id into uid, tid
  from public.ingest_tokens t
  where t.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and t.revoked_at is null and 'peso' = any (t.escopos);
  if uid is null then raise exception 'invalid token' using errcode = '28000'; end if;

  if p_weight_kg is null or p_weight_kg < 30 or p_weight_kg > 300 then
    raise exception 'weight out of range' using errcode = '22003';
  end if;

  update public.ingest_tokens set last_used_at = now() where id = tid;

  select e.id into existing from public.weight_entries e
  where e.user_id = uid
    and e.weight_kg = round(p_weight_kg, 2)
    and e.measured_at between p_measured_at - interval '2 minutes' and p_measured_at + interval '2 minutes'
  limit 1;
  if existing is not null then
    return jsonb_build_object('id', existing, 'duplicate', true);
  end if;

  insert into public.weight_entries (user_id, measured_at, weight_kg, source)
  values (uid, coalesce(p_measured_at, now()), round(p_weight_kg, 2),
          case when p_source in ('shortcut', 'apple_health') then p_source else 'shortcut' end)
  returning id, local_date into new_id, ld;

  return jsonb_build_object('id', new_id, 'local_date', ld, 'duplicate', false);
end $$;

revoke execute on function public.ingest_weight(text, numeric, timestamptz, text) from public, authenticated;
grant execute on function public.ingest_weight(text, numeric, timestamptz, text) to anon;
