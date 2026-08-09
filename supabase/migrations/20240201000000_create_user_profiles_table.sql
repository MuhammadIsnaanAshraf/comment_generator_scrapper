-- user_profiles: one row per user, holding the identity/background info
-- injected into the comment-generation prompt via {{user_background}}
-- (see buildUserBackgroundBlock in groq-service.ts). Falls back to a
-- built-in default profile when a user has no row yet (see user-profile.ts).
-- Created at: 2024-02-01T00:00:00.000Z

create table if not exists user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  headline text,
  background_json jsonb not null default '{}'::jsonb,
  tone_preferences jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table user_profiles enable row level security;

-- Reads happen from the backend via the service-role key (bypasses RLS).
-- These policies let a user manage their own profile directly if ever
-- queried with their session token (e.g. from a future settings page).
create policy "Users can view their own profile"
  on user_profiles for select
  using (auth.uid() = user_id);

create policy "Users can insert their own profile"
  on user_profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own profile"
  on user_profiles for update
  using (auth.uid() = user_id);
