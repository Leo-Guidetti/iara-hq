-- Pedido do Leo (23/11): marcar em quais dias do expediente ele faz home office e em quais vai presencial.
-- config.expediente ganha "casa": dias (isodow, subconjunto de "dias") em home office. Nos outros dias o
-- trabalho é presencial em "local". core.fixos usa isso: home office vira local "Casa" (deslocamento zero).

create or replace function public.hub_expediente_salvar(p jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ok boolean; v_dias jsonb;
begin
  v_dias := coalesce(p -> 'dias', '[1,2,3,4,5]'::jsonb);
  update core.perfil pf
     set config = case when p is null or jsonb_typeof(p) <> 'object' then coalesce(pf.config, '{}'::jsonb) - 'expediente'
                       else coalesce(pf.config, '{}'::jsonb) || jsonb_build_object('expediente', jsonb_build_object(
                              'dias', v_dias,
                              'inicio', coalesce(p ->> 'inicio', '09:00'), 'fim', coalesce(p ->> 'fim', '18:00'),
                              'titulo', coalesce(nullif(p ->> 'titulo', ''), 'Trabalho'),
                              'local', nullif(trim(coalesce(p ->> 'local', '')), ''),
                              -- sem "casa" no pedido (ex.: comando de voz antigo), mantém o que já estava
                              'casa', coalesce((select jsonb_agg(d order by d) from jsonb_array_elements(
                                         case when jsonb_typeof(p -> 'casa') = 'array' then p -> 'casa'
                                              else coalesce(pf.config -> 'expediente' -> 'casa', '[]'::jsonb) end) d
                                         where d in (select jsonb_array_elements(v_dias))), '[]'::jsonb))) end,
         updated_at = now()
   where pf.user_id = auth.uid() and exists (select 1 from core.members m where m.user_id = auth.uid());
  get diagnostics v_ok = row_count;
  return v_ok;
end $$;
revoke all on function public.hub_expediente_salvar(jsonb) from public, anon;
grant execute on function public.hub_expediente_salvar(jsonb) to authenticated;

create or replace function core.fixos(p_user uuid, p_de date, p_ate date) returns jsonb
language sql stable security definer set search_path = '' as $$
  with exp as (select p.config -> 'expediente' as e from core.perfil p where p.user_id = p_user),
  dias as (select d::date as d from generate_series(p_de, p_ate, interval '1 day') g(d)),
  x as (
    select jsonb_build_object('data', dias.d, 'inicio', exp.e ->> 'inicio', 'fim', exp.e ->> 'fim',
                              'titulo', coalesce(nullif(exp.e ->> 'titulo', ''), 'Trabalho') || case when ho then ' (home office)' else '' end,
                              'tipo', 'trabalho', 'fonte', 'expediente', 'id', null,
                              'local', case when ho then 'Casa' else nullif(exp.e ->> 'local', '') end,
                              'modo', case when ho then 'home_office' else 'presencial' end) as v
      from dias, exp,
           lateral (select jsonb_typeof(exp.e -> 'casa') = 'array'
                       and (exp.e -> 'casa') @> to_jsonb(extract(isodow from dias.d)::int) as ho) h
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
