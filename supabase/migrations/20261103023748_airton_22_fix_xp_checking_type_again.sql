do $$
declare v_user uuid := '69706b26-5f72-4dfd-9d81-8ecb8157086c'; r record;
begin
  -- o final 3067 é da conta corrente E da conta investimento; não forçar "investimento" pelo final do número
  insert into airton.settings (user_id, key, value) values (v_user, 'investment_last4', '["nenhum"]'::jsonb)
  on conflict (user_id, key) do update set value = excluded.value;
  update airton.accounts set type = 'checking' where user_id = v_user and name = 'Conta corrente XP';
  for r in select id from airton.employments where user_id = v_user and employer = 'XP' order by start_date loop
    perform airton.apply_employment(r.id);
  end loop;
end $$;;
