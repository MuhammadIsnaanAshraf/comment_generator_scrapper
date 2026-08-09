-- Auto-provision a user_profiles row for every new auth.users row.
-- A freshly signed-up user has no profile yet, so getUserProfile
-- (backend/src/services/user-profile.ts) falls back to DEFAULT_PROFILE.
-- This trigger gives every new user their own row out of the box.
--
-- Notes:
-- * SECURITY DEFINER + `search_path = public` so the function can insert
--   into RLS-protected user_profiles when fired by the auth role.
-- * `on conflict (user_id) do nothing` keeps the trigger idempotent if a
--   row was already created out-of-band for that user.
-- * name is required (not null); default to the OAuth full_name when
--   present, otherwise the email local-part.
-- Created at: 2026-08-09T00:00:00.000Z

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (user_id, name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Recreate if it already exists (e.g. this migration was applied before).
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
