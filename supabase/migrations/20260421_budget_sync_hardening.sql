do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_profiles'
      and policyname = 'Users can delete their own profile'
  ) then
    create policy "Users can delete their own profile"
    on public.user_profiles
    for delete
    using (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_snapshots'
      and policyname = 'Users can delete their own snapshot'
  ) then
    create policy "Users can delete their own snapshot"
    on public.user_snapshots
    for delete
    using (auth.uid() = user_id);
  end if;
end
$$;
