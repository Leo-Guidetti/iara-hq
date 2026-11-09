create or replace function airton._employment_for(p_user uuid, p_date date, p_desc text)
returns airton.employments language sql stable set search_path to '' as $$
  select e.* from airton.employments e
   where e.user_id = p_user
     and p_date >= e.start_date - 10 and (e.end_date is null or p_date <= e.end_date + 45)
     and exists (select 1 from unnest(e.payer_terms) t where length(btrim(t)) >= 3 and p_desc ilike '%' || btrim(t) || '%')
   order by (p_date between e.start_date and coalesce(e.end_date, '9999-12-31')) desc, e.start_date desc limit 1
$$;
do $$
declare r record;
begin
  for r in select id from airton.employments where user_id = '69706b26-5f72-4dfd-9d81-8ecb8157086c' and employer = 'XP' order by start_date loop
    perform airton.apply_employment(r.id);
  end loop;
end $$;;
