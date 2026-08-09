-- moderation_reviews: an operator's approve/reject decision on a single
-- generation, for the admin console's RAG Moderation Queue.
--
-- generation_log is append-only and written by the generation pipeline; review
-- state is a separate operator concern, so it lives in its own table rather
-- than as extra columns on the log. A generation with no row here is "pending".
--
-- Created at: 2024-03-02T00:00:00.000Z

create table if not exists moderation_reviews (
  generation_id uuid primary key references generation_log (id) on delete cascade,
  status text not null check (status in ('approved', 'rejected')),
  note text,
  -- Nullable: the console authenticates as an operator, not as an auth.users
  -- row, so the reviewer may not map to a Supabase user.
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz not null default now()
);

-- Serves "newest decisions first" and the status filter on the queue.
create index if not exists moderation_reviews_status_reviewed_at_idx
  on moderation_reviews (status, reviewed_at desc);

alter table moderation_reviews enable row level security;

-- Written only by the console via the service-role key (bypasses RLS). This
-- policy lets a user see decisions made on their own generations.
create policy "Users can view reviews of their own generations"
  on moderation_reviews for select
  using (
    exists (
      select 1 from generation_log g
      where g.id = moderation_reviews.generation_id
        and g.user_id = auth.uid()
    )
  );
