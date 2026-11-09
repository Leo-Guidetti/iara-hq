create view public.weight_daily with (security_invoker = true) as
select distinct on (user_id, local_date)
  user_id, local_date, measured_at, weight_kg, fasted, source
from public.weight_entries
order by user_id, local_date, measured_at asc;

create view public.weight_with_trend with (security_invoker = true) as
select
  user_id,
  local_date,
  weight_kg,
  round(avg(weight_kg) over w, 2)  as trend_7d,
  count(*) over w                  as n_7d
from public.weight_daily
window w as (partition by user_id order by local_date
             range between interval '6 days' preceding and current row);

create view public.body_comp_estimates with (security_invoker = true) as
with m as (
  select distinct on (user_id, local_date) *
  from public.measurements
  where waist_cm is not null
  order by user_id, local_date, measured_at desc
),
calc as (
  select
    m.user_id, m.local_date, m.waist_cm, m.neck_cm, m.hip_cm,
    p.height_cm, p.sex,
    w.trend_7d as weight_ref_kg,
    case p.sex
      when 'male'   then 64 - 20 * (p.height_cm / m.waist_cm)
      when 'female' then 76 - 20 * (p.height_cm / m.waist_cm)
    end as bf_rfm,
    case
      when p.sex = 'male' and m.neck_cm is not null and m.waist_cm > m.neck_cm
        then 495 / (1.0324 - 0.19077 * log(m.waist_cm - m.neck_cm) + 0.15456 * log(p.height_cm)) - 450
      when p.sex = 'female' and m.neck_cm is not null and m.hip_cm is not null
        then 495 / (1.29579 - 0.35004 * log(m.waist_cm + m.hip_cm - m.neck_cm) + 0.22100 * log(p.height_cm)) - 450
    end as bf_navy
  from m
  join public.profiles p on p.id = m.user_id
  left join lateral (
    select t.trend_7d from public.weight_with_trend t
    where t.user_id = m.user_id and t.local_date between m.local_date - 7 and m.local_date
    order by t.local_date desc limit 1
  ) w on true
  where p.height_cm is not null and p.sex is not null
)
select
  user_id, local_date, waist_cm, neck_cm, hip_cm, height_cm, sex, weight_ref_kg,
  round(bf_rfm, 1)  as bf_rfm,
  round(bf_navy, 1) as bf_navy,
  round(coalesce((bf_rfm + bf_navy) / 2, bf_rfm, bf_navy), 1) as bf_mean,
  round(weight_ref_kg * coalesce((bf_rfm + bf_navy) / 2, bf_rfm, bf_navy) / 100, 1) as fat_mass_kg,
  round(weight_ref_kg * (1 - coalesce((bf_rfm + bf_navy) / 2, bf_rfm, bf_navy) / 100), 1) as lean_mass_kg,
  round(waist_cm / height_cm, 3) as waist_height_ratio
from calc;

create or replace function public.create_ingest_token(p_label text default 'iPhone')
returns text language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  tok text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  tok := 'cla_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.ingest_tokens (user_id, token_hash, label)
  values (uid, encode(sha256(convert_to(tok, 'UTF8')), 'hex'), coalesce(nullif(p_label, ''), 'iPhone'));
  return tok;
end $$;

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
    and t.revoked_at is null;
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

revoke execute on function public.create_ingest_token(text) from public, anon;
grant execute on function public.create_ingest_token(text) to authenticated;
revoke execute on function public.ingest_weight(text, numeric, timestamptz, text) from public;
grant execute on function public.ingest_weight(text, numeric, timestamptz, text) to anon, authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_local_date() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;;
