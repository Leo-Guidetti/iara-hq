revoke execute on function airton._uid(uuid) from anon, public;
revoke execute on function airton.is_member() from anon, public;
grant execute on function airton._uid(uuid) to authenticated, service_role;
grant execute on function airton.is_member() to authenticated, service_role;;
