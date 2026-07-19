-- generation_log: one row per comment-generation call, used to detect
-- overuse of the BMC background story across a user's recent history.
-- Created at: 2024-01-01T00:00:01.000Z

create table if not exists generation_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  post_url text not null,
  post_text text not null,
  category text,
  stance_1 text,
  stance_2 text,
  comment_1 text,
  comment_2 text,
  bmc_used boolean not null default false,
  created_at timestamptz not null default now()
);

-- Serves "last N rows for this user, newest first" — the only access
-- pattern this table needs (see getBmcUsedRecently in generation-log.ts).
create index if not exists generation_log_user_id_created_at_idx
  on generation_log (user_id, created_at desc);

alter table generation_log enable row level security;

-- Writes happen only from the backend via the service-role key (bypasses
-- RLS). This policy just lets a user read their own history if ever
-- queried with their session token (e.g. from the dashboard).
create policy "Users can view their own generation logs"
  on generation_log for select
  using (auth.uid() = user_id);