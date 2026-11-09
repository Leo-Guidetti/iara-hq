
do $$
declare t text;
begin
  foreach t in array array['settings','accounts','categories','transactions','rules','planned_events','installment_plans',
    'goals','inv_snapshot','inv_position','inv_product_info','of_items','sync_runs','push_subscriptions','ai_usage',
    'chat_messages','notify_log']
  loop
    execute format('alter table airton.%I enable row level security', t);
    execute format($p$create policy owner_all on airton.%I for all to authenticated
      using (user_id = (select auth.uid()) and (select airton.is_member()))
      with check (user_id = (select auth.uid()) and (select airton.is_member()))$p$, t);
  end loop;
end $$;

alter table airton.members enable row level security;
create policy self_read on airton.members for select to authenticated using (user_id = (select auth.uid()));

alter table airton_private.kv enable row level security;

grant usage on schema airton to authenticated, service_role;
grant select, insert, update, delete on all tables in schema airton to authenticated;
grant all on all tables in schema airton to service_role;
grant usage, select on all sequences in schema airton to authenticated, service_role;
grant execute on all functions in schema airton to authenticated, service_role;
alter default privileges in schema airton grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema airton grant all on tables to service_role;
alter default privileges in schema airton grant execute on functions to authenticated, service_role;
revoke insert, update, delete on airton.members from authenticated;
grant usage on schema airton_private to service_role;
grant all on all tables in schema airton_private to service_role;

-- dono: só a conta do Leo usa o AIrton (o projeto ClaudIA tem outros usuários)
insert into airton.members (user_id)
select id from auth.users where lower(email) = 'leonardoguidettic@gmail.com'
on conflict do nothing;
;
