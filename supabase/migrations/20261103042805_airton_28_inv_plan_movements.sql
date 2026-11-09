create table if not exists airton.inv_plan (
  id bigserial primary key,
  user_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  content jsonb not null,
  context jsonb,
  model text
);
create table if not exists airton.inv_of (
  user_id uuid not null,
  pluggy_id text not null,
  produto text,
  raw jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, pluggy_id)
);
create table if not exists airton.inv_movements (
  user_id uuid not null,
  pluggy_id text not null,
  investment_id text,
  produto text,
  date date not null,
  type text,
  movement_type text,
  amount numeric,
  raw jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, pluggy_id)
);
create index if not exists inv_movements_user_date on airton.inv_movements (user_id, date);
create index if not exists inv_plan_user_created on airton.inv_plan (user_id, created_at desc);
do $$
declare t text;
begin
  foreach t in array array['inv_plan','inv_of','inv_movements'] loop
    execute format('alter table airton.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname='airton' and tablename=t and policyname='owner_all') then
      execute format('create policy owner_all on airton.%I for all to authenticated using (user_id = auth.uid() and airton.is_member()) with check (user_id = auth.uid() and airton.is_member())', t);
    end if;
    execute format('grant all on airton.%I to authenticated, service_role', t);
  end loop;
end $$;
grant usage, select on sequence airton.inv_plan_id_seq to authenticated, service_role;;
