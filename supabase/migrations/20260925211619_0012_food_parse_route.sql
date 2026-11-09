alter table public.ai_usage drop constraint if exists ai_usage_route_check;
alter table public.ai_usage add constraint ai_usage_route_check
  check (route in ('photo-review', 'coach', 'diet', 'checkin', 'coach-chat', 'coach-session', 'food-parse'));
create index if not exists food_logs_user_date on public.food_logs (user_id, local_date desc);;
