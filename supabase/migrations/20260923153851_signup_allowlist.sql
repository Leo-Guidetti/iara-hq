create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.allowed_emails (email text primary key);
insert into private.allowed_emails values ('leonardoguidettic@gmail.com');

create or replace function private.enforce_signup_allowlist()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.allowed_emails a where a.email = lower(new.email)) then
    raise exception 'signup not allowed';
  end if;
  return new;
end $$;

create trigger enforce_signup_allowlist
  before insert on auth.users
  for each row execute function private.enforce_signup_allowlist();;
