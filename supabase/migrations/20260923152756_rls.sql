do $$
declare t text;
begin
  foreach t in array array[
    'weight_entries', 'measurements', 'progress_photos', 'photo_reviews',
    'medication_logs', 'daily_activity', 'workout_plans', 'workout_logs',
    'food_logs', 'diet_recommendations'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using ((select auth.uid()) = user_id)
         with check ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
create policy "own profile read" on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy "own profile update" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

alter table public.ingest_tokens enable row level security;
revoke all on public.ingest_tokens from anon;
revoke insert, update on public.ingest_tokens from authenticated;
grant update (label, revoked_at) on public.ingest_tokens to authenticated;
create policy "own tokens read" on public.ingest_tokens for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "own tokens revoke" on public.ingest_tokens for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own tokens delete" on public.ingest_tokens for delete to authenticated
  using ((select auth.uid()) = user_id);;
